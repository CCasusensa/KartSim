package api

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"kartsim/internal/data/cache"
	"kartsim/internal/data/store"
	"kartsim/internal/shared/apierr"
	"kartsim/internal/shared/contract"
	"kartsim/internal/shared/nodekey"
)

// Game nodes added in the admin console (NODE.md "后台添加节点"): each has
// its own key. A keyed node calls the internal API with X-Kart-Node-Key, on
// the internal listener or under /multiplayer on the public one, may act
// only as itself, and its tickets are signed with its own ticket key.

var (
	errNodeKeyInvalid  = apierr.New(http.StatusUnauthorized, "NODE_KEY_INVALID")
	errNodeDisabled    = apierr.New(http.StatusForbidden, "NODE_DISABLED")
	errNodeMismatch    = apierr.New(http.StatusForbidden, "NODE_MISMATCH")
	errNodeKeyRequired = apierr.New(http.StatusForbidden, "NODE_KEY_REQUIRED")
	errInvalidGameNode = apierr.New(http.StatusBadRequest, "INVALID_NODE")
)

// nodeRegistryTTL is how long the node list read for authentication is
// reused; console changes refresh it at once.
const nodeRegistryTTL = 10 * time.Second

// nodeRegistry caches the game_nodes rows by ID.
type nodeRegistry struct {
	mu       sync.Mutex
	nodes    map[string]store.GameNode
	loadedAt time.Time
}

// gameNodes returns the registered nodes by ID (empty without MySQL).
func (a *API) gameNodes(ctx context.Context) (map[string]store.GameNode, error) {
	if a.store == nil {
		return map[string]store.GameNode{}, nil
	}
	registry := &a.nodeRegistry
	registry.mu.Lock()
	defer registry.mu.Unlock()
	if registry.nodes != nil && a.now().Sub(registry.loadedAt) < nodeRegistryTTL {
		return registry.nodes, nil
	}
	list, err := a.store.GameNodes(ctx)
	if err != nil {
		return nil, err
	}
	registry.nodes = make(map[string]store.GameNode, len(list))
	for _, node := range list {
		registry.nodes[node.ID] = node
	}
	registry.loadedAt = a.now()
	return registry.nodes, nil
}

func (a *API) forgetGameNodes() {
	a.nodeRegistry.mu.Lock()
	a.nodeRegistry.nodes = nil
	a.nodeRegistry.mu.Unlock()
}

type nodeIdentityKey struct{}

// keyedNode is the node a request authenticated as with its own key ("",
// false for the cluster secret).
func keyedNode(ctx context.Context) (string, bool) {
	id, ok := ctx.Value(nodeIdentityKey{}).(string)
	return id, ok
}

// authenticateNode checks a node key against the registry.
func (a *API) authenticateNode(ctx context.Context, key string) (string, error) {
	id, ok := nodekey.NodeID(key)
	if !ok {
		return "", errNodeKeyInvalid
	}
	nodes, err := a.gameNodes(ctx)
	if err != nil {
		a.log.Warn("node registry unavailable", "error", err)
		return "", errServiceUnavailable
	}
	node, found := nodes[id]
	given := nodekey.Digest(key)
	if !found || subtle.ConstantTimeCompare([]byte(given), []byte(node.KeyHash)) != 1 {
		return "", errNodeKeyInvalid
	}
	if node.Disabled {
		return "", errNodeDisabled
	}
	return id, nil
}

// callerNode checks the nodeId a request names: a keyed node may only name
// itself, and a cluster-secret caller may not name a node that has a key.
func (a *API) callerNode(r *http.Request, nodeID string) error {
	if !validNodeID(nodeID) || nodeID == contract.LobbyNodeID {
		return errInvalidNodeID
	}
	if id, keyed := keyedNode(r.Context()); keyed {
		if id != nodeID {
			return errNodeMismatch
		}
		return nil
	}
	nodes, err := a.gameNodes(r.Context())
	if err != nil {
		a.log.Warn("node registry unavailable", "error", err)
		return errServiceUnavailable
	}
	if _, registered := nodes[nodeID]; registered {
		return errNodeKeyRequired
	}
	return nil
}

// ticketKey is the HMAC key of the tickets for node.
func (a *API) ticketKey(node cache.Node) []byte {
	if node.Keyed {
		return []byte(nodekey.TicketKey(a.secret, node.NodeID))
	}
	return a.secret
}

// registerNode answers a keyed node's start: who it is and its ticket key.
func (a *API) registerNode(w http.ResponseWriter, r *http.Request) error {
	id, keyed := keyedNode(r.Context())
	if !keyed {
		return errNodeKeyRequired
	}
	var request contract.NodeRegisterRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return err
	}
	nodes, err := a.gameNodes(r.Context())
	if err != nil {
		return errServiceUnavailable
	}
	node := nodes[id]
	now := a.nowMillis()
	ip := ""
	if addr := a.clientIP(r); addr.IsValid() {
		ip = addr.String()
	}
	if err := a.store.NoteGameNodeRegistered(r.Context(), id, now, ip); err != nil {
		a.log.Warn("node registration time not stored", "node", id, "error", err)
	}
	a.log.Info("game node registered with its key", "node", id, "name", node.Name, "ip", ip,
		"version", request.Version)
	pageHosts := a.network.Hosts()
	if parsed, err := url.Parse(a.publicOrigin); err == nil && parsed.Hostname() != "" {
		pageHosts = append(pageHosts, strings.ToLower(parsed.Hostname()))
	}
	return writeJSON(w, http.StatusOK, contract.NodeRegistration{NodeID: id, Name: node.Name, Origin: node.Origin,
		DataNode: a.dataNode, TicketKey: nodekey.TicketKey(a.secret, id), ObservedIP: ip, PageHosts: pageHosts,
		ServerTime: now})
}

// managedNodeJSON is a registered node with what the registry says about
// it now: online (players, capacity, origin), offline (seen within a day),
// never connected, or disabled.
type managedNodeJSON struct {
	store.GameNode
	Status   string  `json:"status"` // online, offline, never, disabled
	Players  int     `json:"players"`
	Capacity int     `json:"capacity"`
	Live     *string `json:"liveOrigin,omitempty"`
	SeenAt   int64   `json:"seenAt,omitempty"`
}

func (a *API) adminGameNodes(w http.ResponseWriter, r *http.Request) error {
	if _, err := a.requireAdmin(r); err != nil {
		return err
	}
	list, err := a.store.GameNodes(r.Context())
	if err != nil {
		return err
	}
	live := map[string]cache.Node{}
	seen := map[string]cache.Node{}
	if a.cluster != nil {
		if nodes, err := a.cluster.Nodes(r.Context()); err == nil {
			for _, node := range nodes {
				live[node.NodeID] = node
			}
		}
		if nodes, err := a.cluster.SeenNodes(r.Context()); err == nil {
			for _, node := range nodes {
				seen[node.NodeID] = node
			}
		}
	}
	rows := make([]managedNodeJSON, 0, len(list))
	for _, node := range list {
		row := managedNodeJSON{GameNode: node, Status: "never"}
		if found, ok := seen[node.ID]; ok {
			row.Status, row.SeenAt = "offline", found.SeenAt
		}
		if found, ok := live[node.ID]; ok && found.Keyed {
			row.Status, row.Players, row.Capacity, row.SeenAt = "online", found.Players, found.Capacity, found.SeenAt
			row.Live = nodeOrigin(found)
		}
		if node.Disabled {
			row.Status = "disabled"
		}
		rows = append(rows, row)
	}
	return writeJSON(w, http.StatusOK, map[string]any{"nodes": rows})
}

type gameNodeRequest struct {
	ID       string  `json:"id"`
	Name     *string `json:"name"`
	Origin   *string `json:"origin"`
	Note     *string `json:"note"`
	Disabled *bool   `json:"disabled"`
}

// apply checks and copies the request's fields onto node.
func (request gameNodeRequest) apply(node *store.GameNode) error {
	if request.Name != nil {
		node.Name = strings.TrimSpace(*request.Name)
	}
	if request.Origin != nil {
		origin, ok := normalizeNodeOrigin(strings.TrimSpace(*request.Origin))
		if !ok {
			return errInvalidGameNode
		}
		node.Origin = origin
	}
	if request.Note != nil {
		node.Note = strings.TrimSpace(*request.Note)
	}
	if request.Disabled != nil {
		node.Disabled = *request.Disabled
	}
	if !validText(node.Name, 32) || !optionalText(node.Note, 200) {
		return errInvalidGameNode
	}
	return nil
}

// adminCreateGameNode adds a node and returns its key, shown only now.
func (a *API) adminCreateGameNode(w http.ResponseWriter, r *http.Request) error {
	var request gameNodeRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return err
	}
	admin, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	node := store.GameNode{ID: strings.TrimSpace(request.ID), CreatedBy: admin.Username, CreatedAt: a.nowMillis()}
	if node.ID == "" {
		suffix := make([]byte, 3)
		_, _ = rand.Read(suffix)
		node.ID = "node-" + hex.EncodeToString(suffix)
	}
	if !nodekey.ValidID(node.ID) || node.ID == contract.LobbyNodeID || request.Name == nil {
		return errInvalidGameNode
	}
	if err := request.apply(&node); err != nil {
		return err
	}
	key := nodekey.New(node.ID)
	node.KeyHash, node.KeyCreatedAt = nodekey.Digest(key), node.CreatedAt
	if err := a.store.CreateGameNode(r.Context(), node); err != nil {
		return err
	}
	a.forgetGameNodes()
	a.log.Info("admin added a game node", "admin", admin.Username, "node", node.ID, "name", node.Name)
	return writeJSON(w, http.StatusOK, map[string]any{"node": node, "key": key})
}

func (a *API) adminUpdateGameNode(w http.ResponseWriter, r *http.Request) error {
	var request gameNodeRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return err
	}
	admin, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	node, found, err := a.store.GameNode(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	if !found {
		return apierr.New(http.StatusNotFound, "NODE_NOT_FOUND")
	}
	wasDisabled := node.Disabled
	if err := request.apply(&node); err != nil {
		return err
	}
	if err := a.store.UpdateGameNode(r.Context(), node); err != nil {
		return err
	}
	a.forgetGameNodes()
	if node.Disabled && !wasDisabled {
		a.dropNode(r.Context(), node.ID)
	}
	a.log.Info("admin changed a game node", "admin", admin.Username, "node", node.ID, "disabled", node.Disabled)
	return writeJSON(w, http.StatusOK, map[string]any{"node": node})
}

// adminRotateGameNodeKey replaces a node's key: the node must be given the
// new one, the old one stops working at once.
func (a *API) adminRotateGameNodeKey(w http.ResponseWriter, r *http.Request) error {
	admin, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	if !nodekey.ValidID(id) {
		return apierr.New(http.StatusNotFound, "NODE_NOT_FOUND")
	}
	key := nodekey.New(id)
	if err := a.store.SetGameNodeKey(r.Context(), id, nodekey.Digest(key), a.nowMillis()); err != nil {
		return err
	}
	a.forgetGameNodes()
	a.dropNode(r.Context(), id)
	a.log.Info("admin replaced a game node key", "admin", admin.Username, "node", id)
	return writeJSON(w, http.StatusOK, map[string]any{"key": key})
}

func (a *API) adminDeleteGameNode(w http.ResponseWriter, r *http.Request) error {
	admin, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	if err := a.store.DeleteGameNode(r.Context(), id); err != nil {
		return err
	}
	a.forgetGameNodes()
	a.dropNode(r.Context(), id)
	a.log.Info("admin deleted a game node", "admin", admin.Username, "node", id)
	return writeJSON(w, http.StatusOK, contract.OK{OK: true})
}

// dropNode takes a node off the game-server list now instead of when its
// registration expires (its key no longer works).
func (a *API) dropNode(ctx context.Context, id string) {
	if a.cluster == nil {
		return
	}
	if err := a.cluster.Leave(ctx, id); err != nil {
		a.log.Warn("node not removed from the registry; it expires on its own", "node", id, "error", err)
	}
}
