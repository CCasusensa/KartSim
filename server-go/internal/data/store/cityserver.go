package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

// The 卡丁城 server (GLOBAL_LOBBY.md 卡丁城): the game node the global lobby
// sends every player entering the city to, chosen in the admin console's
// 服务器节点 page. It lives in the "cityServer" app_settings row; absent or
// empty, the lobby keeps everyone on one node of its own choosing.

const settingsCityServer = "cityServer"

// CityServer is the admin's city node ("" = automatic).
type CityServer struct {
	NodeID    string `json:"nodeId"`
	UpdatedAt int64  `json:"updatedAt"`
	UpdatedBy string `json:"updatedBy"`
}

// CityServer returns the stored choice, or automatic.
func (s *Store) CityServer(ctx context.Context) (CityServer, error) {
	var setting CityServer
	var raw string
	err := s.db.QueryRowContext(ctx, "SELECT json, updated_at, updated_by FROM app_settings WHERE name = ?",
		settingsCityServer).Scan(&raw, &setting.UpdatedAt, &setting.UpdatedBy)
	if errors.Is(err, sql.ErrNoRows) {
		return setting, nil
	} else if err != nil {
		return setting, err
	}
	var stored struct {
		NodeID string `json:"nodeId"`
	}
	if err := json.Unmarshal([]byte(raw), &stored); err != nil {
		return setting, fmt.Errorf("city server: %w", err)
	}
	setting.NodeID = stored.NodeID
	return setting, nil
}

// SaveCityServer stores the city node (the caller checked the ID; "" for
// automatic) with who chose it and returns what is now in effect.
func (s *Store) SaveCityServer(ctx context.Context, nodeID, admin string, now int64) (CityServer, error) {
	encoded, err := json.Marshal(struct {
		NodeID string `json:"nodeId"`
	}{nodeID})
	if err != nil {
		return CityServer{}, err
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO app_settings(name, json, updated_at, updated_by)
		VALUES(?, ?, ?, ?) AS incoming
		ON DUPLICATE KEY UPDATE json = incoming.json, updated_at = incoming.updated_at, updated_by = incoming.updated_by`,
		settingsCityServer, string(encoded), now, admin); err != nil {
		return CityServer{}, err
	}
	return s.CityServer(ctx)
}
