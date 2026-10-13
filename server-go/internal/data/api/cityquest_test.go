package api

import (
	"net/http"
	"testing"
	"time"

	"kartsim/internal/data/datatest"
	"kartsim/internal/shared/contract"
	"kartsim/internal/shared/rewards"
)

// A delivery credits its 金币 and exp once per run, levels up like a race,
// rejects absurd amounts and stops paying past the daily cap
// (CITY-QUESTS.md 4).
func TestCityQuestRewardInternalAPI(t *testing.T) {
	h := newHarness(t, harnessOptions{mysql: true})
	u := datatest.Unique()
	id, _ := h.register("quest_"+u, "Quest"+u)
	reward := func(run string, exp, lucci int64) contract.CityQuestReward {
		t.Helper()
		var out contract.CityQuestReward
		h.call(contract.PathCityQuestReward, contract.CityQuestRewardRequest{AccountID: id, RunID: run,
			QuestID: "beach-brochures", Exp: exp, Lucci: lucci}).expect(t, http.StatusOK, "").json(t, &out)
		return out
	}
	levelLucci := func(r contract.CityQuestReward) (sum int64) {
		for _, up := range r.LevelUps {
			sum += up.Lucci
		}
		return sum
	}
	first := reward("run-"+u+"-1", 91, 230)
	if first.Exp != 91 || first.Lucci != 230 || first.Capped || first.Duplicate ||
		first.WalletLucci != harnessStartingLucci+230+levelLucci(first) || first.TotalExp != 91 || first.Level < 1 {
		t.Fatalf("first delivery %+v", first)
	}
	again := reward("run-"+u+"-1", 91, 230)
	if !again.Duplicate || again.Exp != 0 || again.Lucci != 0 || again.WalletLucci != first.WalletLucci {
		t.Fatalf("retried delivery %+v", again)
	}
	// Enough exp for a few levels: the level-up rewards come along.
	big := reward("run-"+u+"-2", 2000, 5000)
	if big.Exp != 2000 || big.Lucci != 5000 || len(big.LevelUps) == 0 || big.Level <= first.Level ||
		big.WalletLucci != first.WalletLucci+5000+levelLucci(big) {
		t.Fatalf("big delivery %+v", big)
	}
	for _, bad := range []contract.CityQuestRewardRequest{
		{AccountID: id, RunID: "r", QuestID: "q", Exp: 2001},
		{AccountID: id, RunID: "r", QuestID: "q", Lucci: 5001},
		{AccountID: id, RunID: "", QuestID: "q"},
		{AccountID: id, RunID: "r", QuestID: "q", Exp: -1},
	} {
		h.call(contract.PathCityQuestReward, bad).expect(t, http.StatusBadRequest, "INVALID_QUEST")
	}
	// Past the day's cap a delivery is still accepted, but pays nothing.
	day := rewards.BeijingDay(time.UnixMilli(h.api.nowMillis()))
	datatest.Exec(t, h.db, `UPDATE daily_rewards SET count = 50 WHERE account_id = ? AND day = ? AND kind = 'cityquest'`, id, day)
	capped := reward("run-"+u+"-3", 50, 100)
	if !capped.Capped || capped.Exp != 0 || capped.Lucci != 0 || capped.WalletLucci != big.WalletLucci {
		t.Fatalf("capped delivery %+v", capped)
	}
}
