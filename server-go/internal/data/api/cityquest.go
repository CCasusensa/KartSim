package api

import (
	"net/http"
	"time"

	"kartsim/internal/data/store"
	"kartsim/internal/shared/apierr"
	"kartsim/internal/shared/contract"
	"kartsim/internal/shared/rewards"
)

// 卡丁城送货任务 (CITY-QUESTS.md): a game node credits a delivery it judged
// complete. The amounts come from the quest table the node embeds; these
// bounds only stop a broken node from paying absurd sums.
const (
	maxCityQuestExp   = 2000
	maxCityQuestLucci = 5000
)

var errInvalidQuest = apierr.New(http.StatusBadRequest, "INVALID_QUEST")

func (a *API) cityQuestReward(w http.ResponseWriter, r *http.Request) error {
	var request contract.CityQuestRewardRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return err
	}
	if !validASCIIID(request.AccountID, 36) {
		return errInvalidAccountID
	}
	if !validASCIIID(request.RunID, 64) || !validASCIIID(request.QuestID, 64) ||
		request.Exp < 0 || request.Exp > maxCityQuestExp || request.Lucci < 0 || request.Lucci > maxCityQuestLucci {
		return errInvalidQuest
	}
	now := a.nowMillis()
	result, err := a.store.SettleCityQuest(r.Context(), store.CityQuestRun{AccountID: request.AccountID,
		RunID: request.RunID, QuestID: request.QuestID, Exp: request.Exp, Lucci: request.Lucci,
		Day: rewards.BeijingDay(time.UnixMilli(now)), Now: now})
	if err != nil {
		return err
	}
	levelUps := make([]contract.CityQuestLevelUp, 0, len(result.LevelUps))
	for _, up := range result.LevelUps {
		levelUps = append(levelUps, contract.CityQuestLevelUp{Level: up.Level, Lucci: up.Lucci, Koin: up.Koin, Coupon: up.Coupon})
	}
	return writeJSON(w, http.StatusOK, contract.CityQuestReward{Exp: result.Exp, Lucci: result.Lucci,
		Capped: result.Capped, Duplicate: result.Duplicate, LevelUps: levelUps, WalletLucci: result.WalletLucci,
		TotalExp: result.TotalExp, Level: result.Level})
}
