package api

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"net/http"
	"strings"
	"testing"
	"time"

	"kartsim/internal/data/datatest"
)

// These need no MySQL.

func promoPNG(t *testing.T, width, height int, shade uint8) []byte {
	t.Helper()
	picture := image.NewRGBA(image.Rect(0, 0, width, height))
	for i := range picture.Pix {
		picture.Pix[i] = shade
	}
	var out bytes.Buffer
	if err := png.Encode(&out, picture); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

// promoWebP is a lossless WebP header of the given size (enough to be read).
func promoWebP(width, height int) []byte {
	out := []byte("RIFF\x00\x00\x00\x00WEBPVP8L\x00\x00\x00\x00\x2f")
	out = binary.LittleEndian.AppendUint32(out, uint32(width-1)|uint32(height-1)<<14)
	return append(out, make([]byte, 16)...)
}

func TestInspectPromoImage(t *testing.T) {
	var jpg, gifData bytes.Buffer
	if err := jpeg.Encode(&jpg, image.NewGray(image.Rect(0, 0, 40, 30)), nil); err != nil {
		t.Fatal(err)
	}
	palette := image.NewPaletted(image.Rect(0, 0, 7, 9), []color.Color{color.Black, color.White})
	if err := gif.Encode(&gifData, palette, nil); err != nil {
		t.Fatal(err)
	}
	extended := []byte("RIFF\x00\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00\x10\x00\x00\x00\x3f\x06\x00\x9f\x03\x00")
	extended = append(extended, make([]byte, 16)...)
	lossy := []byte("RIFF\x00\x00\x00\x00WEBPVP8 \x00\x00\x00\x00\x30\x01\x00\x9d\x01\x2a\x40\x06\xa0\x03")
	lossy = append(lossy, make([]byte, 16)...)
	for _, check := range []struct {
		name          string
		data          []byte
		contentType   string
		width, height int
	}{
		{"png", promoPNG(t, 64, 32, 200), "image/png", 64, 32},
		{"jpeg", jpg.Bytes(), "image/jpeg", 40, 30},
		{"gif", gifData.Bytes(), "image/gif", 7, 9},
		{"webp lossless", promoWebP(1040, 600), "image/webp", 1040, 600},
		{"webp extended", extended, "image/webp", 1600, 928},
		{"webp lossy", lossy, "image/webp", 1600, 928},
	} {
		contentType, width, height, ok := inspectPromoImage(check.data)
		if !ok || contentType != check.contentType || width != check.width || height != check.height {
			t.Errorf("%s: %s %dx%d %v", check.name, contentType, width, height, ok)
		}
	}
	for name, data := range map[string][]byte{
		"svg":        []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>`),
		"html":       []byte("<html><img src=x onerror=alert(1)></html>"),
		"broken png": promoPNG(t, 4, 4, 0)[:20],
		"too wide":   promoPNG(t, maxPromoImageSide+1, 1, 0),
		"webp huge":  promoWebP(maxPromoImageSide+1, 10),
		"empty":      nil,
	} {
		if _, _, _, ok := inspectPromoImage(data); ok {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestValidPromoLink(t *testing.T) {
	for _, link := range []string{"", "https://example.com", "http://example.com/a?b=1#c", "/editor.html",
		"https://kart.example.cn/活动/页面", "/"} {
		if !validPromoLink(link) {
			t.Errorf("%q refused", link)
		}
	}
	for _, link := range []string{"javascript:alert(1)", "data:text/html,x", "//evil.example", "ftp://example.com",
		"https://", "example.com", "https://a b.com", "https://user:pw@example.com", "/a\\b", "https://e.com/\"x",
		"https://e.com/\nx", "https://e.com/" + strings.Repeat("a", maxPromoLink)} {
		if validPromoLink(link) {
			t.Errorf("%q accepted", link)
		}
	}
}

// 大厅宣传 (ADMIN.md 10): admins upload pictures and set the carousel and
// boards; players read them without signing in; bad settings are refused;
// pictures no setting uses are removed after a day.
func TestAdminLobbyPromos(t *testing.T) {
	h := newAdminHarness(t, harnessOptions{})
	h.cleanup("DELETE FROM app_settings WHERE name = 'lobbyPromos'")
	h.cleanup("DELETE FROM lobby_promo_images WHERE created_by = ?", h.adminName)
	datatest.Exec(t, h.db, "DELETE FROM app_settings WHERE name = 'lobbyPromos'")
	h.account("promo_"+h.u, "宣传"+h.u, password, false)
	player := h.login("promo_"+h.u, password)
	adminToken := strings.TrimPrefix(h.adminHeader["Authorization"], "Bearer ")
	uploadAs := func(token string, data []byte) response {
		return send(t, http.MethodPost, h.public.URL+"/api/admin/lobby-promos/images", data, bearerHeader(token))
	}
	upload := func(data []byte) string {
		var body struct {
			Image, URL, ContentType string
			Width, Height, Size     int
		}
		uploadAs(adminToken, data).expect(t, http.StatusOK, "").json(t, &body)
		if len(body.Image) != 32 || body.URL != promoImagePath+body.Image || body.Size != len(data) ||
			body.ContentType != "image/png" || body.Width == 0 {
			t.Fatalf("upload %+v", body)
		}
		return body.Image
	}

	// Only admins see or change the settings; anyone reads what players see.
	for _, path := range []string{"/api/admin/lobby-promos"} {
		h.get(path, nil).expect(t, http.StatusUnauthorized, "LOGIN_REQUIRED")
		h.get(path, bearerHeader(player)).expect(t, http.StatusForbidden, "ADMIN_REQUIRED")
	}
	h.put("/api/admin/lobby-promos", map[string]any{}, bearerHeader(player)).expect(t, http.StatusForbidden, "ADMIN_REQUIRED")
	uploadAs(player, promoPNG(t, 8, 8, 1)).expect(t, http.StatusForbidden, "ADMIN_REQUIRED")
	var shown lobbyPromosJSON
	h.get("/api/lobby/promos", nil).expect(t, http.StatusOK, "").json(t, &shown)
	if shown.Interval != 5 || len(shown.Carousel) != 0 || len(shown.Boards) != 2 || shown.Boards[0].URL != "" ||
		shown.UpdatedAt != 0 {
		t.Fatalf("defaults %+v", shown)
	}

	// Pictures: checked, named by content, served for good.
	slide := promoPNG(t, 1040, 600, 90)
	board := promoPNG(t, 1050, 234, 160)
	slideID, boardID := upload(slide), upload(board)
	if again := upload(slide); again != slideID {
		t.Fatalf("same picture, new id %s", again)
	}
	uploadAs(adminToken, []byte("<svg></svg>")).expect(t, http.StatusBadRequest, "INVALID_PROMO_IMAGE")
	uploadAs(adminToken, make([]byte, maxPromoImageBytes+1)).expect(t, http.StatusRequestEntityTooLarge,
		"PROMO_IMAGE_TOO_LARGE")
	served := h.get(promoImagePath+slideID, nil).expect(t, http.StatusOK, "")
	if !bytes.Equal(served.body, slide) || served.header.Get("Content-Type") != "image/png" ||
		!strings.Contains(served.header.Get("Cache-Control"), "immutable") ||
		served.header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("served %d bytes, %v", len(served.body), served.header)
	}
	h.get(promoImagePath+slideID, map[string]string{"If-None-Match": served.header.Get("ETag")}).
		expect(t, http.StatusNotModified, "")
	h.get(promoImagePath+strings.Repeat("0", 32), nil).expect(t, http.StatusNotFound, "PROMO_IMAGE_NOT_FOUND")
	h.get(promoImagePath+"x", nil).expect(t, http.StatusNotFound, "PROMO_IMAGE_NOT_FOUND")

	// Bad settings change nothing.
	missing := strings.Repeat("ab", 16)
	for _, body := range []map[string]any{
		{"carousel": []map[string]any{{"link": "https://example.com"}}},
		{"carousel": []map[string]any{{"image": slideID, "link": "javascript:alert(1)"}}},
		{"carousel": []map[string]any{{"image": "../../x"}}},
		{"interval": 1},
		{"interval": 61},
		{"carousel": make([]map[string]any, 9)},
		{"boards": []map[string]any{{}, {}, {}}},
		{"boards": []map[string]any{{"title": strings.Repeat("长", maxPromoTitle+1)}}},
	} {
		h.put("/api/admin/lobby-promos", body, h.adminHeader).expect(t, http.StatusBadRequest, "INVALID_LOBBY_PROMOS")
	}
	h.put("/api/admin/lobby-promos", map[string]any{"carousel": []map[string]any{{"image": missing}}},
		h.adminHeader).expect(t, http.StatusBadRequest, "PROMO_IMAGE_NOT_FOUND")

	// An unused upload older than a day goes with the next save; used ones stay.
	old := time.Now().Add(-48 * time.Hour).UnixMilli()
	datatest.Exec(t, h.db, `INSERT INTO lobby_promo_images(id, content_type, width, height, byte_size, data,
		created_by, created_at) VALUES(?, 'image/png', 1, 1, 1, 'x', ?, ?)`, missing, h.adminName, old)
	datatest.Exec(t, h.db, "UPDATE lobby_promo_images SET created_at = ? WHERE id = ?", old, boardID)

	var saved lobbyPromosJSON
	h.put("/api/admin/lobby-promos", map[string]any{
		"interval": 8,
		"carousel": []map[string]any{{"image": slideID, "link": " https://example.com/活动 ", "title": "新车上市"},
			{"image": slideID}},
		"boards": []map[string]any{{"image": boardID, "link": "/editor.html"}, {"title": "敬请期待"}},
	}, h.adminHeader).expect(t, http.StatusOK, "").json(t, &saved)
	if saved.Interval != 8 || len(saved.Carousel) != 2 || saved.Carousel[0].URL != promoImagePath+slideID ||
		saved.Carousel[0].Link != "https://example.com/活动" || saved.Carousel[0].Title != "新车上市" ||
		saved.Carousel[0].Width != 1040 || saved.Carousel[0].Height != 600 ||
		saved.Boards[0].Image != boardID || saved.Boards[0].Link != "/editor.html" || saved.Boards[1].URL != "" ||
		saved.Boards[1].Title != "敬请期待" || saved.UpdatedBy != h.adminName || saved.UpdatedAt == 0 {
		t.Fatalf("saved %+v", saved)
	}
	h.get(promoImagePath+missing, nil).expect(t, http.StatusNotFound, "PROMO_IMAGE_NOT_FOUND")
	h.get(promoImagePath+boardID, nil).expect(t, http.StatusOK, "")

	h.get("/api/lobby/promos", nil).expect(t, http.StatusOK, "").json(t, &shown)
	if shown.Interval != 8 || len(shown.Carousel) != 2 || shown.Boards[0].URL != promoImagePath+boardID ||
		shown.UpdatedBy != "" {
		t.Fatalf("players see %+v", shown)
	}
	var reloaded lobbyPromosJSON
	h.adminGet("/api/admin/lobby-promos", &reloaded)
	if reloaded.UpdatedBy != h.adminName || len(reloaded.Carousel) != 2 {
		t.Fatalf("admin reload %+v", reloaded)
	}

	// Clearing the carousel brings back the built-in pictures.
	h.put("/api/admin/lobby-promos", map[string]any{"carousel": []any{}}, h.adminHeader).
		expect(t, http.StatusOK, "").json(t, &saved)
	if len(saved.Carousel) != 0 || saved.Interval != 5 || saved.Boards[0].URL != "" {
		t.Fatalf("cleared %+v", saved)
	}
}
