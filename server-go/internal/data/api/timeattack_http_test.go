package api

import (
	"encoding/base64"
	"net/http"
	"testing"
	"time"

	"kartsim/internal/data/datatest"
	"kartsim/internal/data/store"
	"kartsim/internal/data/timeattack"
)

// The 练习计时赛 / 排位计时赛 HTTP tests need MySQL (KART_TEST_MYSQL_DSN).

type missionsBody struct {
	TrackID string `json:"trackId"`
	Goals   []struct {
		Index   int    `json:"index"`
		Title   string `json:"title"`
		Type    string `json:"type"`
		Hidden  bool   `json:"hidden"`
		Current int    `json:"current"`
		Stages  []struct {
			Stage       int  `json:"stage"`
			Count       int  `json:"count"`
			Requirement int  `json:"requirement"`
			Value       int  `json:"value"`
			Cleared     bool `json:"cleared"`
			Claimed     bool `json:"claimed"`
			Rewards     []rewardJSON
		} `json:"stages"`
	} `json:"goals"`
	Duel *struct {
		Key     string `json:"key"`
		TrackID string `json:"trackId"`
		Track   string `json:"track"`
		From    int64  `json:"from"`
		To      int64  `json:"to"`
		Stages  []struct {
			Stage    int   `json:"stage"`
			TargetMs int64 `json:"targetMs"`
			NPC      struct {
				Name string `json:"name"`
			} `json:"npc"`
			Rewards []rewardJSON `json:"rewards"`
		} `json:"stages"`
		Standing []store.DuelStageView `json:"standing"`
	} `json:"duel"`
	RecordGoalMs int64 `json:"recordGoalMs"`
}

func TestTimeAttackMissionsNeedLogin(t *testing.T) {
	h := newHarness(t, harnessOptions{})
	for _, path := range []string{"/api/timeattack/ranking?trackId=tomb_I09", "/api/timeattack/missions?trackId=tomb_I09",
		"/api/timeattack/replay?trackId=tomb_I09&accountId=x"} {
		h.get(path, nil).expect(t, http.StatusUnauthorized, "LOGIN_REQUIRED")
	}
	for _, path := range []string{"/api/timeattack/ranked/enter", "/api/timeattack/goals/claim", "/api/timeattack/duel/settle"} {
		h.post(path, map[string]any{}, nil).expect(t, http.StatusUnauthorized, "LOGIN_REQUIRED")
	}
}

func TestTimeAttackPracticeGoalsRankedAndDuel(t *testing.T) {
	// 2026-10-12: the tomb_I09 duel event (2026-10-08 ~ 10-22) is running.
	clock := newFakeClock(time.Date(2026, 10, 12, 4, 0, 0, 0, time.UTC))
	h := newHarness(t, harnessOptions{mysql: true, now: clock.now})
	u := datatest.Unique()
	id, token := h.register("ta_"+u, "Ta"+u)
	h.setWallet(id, store.Wallet{Lucci: 1_000})
	auth := bearerHeader(token)
	const track = "tomb_I09"

	var missions missionsBody
	h.get("/api/timeattack/missions?trackId="+track, auth).expect(t, http.StatusOK, "").json(t, fresh(&missions))
	if len(missions.Goals) != 4 || missions.Goals[0].Type != timeattack.GoalFinish || missions.Goals[2].Type != timeattack.GoalCrash ||
		!missions.Goals[3].Hidden || missions.RecordGoalMs != 118_590 {
		t.Fatalf("goals %+v record %d", missions.Goals, missions.RecordGoalMs)
	}
	if missions.Duel == nil || missions.Duel.TrackID != track || missions.Duel.Stages[0].NPC.Name != "小乖" ||
		missions.Duel.Stages[0].TargetMs != 118_590 || !missions.Duel.Standing[0].Open || missions.Duel.Standing[1].Open {
		t.Fatalf("duel %+v", missions.Duel)
	}
	h.get("/api/timeattack/missions?trackId=nope", auth).expect(t, http.StatusBadRequest, "INVALID_TRACK")

	type settled struct {
		store.TimeAttackResult
		Summary summaryBody
	}
	settle := func(body map[string]any) response {
		clock.advance(3 * time.Minute)
		return h.post("/api/timeattack/settle", body, auth)
	}
	// A practice run with 2 boosters and 40 crashes: 完成赛道 1/1 cleared,
	// boosters 2/5, crash stage 1 (≤50) 1/3, the record goal missed.
	var result settled
	settle(map[string]any{"trackId": track, "elapsedMs": 150_000, "requestId": uuid(), "mode": "practice", "speed": 7,
		"booster": 0, "kart": map[string]any{"itemId": 0, "systemKey": "", "name": "测试车"}, "crashCount": 40,
		"boosterCount": 2}).expect(t, http.StatusOK, "").json(t, fresh(&result))
	if !result.NewRecord || !result.ModeNewRecord || result.ModeBestMs != 150_000 || result.Rank != 0 {
		t.Fatalf("practice result %+v", result.TimeAttackResult)
	}
	h.get("/api/timeattack/missions?trackId="+track, auth).expect(t, http.StatusOK, "").json(t, fresh(&missions))
	g := missions.Goals
	if !g[0].Stages[0].Cleared || g[0].Stages[1].Cleared || g[0].Current != 1 || g[1].Stages[0].Value != 2 ||
		g[2].Stages[0].Value != 1 || g[2].Stages[0].Cleared || g[3].Stages[0].Value != 0 {
		t.Fatalf("goals after a run %+v", g)
	}
	// Claim 完成赛道 1阶段: its stock lands in the reward box; claiming twice
	// or an uncleared stage is refused.
	claim := func(set, stage int) response {
		return h.post("/api/timeattack/goals/claim", map[string]any{"requestId": uuid(), "trackId": track, "set": set,
			"stage": stage}, auth)
	}
	claim(0, 2).expect(t, http.StatusConflict, "GOAL_NOT_CLEARED")
	claim(9, 1).expect(t, http.StatusBadRequest, "INVALID_GOAL")
	var claimed struct {
		Goals []struct {
			Current int                      `json:"current"`
			Stages  []struct{ Claimed bool } `json:"stages"`
		} `json:"goals"`
	}
	claim(0, 1).expect(t, http.StatusOK, "").json(t, &claimed)
	if !claimed.Goals[0].Stages[0].Claimed || claimed.Goals[0].Current != 2 {
		t.Fatalf("claimed %+v", claimed.Goals[0])
	}
	claim(0, 1).expect(t, http.StatusConflict, "GOAL_CLAIMED")
	var box boxBody
	h.get("/api/reward-box", auth).expect(t, http.StatusOK, "").json(t, fresh(&box))
	if len(box.Entries) != 1 || box.Entries[0].Source != store.BoxSourceTimeAttack || box.Entries[0].Message != "练习目标：完成赛道 1阶段" {
		t.Fatalf("reward box %+v", box.Entries)
	}

	// Ranked: the fee first (once per request id), then the run with its replay.
	var ranking store.Ranking
	h.get("/api/timeattack/ranking?trackId="+track+"&speed=7&booster=0", auth).expect(t, http.StatusOK, "").json(t, fresh(&ranking))
	if len(ranking.Rows) != 0 || ranking.Ranked != nil || ranking.Practice == nil || ranking.Practice.BestMs != 150_000 ||
		ranking.Fee != timeattack.RankedEntryLucci {
		t.Fatalf("empty ranking %+v", ranking)
	}
	entry := uuid()
	settle(map[string]any{"trackId": track, "elapsedMs": 140_000, "requestId": entry, "mode": "ranked", "speed": 7, "booster": 0,
		"kart": map[string]any{"name": "测试车"}, "replay": base64.StdEncoding.EncodeToString([]byte("ksv-bytes"))}).
		expect(t, http.StatusConflict, "NO_RANKED_ENTRY")
	var entered struct {
		Fee     int `json:"fee"`
		Summary summaryBody
	}
	enter := func(request string) response {
		return h.post("/api/timeattack/ranked/enter", map[string]any{"requestId": request, "trackId": track, "speed": 7,
			"booster": 0}, auth)
	}
	enter(entry).expect(t, http.StatusOK, "").json(t, &entered)
	// 1,000 + the practice run's 70 (new record) - the 500 fee.
	if entered.Fee != 500 || entered.Summary.Wallet.Lucci != 570 {
		t.Fatalf("entered %+v", entered)
	}
	enter(entry).expect(t, http.StatusOK, "").json(t, fresh(&entered)) // the same request: no second charge
	if entered.Summary.Wallet.Lucci != 570 {
		t.Fatalf("charged twice: %+v", entered.Summary.Wallet)
	}
	enter(uuid()).expect(t, http.StatusOK, "")
	enter(uuid()).expect(t, http.StatusConflict, "INSUFFICIENT_FUNDS")
	settle(map[string]any{"trackId": track, "elapsedMs": 140_000, "requestId": entry, "mode": "ranked", "speed": 7, "booster": 1,
		"kart": map[string]any{"name": "测试车"}}).expect(t, http.StatusConflict, "NO_RANKED_ENTRY") // another booster mode
	settle(map[string]any{"trackId": track, "elapsedMs": 140_000, "requestId": entry, "mode": "ranked", "speed": 7, "booster": 0,
		"kart": map[string]any{"name": "测试车"}, "replay": base64.StdEncoding.EncodeToString([]byte("ksv-bytes"))}).
		expect(t, http.StatusOK, "").json(t, fresh(&result))
	if !result.ModeNewRecord || result.ModeBestMs != 140_000 || result.Rank != 1 || !result.TopTen {
		t.Fatalf("ranked result %+v", result.TimeAttackResult)
	}
	// The entry is spent: the same request id replays the answer, a new one needs a fee.
	settle(map[string]any{"trackId": track, "elapsedMs": 140_000, "requestId": entry, "mode": "ranked", "speed": 7, "booster": 0,
		"kart": map[string]any{"name": "测试车"}}).expect(t, http.StatusOK, "")
	h.get("/api/timeattack/ranking?trackId="+track+"&speed=7&booster=0", auth).expect(t, http.StatusOK, "").json(t, fresh(&ranking))
	if len(ranking.Rows) != 1 || ranking.Rows[0].Nickname != "Ta"+u || ranking.Rows[0].BestMs != 140_000 || !ranking.Rows[0].HasReplay ||
		!ranking.Rows[0].Self || ranking.MyRank != 1 || ranking.Ranked == nil || ranking.Ranked.Kart.Name != "测试车" {
		t.Fatalf("ranking %+v", ranking)
	}
	replay := h.get("/api/timeattack/replay?trackId="+track+"&speed=7&booster=0&accountId="+id, auth).expect(t, http.StatusOK, "")
	if string(replay.body) != "ksv-bytes" || replay.header.Get("ETag") == "" {
		t.Fatalf("replay %q %v", replay.body, replay.header)
	}
	h.get("/api/timeattack/replay?trackId="+track+"&speed=7&booster=1&accountId="+id, auth).expect(t, http.StatusNotFound, "REPLAY_NOT_FOUND")

	// The duel: a loss counts toward the 难度设定, a win under the NPC time
	// clears the stage once (its reward boxed) and opens the next.
	duel := func(stage, difficulty int, elapsed int64, finished bool) response {
		return h.post("/api/timeattack/duel/settle", map[string]any{"requestId": uuid(), "key": missions.Duel.Key, "stage": stage,
			"difficulty": difficulty, "elapsedMs": elapsed, "finished": finished}, auth)
	}
	var duelResult struct {
		Won      bool  `json:"won"`
		TargetMs int64 `json:"targetMs"`
		Result   store.DuelResult
	}
	duel(2, 0, 100_000, true).expect(t, http.StatusConflict, "DUEL_STAGE_LOCKED")
	duel(1, 1, 100_000, true).expect(t, http.StatusConflict, "DUEL_STAGE_LOCKED") // level 1 needs 3 losses
	duel(1, 0, 130_000, true).expect(t, http.StatusOK, "").json(t, fresh(&duelResult))
	if duelResult.Won || duelResult.TargetMs != 118_590 || duelResult.Result.Losses != 1 {
		t.Fatalf("lost duel %+v", duelResult)
	}
	duel(1, 0, 0, false).expect(t, http.StatusOK, "")
	duel(1, 0, 0, false).expect(t, http.StatusOK, "").json(t, fresh(&duelResult))
	if duelResult.Result.Losses != 3 || duelResult.Result.Difficulty != 1 {
		t.Fatalf("three losses %+v", duelResult.Result)
	}
	// Level 1: the NPC sets off 1 s later, so the target grows by 1 s.
	duel(1, 1, 119_000, true).expect(t, http.StatusOK, "").json(t, fresh(&duelResult))
	if !duelResult.Won || duelResult.TargetMs != 119_590 || !duelResult.Result.FirstWin || duelResult.Result.Bonus == nil ||
		!duelResult.Result.Stages[0].Won || !duelResult.Result.Stages[1].Open {
		t.Fatalf("won duel %+v", duelResult)
	}
	duel(1, 1, 119_000, true).expect(t, http.StatusOK, "").json(t, fresh(&duelResult))
	if duelResult.Result.FirstWin || duelResult.Result.Bonus != nil {
		t.Fatalf("second win %+v", duelResult.Result)
	}
	h.get("/api/reward-box", auth).expect(t, http.StatusOK, "").json(t, fresh(&box))
	if len(box.Entries) != 3 { // the goal claim, the stage reward and the level-1 bonus
		t.Fatalf("reward box after the duel %+v", box.Entries)
	}
	h.post("/api/timeattack/duel/settle", map[string]any{"requestId": uuid(), "key": "nope", "stage": 1, "elapsedMs": 1, "finished": true}, auth).
		expect(t, http.StatusBadRequest, "INVALID_DUEL")
}
