package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"kartsim/internal/data/store"
	"kartsim/internal/shared/apierr"
)

// 地图工坊 (MAPS.md): published player-made tracks. Listing and downloads
// are public (every racer of a room needs the track); publishing and
// deleting need the author's session.

const (
	// maxMapContainer bounds a packed track container.
	maxMapContainer = 40 << 20
	maxMapPicture   = 1 << 20
	maxMapDesign    = 4 << 20
	maxMapFiles     = 2000
	// maxMapUpload bounds the whole multipart body.
	maxMapUpload = maxMapContainer + 2*maxMapPicture + maxMapDesign + 1<<20
	// mapsPerAccount bounds how many maps one account may publish.
	mapsPerAccount = 20
	// maxMapItems bounds a map's item boxes (the client's cube ids run 1..2048).
	maxMapItems = 2048
	// mapUploadTimeout replaces requestTimeout for the upload itself.
	mapUploadTimeout = 3 * time.Minute
)

var (
	errInvalidMap = apierr.New(http.StatusBadRequest, "INVALID_MAP")
	mapIDPattern  = regexp.MustCompile(`^[0-9a-z]{6,16}$`)
	mapFileName   = regexp.MustCompile(`^[A-Za-z0-9_@\-.]{1,80}$`)
	mapTheme      = regexp.MustCompile(`^[A-Za-z]{2,16}$`)
	pngSignature  = []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}
)

func (a *API) listMaps(w http.ResponseWriter, r *http.Request) error {
	maps, err := a.store.PublishedMaps(r.Context())
	if err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "no-cache")
	return writeJSON(w, http.StatusOK, map[string]any{"maps": maps})
}

func (a *API) myMaps(w http.ResponseWriter, r *http.Request) error {
	account, err := a.signedIn(r)
	if err != nil {
		return err
	}
	maps, err := a.store.OwnedMaps(r.Context(), account.ID)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"maps": maps})
}

func mapID(r *http.Request) (string, error) {
	id := r.PathValue("id")
	if !mapIDPattern.MatchString(id) {
		return "", store.ErrMapNotFound
	}
	return id, nil
}

func (a *API) getMap(w http.ResponseWriter, r *http.Request) error {
	id, err := mapID(r)
	if err != nil {
		return err
	}
	m, err := a.store.CustomMapByID(r.Context(), id)
	if err != nil {
		return err
	}
	if m.Hidden {
		return store.ErrMapNotFound
	}
	w.Header().Set("Cache-Control", "no-cache")
	return writeJSON(w, http.StatusOK, m)
}

// mapFile serves the container, the picker pictures or the design. A request
// naming the current sha256 (?v=) may be cached for good: a new version has
// a new hash.
func (a *API) mapFile(w http.ResponseWriter, r *http.Request) error {
	return a.serveMapFile(w, r, false)
}

// serveMapFile answers mapFile; for the admin console (admin) hidden maps
// are served too, and only to the admin's own browser cache.
func (a *API) serveMapFile(w http.ResponseWriter, r *http.Request, admin bool) error {
	id, err := mapID(r)
	if err != nil {
		return err
	}
	kind := r.PathValue("file")
	contentType := map[string]string{"container": "application/octet-stream", "card": "image/png",
		"thumb": "image/png", "design": "application/json"}[kind]
	if contentType == "" {
		return store.ErrMapNotFound
	}
	m, err := a.store.CustomMapByID(r.Context(), id)
	if err != nil {
		return err
	}
	if m.Hidden && !admin {
		return store.ErrMapNotFound
	}
	etag := `"map-` + m.SHA256 + `-` + kind + `"`
	immutable := r.URL.Query().Get("v") == m.SHA256 && kind != "design"
	switch {
	case immutable && admin:
		w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	case immutable:
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	case admin:
		w.Header().Set("Cache-Control", "private, no-cache")
	default:
		w.Header().Set("Cache-Control", "no-cache")
	}
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return nil
	}
	data, err := a.store.MapBlob(r.Context(), id, kind)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
	return nil
}

func readPart(form *multipart.Form, name string, limit int64) ([]byte, error) {
	files := form.File[name]
	if len(files) != 1 || files[0].Size <= 0 || files[0].Size > limit {
		return nil, errInvalidMap
	}
	file, err := files[0].Open()
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return io.ReadAll(io.LimitReader(file, limit+1))
}

// validMapName: 1–24 code points after trimming, no control characters.
func validMapName(name string) bool {
	if !utf8.ValidString(name) || name == "" || utf8.RuneCountInString(name) > 24 {
		return false
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

// parseMapUpload checks the multipart publish request (MAPS.md 3).
func parseMapUpload(id string, form *multipart.Form) (store.MapUpload, error) {
	var meta struct {
		ID         string          `json:"id"`
		Name       string          `json:"name"`
		Theme      string          `json:"theme"`
		Laps       int             `json:"laps"`
		Difficulty int             `json:"difficulty"`
		RoadExtent int             `json:"roadExtent"`
		Items      int             `json:"items"`
		Files      []store.MapFile `json:"files"`
	}
	values := form.Value["meta"]
	if len(values) != 1 || json.Unmarshal([]byte(values[0]), &meta) != nil || meta.ID != id {
		return store.MapUpload{}, errInvalidMap
	}
	meta.Name = strings.TrimSpace(meta.Name)
	if !validMapName(meta.Name) || !mapTheme.MatchString(meta.Theme) || meta.Laps < 1 || meta.Laps > 9 ||
		meta.Difficulty < 1 || meta.Difficulty > 5 || meta.RoadExtent < 100 || meta.RoadExtent > 20000 ||
		meta.Items < 0 || meta.Items > maxMapItems ||
		len(meta.Files) == 0 || len(meta.Files) > maxMapFiles {
		return store.MapUpload{}, errInvalidMap
	}
	seen := map[string]bool{}
	hasTrack := false
	for _, file := range meta.Files {
		lower := strings.ToLower(file.Path)
		if !mapFileName.MatchString(file.Path) || file.Size < 0 || file.Size > maxMapContainer*4 || seen[lower] {
			return store.MapUpload{}, errInvalidMap
		}
		seen[lower] = true
		hasTrack = hasTrack || lower == "track.1s"
	}
	if !hasTrack || !seen["xt_trackcard.png"] || !seen["xt_minimap.png"] {
		return store.MapUpload{}, errInvalidMap
	}
	container, err := readPart(form, "container", maxMapContainer)
	if err != nil {
		return store.MapUpload{}, err
	}
	design, err := readPart(form, "design", maxMapDesign)
	if err != nil || !json.Valid(design) {
		return store.MapUpload{}, errInvalidMap
	}
	card, err := readPart(form, "card", maxMapPicture)
	if err != nil || !bytes.HasPrefix(card, pngSignature) {
		return store.MapUpload{}, errInvalidMap
	}
	thumb, err := readPart(form, "thumb", maxMapPicture)
	if err != nil || !bytes.HasPrefix(thumb, pngSignature) {
		return store.MapUpload{}, errInvalidMap
	}
	digest := sha256.Sum256(container)
	return store.MapUpload{
		Map: store.CustomMap{ID: id, Name: meta.Name, Theme: meta.Theme, Laps: meta.Laps, Difficulty: meta.Difficulty,
			RoadExtent: meta.RoadExtent, Items: meta.Items, Files: meta.Files, SHA256: hex.EncodeToString(digest[:])},
		Design: string(design), Container: container, Card: card, Thumb: thumb,
	}, nil
}

// publishMap creates or updates one of the caller's maps from a multipart
// body: meta (JSON), design, container, card and thumb.
func (a *API) publishMap(w http.ResponseWriter, r *http.Request) error {
	id, err := mapID(r)
	if err != nil {
		return errInvalidMap
	}
	account, err := a.signedIn(r)
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxMapUpload)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return apierr.New(http.StatusRequestEntityTooLarge, "MAP_TOO_LARGE")
		}
		return errInvalidMap
	}
	defer r.MultipartForm.RemoveAll()
	upload, err := parseMapUpload(id, r.MultipartForm)
	if err != nil {
		return err
	}
	saved, err := a.store.SaveMap(r.Context(), account.ID, upload, mapsPerAccount, a.nowMillis())
	if err != nil {
		return err
	}
	a.log.Info("map published", "map", saved.ID, "account", account.ID, "bytes", saved.Size, "items", saved.Items)
	a.itemMaps.refresh(r.Context(), a.store)
	return writeJSON(w, http.StatusOK, saved)
}

func (a *API) deleteMap(w http.ResponseWriter, r *http.Request) error {
	id, err := mapID(r)
	if err != nil {
		return err
	}
	account, err := a.signedIn(r)
	if err != nil {
		return err
	}
	deleted, err := a.store.DeleteMap(r.Context(), id, account.ID, account.Admin)
	if err != nil {
		return err
	}
	if deleted.OwnerID != account.ID {
		a.log.Info("admin map deleted", "admin", account.Username, "map", id, "name", deleted.Name,
			"owner", deleted.OwnerID)
	}
	a.itemMaps.refresh(r.Context(), a.store)
	return writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

/* ---------- 管理后台 ---------- */

// mapRowJSON is the MapRow of ADMIN.md 9: author is the author's
// nickname, username its account name.
type mapRowJSON struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	OwnerID    string `json:"ownerId"`
	Username   string `json:"username"`
	Author     string `json:"author"`
	Theme      string `json:"theme"`
	Laps       int    `json:"laps"`
	Difficulty int    `json:"difficulty"`
	RoadExtent int    `json:"roadExtent"`
	Items      int    `json:"items"`
	Files      int    `json:"files"`
	Size       int    `json:"size"`
	SHA256     string `json:"sha256"`
	Hidden     bool   `json:"hidden"`
	CreatedAt  int64  `json:"createdAt"`
	UpdatedAt  int64  `json:"updatedAt"`
}

// adminMaps lists every published map, hidden ones too: ?state=public|
// hidden, account= (the author's id or username); q matches the name, the
// author's username and nickname and the map and author ids; from/to bound
// the update time. Sort keys: updatedAt (default), createdAt, name, size,
// items.
func (a *API) adminMaps(w http.ResponseWriter, r *http.Request) error {
	if _, err := a.requireAdmin(r); err != nil {
		return err
	}
	list, err := parseAdminList(r, false, "updatedAt", "createdAt", "name", "size", "items")
	if err != nil {
		return err
	}
	var filter store.MapFilter
	if filter.State, err = oneOfParam(r, "state", store.MapPublic, store.MapHidden); err != nil {
		return err
	}
	var matched bool
	if filter.AccountID, matched, err = a.accountParam(r.Context(), r); err != nil {
		return err
	} else if !matched {
		return emptyList[mapRowJSON](w, list)
	}
	rows, total, err := a.store.AdminMaps(r.Context(), list.AdminPage, filter)
	if err != nil {
		return err
	}
	items := make([]mapRowJSON, len(rows))
	for i, row := range rows {
		m := row.Map
		items[i] = mapRowJSON{ID: m.ID, Name: m.Name, OwnerID: m.OwnerID, Username: row.Username, Author: m.Author,
			Theme: m.Theme, Laps: m.Laps, Difficulty: m.Difficulty, RoadExtent: m.RoadExtent, Items: m.Items,
			Files: len(m.Files), Size: m.Size, SHA256: m.SHA256, Hidden: m.Hidden, CreatedAt: m.CreatedAt,
			UpdatedAt: m.UpdatedAt}
	}
	return answerList(w, list, items, total)
}

// adminMapFile serves a map's files to the console, hidden maps too (the
// console previews the card and thumb of every map).
func (a *API) adminMapFile(w http.ResponseWriter, r *http.Request) error {
	if _, err := a.requireAdmin(r); err != nil {
		return err
	}
	return a.serveMapFile(w, r, true)
}

// adminHideMap: {hidden} hides or restores a map in the public list.
func (a *API) adminHideMap(w http.ResponseWriter, r *http.Request) error {
	admin, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	id, err := mapID(r)
	if err != nil {
		return err
	}
	var request struct {
		Hidden bool `json:"hidden"`
	}
	if err := decodeJSON(w, r, &request); err != nil {
		return err
	}
	if err := a.store.SetMapHidden(r.Context(), id, request.Hidden); err != nil {
		return err
	}
	a.log.Info("admin map hidden", "admin", admin.Username, "map", id, "hidden", request.Hidden)
	a.itemMaps.refresh(r.Context(), a.store)
	return writeJSON(w, http.StatusOK, map[string]any{"hidden": request.Hidden})
}

// adminDeleteMap deletes any map for good (its files go with it).
func (a *API) adminDeleteMap(w http.ResponseWriter, r *http.Request) error {
	admin, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	id, err := mapID(r)
	if err != nil {
		return err
	}
	deleted, err := a.store.DeleteMap(r.Context(), id, admin.ID, true)
	if err != nil {
		return err
	}
	a.log.Info("admin map deleted", "admin", admin.Username, "map", id, "name", deleted.Name,
		"owner", deleted.OwnerID)
	a.itemMaps.refresh(r.Context(), a.store)
	return writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// serveUpload is serve with a longer deadline: a large map takes a while to
// arrive on a slow line before the database is touched.
func (a *API) serveUpload(handler handlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), mapUploadTimeout)
		defer cancel()
		if err := handler(w, r.WithContext(ctx)); err != nil {
			if _, ok := apierr.As(err); !ok {
				a.log.Error("request failed", "method", r.Method, "path", r.URL.Path, "error", err)
				err = apierr.New(http.StatusInternalServerError, "INTERNAL_ERROR")
			}
			apierr.WriteError(w, err)
		}
	})
}

// itemMapSet is the published maps with item boxes, for the global lobby's
// item rooms: the lobby checks it with its lock held, so it never queries.
type itemMapSet struct {
	mu  sync.RWMutex
	ids map[string]bool
}

// has reports whether trackID (custom_<id>) is a published item map.
func (s *itemMapSet) has(trackID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.ids[strings.TrimPrefix(trackID, "custom_")]
}

// refresh reloads the set; a failure keeps the previous one.
func (s *itemMapSet) refresh(ctx context.Context, st *store.Store) {
	if st == nil {
		return
	}
	ids, err := st.ItemMapIDs(ctx)
	if err != nil {
		return
	}
	next := make(map[string]bool, len(ids))
	for _, id := range ids {
		next[id] = true
	}
	s.mu.Lock()
	s.ids = next
	s.mu.Unlock()
}
