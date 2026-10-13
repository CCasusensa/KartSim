package api

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"kartsim/internal/data/datatest"
	"kartsim/internal/shared/contract"
	"kartsim/internal/shared/nodekey"
	"kartsim/internal/shared/ticket"
)

// nodeCall posts to the node API at url with a node key.
func nodeCall(t *testing.T, url, path, key string, body any) response {
	t.Helper()
	return send(t, http.MethodPost, url+path, body, map[string]string{contract.NodeKeyHeader: key})
}

// A node the admin adds in the console registers with its key alone, on
// the public listener as well as the internal one; it acts only as itself,
// gets tickets signed with its own key, and loses access when the key is
// replaced or the node is disabled or deleted.
func TestConsoleAddedNodes(t *testing.T) {
	h := newHarness(t, harnessOptions{mysql: true})
	_, admin := h.adminUser()
	headers := bearerHeader(admin)
	id := "t-" + strings.ReplaceAll(datatest.Unique(), ".", "")
	id = id[:min(len(id), 40)]
	h.cleanup("DELETE FROM game_nodes WHERE id = ?", id)

	h.post("/api/admin/game-nodes", map[string]any{"id": id}, headers).expect(t, http.StatusBadRequest, "INVALID_NODE")
	h.post("/api/admin/game-nodes", map[string]any{"name": "华东一区"}, nil).expect(t, http.StatusUnauthorized, "LOGIN_REQUIRED")
	var created struct {
		Node struct{ ID, Name string }
		Key  string
	}
	h.post("/api/admin/game-nodes", map[string]any{"id": id, "name": "华东一区", "note": "测试"}, headers).
		expect(t, http.StatusOK, "").json(t, &created)
	if created.Node.ID != id || created.Node.Name != "华东一区" || !strings.HasPrefix(created.Key, "kn1."+id+".") {
		t.Fatalf("created %+v", created)
	}
	h.post("/api/admin/game-nodes", map[string]any{"id": id, "name": "again"}, headers).expect(t, http.StatusConflict, "NODE_EXISTS")
	key := created.Key

	// Register through the public listener (/multiplayer/internal/…).
	var reg contract.NodeRegistration
	nodeCall(t, h.public.URL, contract.NodePathPrefix+contract.PathNodeRegister, key,
		contract.NodeRegisterRequest{ProtocolVersion: contract.ProtocolVersion}).expect(t, http.StatusOK, "").json(t, &reg)
	if reg.NodeID != id || reg.Name != "华东一区" || reg.DataNode != "data-test" ||
		reg.TicketKey != nodekey.TicketKey([]byte(testSecret), id) || reg.ObservedIP != "127.0.0.1" {
		t.Fatalf("registration %+v", reg)
	}
	// The public listener never takes the cluster secret.
	send(t, http.MethodPost, h.public.URL+contract.NodePathPrefix+contract.PathHeartbeat, map[string]any{},
		map[string]string{contract.ClusterKeyHeader: testSecret}).expect(t, http.StatusUnauthorized, "CLUSTER_KEY_INVALID")
	nodeCall(t, h.public.URL, contract.NodePathPrefix+contract.PathNodeRegister, "kn1."+id+"."+strings.Repeat("A", 43),
		map[string]any{}).expect(t, http.StatusUnauthorized, "NODE_KEY_INVALID")

	// The console's name wins over the heartbeat's; the node is keyed.
	beat := contract.HeartbeatRequest{NodeID: id, Name: "local name", Origin: "http://203.0.113.7:8788", Capacity: 40,
		Players: []contract.OnlinePlayer{}, StartedAt: time.Now().UnixMilli(), ProtocolVersion: contract.ProtocolVersion}
	nodeCall(t, h.internal.URL, contract.PathHeartbeat, key, beat).expect(t, http.StatusOK, "")
	var list contract.GameServerList
	h.get("/multiplayer/game-servers", nil).expect(t, http.StatusOK, "").json(t, &list)
	if len(list.Servers) != 1 || list.Servers[0].Name != "华东一区" || *list.Servers[0].Origin != "http://203.0.113.7:8788" {
		t.Fatalf("servers %+v", list.Servers)
	}

	// Its tickets verify with its ticket key, not the cluster secret.
	user := h.account("nodeuser"+id[len(id)-6:], "节点玩家"+id[len(id)-6:], "password-123", false)
	h.cleanupAccount(user)
	token := h.login("nodeuser"+id[len(id)-6:], "password-123")
	h.claimStarter(token, 2, 6, 4)
	var issued contract.TicketResponse
	h.post("/multiplayer/game-servers/ticket", contract.TicketRequest{NodeID: id}, bearerHeader(token)).
		expect(t, http.StatusOK, "").json(t, &issued)
	if _, err := ticket.Verify([]byte(reg.TicketKey), issued.Ticket, time.Now()); err != nil {
		t.Fatalf("ticket with the node key: %v", err)
	}
	if _, err := ticket.Verify([]byte(testSecret), issued.Ticket, time.Now()); err == nil {
		t.Fatal("ticket verifies with the cluster secret")
	}

	// A keyed node acts only as itself; nobody acts as it with the cluster secret.
	other := beat
	other.NodeID = "someone-else"
	nodeCall(t, h.internal.URL, contract.PathHeartbeat, key, other).expect(t, http.StatusForbidden, "NODE_MISMATCH")
	nodeCall(t, h.internal.URL, contract.PathNodeLeave, key, contract.NodeLeaveRequest{NodeID: "someone-else"}).
		expect(t, http.StatusForbidden, "NODE_MISMATCH")
	h.call(contract.PathHeartbeat, beat).expect(t, http.StatusForbidden, "NODE_KEY_REQUIRED")
	h.call(contract.PathNodeRegister, contract.NodeRegisterRequest{}).expect(t, http.StatusForbidden, "NODE_KEY_REQUIRED")

	// The console lists it online.
	var managed struct {
		Nodes []struct {
			ID, Status string
			Players    int
			Capacity   int
		}
	}
	h.get("/api/admin/game-nodes", headers).expect(t, http.StatusOK, "").json(t, &managed)
	found := false
	for _, node := range managed.Nodes {
		if node.ID == id {
			found = node.Status == "online" && node.Capacity == 40
		}
	}
	if !found {
		t.Fatalf("console list %+v", managed.Nodes)
	}

	// A new key replaces the old one at once and takes the node off the list.
	var rotated struct{ Key string }
	h.post("/api/admin/game-nodes/"+id+"/key", nil, headers).expect(t, http.StatusOK, "").json(t, &rotated)
	nodeCall(t, h.internal.URL, contract.PathHeartbeat, key, beat).expect(t, http.StatusUnauthorized, "NODE_KEY_INVALID")
	h.get("/multiplayer/game-servers", nil).expect(t, http.StatusOK, "").json(t, &list)
	if len(list.Servers) != 0 {
		t.Fatalf("servers after the new key %+v", list.Servers)
	}
	nodeCall(t, h.internal.URL, contract.PathHeartbeat, rotated.Key, beat).expect(t, http.StatusOK, "")

	// Disabled: refused; enabled again: back.
	send(t, http.MethodPatch, h.public.URL+"/api/admin/game-nodes/"+id, map[string]any{"disabled": true, "name": "华东二区"},
		headers).expect(t, http.StatusOK, "")
	nodeCall(t, h.internal.URL, contract.PathHeartbeat, rotated.Key, beat).expect(t, http.StatusForbidden, "NODE_DISABLED")
	send(t, http.MethodPatch, h.public.URL+"/api/admin/game-nodes/"+id, map[string]any{"disabled": false},
		headers).expect(t, http.StatusOK, "")
	nodeCall(t, h.internal.URL, contract.PathHeartbeat, rotated.Key, beat).expect(t, http.StatusOK, "")
	h.get("/multiplayer/game-servers", nil).expect(t, http.StatusOK, "").json(t, &list)
	if len(list.Servers) != 1 || list.Servers[0].Name != "华东二区" {
		t.Fatalf("servers after rename %+v", list.Servers)
	}

	// Deleted: the key is gone.
	send(t, http.MethodDelete, h.public.URL+"/api/admin/game-nodes/"+id, nil, headers).expect(t, http.StatusOK, "")
	nodeCall(t, h.internal.URL, contract.PathHeartbeat, rotated.Key, beat).expect(t, http.StatusUnauthorized, "NODE_KEY_INVALID")
	send(t, http.MethodDelete, h.public.URL+"/api/admin/game-nodes/"+id, nil, headers).expect(t, http.StatusNotFound, "NODE_NOT_FOUND")
}

// Nodes on the cluster secret keep working as before.
func TestClusterSecretNodesStillWork(t *testing.T) {
	h := newHarness(t, harnessOptions{mysql: true})
	h.heartbeat("legacy-node", "旧节点", "http://127.0.0.1:8788", 10)
	h.call(contract.NodePathPrefix+contract.PathHeartbeat, contract.HeartbeatRequest{NodeID: "legacy-node", Capacity: 10,
		Players: []contract.OnlinePlayer{}, ProtocolVersion: contract.ProtocolVersion}).expect(t, http.StatusOK, "")
}
