package api

import (
	"context"
	"net/http"
	"testing"
	"time"

	"kartsim/internal/data/datatest"
	"kartsim/internal/data/store"
)

// The 跑跑通行证每日任务 chain and the 俱乐部任务 (MENUS.md 2) need MySQL.

func TestPassChainAndClubQuest(t *testing.T) {
	clock := newFakeClock(time.Date(2026, 10, 12, 4, 0, 0, 0, time.UTC))
	h := newHarness(t, harnessOptions{mysql: true, now: clock.now})
	id, nickname, token := h.messengerUser()
	mateID, mateName, _ := h.messengerUser()
	auth := bearerHeader(token)

	type questsBodyPass struct {
		Quests     []questJSON `json:"quests"`
		PassPoints int         `json:"passPoints"`
		HasClub    bool        `json:"hasClub"`
	}
	var body questsBodyPass
	h.get("/api/quests", auth).expect(t, http.StatusOK, "").json(t, &body)
	byID := func() map[int]questJSON {
		out := map[int]questJSON{}
		for _, q := range body.Quests {
			out[q.ID] = q
		}
		return out
	}
	q := byID()
	if body.HasClub || body.PassPoints != 0 || q[9301].Group != "pass" || q[9301].Locked || !q[9302].Locked ||
		q[9401].Group != "club" || q[9001].Group != "normal" || q[9301].Rewards[0].PassPoints != 10 {
		t.Fatalf("fresh quests %+v pass=%d club=%v", q[9301], body.PassPoints, body.HasClub)
	}

	// Both riders join one club.
	now := clock.millis()
	datatest.Exec(t, h.db, `INSERT INTO clubs(name, intro, mark, frame, master_id, created_at, updated_at)
		VALUES(?, 'x', 1, 0, ?, ?, ?)`, "club-"+datatest.Unique(), id, now, now)
	var clubID int64
	if err := h.db.QueryRow("SELECT id FROM clubs WHERE master_id = ?", id).Scan(&clubID); err != nil {
		t.Fatal(err)
	}
	h.cleanup("DELETE FROM clubs WHERE id = ?", clubID)
	for _, member := range []string{id, mateID} {
		datatest.Exec(t, h.db, "INSERT INTO club_members(account_id, club_id, grade, joined_at) VALUES(?, ?, 2, ?)",
			member, clubID, now)
	}

	race := func(mate bool) {
		t.Helper()
		elapsed := 70_000
		results := []store.SettledResult{{PlayerID: "p", AccountID: id, Name: nickname, Rank: 1, ElapsedMs: &elapsed,
			DistanceMeters: 5000}}
		if mate {
			second := 75_000
			results = append(results, store.SettledResult{PlayerID: "m", AccountID: mateID, Name: mateName, Rank: 2,
				ElapsedMs: &second, DistanceMeters: 5000})
		}
		if _, _, err := h.api.store.SaveSettlement(context.Background(), store.Settlement{RaceID: "race-" + datatest.Unique(),
			RoomID: "room", Gameplay: "ordinary", TrackID: "village_R01", Snapshot: "{}", CreatedAt: clock.millis(),
			Results: results}); err != nil {
			t.Fatal(err)
		}
	}
	race(false)
	race(true)
	race(true)
	h.get("/api/quests", auth).expect(t, http.StatusOK, "").json(t, fresh(&body))
	q = byID()
	// Three drives complete stage 1 (10 通行证积分) and open stage 2; two races had a clubmate.
	if !body.HasClub || body.PassPoints != 10 || q[9301].CompletedAt == 0 || q[9302].Locked || q[9302].Value != 0 ||
		!q[9303].Locked || q[9401].Value != 2 {
		t.Fatalf("after three races pass=%d 9301=%+v 9302=%+v 9401=%+v", body.PassPoints, q[9301], q[9302], q[9401])
	}
	race(true)
	h.get("/api/quests", auth).expect(t, http.StatusOK, "").json(t, fresh(&body))
	q = byID()
	if q[9302].Value != 1 || q[9401].CompletedAt == 0 {
		t.Fatalf("fourth race 9302=%+v 9401=%+v", q[9302], q[9401])
	}
	// The club quest's 金币 is boxed; pass points never are.
	var box boxBody
	h.get("/api/reward-box", auth).expect(t, http.StatusOK, "").json(t, &box)
	lucci := 0
	for _, entry := range box.Entries {
		if entry.Currency == "lucci" && entry.Message == "任务：与俱乐部成员同场比赛3回" {
			lucci += entry.Count
		}
	}
	if lucci != 2000 {
		t.Fatalf("club quest reward %+v", box.Entries)
	}
	// Tomorrow the chain starts over at stage 1; the points stay.
	clock.advance(24 * time.Hour)
	h.get("/api/quests", auth).expect(t, http.StatusOK, "").json(t, fresh(&body))
	q = byID()
	if q[9301].CompletedAt != 0 || !q[9302].Locked || body.PassPoints != 10 {
		t.Fatalf("next day 9301=%+v 9302=%+v pass=%d", q[9301], q[9302], body.PassPoints)
	}
}
