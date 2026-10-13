package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"testing"

	"kartsim/internal/data/datatest"
	"kartsim/internal/data/store"
)

var testPNG = append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, []byte("picture")...)

type mapUpload struct {
	meta      map[string]any
	design    string
	container []byte
	card      []byte
	thumb     []byte
}

func validMapUpload(id string) mapUpload {
	return mapUpload{
		meta: map[string]any{"id": id, "name": "测试环线", "theme": "village", "laps": 3, "difficulty": 2,
			"roadExtent": 900, "items": 12, "files": []map[string]any{{"path": "track.1s", "size": 10},
				{"path": "xt_minimap.png", "size": 3}, {"path": "xt_trackCard.png", "size": 3}}},
		design:    `{"format":"kartsim-map","version":1}`,
		container: bytes.Repeat([]byte("rho"), 100),
		card:      testPNG, thumb: testPNG,
	}
}

// publish posts a multipart map upload the way the editor does.
func (h *harness) publish(id string, upload mapUpload, headers map[string]string) response {
	h.t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	meta, _ := json.Marshal(upload.meta)
	_ = form.WriteField("meta", string(meta))
	for _, part := range []struct {
		name string
		data []byte
	}{{"design", []byte(upload.design)}, {"container", upload.container}, {"card", upload.card}, {"thumb", upload.thumb}} {
		if part.data == nil {
			continue
		}
		writer, _ := form.CreateFormFile(part.name, part.name)
		_, _ = writer.Write(part.data)
	}
	_ = form.Close()
	request, err := http.NewRequest(http.MethodPost, h.public.URL+"/api/maps/"+id, &body)
	if err != nil {
		h.t.Fatal(err)
	}
	request.Header.Set("Content-Type", form.FormDataContentType())
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	result, err := http.DefaultClient.Do(request)
	if err != nil {
		h.t.Fatal(err)
	}
	defer result.Body.Close()
	data, _ := io.ReadAll(result.Body)
	return response{status: result.StatusCode, header: result.Header, body: data}
}

func TestCustomMapsAPI(t *testing.T) {
	h := newHarness(t, harnessOptions{mysql: true})
	_, authorName, authorToken := h.messengerUser()
	_, _, otherToken := h.messengerUser()
	author, other := bearerHeader(authorToken), bearerHeader(otherToken)
	id := "t" + datatest.Unique()
	h.cleanup("DELETE FROM custom_maps WHERE id = ?", id)

	h.publish(id, validMapUpload(id), nil).expect(t, http.StatusUnauthorized, "LOGIN_REQUIRED")

	upload := validMapUpload(id)
	var saved store.CustomMap
	h.publish(id, upload, author).expect(t, http.StatusOK, "").json(t, &saved)
	digest := sha256.Sum256(upload.container)
	if saved.ID != id || saved.Author != authorName || saved.SHA256 != hex.EncodeToString(digest[:]) || saved.Items != 12 ||
		saved.Size != len(upload.container) || len(saved.Files) != 3 || saved.Name != "测试环线" {
		t.Fatalf("saved %+v", saved)
	}

	// The global lobby's item rooms now accept the map (it has item boxes).
	if !h.api.itemMaps.has("custom_" + id) {
		t.Fatal("published item map missing from the lobby's item maps")
	}
	var list struct{ Maps []store.CustomMap }
	h.get("/api/maps", nil).expect(t, http.StatusOK, "").json(t, &list)
	found := false
	for _, m := range list.Maps {
		found = found || m.ID == id
	}
	if !found {
		t.Fatalf("published map missing from %s", h.get("/api/maps", nil).body)
	}
	var mine struct{ Maps []store.CustomMap }
	h.get("/api/maps/mine", author).expect(t, http.StatusOK, "").json(t, &mine)
	if len(mine.Maps) != 1 || mine.Maps[0].ID != id {
		t.Fatalf("mine %+v", mine)
	}

	// The container is immutable under its hash; without the hash it is revalidated.
	container := h.get("/api/maps/"+id+"/container?v="+saved.SHA256, nil).expect(t, http.StatusOK, "")
	if !bytes.Equal(container.body, upload.container) || container.header.Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("container %d bytes, cache %q", len(container.body), container.header.Get("Cache-Control"))
	}
	if cache := h.get("/api/maps/"+id+"/container", nil).header.Get("Cache-Control"); cache != "no-cache" {
		t.Fatalf("unversioned cache %q", cache)
	}
	if card := h.get("/api/maps/"+id+"/card", nil).expect(t, http.StatusOK, ""); !bytes.Equal(card.body, testPNG) {
		t.Fatal("card bytes differ")
	}
	if design := h.get("/api/maps/"+id+"/design", nil).expect(t, http.StatusOK, ""); string(design.body) != upload.design {
		t.Fatalf("design %s", design.body)
	}
	h.get("/api/maps/"+id+"/secret", nil).expect(t, http.StatusNotFound, "MAP_NOT_FOUND")

	// Another account cannot take the id over; a broken upload is refused.
	h.publish(id, validMapUpload(id), other).expect(t, http.StatusForbidden, "MAP_NOT_OWNER")
	noTrack := validMapUpload(id)
	noTrack.meta["files"] = []map[string]any{{"path": "xt_minimap.png", "size": 3}, {"path": "xt_trackCard.png", "size": 3}}
	h.publish(id, noTrack, author).expect(t, http.StatusBadRequest, "INVALID_MAP")
	badCard := validMapUpload(id)
	badCard.card = []byte("not a png")
	h.publish(id, badCard, author).expect(t, http.StatusBadRequest, "INVALID_MAP")
	tooMany := validMapUpload(id)
	tooMany.meta["items"] = 5000
	h.publish(id, tooMany, author).expect(t, http.StatusBadRequest, "INVALID_MAP")
	badPath := validMapUpload(id)
	badPath.meta["files"] = []map[string]any{{"path": "../track.1s", "size": 3}}
	h.publish(id, badPath, author).expect(t, http.StatusBadRequest, "INVALID_MAP")
	otherID := validMapUpload(id)
	otherID.meta["id"] = "different"
	h.publish(id, otherID, author).expect(t, http.StatusBadRequest, "INVALID_MAP")

	// Republishing replaces the container and its hash; without item boxes it leaves the item rooms.
	upload.container = bytes.Repeat([]byte("new"), 50)
	upload.meta["items"] = 0
	var updated store.CustomMap
	h.publish(id, upload, author).expect(t, http.StatusOK, "").json(t, &updated)
	if updated.SHA256 == saved.SHA256 || updated.Size != 150 {
		t.Fatalf("updated %+v", updated)
	}
	if h.api.itemMaps.has("custom_" + id) {
		t.Fatal("a map without item boxes stayed an item map")
	}

	h.post("/api/maps/"+id+"/delete", nil, other).expect(t, http.StatusForbidden, "MAP_NOT_OWNER")
	h.post("/api/maps/"+id+"/delete", nil, author).expect(t, http.StatusOK, "")
	h.get("/api/maps/"+id, nil).expect(t, http.StatusNotFound, "MAP_NOT_FOUND")
	h.get("/api/maps/"+id+"/container", nil).expect(t, http.StatusNotFound, "MAP_NOT_FOUND")
}

// The console lists every map with its author, hidden ones too, searches
// and filters them, previews hidden maps' pictures, hides, restores and
// deletes any map; players get none of it.
func TestAdminCustomMaps(t *testing.T) {
	h := newAdminHarness(t, harnessOptions{})
	u := h.u
	authorID, authorNick, authorToken := h.messengerUser()
	otherID, otherNick, otherToken := h.messengerUser()
	author, other := bearerHeader(authorToken), bearerHeader(otherToken)
	publish := func(name string, items int, headers map[string]string) string {
		t.Helper()
		id := "a" + datatest.Unique()
		h.cleanup("DELETE FROM custom_maps WHERE id = ?", id)
		upload := validMapUpload(id)
		upload.meta["name"] = name + u
		upload.meta["items"] = items
		h.publish(id, upload, headers).expect(t, http.StatusOK, "")
		return id
	}
	ring := publish("环线", 12, author)
	hill := publish("山路", 0, author)
	bay := publish("海湾", 3, other)
	deleteMap := func(id string, headers map[string]string) response {
		t.Helper()
		return send(t, http.MethodDelete, h.public.URL+"/api/admin/maps/"+id, nil, headers)
	}

	// Players are refused.
	for _, path := range []string{"/api/admin/maps", "/api/admin/maps/" + ring + "/card"} {
		h.get(path, nil).expect(t, http.StatusUnauthorized, "LOGIN_REQUIRED")
		h.get(path, author).expect(t, http.StatusForbidden, "ADMIN_REQUIRED")
	}
	h.post("/api/admin/maps/"+ring+"/hidden", map[string]any{"hidden": true}, author).
		expect(t, http.StatusForbidden, "ADMIN_REQUIRED")
	deleteMap(ring, author).expect(t, http.StatusForbidden, "ADMIN_REQUIRED")
	deleteMap(ring, nil).expect(t, http.StatusUnauthorized, "LOGIN_REQUIRED")

	// A hidden map leaves the public list, its files and the item rooms;
	// the console still shows its pictures, only to the admin's browser.
	h.post("/api/admin/maps/"+bay+"/hidden", map[string]any{"hidden": true}, h.adminHeader).expect(t, http.StatusOK, "")
	if h.api.itemMaps.has("custom_" + bay) {
		t.Fatal("a hidden item map stayed an item map")
	}
	h.get("/api/maps/"+bay+"/card", nil).expect(t, http.StatusNotFound, "MAP_NOT_FOUND")
	for _, kind := range []string{"card", "thumb"} {
		picture := h.get("/api/admin/maps/"+bay+"/"+kind, h.adminHeader).expect(t, http.StatusOK, "")
		if !bytes.Equal(picture.body, testPNG) || picture.header.Get("Content-Type") != "image/png" ||
			picture.header.Get("Cache-Control") != "private, no-cache" {
			t.Fatalf("%s: %d bytes, %q, cache %q", kind, len(picture.body), picture.header.Get("Content-Type"),
				picture.header.Get("Cache-Control"))
		}
	}
	var ringMap store.CustomMap
	h.get("/api/maps/"+ring, nil).expect(t, http.StatusOK, "").json(t, &ringMap)
	if cache := h.get("/api/admin/maps/"+ring+"/thumb?v="+ringMap.SHA256, h.adminHeader).expect(t, http.StatusOK, "").
		header.Get("Cache-Control"); cache != "private, max-age=31536000, immutable" {
		t.Fatalf("versioned admin picture cache %q", cache)
	}
	h.get("/api/admin/maps/"+bay+"/secret", h.adminHeader).expect(t, http.StatusNotFound, "MAP_NOT_FOUND")
	h.get("/api/admin/maps/nosuchmap/card", h.adminHeader).expect(t, http.StatusNotFound, "MAP_NOT_FOUND")

	type mapList struct {
		Items []mapRowJSON
		Total int
	}
	list := func(query string) mapList {
		t.Helper()
		var page mapList
		h.adminGet("/api/admin/maps?"+query, &page)
		return page
	}
	ids := func(page mapList) []string {
		list := make([]string, len(page.Items))
		for i, item := range page.Items {
			list[i] = item.ID
		}
		return list
	}
	everything := list("q=" + url.QueryEscape(u))
	rows := map[string]mapRowJSON{}
	for _, item := range everything.Items {
		rows[item.ID] = item
	}
	if everything.Total != 3 || len(rows) != 3 {
		t.Fatalf("all maps %+v", everything)
	}
	if row := rows[ring]; row.Name != "环线"+u || row.OwnerID != authorID || row.Author != authorNick ||
		row.Username == "" || row.Theme != "village" || row.Laps != 3 || row.Difficulty != 2 || row.RoadExtent != 900 ||
		row.Items != 12 || row.Files != 3 || row.Size != 300 || len(row.SHA256) != 64 || row.Hidden ||
		row.CreatedAt == 0 || row.UpdatedAt < row.CreatedAt {
		t.Fatalf("ring row %+v", row)
	}
	if row := rows[bay]; !row.Hidden || row.OwnerID != otherID || row.Author != otherNick {
		t.Fatalf("hidden row %+v", row)
	}
	if page := list("state=hidden&q=" + url.QueryEscape(u)); page.Total != 1 || page.Items[0].ID != bay {
		t.Fatalf("hidden maps %v", ids(page))
	}
	if page := list("state=public&q=" + url.QueryEscape(u)); page.Total != 2 || rows[page.Items[0].ID].Hidden ||
		rows[page.Items[1].ID].Hidden {
		t.Fatalf("public maps %v", ids(page))
	}
	if page := list("q=" + ring); page.Total != 1 || page.Items[0].ID != ring {
		t.Fatalf("by map id %v", ids(page))
	}
	if page := list("q=" + url.QueryEscape(authorNick)); page.Total != 2 {
		t.Fatalf("by author nickname %v", ids(page))
	}
	if page := list("q=" + url.QueryEscape("海湾"+u)); page.Total != 1 || page.Items[0].ID != bay {
		t.Fatalf("by name %v", ids(page))
	}
	if page := list("account=" + authorID + "&sort=items&order=asc"); page.Total != 2 ||
		page.Items[0].ID != hill || page.Items[1].ID != ring {
		t.Fatalf("author's maps by items %v", ids(page))
	}
	if page := list("account=nobody_" + u); page.Total != 0 || page.Items == nil {
		t.Fatalf("unknown account %+v", page)
	}
	if page := list("q=" + url.QueryEscape(u) + "&pageSize=2&page=2&sort=items"); page.Total != 3 || len(page.Items) != 1 ||
		page.Items[0].ID != hill {
		t.Fatalf("second page %v", ids(page))
	}
	h.get("/api/admin/maps?state=bogus", h.adminHeader).expect(t, http.StatusBadRequest, "INVALID_QUERY")

	// Restoring brings it back everywhere.
	h.post("/api/admin/maps/"+bay+"/hidden", map[string]any{"hidden": false}, h.adminHeader).expect(t, http.StatusOK, "")
	if !h.api.itemMaps.has("custom_" + bay) {
		t.Fatal("a restored item map is not an item map")
	}
	h.get("/api/maps/"+bay+"/card", nil).expect(t, http.StatusOK, "")
	h.post("/api/admin/maps/nosuchmap/hidden", map[string]any{"hidden": true}, h.adminHeader).
		expect(t, http.StatusNotFound, "MAP_NOT_FOUND")

	// The admin deletes another account's map for good.
	deleteMap(bay, h.adminHeader).expect(t, http.StatusOK, "")
	if h.api.itemMaps.has("custom_" + bay) {
		t.Fatal("a deleted item map stayed an item map")
	}
	h.get("/api/maps/"+bay, nil).expect(t, http.StatusNotFound, "MAP_NOT_FOUND")
	h.get("/api/admin/maps/"+bay+"/card", h.adminHeader).expect(t, http.StatusNotFound, "MAP_NOT_FOUND")
	deleteMap(bay, h.adminHeader).expect(t, http.StatusNotFound, "MAP_NOT_FOUND")
	deleteMap("BAD!", h.adminHeader).expect(t, http.StatusNotFound, "MAP_NOT_FOUND")
	// The players' delete also lets an admin remove any map.
	h.post("/api/maps/"+hill+"/delete", nil, other).expect(t, http.StatusForbidden, "MAP_NOT_OWNER")
	h.post("/api/maps/"+hill+"/delete", nil, h.adminHeader).expect(t, http.StatusOK, "")
	if page := list("q=" + url.QueryEscape(u)); page.Total != 1 || page.Items[0].ID != ring {
		t.Fatalf("after deletes %v", ids(page))
	}
}
