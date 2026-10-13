package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"

	"kartsim/internal/shared/apierr"
)

// 地图工坊 (MAPS.md): tracks players build in the map editor. The browser
// builds the track container itself; the service keeps it with its design
// and serves it to every player of a room that picks the map.

var (
	ErrMapNotFound = apierr.New(http.StatusNotFound, "MAP_NOT_FOUND")
	ErrMapNotOwner = apierr.New(http.StatusForbidden, "MAP_NOT_OWNER")
	ErrTooManyMaps = apierr.New(http.StatusConflict, "TOO_MANY_MAPS")
)

// MapFile is one file of a map's track container (path inside it, size).
type MapFile struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

// CustomMap is a published map without its blobs.
type CustomMap struct {
	ID         string    `json:"id"`
	OwnerID    string    `json:"-"`
	Name       string    `json:"name"`
	Author     string    `json:"author"`
	Theme      string    `json:"theme"`
	Laps       int       `json:"laps"`
	Difficulty int       `json:"difficulty"`
	RoadExtent int       `json:"roadExtent"`
	Items      int       `json:"items"`
	Files      []MapFile `json:"files"`
	SHA256     string    `json:"sha256"`
	Size       int       `json:"size"`
	Hidden     bool      `json:"hidden,omitempty"`
	CreatedAt  int64     `json:"createdAt"`
	UpdatedAt  int64     `json:"updatedAt"`
}

// MapUpload is a validated publish request.
type MapUpload struct {
	Map       CustomMap
	Design    string
	Container []byte
	Card      []byte
	Thumb     []byte
}

const mapColumns = `m.id, m.owner_id, m.name, COALESCE(a.nickname, ''), m.theme, m.laps, m.difficulty, m.road_extent,
	m.items, m.files_json, m.sha256, m.byte_size, m.hidden, m.created_at, m.updated_at`

func scanMap(row interface{ Scan(dest ...any) error }) (CustomMap, error) {
	var m CustomMap
	var files string
	var hidden int
	if err := row.Scan(&m.ID, &m.OwnerID, &m.Name, &m.Author, &m.Theme, &m.Laps, &m.Difficulty, &m.RoadExtent,
		&m.Items, &files, &m.SHA256, &m.Size, &hidden, &m.CreatedAt, &m.UpdatedAt); err != nil {
		return m, err
	}
	m.Hidden = hidden != 0
	if err := json.Unmarshal([]byte(files), &m.Files); err != nil {
		m.Files = []MapFile{}
	}
	return m, nil
}

func (s *Store) listMaps(ctx context.Context, where string, args ...any) ([]CustomMap, error) {
	list := []CustomMap{}
	err := s.queryRows(ctx, "SELECT "+mapColumns+" FROM custom_maps m LEFT JOIN accounts a ON a.id = m.owner_id "+
		where+" ORDER BY m.updated_at DESC, m.id", args, func(rows *sql.Rows) error {
		m, err := scanMap(rows)
		if err != nil {
			return err
		}
		list = append(list, m)
		return nil
	})
	return list, err
}

// PublishedMaps lists every map that is not hidden, newest first.
func (s *Store) PublishedMaps(ctx context.Context) ([]CustomMap, error) {
	return s.listMaps(ctx, "WHERE m.hidden = 0")
}

// ItemMapIDs lists the published maps that have item boxes (item rooms may
// race them).
func (s *Store) ItemMapIDs(ctx context.Context) ([]string, error) {
	ids := []string{}
	err := s.queryRows(ctx, "SELECT id FROM custom_maps WHERE hidden = 0 AND items > 0", nil, func(rows *sql.Rows) error {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		ids = append(ids, id)
		return nil
	})
	return ids, err
}

// OwnedMaps lists an account's maps (hidden ones too).
func (s *Store) OwnedMaps(ctx context.Context, ownerID string) ([]CustomMap, error) {
	return s.listMaps(ctx, "WHERE m.owner_id = ?", ownerID)
}

// CustomMapByID answers one map (404 MAP_NOT_FOUND).
func (s *Store) CustomMapByID(ctx context.Context, id string) (CustomMap, error) {
	m, err := scanMap(s.db.QueryRowContext(ctx, "SELECT "+mapColumns+
		" FROM custom_maps m LEFT JOIN accounts a ON a.id = m.owner_id WHERE m.id = ?", id))
	if errors.Is(err, sql.ErrNoRows) {
		return CustomMap{}, ErrMapNotFound
	}
	return m, err
}

// MapBlob reads one stored file of a map: design, container, card or thumb.
func (s *Store) MapBlob(ctx context.Context, id, column string) ([]byte, error) {
	switch column {
	case "design", "container", "card", "thumb":
	default:
		return nil, ErrMapNotFound
	}
	var data []byte
	err := s.db.QueryRowContext(ctx, "SELECT f."+column+
		" FROM custom_map_files f JOIN custom_maps m ON m.id = f.map_id WHERE f.map_id = ?", id).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrMapNotFound
	}
	return data, err
}

// SaveMap creates or replaces an account's map. Another account's id is
// refused (403 MAP_NOT_OWNER); a new map beyond `limit` per account is
// refused (409 TOO_MANY_MAPS).
func (s *Store) SaveMap(ctx context.Context, ownerID string, upload MapUpload, limit int, now int64) (CustomMap, error) {
	files, err := json.Marshal(upload.Map.Files)
	if err != nil {
		return CustomMap{}, err
	}
	err = inTxOptions(ctx, s.db, nil, nil, func(tx *sql.Tx) error {
		var owner string
		err := tx.QueryRowContext(ctx, "SELECT owner_id FROM custom_maps WHERE id = ? FOR UPDATE", upload.Map.ID).Scan(&owner)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			var count int
			if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM custom_maps WHERE owner_id = ?", ownerID).Scan(&count); err != nil {
				return err
			}
			if count >= limit {
				return ErrTooManyMaps
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO custom_maps(id, owner_id, name, theme, laps, difficulty, road_extent,
					items, files_json, sha256, byte_size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				upload.Map.ID, ownerID, upload.Map.Name, upload.Map.Theme, upload.Map.Laps, upload.Map.Difficulty,
				upload.Map.RoadExtent, upload.Map.Items, string(files), upload.Map.SHA256, len(upload.Container), now, now); err != nil {
				return err
			}
		case err != nil:
			return err
		case owner != ownerID:
			return ErrMapNotOwner
		default:
			if _, err := tx.ExecContext(ctx, `UPDATE custom_maps SET name = ?, theme = ?, laps = ?, difficulty = ?,
					road_extent = ?, items = ?, files_json = ?, sha256 = ?, byte_size = ?, updated_at = ? WHERE id = ?`,
				upload.Map.Name, upload.Map.Theme, upload.Map.Laps, upload.Map.Difficulty, upload.Map.RoadExtent,
				upload.Map.Items, string(files), upload.Map.SHA256, len(upload.Container), now, upload.Map.ID); err != nil {
				return err
			}
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO custom_map_files(map_id, design, container, card, thumb) VALUES (?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE design = VALUES(design), container = VALUES(container), card = VALUES(card),
			thumb = VALUES(thumb)`, upload.Map.ID, upload.Design, upload.Container, upload.Card, upload.Thumb)
		return err
	})
	if err != nil {
		return CustomMap{}, err
	}
	return s.CustomMapByID(ctx, upload.Map.ID)
}

// DeleteMap removes a map; only its owner or an admin may (403 MAP_NOT_OWNER).
func (s *Store) DeleteMap(ctx context.Context, id, accountID string, admin bool) error {
	m, err := s.CustomMapByID(ctx, id)
	if err != nil {
		return err
	}
	if m.OwnerID != accountID && !admin {
		return ErrMapNotOwner
	}
	_, err = s.db.ExecContext(ctx, "DELETE FROM custom_maps WHERE id = ?", id)
	return err
}

// SetMapHidden hides a map from the public list (admin).
func (s *Store) SetMapHidden(ctx context.Context, id string, hidden bool) error {
	value := 0
	if hidden {
		value = 1
	}
	result, err := s.db.ExecContext(ctx, "UPDATE custom_maps SET hidden = ? WHERE id = ?", value, id)
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n == 0 {
		if _, err := s.CustomMapByID(ctx, id); err != nil {
			return err
		}
	}
	return nil
}
