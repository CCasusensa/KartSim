package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"kartsim/internal/data/store"
	"kartsim/internal/shared/apierr"
)

// 大厅宣传 (ADMIN.md 10): the lobby home's promotion carousel and its two
// promotion boards. Players read GET /api/lobby/promos and the pictures
// (public; a picture's id is its content hash, so it is cached for good);
// the admin console uploads pictures and sets which shows where, each with
// an optional link.

const (
	maxPromoImageBytes = 4 << 20
	maxPromoImageSide  = 4096
	maxPromoLink       = 500
	maxPromoTitle      = 40
	promoImagePath     = "/api/lobby/promo-images/"
)

var (
	errInvalidLobbyPromos = apierr.New(http.StatusBadRequest, "INVALID_LOBBY_PROMOS")
	errInvalidPromoImage  = apierr.New(http.StatusBadRequest, "INVALID_PROMO_IMAGE")
	errPromoImageTooLarge = apierr.New(http.StatusRequestEntityTooLarge, "PROMO_IMAGE_TOO_LARGE")
	promoImageID          = regexp.MustCompile(`^[0-9a-f]{32}$`)
)

// lobbyPromoJSON is one carousel picture or board as the client reads it.
type lobbyPromoJSON struct {
	Image  string `json:"image"`
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Link   string `json:"link"`
	Title  string `json:"title"`
}

type lobbyPromosJSON struct {
	Interval  int              `json:"interval"`
	Carousel  []lobbyPromoJSON `json:"carousel"`
	Boards    []lobbyPromoJSON `json:"boards"`
	UpdatedAt int64            `json:"updatedAt"`
	UpdatedBy string           `json:"updatedBy,omitempty"`
}

// lobbyPromosJSON adds the pictures' paths and sizes. Carousel entries
// whose picture is gone are left out; a board whose picture is gone keeps
// its link and title.
func (a *API) lobbyPromosJSON(r *http.Request, promos store.LobbyPromos) (lobbyPromosJSON, error) {
	images, err := a.store.LobbyPromoImages(r.Context(), promos.Images())
	if err != nil {
		return lobbyPromosJSON{}, err
	}
	entry := func(promo store.LobbyPromo) (lobbyPromoJSON, bool) {
		out := lobbyPromoJSON{Link: promo.Link, Title: promo.Title}
		image, ok := images[promo.Image]
		if ok {
			out.Image, out.URL, out.Width, out.Height = image.ID, promoImagePath+image.ID, image.Width, image.Height
		}
		return out, ok
	}
	out := lobbyPromosJSON{Interval: promos.Interval, Carousel: []lobbyPromoJSON{}, Boards: []lobbyPromoJSON{},
		UpdatedAt: promos.UpdatedAt}
	for _, promo := range promos.Carousel {
		if slide, ok := entry(promo); ok {
			out.Carousel = append(out.Carousel, slide)
		}
	}
	for _, promo := range promos.Boards {
		board, _ := entry(promo)
		out.Boards = append(out.Boards, board)
	}
	return out, nil
}

// lobbyPromos answers what the lobby home's promotion column shows.
func (a *API) lobbyPromos(w http.ResponseWriter, r *http.Request) error {
	promos, err := a.store.LobbyPromos(r.Context())
	if err != nil {
		return err
	}
	out, err := a.lobbyPromosJSON(r, promos)
	if err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "no-cache")
	return writeJSON(w, http.StatusOK, out)
}

// lobbyPromoImage serves an uploaded picture. Its id is its content hash,
// so every answer may be cached for good.
func (a *API) lobbyPromoImage(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("id")
	if !promoImageID.MatchString(id) {
		return store.ErrLobbyImageNotFound
	}
	header := w.Header()
	etag := `"promo-` + id + `"`
	header.Set("Cache-Control", "public, max-age=31536000, immutable")
	header.Set("ETag", etag)
	// The game page may be on another origin.
	header.Set("Cross-Origin-Resource-Policy", "cross-origin")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return nil
	}
	image, err := a.store.LobbyPromoImage(r.Context(), id)
	if err != nil {
		header.Del("Cache-Control")
		header.Del("ETag")
		return err
	}
	header.Set("Content-Type", image.ContentType)
	header.Set("Content-Length", strconv.Itoa(len(image.Data)))
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(image.Data)
	return nil
}

// adminLobbyPromos answers the settings with the pictures' details.
func (a *API) adminLobbyPromos(w http.ResponseWriter, r *http.Request) error {
	if _, err := a.requireAdmin(r); err != nil {
		return err
	}
	promos, err := a.store.LobbyPromos(r.Context())
	if err != nil {
		return err
	}
	out, err := a.lobbyPromosJSON(r, promos)
	if err != nil {
		return err
	}
	out.UpdatedBy = promos.UpdatedBy
	return writeJSON(w, http.StatusOK, out)
}

// adminSaveLobbyPromos stores {interval, carousel[{image,link,title}],
// boards[{image,link,title} ×2]}: 0–8 carousel pictures, each with an
// uploaded picture; boards may leave the picture out (the drawn board with
// its title, COMING SOON when empty). Links are http(s) URLs or paths of
// the game's own site. Players see the change on their next lobby home.
func (a *API) adminSaveLobbyPromos(w http.ResponseWriter, r *http.Request) error {
	var request struct {
		Interval int                `json:"interval"`
		Carousel []store.LobbyPromo `json:"carousel"`
		Boards   []store.LobbyPromo `json:"boards"`
	}
	if err := decodeJSON(w, r, &request); err != nil {
		return err
	}
	admin, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	promos := store.LobbyPromos{Interval: request.Interval, Carousel: []store.LobbyPromo{}}
	if promos.Interval == 0 {
		promos.Interval = store.DefaultLobbyInterval
	}
	if promos.Interval < store.MinLobbyInterval || promos.Interval > store.MaxLobbyInterval ||
		len(request.Carousel) > store.MaxLobbyCarousel || len(request.Boards) > store.LobbyBoards {
		return errInvalidLobbyPromos
	}
	for _, slide := range request.Carousel {
		slide, ok := cleanLobbyPromo(slide)
		if !ok || slide.Image == "" {
			return errInvalidLobbyPromos
		}
		promos.Carousel = append(promos.Carousel, slide)
	}
	for i, board := range request.Boards {
		board, ok := cleanLobbyPromo(board)
		if !ok {
			return errInvalidLobbyPromos
		}
		promos.Boards[i] = board
	}
	saved, err := a.store.SaveLobbyPromos(r.Context(), promos, admin.Username, a.nowMillis())
	if err != nil {
		return err
	}
	a.log.Info("admin lobby promos", "admin", admin.Username, "carousel", len(saved.Carousel),
		"interval", saved.Interval, "boardImages", []bool{saved.Boards[0].Image != "", saved.Boards[1].Image != ""})
	out, err := a.lobbyPromosJSON(r, saved)
	if err != nil {
		return err
	}
	out.UpdatedBy = saved.UpdatedBy
	return writeJSON(w, http.StatusOK, out)
}

// cleanLobbyPromo trims the fields and checks them.
func cleanLobbyPromo(promo store.LobbyPromo) (store.LobbyPromo, bool) {
	promo.Link, promo.Title = strings.TrimSpace(promo.Link), strings.TrimSpace(promo.Title)
	ok := (promo.Image == "" || promoImageID.MatchString(promo.Image)) && validPromoLink(promo.Link) &&
		(promo.Title == "" || validText(promo.Title, maxPromoTitle))
	return promo, ok
}

// validPromoLink accepts no link, an http(s) URL with a host, or a path on
// the game's own site ("/editor.html").
func validPromoLink(link string) bool {
	if link == "" {
		return true
	}
	if len(link) > maxPromoLink || !utf8.ValidString(link) || strings.ContainsAny(link, "\\<>\"'`") {
		return false
	}
	for _, r := range link {
		if r <= ' ' || r == 0x7f || isISOControl(r) {
			return false
		}
	}
	if strings.HasPrefix(link, "/") {
		return !strings.HasPrefix(link, "//")
	}
	parsed, err := url.Parse(link)
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != "" &&
		parsed.User == nil
}

// adminUploadPromoImage stores the picture in the body (PNG, JPEG, GIF or
// WebP, at most 4 MiB and 4096 px a side) and answers its id and size.
func (a *API) adminUploadPromoImage(w http.ResponseWriter, r *http.Request) error {
	admin, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxPromoImageBytes))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return errPromoImageTooLarge
		}
		return errInvalidPromoImage
	}
	contentType, width, height, ok := inspectPromoImage(data)
	if !ok {
		return errInvalidPromoImage
	}
	digest := sha256.Sum256(data)
	image, err := a.store.SaveLobbyPromoImage(r.Context(), store.LobbyPromoImage{
		ID: hex.EncodeToString(digest[:16]), ContentType: contentType, Width: width, Height: height,
		Data: data, CreatedBy: admin.Username,
	}, a.nowMillis())
	if err != nil {
		return err
	}
	a.log.Info("admin lobby promo picture", "admin", admin.Username, "image", image.ID,
		"type", image.ContentType, "width", image.Width, "height", image.Height, "bytes", image.Size)
	return writeJSON(w, http.StatusOK, map[string]any{"image": image.ID, "url": promoImagePath + image.ID,
		"contentType": image.ContentType, "width": image.Width, "height": image.Height, "size": image.Size})
}

// inspectPromoImage reads the type and size of a PNG, JPEG, GIF or WebP
// picture; anything else (SVG included) is refused.
func inspectPromoImage(data []byte) (contentType string, width, height int, ok bool) {
	contentType = http.DetectContentType(data)
	reader := bytes.NewReader(data)
	switch contentType {
	case "image/png":
		config, err := png.DecodeConfig(reader)
		ok, width, height = err == nil, config.Width, config.Height
	case "image/jpeg":
		config, err := jpeg.DecodeConfig(reader)
		ok, width, height = err == nil, config.Width, config.Height
	case "image/gif":
		config, err := gif.DecodeConfig(reader)
		ok, width, height = err == nil, config.Width, config.Height
	case "image/webp":
		width, height, ok = webpSize(data)
	}
	ok = ok && width > 0 && height > 0 && width <= maxPromoImageSide && height <= maxPromoImageSide
	return contentType, width, height, ok
}

// webpSize reads a WebP picture's canvas size from its first chunk: VP8X
// (extended), VP8L (lossless) or "VP8 " (lossy).
func webpSize(data []byte) (width, height int, ok bool) {
	if len(data) < 30 || string(data[0:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		return 0, 0, false
	}
	body := data[20:]
	switch string(data[12:16]) {
	case "VP8X":
		width = 1 + (int(body[4]) | int(body[5])<<8 | int(body[6])<<16)
		height = 1 + (int(body[7]) | int(body[8])<<8 | int(body[9])<<16)
		return width, height, true
	case "VP8L":
		if body[0] != 0x2f {
			return 0, 0, false
		}
		bits := binary.LittleEndian.Uint32(body[1:5])
		return int(bits&0x3fff) + 1, int(bits>>14&0x3fff) + 1, true
	case "VP8 ":
		if body[3] != 0x9d || body[4] != 0x01 || body[5] != 0x2a {
			return 0, 0, false
		}
		return int(binary.LittleEndian.Uint16(body[6:8]) & 0x3fff),
			int(binary.LittleEndian.Uint16(body[8:10]) & 0x3fff), true
	}
	return 0, 0, false
}
