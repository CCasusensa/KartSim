package store

import (
	"context"
	"database/sql"
	"errors"
	"net/http"

	"kartsim/internal/shared/apierr"
)

// Game nodes the admin added in the console (NODE.md "后台添加节点"). The
// key is shown once; only its digest is kept, like invite codes.

var (
	errGameNodeMissing = apierr.New(http.StatusNotFound, "NODE_NOT_FOUND")
	errGameNodeExists  = apierr.New(http.StatusConflict, "NODE_EXISTS")
)

// GameNode is one registered game node.
type GameNode struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Origin       string `json:"origin,omitempty"`
	Note         string `json:"note,omitempty"`
	KeyHash      string `json:"-"`
	Disabled     bool   `json:"disabled"`
	CreatedBy    string `json:"createdBy"`
	CreatedAt    int64  `json:"createdAt"`
	KeyCreatedAt int64  `json:"keyCreatedAt"`
	RegisteredAt int64  `json:"registeredAt,omitempty"`
	RegisteredIP string `json:"registeredIp,omitempty"`
}

const gameNodeColumns = "id, name, origin, note, key_hash, disabled, created_by, created_at, key_created_at, " +
	"registered_at, registered_ip"

func scanGameNode(row interface{ Scan(dest ...any) error }) (GameNode, error) {
	var n GameNode
	err := row.Scan(&n.ID, &n.Name, &n.Origin, &n.Note, &n.KeyHash, &n.Disabled, &n.CreatedBy, &n.CreatedAt,
		&n.KeyCreatedAt, &n.RegisteredAt, &n.RegisteredIP)
	return n, err
}

// GameNodes lists the registered nodes, oldest first.
func (s *Store) GameNodes(ctx context.Context) ([]GameNode, error) {
	list := []GameNode{}
	err := s.queryRows(ctx, "SELECT "+gameNodeColumns+" FROM game_nodes ORDER BY created_at, id", nil,
		func(rows *sql.Rows) error {
			n, err := scanGameNode(rows)
			if err != nil {
				return err
			}
			list = append(list, n)
			return nil
		})
	return list, err
}

// GameNode returns one node (found false without it).
func (s *Store) GameNode(ctx context.Context, id string) (GameNode, bool, error) {
	n, err := scanGameNode(s.db.QueryRowContext(ctx, "SELECT "+gameNodeColumns+" FROM game_nodes WHERE id = ?", id))
	if errors.Is(err, sql.ErrNoRows) {
		return GameNode{}, false, nil
	}
	return n, err == nil, err
}

// CreateGameNode adds a node (409 NODE_EXISTS when the ID is taken).
func (s *Store) CreateGameNode(ctx context.Context, n GameNode) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO game_nodes(id, name, origin, note, key_hash, created_by, created_at,
		key_created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`, n.ID, n.Name, n.Origin, n.Note, n.KeyHash, n.CreatedBy,
		n.CreatedAt, n.KeyCreatedAt)
	if _, duplicate := duplicateKey(err); duplicate {
		return errGameNodeExists
	}
	return err
}

// UpdateGameNode changes a node's name, origin, note and disabled flag.
func (s *Store) UpdateGameNode(ctx context.Context, n GameNode) error {
	return s.changeGameNode(ctx, "UPDATE game_nodes SET name = ?, origin = ?, note = ?, disabled = ? WHERE id = ?",
		n.Name, n.Origin, n.Note, n.Disabled, n.ID)
}

// SetGameNodeKey replaces a node's key; the old key stops working at once.
func (s *Store) SetGameNodeKey(ctx context.Context, id, keyHash string, now int64) error {
	return s.changeGameNode(ctx, "UPDATE game_nodes SET key_hash = ?, key_created_at = ? WHERE id = ?",
		keyHash, now, id)
}

// NoteGameNodeRegistered records when and from where a node last registered.
func (s *Store) NoteGameNodeRegistered(ctx context.Context, id string, now int64, ip string) error {
	return s.changeGameNode(ctx, "UPDATE game_nodes SET registered_at = ?, registered_ip = ? WHERE id = ?",
		now, ip, id)
}

// DeleteGameNode removes a node and its key.
func (s *Store) DeleteGameNode(ctx context.Context, id string) error {
	return s.changeGameNode(ctx, "DELETE FROM game_nodes WHERE id = ?", id)
}

func (s *Store) changeGameNode(ctx context.Context, query string, args ...any) error {
	result, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n == 0 {
		// MySQL counts changed rows: an UPDATE that sets the same values
		// affects none, so look before calling it missing.
		if _, found, err := s.GameNode(ctx, args[len(args)-1].(string)); err != nil || found {
			return err
		}
		return errGameNodeMissing
	}
	return nil
}
