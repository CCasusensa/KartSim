package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"kartsim/internal/shared/apierr"
)

// 大厅宣传 (ADMIN.md 10): the lobby home's promotion carousel and the two
// promotion boards under it. The admin uploads pictures (lobby_promo_images,
// schema v23, named by their content hash) and chooses which one shows
// where, each with an optional link, in the "lobbyPromos" app_settings row.
// Without a row the client keeps its built-in pictures.

const (
	settingsLobbyPromos = "lobbyPromos"
	// MaxLobbyCarousel bounds the carousel's pictures.
	MaxLobbyCarousel = 8
	// LobbyBoards is the number of promotion boards (blue, then purple).
	LobbyBoards = 2
	// DefaultLobbyInterval, MinLobbyInterval and MaxLobbyInterval are the
	// carousel's seconds per picture.
	DefaultLobbyInterval = 5
	MinLobbyInterval     = 2
	MaxLobbyInterval     = 60
	// MaxLobbyPromoImages bounds the stored pictures; unused ones older than
	// lobbyImageGrace are removed first.
	MaxLobbyPromoImages = 100
	// lobbyImageGrace keeps an upload no setting uses yet: the admin may
	// still be filling in the form.
	lobbyImageGrace = 24 * 60 * 60 * 1000
)

var (
	// ErrLobbyImageNotFound: no picture has that id (or it was removed).
	ErrLobbyImageNotFound = apierr.New(http.StatusNotFound, "PROMO_IMAGE_NOT_FOUND")
	errLobbyImageMissing  = apierr.New(http.StatusBadRequest, "PROMO_IMAGE_NOT_FOUND")
	errLobbyImageLimit    = apierr.New(http.StatusConflict, "PROMO_IMAGE_LIMIT")
)

// LobbyPromo is one carousel picture or promotion board.
type LobbyPromo struct {
	// Image is the picture's id; a board without one keeps its drawn look.
	Image string `json:"image"`
	// Link opens when the picture is clicked: an http(s) URL or a path on
	// the game's own site; empty for none.
	Link string `json:"link"`
	// Title names the picture; a board without a picture shows it in place
	// of COMING SOON.
	Title string `json:"title"`
}

// LobbyPromos is what the lobby home's promotion column shows.
type LobbyPromos struct {
	// Interval is the carousel's seconds per picture.
	Interval int `json:"interval"`
	// Carousel is empty until the admin sets it: the client then shows the
	// release loading illustrations.
	Carousel  []LobbyPromo            `json:"carousel"`
	Boards    [LobbyBoards]LobbyPromo `json:"boards"`
	UpdatedAt int64                   `json:"updatedAt"`
	UpdatedBy string                  `json:"updatedBy"`
}

// Images lists the picture ids the settings use, once each.
func (p LobbyPromos) Images() []string {
	seen := map[string]bool{}
	ids := []string{}
	for _, promo := range append(append([]LobbyPromo{}, p.Carousel...), p.Boards[:]...) {
		if promo.Image != "" && !seen[promo.Image] {
			seen[promo.Image] = true
			ids = append(ids, promo.Image)
		}
	}
	return ids
}

// LobbyPromoImage is one uploaded picture; Data is filled only when the
// picture itself is read.
type LobbyPromoImage struct {
	ID          string `json:"id"`
	ContentType string `json:"contentType"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	Size        int    `json:"size"`
	CreatedAt   int64  `json:"createdAt"`
	CreatedBy   string `json:"createdBy"`
	Data        []byte `json:"-"`
}

// LobbyPromos returns the stored settings; before any were saved, an empty
// carousel, two empty boards and the default interval.
func (s *Store) LobbyPromos(ctx context.Context) (LobbyPromos, error) {
	return lobbyPromos(ctx, s.db)
}

func lobbyPromos(ctx context.Context, q settingsQuerier) (LobbyPromos, error) {
	promos := LobbyPromos{Interval: DefaultLobbyInterval, Carousel: []LobbyPromo{}}
	var raw string
	err := q.QueryRowContext(ctx, "SELECT json, updated_at, updated_by FROM app_settings WHERE name = ?",
		settingsLobbyPromos).Scan(&raw, &promos.UpdatedAt, &promos.UpdatedBy)
	if errors.Is(err, sql.ErrNoRows) {
		return promos, nil
	} else if err != nil {
		return promos, err
	}
	var stored struct {
		Interval int          `json:"interval"`
		Carousel []LobbyPromo `json:"carousel"`
		Boards   []LobbyPromo `json:"boards"`
	}
	if err := json.Unmarshal([]byte(raw), &stored); err != nil {
		return promos, fmt.Errorf("lobby promos: %w", err)
	}
	if stored.Interval > 0 {
		promos.Interval = stored.Interval
	}
	if stored.Carousel != nil {
		promos.Carousel = stored.Carousel
	}
	copy(promos.Boards[:], stored.Boards)
	return promos, nil
}

// SaveLobbyPromos stores the settings (the caller checked their fields)
// with who changed them, and returns what is now in effect. Every picture
// they name must exist. Uploads no setting uses any more are removed once
// older than a day.
func (s *Store) SaveLobbyPromos(ctx context.Context, promos LobbyPromos, admin string, now int64) (LobbyPromos, error) {
	encoded, err := json.Marshal(struct {
		Interval int                     `json:"interval"`
		Carousel []LobbyPromo            `json:"carousel"`
		Boards   [LobbyBoards]LobbyPromo `json:"boards"`
	}{promos.Interval, promos.Carousel, promos.Boards})
	if err != nil {
		return LobbyPromos{}, err
	}
	ids := promos.Images()
	err = inTx(ctx, s.db, nil, func(tx *sql.Tx) error {
		if len(ids) > 0 {
			// Shared locks keep a concurrent prune from removing them first.
			var found int
			if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM lobby_promo_images WHERE id IN ("+
				placeholders(len(ids))+") FOR SHARE", anySlice(ids)...).Scan(&found); err != nil {
				return err
			}
			if found != len(ids) {
				return errLobbyImageMissing
			}
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO app_settings(name, json, updated_at, updated_by)
			VALUES(?, ?, ?, ?) AS incoming
			ON DUPLICATE KEY UPDATE json = incoming.json, updated_at = incoming.updated_at, updated_by = incoming.updated_by`,
			settingsLobbyPromos, string(encoded), now, admin)
		return err
	})
	if err != nil {
		return LobbyPromos{}, err
	}
	if _, err := s.pruneLobbyPromoImages(ctx, ids, now); err != nil {
		return LobbyPromos{}, err
	}
	return s.LobbyPromos(ctx)
}

// pruneLobbyPromoImages removes the pictures older than lobbyImageGrace
// that are not in keep.
func (s *Store) pruneLobbyPromoImages(ctx context.Context, keep []string, now int64) (int64, error) {
	query := "DELETE FROM lobby_promo_images WHERE created_at < ?"
	args := []any{now - lobbyImageGrace}
	if len(keep) > 0 {
		query += " AND id NOT IN (" + placeholders(len(keep)) + ")"
		args = append(args, anySlice(keep)...)
	}
	result, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// SaveLobbyPromoImage stores an uploaded picture (the caller checked it and
// named it by its content) and returns it without its data. The same
// picture uploaded again is the stored one.
func (s *Store) SaveLobbyPromoImage(ctx context.Context, image LobbyPromoImage, now int64) (LobbyPromoImage, error) {
	if existing, err := s.lobbyPromoImageInfo(ctx, image.ID); err == nil {
		return existing, nil
	} else if !errors.Is(err, ErrLobbyImageNotFound) {
		return LobbyPromoImage{}, err
	}
	var count int
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM lobby_promo_images").Scan(&count); err != nil {
		return LobbyPromoImage{}, err
	}
	if count >= MaxLobbyPromoImages {
		promos, err := s.LobbyPromos(ctx)
		if err != nil {
			return LobbyPromoImage{}, err
		}
		removed, err := s.pruneLobbyPromoImages(ctx, promos.Images(), now)
		if err != nil {
			return LobbyPromoImage{}, err
		}
		if count-int(removed) >= MaxLobbyPromoImages {
			return LobbyPromoImage{}, errLobbyImageLimit
		}
	}
	if _, err := s.db.ExecContext(ctx, `INSERT IGNORE INTO lobby_promo_images(id, content_type, width, height,
		byte_size, data, created_by, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`, image.ID, image.ContentType,
		image.Width, image.Height, len(image.Data), image.Data, image.CreatedBy, now); err != nil {
		return LobbyPromoImage{}, err
	}
	return s.lobbyPromoImageInfo(ctx, image.ID)
}

func (s *Store) lobbyPromoImageInfo(ctx context.Context, id string) (LobbyPromoImage, error) {
	images, err := s.LobbyPromoImages(ctx, []string{id})
	if err != nil {
		return LobbyPromoImage{}, err
	}
	image, ok := images[id]
	if !ok {
		return LobbyPromoImage{}, ErrLobbyImageNotFound
	}
	return image, nil
}

// LobbyPromoImages returns the stored pictures among ids, without their data.
func (s *Store) LobbyPromoImages(ctx context.Context, ids []string) (map[string]LobbyPromoImage, error) {
	images := map[string]LobbyPromoImage{}
	if len(ids) == 0 {
		return images, nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, content_type, width, height, byte_size, created_by, created_at
		FROM lobby_promo_images WHERE id IN (`+placeholders(len(ids))+")", anySlice(ids)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var image LobbyPromoImage
		if err := rows.Scan(&image.ID, &image.ContentType, &image.Width, &image.Height, &image.Size,
			&image.CreatedBy, &image.CreatedAt); err != nil {
			return nil, err
		}
		images[image.ID] = image
	}
	return images, rows.Err()
}

// LobbyPromoImage reads one picture with its data.
func (s *Store) LobbyPromoImage(ctx context.Context, id string) (LobbyPromoImage, error) {
	image := LobbyPromoImage{ID: id}
	err := s.db.QueryRowContext(ctx, `SELECT content_type, width, height, byte_size, created_by, created_at, data
		FROM lobby_promo_images WHERE id = ?`, id).Scan(&image.ContentType, &image.Width, &image.Height,
		&image.Size, &image.CreatedBy, &image.CreatedAt, &image.Data)
	if errors.Is(err, sql.ErrNoRows) {
		return LobbyPromoImage{}, ErrLobbyImageNotFound
	}
	return image, err
}
