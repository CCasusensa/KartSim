package store

import (
	"context"
	"database/sql"
	"errors"

	"kartsim/internal/data/quest"
)

// 任务 (MENUS.md 2): races add to the account's quests of the current
// period; reaching a target files the rewards into the 奖励箱 (an emblem is
// granted at once) — the release mails them too ("任务已完成。请在奖励箱中
// 确认奖励~！").

// EmblemSourceQuest is the account_emblems source of quest emblems.
const EmblemSourceQuest = "quest"

// QuestState is an account's standing on one quest in its current period.
type QuestState struct {
	ID          int   `json:"id"`
	Value       int64 `json:"value"`
	CompletedAt int64 `json:"completedAt,omitempty"`
}

// questDone reports whether a quest is completed: a one-time quest ever,
// a daily or weekly one (the pass chain) in its current period.
func questDone(ctx context.Context, q queryer, accountID string, id int, now int64) (bool, error) {
	period := ""
	if pre, ok := quest.ByID(id); ok {
		period = quest.PeriodOf(pre.Reset, now).Key
	}
	return exists(ctx, q, `SELECT 1 FROM quest_progress WHERE account_id = ? AND quest_id = ? AND period = ?
		AND completed_at IS NOT NULL`, accountID, id, period)
}

// addPassPoints credits 通行证积分 (MENUS.md 2: the pass chain's rewards).
func addPassPoints(ctx context.Context, tx *sql.Tx, accountID string, points int, now int64) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO pass_points(account_id, points, updated_at) VALUES(?, ?, ?) AS incoming
		ON DUPLICATE KEY UPDATE points = pass_points.points + incoming.points, updated_at = incoming.updated_at`,
		accountID, points, now)
	return err
}

// PassPoints is an account's 通行证积分.
func (s *Store) PassPoints(ctx context.Context, accountID string) (int, error) {
	var points int
	err := s.db.QueryRowContext(ctx, "SELECT points FROM pass_points WHERE account_id = ?", accountID).Scan(&points)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return points, err
}

// addQuestProgress counts a race on every quest it serves and completes the
// ones it brings to their target.
func addQuestProgress(ctx context.Context, tx *sql.Tx, accountID string, race quest.Race, now int64) error {
	// A chained quest opens with the race after the one completing its
	// predecessor: read the predecessors' standing before counting anything.
	preDone := map[int]bool{}
	for i := range quest.All {
		if pre := quest.All[i].Pre; pre != 0 {
			done, err := questDone(ctx, tx, accountID, pre, now)
			if err != nil {
				return err
			}
			preDone[pre] = done
		}
	}
	for i := range quest.All {
		q := &quest.All[i]
		gain := q.Gain(race)
		if gain <= 0 {
			continue
		}
		if q.Pre != 0 && !preDone[q.Pre] {
			continue
		}
		period := quest.PeriodOf(q.Reset, now).Key
		if _, err := tx.ExecContext(ctx, `INSERT INTO quest_progress(account_id, quest_id, period, value, updated_at)
			VALUES(?, ?, ?, 0, ?) ON DUPLICATE KEY UPDATE account_id = account_id`, accountID, q.ID, period, now); err != nil {
			if missingParent(err) {
				return errAccountNotFound
			}
			return err
		}
		var (
			value     int64
			completed sql.NullInt64
		)
		if err := tx.QueryRowContext(ctx, `SELECT value, completed_at FROM quest_progress
			WHERE account_id = ? AND quest_id = ? AND period = ? FOR UPDATE`, accountID, q.ID, period).
			Scan(&value, &completed); err != nil {
			return err
		}
		if completed.Valid {
			continue
		}
		value = min(value+gain, q.Target)
		var completedAt any
		if value >= q.Target {
			completedAt = now
		}
		if _, err := tx.ExecContext(ctx, `UPDATE quest_progress SET value = ?, completed_at = ?, updated_at = ?
			WHERE account_id = ? AND quest_id = ? AND period = ?`, value, completedAt, now, accountID, q.ID, period); err != nil {
			return err
		}
		if completedAt != nil {
			if err := rewardQuest(ctx, tx, accountID, q, now); err != nil {
				return err
			}
		}
	}
	return nil
}

// rewardQuest files a completed quest's prizes.
func rewardQuest(ctx context.Context, tx *sql.Tx, accountID string, q *quest.Quest, now int64) error {
	entries := []RewardBoxEntry{}
	for _, reward := range q.Rewards {
		if reward.PassPoints > 0 {
			if err := addPassPoints(ctx, tx, accountID, reward.PassPoints, now); err != nil {
				return err
			}
			continue
		}
		if reward.Emblem != 0 {
			if _, err := grantEmblem(ctx, tx, accountID, reward.Emblem, EmblemSourceQuest, q.ID, now); err != nil {
				return err
			}
			continue
		}
		entries = append(entries, RewardBoxEntry{Source: BoxSourceQuest, Message: "任务：" + q.Mission, Name: reward.Name,
			Category: reward.Category, ItemID: reward.ItemID, Count: reward.Count, Days: reward.Days,
			Currency: reward.Currency})
	}
	return addRewardBox(ctx, tx, accountID, entries, now)
}

// raceQuestResult is a settled multiplayer result as quests count it.
func raceQuestResult(in Settlement, racer SettledResult) quest.Race {
	finished := racer.ElapsedMs != nil
	won := finished && racer.Rank == 1
	if in.Team {
		won = in.WinningTeam != 0 && racer.Team == in.WinningTeam
	}
	return quest.Race{Channel: quest.RaceChannel(in.Team, in.Infinite), Finished: finished, Rank: racer.Rank,
		Won: won, Meters: int64(max(racer.DistanceMeters, 0))}
}

// Quests returns an account's standing on every quest in its current period.
func (s *Store) Quests(ctx context.Context, accountID string, now int64) ([]QuestState, error) {
	keys := map[string]bool{}
	for _, q := range quest.All {
		keys[quest.PeriodOf(q.Reset, now).Key] = true
	}
	args := []any{accountID}
	marks := ""
	for key := range keys {
		if marks != "" {
			marks += ","
		}
		marks += "?"
		args = append(args, key)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT quest_id, period, value, completed_at FROM quest_progress
		WHERE account_id = ? AND period IN (`+marks+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	found := map[int]QuestState{}
	for rows.Next() {
		var (
			id        int
			period    string
			value     int64
			completed sql.NullInt64
		)
		if err := rows.Scan(&id, &period, &value, &completed); err != nil {
			return nil, err
		}
		q, ok := quest.ByID(id)
		if !ok || quest.PeriodOf(q.Reset, now).Key != period {
			continue
		}
		found[id] = QuestState{ID: id, Value: value, CompletedAt: completed.Int64}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	states := make([]QuestState, 0, len(quest.All))
	for _, q := range quest.All {
		state, ok := found[q.ID]
		if !ok {
			state = QuestState{ID: q.ID}
		}
		states = append(states, state)
	}
	return states, nil
}

// PruneQuestProgress deletes progress of daily and weekly periods that
// started before a Beijing day ("2006-01-02"), at most limit rows.
func (s *Store) PruneQuestProgress(ctx context.Context, dayBefore string, limit int) (int64, error) {
	if dayBefore == "" {
		return 0, errors.New("no day")
	}
	result, err := s.db.ExecContext(ctx, "DELETE FROM quest_progress WHERE period <> '' AND period < ? LIMIT ?",
		dayBefore, limit)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}
