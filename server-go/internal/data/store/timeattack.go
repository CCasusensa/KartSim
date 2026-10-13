package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"kartsim/internal/data/economy"
	"kartsim/internal/data/timeattack"
	"kartsim/internal/shared/apierr"
)

// 练习计时赛 and 排位计时赛 (TIMEATTACK.md): per-mode records by track, speed
// and booster mode, the replays of a track's top ranked records, the ranked
// entry fee and the training goal / duel progress. Everything changes under
// the account's wallet lock (lockLedger), like the time-attack settlement
// that calls most of it.

// Ledger reason, reward box source and emblem source of the feature.
const (
	ReasonRankedEntry      = "rankedentry" // the 500 金币 ranked entry fee; ref = requestId
	ReasonGoalReward       = "tagoal"      // RP of a training goal or duel reward; ref = mission key
	BoxSourceTimeAttack    = "timeattack"
	EmblemSourceTimeAttack = "timeattack"
)

var (
	errNoRankedEntry   = apierr.New(http.StatusConflict, "NO_RANKED_ENTRY")
	errGoalNotCleared  = apierr.New(http.StatusConflict, "GOAL_NOT_CLEARED")
	errGoalClaimed     = apierr.New(http.StatusConflict, "GOAL_CLAIMED")
	errDuelStageLocked = apierr.New(http.StatusConflict, "DUEL_STAGE_LOCKED")
	errReplayMissing   = apierr.New(http.StatusNotFound, "REPLAY_NOT_FOUND")
)

// TimeAttackKart names the kart a record was set with.
type TimeAttackKart struct {
	ItemID    int    `json:"itemId"`
	SystemKey string `json:"systemKey,omitempty"`
	Name      string `json:"name"`
}

// TimeAttackRecord is an account's best on a track, speed, booster and mode.
type TimeAttackRecord struct {
	BestMs       int64          `json:"bestMs"`
	Kart         TimeAttackKart `json:"kart"`
	CrashCount   int            `json:"crashCount"`
	BoosterCount int            `json:"boosterCount"`
	UpdatedAt    int64          `json:"updatedAt"`
}

// RankingRow is one line of a track's 赛道排名.
type RankingRow struct {
	Rank      int    `json:"rank"`
	AccountID string `json:"accountId"`
	Nickname  string `json:"nickname"`
	KartName  string `json:"kartName"`
	BestMs    int64  `json:"bestMs"`
	UpdatedAt int64  `json:"updatedAt"`
	HasReplay bool   `json:"hasReplay"`
	Self      bool   `json:"self"`
}

// Ranking is a track's top ranked records and the viewer's own records.
type Ranking struct {
	TrackID  string            `json:"trackId"`
	Speed    int               `json:"speed"`
	Booster  int               `json:"booster"`
	Rows     []RankingRow      `json:"rows"`
	Ranked   *TimeAttackRecord `json:"ranked"`
	Practice *TimeAttackRecord `json:"practice"`
	MyRank   int               `json:"myRank"`
	Fee      int               `json:"fee"`
}

// timeAttackKey is a track, speed and booster mode.
type timeAttackKey struct {
	TrackID string
	Speed   int
	Booster int
}

func scanRecord(row interface{ Scan(dest ...any) error }) (*TimeAttackRecord, error) {
	var r TimeAttackRecord
	err := row.Scan(&r.BestMs, &r.Kart.ItemID, &r.Kart.SystemKey, &r.Kart.Name, &r.CrashCount, &r.BoosterCount,
		&r.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &r, err
}

const recordColumns = "best_ms, kart_item_id, kart_system_key, kart_name, crash_count, booster_count, updated_at"

// upsertTimeAttackRecord keeps the account's best of a mode and reports
// whether run improved it.
func upsertTimeAttackRecord(ctx context.Context, tx *sql.Tx, run TimeAttackRun) (best int64, improved bool, err error) {
	previous, err := scanRecord(tx.QueryRowContext(ctx, `SELECT `+recordColumns+` FROM timeattack_records
		WHERE account_id = ? AND track_id = ? AND speed = ? AND booster = ? AND mode = ? FOR UPDATE`,
		run.AccountID, run.TrackID, run.Speed, run.Booster, run.Mode))
	if err != nil {
		return 0, false, err
	}
	if previous != nil && run.ElapsedMs >= previous.BestMs {
		return previous.BestMs, false, nil
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO timeattack_records(account_id, track_id, speed, booster, mode, best_ms,
		kart_item_id, kart_system_key, kart_name, crash_count, booster_count, updated_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) AS incoming
		ON DUPLICATE KEY UPDATE best_ms = incoming.best_ms, kart_item_id = incoming.kart_item_id,
			kart_system_key = incoming.kart_system_key, kart_name = incoming.kart_name,
			crash_count = incoming.crash_count, booster_count = incoming.booster_count, updated_at = incoming.updated_at`,
		run.AccountID, run.TrackID, run.Speed, run.Booster, run.Mode, run.ElapsedMs, run.Kart.ItemID, run.Kart.SystemKey,
		run.Kart.Name, run.CrashCount, run.BoosterCount, run.Now)
	return run.ElapsedMs, true, err
}

// rankOf is the 1-based rank of bestMs among a key's ranked records (ties
// rank by who set them first).
func rankOf(ctx context.Context, tx *sql.Tx, key timeAttackKey, accountID string, bestMs, updatedAt int64) (int, error) {
	var ahead int
	err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM timeattack_records WHERE track_id = ? AND speed = ? AND booster = ?
		AND mode = ? AND account_id <> ? AND (best_ms < ? OR (best_ms = ? AND updated_at < ?))`,
		key.TrackID, key.Speed, key.Booster, timeattack.ModeRanked, accountID, bestMs, bestMs, updatedAt).Scan(&ahead)
	return ahead + 1, err
}

// saveReplay stores the replay of a ranked record and drops the replays of
// records that fell out of the top RankingSize.
func saveReplay(ctx context.Context, tx *sql.Tx, run TimeAttackRun) error {
	if _, err := tx.ExecContext(ctx, `INSERT INTO timeattack_replays(track_id, speed, booster, account_id, best_ms, byte_size,
		ksv, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?) AS incoming
		ON DUPLICATE KEY UPDATE best_ms = incoming.best_ms, byte_size = incoming.byte_size, ksv = incoming.ksv,
			updated_at = incoming.updated_at`,
		run.TrackID, run.Speed, run.Booster, run.AccountID, run.ElapsedMs, len(run.Replay), run.Replay, run.Now); err != nil {
		return err
	}
	// MySQL refuses a subquery on the table being deleted from; list first.
	rows, err := tx.QueryContext(ctx, `SELECT account_id FROM timeattack_records WHERE track_id = ? AND speed = ? AND booster = ?
		AND mode = ? ORDER BY best_ms, updated_at LIMIT ?`, run.TrackID, run.Speed, run.Booster, timeattack.ModeRanked,
		timeattack.RankingSize)
	if err != nil {
		return err
	}
	keep := []any{run.TrackID, run.Speed, run.Booster}
	placeholders := ""
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		keep = append(keep, id)
		if placeholders != "" {
			placeholders += ","
		}
		placeholders += "?"
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if placeholders == "" {
		return nil
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM timeattack_replays WHERE track_id = ? AND speed = ? AND booster = ?
		AND account_id NOT IN (`+placeholders+`)`, keep...)
	return err
}

// settleRankedEntry marks the run's entry (its requestId) as used; a run
// without an unused entry of the same track, speed and booster has not
// paid the fee.
func settleRankedEntry(ctx context.Context, tx *sql.Tx, run TimeAttackRun) error {
	var (
		key     timeAttackKey
		settled sql.NullInt64
	)
	err := tx.QueryRowContext(ctx, `SELECT track_id, speed, booster, settled_at FROM timeattack_entries
		WHERE request_id = ? AND account_id = ? FOR UPDATE`, run.RequestID, run.AccountID).
		Scan(&key.TrackID, &key.Speed, &key.Booster, &settled)
	if errors.Is(err, sql.ErrNoRows) {
		return errNoRankedEntry
	}
	if err != nil {
		return err
	}
	if settled.Valid || key != (timeAttackKey{run.TrackID, run.Speed, run.Booster}) {
		return errNoRankedEntry
	}
	_, err = tx.ExecContext(ctx, "UPDATE timeattack_entries SET settled_at = ? WHERE request_id = ?", run.Now, run.RequestID)
	return err
}

// EnterRanked charges the ranked entry fee once per request id and opens an
// entry the settlement of that request id uses (409 INSUFFICIENT_FUNDS).
func (s *Store) EnterRanked(ctx context.Context, accountID, requestID string, key timeAttackKey, now int64) error {
	return inEconomyTx(ctx, s.db, nil, func(tx *sql.Tx) error {
		l, err := s.lockLedger(ctx, tx, accountID, now)
		if err != nil {
			return err
		}
		charged, err := l.add(economy.Lucci, -timeattack.RankedEntryLucci, ReasonRankedEntry, requestID, "")
		if err != nil {
			return err
		}
		if !charged {
			return nil // the same request: the entry exists
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO timeattack_entries(request_id, account_id, track_id, speed, booster, created_at)
			VALUES(?, ?, ?, ?, ?, ?)`, requestID, accountID, key.TrackID, key.Speed, key.Booster, now)
		return err
	})
}

// RankedKey builds a timeAttackKey (exported for the API).
func RankedKey(trackID string, speed, booster int) timeAttackKey {
	return timeAttackKey{TrackID: trackID, Speed: speed, Booster: booster}
}

// TimeAttackRanking lists a key's top ranked records with the viewer's own.
func (s *Store) TimeAttackRanking(ctx context.Context, key timeAttackKey, accountID string) (Ranking, error) {
	ranking := Ranking{TrackID: key.TrackID, Speed: key.Speed, Booster: key.Booster, Rows: []RankingRow{},
		Fee: timeattack.RankedEntryLucci}
	rows, err := s.db.QueryContext(ctx, `SELECT r.account_id, a.nickname, r.kart_name, r.best_ms, r.updated_at,
		EXISTS(SELECT 1 FROM timeattack_replays p WHERE p.track_id = r.track_id AND p.speed = r.speed AND p.booster = r.booster
			AND p.account_id = r.account_id)
		FROM timeattack_records r JOIN accounts a ON a.id = r.account_id
		WHERE r.track_id = ? AND r.speed = ? AND r.booster = ? AND r.mode = ?
		ORDER BY r.best_ms, r.updated_at LIMIT ?`, key.TrackID, key.Speed, key.Booster, timeattack.ModeRanked,
		timeattack.RankingSize)
	if err != nil {
		return ranking, err
	}
	defer rows.Close()
	for rows.Next() {
		row := RankingRow{Rank: len(ranking.Rows) + 1}
		if err := rows.Scan(&row.AccountID, &row.Nickname, &row.KartName, &row.BestMs, &row.UpdatedAt, &row.HasReplay); err != nil {
			return ranking, err
		}
		row.Self = row.AccountID == accountID
		ranking.Rows = append(ranking.Rows, row)
	}
	if err := rows.Err(); err != nil {
		return ranking, err
	}
	for _, mode := range []string{timeattack.ModeRanked, timeattack.ModePractice} {
		record, err := scanRecord(s.db.QueryRowContext(ctx, `SELECT `+recordColumns+` FROM timeattack_records
			WHERE account_id = ? AND track_id = ? AND speed = ? AND booster = ? AND mode = ?`,
			accountID, key.TrackID, key.Speed, key.Booster, mode))
		if err != nil {
			return ranking, err
		}
		if mode == timeattack.ModeRanked {
			ranking.Ranked = record
		} else {
			ranking.Practice = record
		}
	}
	if ranking.Ranked != nil {
		var ahead int
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM timeattack_records WHERE track_id = ? AND speed = ? AND booster = ?
			AND mode = ? AND account_id <> ? AND (best_ms < ? OR (best_ms = ? AND updated_at < ?))`,
			key.TrackID, key.Speed, key.Booster, timeattack.ModeRanked, accountID, ranking.Ranked.BestMs,
			ranking.Ranked.BestMs, ranking.Ranked.UpdatedAt).Scan(&ahead); err != nil {
			return ranking, err
		}
		ranking.MyRank = ahead + 1
	}
	return ranking, nil
}

// TimeAttackReplay is the stored replay of a ranked record (404 REPLAY_NOT_FOUND).
func (s *Store) TimeAttackReplay(ctx context.Context, key timeAttackKey, accountID string) (ksv []byte, updatedAt int64, err error) {
	err = s.db.QueryRowContext(ctx, `SELECT ksv, updated_at FROM timeattack_replays WHERE track_id = ? AND speed = ? AND booster = ?
		AND account_id = ?`, key.TrackID, key.Speed, key.Booster, accountID).Scan(&ksv, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, 0, errReplayMissing
	}
	return ksv, updatedAt, err
}

// TimeAttackPracticeRecord is the account's practice record of a key.
func (s *Store) TimeAttackPracticeRecord(ctx context.Context, key timeAttackKey, accountID string) (*TimeAttackRecord, error) {
	return scanRecord(s.db.QueryRowContext(ctx, `SELECT `+recordColumns+` FROM timeattack_records
		WHERE account_id = ? AND track_id = ? AND speed = ? AND booster = ? AND mode = ?`,
		accountID, key.TrackID, key.Speed, key.Booster, timeattack.ModePractice))
}

// PruneTimeAttackEntries deletes ranked entries created before cutoff
// (settled or expired), at most limit rows.
func (s *Store) PruneTimeAttackEntries(ctx context.Context, cutoff int64, limit int) (int64, error) {
	result, err := s.db.ExecContext(ctx, "DELETE FROM timeattack_entries WHERE created_at < ? LIMIT ?", cutoff, limit)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// ---- missions: training goals and duels ------------------------------------

// Mission row keys (timeattack_missions.mission).
func goalKey(set int) string { return "goal:" + strconv.Itoa(set) }
func goalStageKey(set, stage int) string {
	return "goal:" + strconv.Itoa(set) + ":" + strconv.Itoa(stage)
}
func claimKey(set, stage int) string { return "claim:" + strconv.Itoa(set) + ":" + strconv.Itoa(stage) }
func duelKey(event string, stage int) string {
	return "duel:" + event + ":" + strconv.Itoa(stage)
}
func duelBonusKey(event string, stage, level int) string {
	return "duelbonus:" + event + ":" + strconv.Itoa(stage) + ":" + strconv.Itoa(level)
}

type missionRow struct {
	Value     int
	ClearedAt sql.NullInt64
	ClaimedAt sql.NullInt64
}

func readMissions(ctx context.Context, q interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}, accountID, trackID string, lock bool) (map[string]missionRow, error) {
	query := "SELECT mission, value, cleared_at, claimed_at FROM timeattack_missions WHERE account_id = ? AND track_id = ?"
	if lock {
		query += " FOR UPDATE"
	}
	rows, err := q.QueryContext(ctx, query, accountID, trackID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]missionRow{}
	for rows.Next() {
		var (
			key string
			row missionRow
		)
		if err := rows.Scan(&key, &row.Value, &row.ClearedAt, &row.ClaimedAt); err != nil {
			return nil, err
		}
		out[key] = row
	}
	return out, rows.Err()
}

func writeMission(ctx context.Context, tx *sql.Tx, accountID, trackID, key string, row missionRow, now int64) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO timeattack_missions(account_id, track_id, mission, value, cleared_at, claimed_at,
		updated_at) VALUES(?, ?, ?, ?, ?, ?, ?) AS incoming
		ON DUPLICATE KEY UPDATE value = incoming.value, cleared_at = incoming.cleared_at, claimed_at = incoming.claimed_at,
			updated_at = incoming.updated_at`, accountID, trackID, key, row.Value, row.ClearedAt, row.ClaimedAt, now)
	return err
}

// goalProgress is a set's progress as the goals count it: cumulative sets
// (finish, booster, record) keep one value; the crash set one per stage.
func goalProgress(set timeattack.GoalSet, index, stage int, rows map[string]missionRow) int {
	if set.Type == timeattack.GoalCrash {
		return rows[goalStageKey(index, stage)].Value
	}
	return rows[goalKey(index)].Value
}

// goalCleared reports whether a stage's count is reached. Crash stages open
// one after another; the others are read off the cumulative value.
func goalCleared(set timeattack.GoalSet, index, stage int, rows map[string]missionRow) bool {
	if stage < 1 || stage > len(set.Stages) {
		return false
	}
	if set.Type == timeattack.GoalCrash {
		for s := 1; s < stage; s++ {
			if rows[goalStageKey(index, s)].Value < set.Stages[s-1].Count {
				return false
			}
		}
	}
	return goalProgress(set, index, stage, rows) >= set.Stages[stage-1].Count
}

// openCrashStage is the first crash stage not yet reached (0: all done).
func openCrashStage(set timeattack.GoalSet, index int, rows map[string]missionRow) int {
	for s := 1; s <= len(set.Stages); s++ {
		if rows[goalStageKey(index, s)].Value < set.Stages[s-1].Count {
			return s
		}
	}
	return 0
}

// advanceGoals counts a finished practice run toward the track's goals.
func advanceGoals(ctx context.Context, tx *sql.Tx, run TimeAttackRun) error {
	if len(run.Goals) == 0 {
		return nil
	}
	rows, err := readMissions(ctx, tx, run.AccountID, run.TrackID, true)
	if err != nil {
		return err
	}
	bump := func(key string, delta int, cap int) error {
		row := rows[key]
		if row.Value >= cap {
			return nil
		}
		row.Value = min(cap, row.Value+delta)
		rows[key] = row
		return writeMission(ctx, tx, run.AccountID, run.TrackID, key, row, run.Now)
	}
	for i, set := range run.Goals {
		last := set.Stages[len(set.Stages)-1]
		switch set.Type {
		case timeattack.GoalFinish:
			if err := bump(goalKey(i), 1, last.Count); err != nil {
				return err
			}
		case timeattack.GoalBooster:
			if run.BoosterCount > 0 {
				if err := bump(goalKey(i), run.BoosterCount, last.Count); err != nil {
					return err
				}
			}
		case timeattack.GoalCrash:
			if stage := openCrashStage(set, i, rows); stage > 0 && run.CrashCount <= set.Stages[stage-1].Requirement {
				if err := bump(goalStageKey(i, stage), 1, set.Stages[stage-1].Count); err != nil {
					return err
				}
			}
		case timeattack.GoalRecord:
			if run.ElapsedMs <= int64(set.Stages[0].Requirement) {
				if err := bump(goalKey(i), 1, last.Count); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// GoalStageView is one stage of a goal set as the window shows it.
type GoalStageView struct {
	Stage       int               `json:"stage"`
	Count       int               `json:"count"`
	Requirement int               `json:"requirement"`
	Value       int               `json:"value"`
	Cleared     bool              `json:"cleared"`
	Claimed     bool              `json:"claimed"`
	Reward      timeattack.Reward `json:"reward"`
}

// GoalSetView is a goal set with the account's progress; Current is the
// stage the card shows (the first unclaimed, or the last).
type GoalSetView struct {
	Index   int             `json:"index"`
	Title   string          `json:"title"`
	Type    string          `json:"type"`
	Hidden  bool            `json:"hidden"`
	Current int             `json:"current"`
	Stages  []GoalStageView `json:"stages"`
}

// DuelStageView is a duel stage with the account's standing.
type DuelStageView struct {
	Stage      int    `json:"stage"`
	Open       bool   `json:"open"`
	Won        bool   `json:"won"`
	Losses     int    `json:"losses"`
	Difficulty int    `json:"difficulty"` // the highest 难度设定 level available
	Bonus      []bool `json:"bonus"`      // which difficulty rewards were taken
}

// TimeAttackMissionsView is a track's goals and the active duel for an account.
type TimeAttackMissionsView struct {
	Goals []GoalSetView   `json:"goals"`
	Duel  []DuelStageView `json:"duel"`
}

func goalViews(goals []timeattack.GoalSet, rows map[string]missionRow) []GoalSetView {
	views := make([]GoalSetView, 0, len(goals))
	for i, set := range goals {
		view := GoalSetView{Index: i, Title: set.Title, Type: set.Type, Hidden: set.Hidden, Current: len(set.Stages)}
		for s := range set.Stages {
			stage := GoalStageView{Stage: s + 1, Count: set.Stages[s].Count, Requirement: set.Stages[s].Requirement,
				Value: goalProgress(set, i, s+1, rows), Cleared: goalCleared(set, i, s+1, rows),
				Claimed: rows[claimKey(i, s+1)].ClaimedAt.Valid, Reward: set.Stages[s].Reward}
			if set.Type != timeattack.GoalCrash {
				stage.Value = min(stage.Value, stage.Count)
			}
			view.Stages = append(view.Stages, stage)
			if !stage.Claimed && view.Current == len(set.Stages) && (s == 0 || view.Stages[s-1].Claimed) {
				view.Current = s + 1
			}
		}
		views = append(views, view)
	}
	return views
}

func duelViews(duel *timeattack.Duel, rows map[string]missionRow) []DuelStageView {
	if duel == nil {
		return nil
	}
	views := make([]DuelStageView, 0, len(duel.Stages))
	open := true
	for _, stage := range duel.Stages {
		row := rows[duelKey(duel.Key(), stage.Stage)]
		view := DuelStageView{Stage: stage.Stage, Open: open, Won: row.ClearedAt.Valid, Losses: row.Value,
			Difficulty: timeattack.DifficultyLevel(stage, row.Value), Bonus: make([]bool, len(stage.Difficulties))}
		for level := range stage.Difficulties {
			view.Bonus[level] = rows[duelBonusKey(duel.Key(), stage.Stage, level)].ClaimedAt.Valid
		}
		views = append(views, view)
		open = open && view.Won
	}
	return views
}

// TimeAttackMissions reads an account's standing on a track's goals and the duel.
func (s *Store) TimeAttackMissions(ctx context.Context, accountID, trackID string, goals []timeattack.GoalSet,
	duel *timeattack.Duel) (TimeAttackMissionsView, error) {
	rows, err := readMissions(ctx, s.db, accountID, trackID, false)
	if err != nil {
		return TimeAttackMissionsView{}, err
	}
	return TimeAttackMissionsView{Goals: goalViews(goals, rows), Duel: duelViews(duel, rows)}, nil
}

// fileReward puts a mission reward where its type goes: stock items and
// 金币 into the reward box, RP onto the account, an emblem into the album.
func (s *Store) fileReward(ctx context.Context, tx *sql.Tx, l *ledger, accountID string, data *timeattack.Data,
	reward timeattack.Reward, message, ref string, now int64) error {
	switch reward.Type {
	case timeattack.RewardLucci:
		return addRewardBox(ctx, tx, accountID, []RewardBoxEntry{{Source: BoxSourceTimeAttack, Message: message,
			Name: "金币", Count: reward.Value, Currency: string(economy.Lucci)}}, now)
	case timeattack.RewardRP:
		_, _, err := l.addExp(int64(reward.Value), ReasonGoalReward, ref, "")
		return err
	case timeattack.RewardEmblem:
		_, err := grantEmblem(ctx, tx, accountID, reward.Value, EmblemSourceTimeAttack, 0, now)
		return err
	case timeattack.RewardStock:
		stock, ok := data.Stock(reward)
		if !ok {
			return fmt.Errorf("reward stock %d is unknown", reward.Value)
		}
		entries := make([]RewardBoxEntry, 0, len(stock.Items))
		for _, item := range stock.Items {
			entries = append(entries, RewardBoxEntry{Source: BoxSourceTimeAttack, Message: message, Name: stock.Name,
				Category: item.Category, ItemID: item.ItemID, Count: item.Count, Days: item.Days})
		}
		return addRewardBox(ctx, tx, accountID, entries, now)
	}
	return fmt.Errorf("reward type %q", reward.Type)
}

// ClaimTimeAttackGoal files a cleared goal stage's reward once
// (409 GOAL_NOT_CLEARED / GOAL_CLAIMED).
func (s *Store) ClaimTimeAttackGoal(ctx context.Context, accountID, trackID string, data *timeattack.Data,
	goals []timeattack.GoalSet, set, stage int, now int64) (TimeAttackMissionsView, error) {
	var view TimeAttackMissionsView
	if set < 0 || set >= len(goals) || stage < 1 || stage > len(goals[set].Stages) {
		return view, errGoalNotCleared
	}
	err := inEconomyTx(ctx, s.db, nil, func(tx *sql.Tx) error {
		l, err := s.lockLedger(ctx, tx, accountID, now)
		if err != nil {
			return err
		}
		rows, err := readMissions(ctx, tx, accountID, trackID, true)
		if err != nil {
			return err
		}
		if !goalCleared(goals[set], set, stage, rows) {
			return errGoalNotCleared
		}
		if rows[claimKey(set, stage)].ClaimedAt.Valid {
			return errGoalClaimed
		}
		goal := goals[set]
		message := fmt.Sprintf("练习目标：%s %d阶段", goal.Title, stage)
		if goal.Type == timeattack.GoalCrash {
			message = fmt.Sprintf("练习目标：撞击次数%d次以内 %d阶段", goal.Stages[stage-1].Requirement, stage)
		}
		if err := s.fileReward(ctx, tx, l, accountID, data, goal.Stages[stage-1].Reward, message,
			trackID+":"+claimKey(set, stage), now); err != nil {
			return err
		}
		row := missionRow{Value: 1, ClearedAt: sql.NullInt64{Int64: now, Valid: true},
			ClaimedAt: sql.NullInt64{Int64: now, Valid: true}}
		rows[claimKey(set, stage)] = row
		if err := writeMission(ctx, tx, accountID, trackID, claimKey(set, stage), row, now); err != nil {
			return err
		}
		view = TimeAttackMissionsView{Goals: goalViews(goals, rows)}
		return nil
	})
	return view, err
}

// DuelRun is one finished 赛道对决 race.
type DuelRun struct {
	AccountID  string
	RequestID  string
	Duel       *timeattack.Duel
	Stage      int
	Difficulty int // the 难度设定 level raced at (0 无)
	Won        bool
	Now        int64
}

// DuelResult is what a duel race changed.
type DuelResult struct {
	FirstWin   bool               `json:"firstWin"`   // the stage was won for the first time: its reward is filed
	Bonus      *timeattack.Reward `json:"bonus"`      // the difficulty reward filed this time
	Losses     int                `json:"losses"`     // consecutive losses at the stage
	Difficulty int                `json:"difficulty"` // the level now available
	Stages     []DuelStageView    `json:"stages"`
}

// SettleDuel records a duel race: a win clears the stage (its reward once,
// and the difficulty level's special reward once per level), a loss counts
// toward the next 难度设定 level (409 DUEL_STAGE_LOCKED when the previous
// stage was not won).
func (s *Store) SettleDuel(ctx context.Context, data *timeattack.Data, run DuelRun) (DuelResult, error) {
	var result DuelResult
	if run.Stage < 1 || run.Stage > len(run.Duel.Stages) {
		return result, errDuelStageLocked
	}
	stage := run.Duel.Stages[run.Stage-1]
	if run.Difficulty < 0 || run.Difficulty >= len(stage.Difficulties) {
		return result, errDuelStageLocked
	}
	err := inEconomyTx(ctx, s.db, nil, func(tx *sql.Tx) error {
		result = DuelResult{}
		l, err := s.lockLedger(ctx, tx, run.AccountID, run.Now)
		if err != nil {
			return err
		}
		rows, err := readMissions(ctx, tx, run.AccountID, run.Duel.TrackID, true)
		if err != nil {
			return err
		}
		if run.Stage > 1 && !rows[duelKey(run.Duel.Key(), run.Stage-1)].ClearedAt.Valid {
			return errDuelStageLocked
		}
		key := duelKey(run.Duel.Key(), run.Stage)
		row := rows[key]
		if run.Difficulty > timeattack.DifficultyLevel(stage, row.Value) {
			return errDuelStageLocked
		}
		if !run.Won {
			row.Value++
			rows[key] = row
			if err := writeMission(ctx, tx, run.AccountID, run.Duel.TrackID, key, row, run.Now); err != nil {
				return err
			}
		} else {
			if !row.ClearedAt.Valid {
				result.FirstWin = true
				row.ClearedAt = sql.NullInt64{Int64: run.Now, Valid: true}
				row.ClaimedAt = row.ClearedAt
				if stage.Reward != nil {
					if err := s.fileReward(ctx, tx, l, run.AccountID, data, *stage.Reward,
						"赛道对决：战胜 "+stage.NPC.Name, run.Duel.TrackID+":"+key, run.Now); err != nil {
						return err
					}
				}
			}
			// The losses stay: a 难度设定 level once unlocked remains available.
			rows[key] = row
			if err := writeMission(ctx, tx, run.AccountID, run.Duel.TrackID, key, row, run.Now); err != nil {
				return err
			}
			if run.Difficulty > 0 {
				bonusKey := duelBonusKey(run.Duel.Key(), run.Stage, run.Difficulty)
				if !rows[bonusKey].ClaimedAt.Valid {
					bonus := stage.Difficulties[run.Difficulty].Reward
					if err := s.fileReward(ctx, tx, l, run.AccountID, data, bonus,
						fmt.Sprintf("赛道对决：%d秒后出发战胜 %s", stage.Difficulties[run.Difficulty].AdvantageMs/1000, stage.NPC.Name),
						run.Duel.TrackID+":"+bonusKey, run.Now); err != nil {
						return err
					}
					bonusRow := missionRow{Value: 1, ClearedAt: sql.NullInt64{Int64: run.Now, Valid: true},
						ClaimedAt: sql.NullInt64{Int64: run.Now, Valid: true}}
					rows[bonusKey] = bonusRow
					if err := writeMission(ctx, tx, run.AccountID, run.Duel.TrackID, bonusKey, bonusRow, run.Now); err != nil {
						return err
					}
					result.Bonus = &bonus
				}
			}
		}
		result.Losses = rows[key].Value
		result.Difficulty = timeattack.DifficultyLevel(stage, result.Losses)
		result.Stages = duelViews(run.Duel, rows)
		return nil
	})
	return result, err
}
