package api

import (
	"net/http"
	"strconv"
	"testing"

	"kartsim/internal/data/datatest"
	"kartsim/internal/data/store"
)

// 联赛回放 (TIMEATTACK.md 4) needs MySQL: the admin publishes a ranked
// replay, riders list and download it, deleting the record keeps the copy.

func TestFeaturedReplays(t *testing.T) {
	h := newHarness(t, harnessOptions{mysql: true})
	riderID, nickname, riderToken := h.messengerUser()
	_, adminToken := h.adminUser()
	rider, admin := bearerHeader(riderToken), bearerHeader(adminToken)
	track := "village_R01"
	now := int64(1_700_000_000_000)
	datatest.Exec(t, h.db, `INSERT INTO timeattack_records(account_id, track_id, speed, booster, mode, best_ms, kart_item_id,
			kart_system_key, kart_name, crash_count, booster_count, updated_at)
		VALUES(?, ?, 7, 0, 'ranked', 95000, 1531, '', '雷霆爆烈', 1, 9, ?)`, riderID, track, now)
	datatest.Exec(t, h.db, `INSERT INTO timeattack_replays(track_id, speed, booster, account_id, best_ms, byte_size, ksv, updated_at)
		VALUES(?, 7, 0, ?, 95000, 9, 'ksv-bytes', ?)`, track, riderID, now)
	h.cleanup("DELETE FROM featured_replays WHERE account_id = ?", riderID)

	type listBody struct {
		Replays []store.FeaturedReplay `json:"replays"`
	}
	var list listBody
	h.get("/api/timeattack/featured", nil).expect(t, http.StatusUnauthorized, "LOGIN_REQUIRED")
	h.get("/api/timeattack/featured", rider).expect(t, http.StatusOK, "").json(t, &list)
	if len(list.Replays) != 0 {
		t.Fatalf("fresh list %+v", list.Replays)
	}
	// The admin's pool lists the stored replay with its record's kart.
	var pool struct {
		Items []store.AdminReplayRow `json:"items"`
		Total int                    `json:"total"`
	}
	h.get("/api/admin/timeattack-replays?account="+riderID, admin).expect(t, http.StatusOK, "").json(t, &pool)
	if pool.Total != 1 || pool.Items[0].KartName != "雷霆爆烈" || pool.Items[0].Featured != 0 || pool.Items[0].Nickname != nickname {
		t.Fatalf("pool %+v", pool)
	}
	h.get("/api/admin/timeattack-replays", rider).expect(t, http.StatusForbidden, "ADMIN_REQUIRED")

	publish := func(body map[string]any, headers map[string]string) response {
		return h.post("/api/admin/featured-replays", body, headers)
	}
	publish(map[string]any{"trackId": track, "speed": 7, "booster": 0, "accountId": riderID, "title": "x"}, rider).
		expect(t, http.StatusForbidden, "ADMIN_REQUIRED")
	publish(map[string]any{"trackId": track, "speed": 7, "booster": 0, "accountId": riderID, "title": ""}, admin).
		expect(t, http.StatusBadRequest, "INVALID_FEATURED")
	publish(map[string]any{"trackId": track, "speed": 7, "booster": 1, "accountId": riderID, "title": "决赛"}, admin).
		expect(t, http.StatusNotFound, "REPLAY_NOT_FOUND")
	var published struct {
		Replay store.FeaturedReplay `json:"replay"`
	}
	publish(map[string]any{"trackId": track, "speed": 7, "booster": 0, "accountId": riderID, "title": " 第1届决赛 ",
		"note": "城镇"}, admin).expect(t, http.StatusOK, "").json(t, &published)
	f := published.Replay
	if f.ID == 0 || f.Title != "第1届决赛" || f.Note != "城镇" || f.Nickname != nickname || f.KartName != "雷霆爆烈" ||
		f.BestMs != 95000 || f.ByteSize != 9 || f.TrackName == "" {
		t.Fatalf("published %+v", f)
	}
	h.get("/api/admin/timeattack-replays?account="+riderID, admin).expect(t, http.StatusOK, "").json(t, fresh(&pool))
	if pool.Items[0].Featured != 1 {
		t.Fatalf("pool after publish %+v", pool.Items)
	}

	// Riders see it and download the copy; the ranked replay can go.
	h.get("/api/timeattack/featured", rider).expect(t, http.StatusOK, "").json(t, fresh(&list))
	if len(list.Replays) != 1 || list.Replays[0].ID != f.ID {
		t.Fatalf("list %+v", list.Replays)
	}
	datatest.Exec(t, h.db, "DELETE FROM timeattack_replays WHERE account_id = ?", riderID)
	file := h.get("/api/timeattack/featured/replay?id="+strconv.FormatInt(f.ID, 10), rider).expect(t, http.StatusOK, "")
	if string(file.body) != "ksv-bytes" || file.header.Get("ETag") == "" {
		t.Fatalf("file %q %v", file.body, file.header)
	}
	h.get("/api/timeattack/featured/replay?id=0", rider).expect(t, http.StatusBadRequest, "INVALID_REQUEST")

	// Delete: admin only, then gone.
	send(t, http.MethodDelete, h.public.URL+"/api/admin/featured-replays/"+strconv.FormatInt(f.ID, 10), nil, rider).
		expect(t, http.StatusForbidden, "ADMIN_REQUIRED")
	send(t, http.MethodDelete, h.public.URL+"/api/admin/featured-replays/"+strconv.FormatInt(f.ID, 10), nil, admin).expect(t, http.StatusOK, "")
	send(t, http.MethodDelete, h.public.URL+"/api/admin/featured-replays/"+strconv.FormatInt(f.ID, 10), nil, admin).
		expect(t, http.StatusNotFound, "FEATURED_NOT_FOUND")
	h.get("/api/timeattack/featured/replay?id="+strconv.FormatInt(f.ID, 10), rider).expect(t, http.StatusNotFound, "FEATURED_NOT_FOUND")
}
