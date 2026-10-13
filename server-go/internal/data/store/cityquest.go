package store

import (
	"context"
	"database/sql"

	"kartsim/internal/data/economy"
	"kartsim/internal/shared/rewards"
)

// 卡丁城送货任务 (CITY-QUESTS.md): the data service credits a delivery the
// game node judged complete.

const (
	// ReasonCityQuest is a delivery reward; ref = the quest run id.
	ReasonCityQuest = "cityquest"
	// DailyCityQuest counts the deliveries rewarded in a Beijing day.
	DailyCityQuest = "cityquest"
	// CityQuestDailyRuns is how many deliveries a day earn a reward.
	CityQuestDailyRuns = 50
)

// CityQuestRun is one completed delivery: the base reward before rates.
type CityQuestRun struct {
	AccountID, RunID, QuestID string
	Exp, Lucci                int64
	Day                       string
	Now                       int64
}

// CityQuestLevelUp is a level the reward reached and what it paid.
type CityQuestLevelUp struct {
	Level               int
	Lucci, Koin, Coupon int64
}

// CityQuestResult is what a delivery credited and the account afterwards.
type CityQuestResult struct {
	Exp, Lucci            int64
	Capped, Duplicate     bool
	LevelUps              []CityQuestLevelUp
	WalletLucci, TotalExp int64
	Level                 int
}

// SettleCityQuest credits one delivery once per run id, after the
// configured rates, up to CityQuestDailyRuns rewarded deliveries a Beijing
// day; level-ups pay their rewards as for races.
func (s *Store) SettleCityQuest(ctx context.Context, run CityQuestRun) (CityQuestResult, error) {
	var result CityQuestResult
	err := inEconomyTx(ctx, s.db, nil, func(tx *sql.Tx) error {
		result = CityQuestResult{}
		l, err := s.lockLedger(ctx, tx, run.AccountID, run.Now)
		if err != nil {
			return err
		}
		counter, err := l.lockDaily(run.Day, DailyCityQuest)
		if err != nil {
			return err
		}
		if counter.count >= CityQuestDailyRuns {
			result.Capped = true
		} else {
			exp := rewards.ApplyRate(run.Exp, s.rules.Rates.Exp)
			lucci := rewards.ApplyRate(run.Lucci, s.rules.Rates.Lucci)
			applied, duplicate, err := l.addExp(exp, ReasonCityQuest, run.RunID, run.QuestID)
			if err != nil {
				return err
			}
			if duplicate {
				result.Duplicate = true
			} else {
				result.Exp = applied
				before := l.wallet.Lucci
				if _, err := l.add(economy.Lucci, lucci, ReasonCityQuest, run.RunID, run.QuestID); err != nil {
					return err
				}
				result.Lucci = l.wallet.Lucci - before
				if err := l.addDaily(run.Day, DailyCityQuest, result.Exp, result.Lucci); err != nil {
					return err
				}
			}
		}
		for _, up := range l.levelUpsOrEmpty() {
			result.LevelUps = append(result.LevelUps, CityQuestLevelUp{Level: up.Level, Lucci: up.Lucci, Koin: up.Koin,
				Coupon: up.Coupon})
		}
		result.WalletLucci, result.TotalExp = l.wallet.Lucci, l.exp
		result.Level = l.levels.LevelForExp(l.exp).Level
		return nil
	})
	return result, err
}
