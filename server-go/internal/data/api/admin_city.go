package api

import (
	"context"
	"net/http"
	"strings"

	"kartsim/internal/data/cache"
	"kartsim/internal/data/store"
	"kartsim/internal/shared/apierr"
	"kartsim/internal/shared/contract"
)

// The console's 卡丁城服务器 (ADMIN.md 4, GLOBAL_LOBBY.md 卡丁城): the game node
// every player entering the city is sent to, or automatic.

var errInvalidCityServer = apierr.New(http.StatusBadRequest, "INVALID_CITY_SERVER")

// cityServerJSON is the setting and where a player entering the city now
// would go.
type cityServerJSON struct {
	NodeID    string `json:"nodeId"` // "" automatic
	UpdatedAt int64  `json:"updatedAt"`
	UpdatedBy string `json:"updatedBy"`
	// Next is the pick for a player without a latency report: nodeId ""
	// when no node can take players (error NO_GAME_SERVER).
	Next cityNextJSON `json:"next"`
}

type cityNextJSON struct {
	NodeID          string `json:"nodeId"`
	NodeName        string `json:"nodeName"`
	Rule            string `json:"rule"`
	SettingExcluded string `json:"settingExcluded,omitempty"`
	Error           string `json:"error,omitempty"`
}

// cityServerJSON describes setting with the registry's live nodes (nil
// without Redis: no node can take players).
func (a *API) cityServerJSON(setting store.CityServer, nodes []cache.Node) cityServerJSON {
	out := cityServerJSON{NodeID: setting.NodeID, UpdatedAt: setting.UpdatedAt, UpdatedBy: setting.UpdatedBy}
	pick := a.lobby.cityNext(nodes, setting.NodeID)
	out.Next.Rule, out.Next.SettingExcluded = pick.rule, pick.settingExcluded
	if pick.found {
		out.Next.NodeID, out.Next.NodeName = pick.node.NodeID, pick.node.Name
	} else {
		out.Next.Error = "NO_GAME_SERVER"
	}
	return out
}

// liveNodes reads the registry for the console (nil, logged, when Redis
// fails).
func (a *API) liveNodes(ctx context.Context) ([]cache.Node, error) {
	if a.cluster == nil {
		return nil, nil
	}
	nodes, err := a.cluster.Nodes(ctx)
	if err != nil {
		a.log.Warn("admin: node list unavailable", "error", err)
	}
	return nodes, err
}

// adminSaveCityServer stores {nodeId} ("" automatic; any node ID, live or
// not: an offline node is skipped until it comes back) and answers the
// setting in effect. Players already in a city stay where they are; the
// next ones to enter follow it.
func (a *API) adminSaveCityServer(w http.ResponseWriter, r *http.Request) error {
	var request struct {
		NodeID *string `json:"nodeId"`
	}
	if err := decodeJSON(w, r, &request); err != nil {
		return err
	}
	admin, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	if request.NodeID == nil {
		return errInvalidCityServer
	}
	nodeID := strings.TrimSpace(*request.NodeID)
	if nodeID != "" && (!validNodeID(nodeID) || nodeID == contract.LobbyNodeID) {
		return errInvalidCityServer
	}
	setting, err := a.store.SaveCityServer(r.Context(), nodeID, admin.Username, a.nowMillis())
	if err != nil {
		return err
	}
	a.log.Info("admin city server", "admin", admin.Username, "node", nodeID)
	nodes, _ := a.liveNodes(r.Context())
	return writeJSON(w, http.StatusOK, a.cityServerJSON(setting, nodes))
}
