package store

import (
	"context"
	"database/sql"
	"errors"
	"net/http"

	"kartsim/internal/shared/apierr"
)

// 联赛回放 (TIMEATTACK.md 4): replays the admin picked from the ranked
// records and published with a title. The .ksv is copied, so the entry
// stays when the record drops out of the top 10 or the account goes.

var errFeaturedMissing = apierr.New(http.StatusNotFound, "FEATURED_NOT_FOUND")

// FeaturedReplay is one published replay (without its bytes).
type FeaturedReplay struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Note      string `json:"note,omitempty"`
	TrackID   string `json:"trackId"`
	TrackName string `json:"trackName"` // filled by the API from the track table
	Speed     int    `json:"speed"`
	Booster   int    `json:"booster"`
	AccountID string `json:"accountId"`
	Nickname  string `json:"nickname"`
	KartName  string `json:"kartName"`
	BestMs    int64  `json:"bestMs"`
	ByteSize  int    `json:"byteSize"`
	CreatedBy string `json:"createdBy"`
	CreatedAt int64  `json:"createdAt"`
}

const featuredColumns = "id, title, note, track_id, speed, booster, account_id, nickname, kart_name, best_ms, byte_size, created_by, created_at"

func scanFeatured(row interface{ Scan(dest ...any) error }) (FeaturedReplay, error) {
	var f FeaturedReplay
	err := row.Scan(&f.ID, &f.Title, &f.Note, &f.TrackID, &f.Speed, &f.Booster, &f.AccountID, &f.Nickname, &f.KartName,
		&f.BestMs, &f.ByteSize, &f.CreatedBy, &f.CreatedAt)
	return f, err
}

// FeaturedReplays lists the published replays, newest first.
func (s *Store) FeaturedReplays(ctx context.Context) ([]FeaturedReplay, error) {
	list := []FeaturedReplay{}
	err := s.queryRows(ctx, "SELECT "+featuredColumns+" FROM featured_replays ORDER BY created_at DESC, id DESC", nil,
		func(rows *sql.Rows) error {
			f, err := scanFeatured(rows)
			if err != nil {
				return err
			}
			list = append(list, f)
			return nil
		})
	return list, err
}

// FeaturedReplayFile is a published replay's .ksv (404 FEATURED_NOT_FOUND).
func (s *Store) FeaturedReplayFile(ctx context.Context, id int64) (ksv []byte, createdAt int64, err error) {
	err = s.db.QueryRowContext(ctx, "SELECT ksv, created_at FROM featured_replays WHERE id = ?", id).Scan(&ksv, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, 0, errFeaturedMissing
	}
	return ksv, createdAt, err
}

// AddFeaturedReplay copies a ranked record's replay (404 REPLAY_NOT_FOUND
// without one) into the published list.
func (s *Store) AddFeaturedReplay(ctx context.Context, key timeAttackKey, accountID, title, note, admin string,
	now int64) (FeaturedReplay, error) {
	result, err := s.db.ExecContext(ctx, `INSERT INTO featured_replays(title, note, track_id, speed, booster, account_id,
			nickname, kart_name, best_ms, byte_size, ksv, created_by, created_at)
		SELECT ?, ?, p.track_id, p.speed, p.booster, p.account_id, a.nickname, COALESCE(r.kart_name, ''), p.best_ms,
			p.byte_size, p.ksv, ?, ?
		FROM timeattack_replays p JOIN accounts a ON a.id = p.account_id
		LEFT JOIN timeattack_records r ON r.account_id = p.account_id AND r.track_id = p.track_id AND r.speed = p.speed
			AND r.booster = p.booster AND r.mode = 'ranked'
		WHERE p.track_id = ? AND p.speed = ? AND p.booster = ? AND p.account_id = ?`,
		title, note, admin, now, key.TrackID, key.Speed, key.Booster, accountID)
	if err != nil {
		return FeaturedReplay{}, err
	}
	if n, _ := result.RowsAffected(); n == 0 {
		return FeaturedReplay{}, errReplayMissing
	}
	id, err := result.LastInsertId()
	if err != nil {
		return FeaturedReplay{}, err
	}
	return scanFeatured(s.db.QueryRowContext(ctx, "SELECT "+featuredColumns+" FROM featured_replays WHERE id = ?", id))
}

// DeleteFeaturedReplay removes a published replay (404 FEATURED_NOT_FOUND).
func (s *Store) DeleteFeaturedReplay(ctx context.Context, id int64) error {
	result, err := s.db.ExecContext(ctx, "DELETE FROM featured_replays WHERE id = ?", id)
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n == 0 {
		return errFeaturedMissing
	}
	return nil
}

// AdminReplayRow is one stored ranked replay in the admin list.
type AdminReplayRow struct {
	TrackID   string `json:"trackId"`
	TrackName string `json:"trackName"` // filled by the API
	Speed     int    `json:"speed"`
	Booster   int    `json:"booster"`
	AccountID string `json:"accountId"`
	Username  string `json:"username"`
	Nickname  string `json:"nickname"`
	KartName  string `json:"kartName"`
	BestMs    int64  `json:"bestMs"`
	ByteSize  int    `json:"byteSize"`
	UpdatedAt int64  `json:"updatedAt"`
	Featured  int    `json:"featured"`
}

// ReplayFilter narrows the admin replay list.
type ReplayFilter struct {
	TrackID   string
	AccountID string
}

var replaySorts = map[string]string{"updatedAt": "p.updated_at", "bestMs": "p.best_ms", "track": "p.track_id"}

// AdminTimeAttackReplays lists the stored ranked replays, newest first by
// default: q matches the username, nickname and track id.
func (s *Store) AdminTimeAttackReplays(ctx context.Context, page AdminPage, filter ReplayFilter) ([]AdminReplayRow, int, error) {
	var q adminQuery
	q.search(page.Query, []string{"a.username", "a.nickname", "p.track_id"}, nil)
	q.during("p.updated_at", page)
	if filter.TrackID != "" {
		q.add("p.track_id = ?", filter.TrackID)
	}
	if filter.AccountID != "" {
		q.add("p.account_id = ?", filter.AccountID)
	}
	from := " FROM timeattack_replays p JOIN accounts a ON a.id = p.account_id"
	total, err := s.count(ctx, "SELECT COUNT(*)"+from+q.where(), q.args)
	if err != nil || total == 0 {
		return []AdminReplayRow{}, total, err
	}
	tail, args := limit(page, q.args)
	list := []AdminReplayRow{}
	err = s.queryRows(ctx, `SELECT p.track_id, p.speed, p.booster, p.account_id, a.username, a.nickname,
			COALESCE((SELECT r.kart_name FROM timeattack_records r WHERE r.account_id = p.account_id AND r.track_id = p.track_id
				AND r.speed = p.speed AND r.booster = p.booster AND r.mode = 'ranked'), ''),
			p.best_ms, p.byte_size, p.updated_at,
			(SELECT COUNT(*) FROM featured_replays f WHERE f.account_id = p.account_id AND f.track_id = p.track_id
				AND f.speed = p.speed AND f.booster = p.booster)`+from+q.where()+
		orderBy(page, replaySorts, "updatedAt", "p.track_id", "p.account_id")+tail, args, func(rows *sql.Rows) error {
		var row AdminReplayRow
		if err := rows.Scan(&row.TrackID, &row.Speed, &row.Booster, &row.AccountID, &row.Username, &row.Nickname,
			&row.KartName, &row.BestMs, &row.ByteSize, &row.UpdatedAt, &row.Featured); err != nil {
			return err
		}
		list = append(list, row)
		return nil
	})
	return list, total, err
}
