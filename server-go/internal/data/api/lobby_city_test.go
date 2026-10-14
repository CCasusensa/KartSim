package api

import (
	"net/http"
	"slices"
	"testing"
	"time"

	"kartsim/internal/data/cache"
	"kartsim/internal/shared/contract"
	"kartsim/internal/shared/ticket"
)

// The city node (GLOBAL_LOBBY.md 卡丁城): the console's node when it can take
// the player, else the crowd, else the node last used, else latency.
func TestPickCityNode(t *testing.T) {
	nodes := []cache.Node{
		{NodeID: "bj", Capacity: 400, Players: 10, ProtocolVersion: contract.ProtocolVersion},
		{NodeID: "gz", Capacity: 100, Players: 20, ProtocolVersion: contract.ProtocolVersion},
		{NodeID: "hk", Capacity: 100, Players: 30, ProtocolVersion: contract.ProtocolVersion},
		{NodeID: "full", Capacity: 10, Players: 10, ProtocolVersion: contract.ProtocolVersion},
		{NodeID: "old", Capacity: 100, ProtocolVersion: 39},
	}
	near := map[string]int{"bj": 40, "gz": 8, "hk": 20}
	for _, c := range []struct {
		name, setting, last string
		latency, crowd      map[string]int
		want, rule, why     string
	}{
		{name: "setting beats the crowd", setting: "hk", crowd: map[string]int{"gz": 9}, latency: near,
			want: "hk", rule: cityRuleSetting},
		{name: "setting offline", setting: "gone", crowd: map[string]int{"bj": 2, "gz": 1}, latency: near,
			want: "bj", rule: cityRuleCrowd, why: excludedOffline},
		{name: "setting full", setting: "full", crowd: map[string]int{"full": 10}, latency: near,
			want: "gz", rule: cityRuleLatency, why: excludedFull},
		{name: "setting of another protocol", setting: "old", last: "hk", latency: near,
			want: "hk", rule: cityRuleLast, why: excludedProtocol},
		{name: "crowd tie goes to the last node", crowd: map[string]int{"bj": 3, "gz": 3, "hk": 1}, last: "bj",
			latency: near, want: "bj", rule: cityRuleCrowd},
		{name: "crowd tie by latency", crowd: map[string]int{"bj": 3, "gz": 3}, last: "hk", latency: near,
			want: "gz", rule: cityRuleCrowd},
		{name: "empty city keeps the last node", last: "bj", latency: near, want: "bj", rule: cityRuleLast},
		{name: "last node gone", last: "old", latency: near, want: "gz", rule: cityRuleLatency},
		{name: "nothing measured", want: "bj", rule: cityRuleLatency},
	} {
		crowded := slices.Clone(nodes)
		for i := range crowded {
			crowded[i].CityPlayers = c.crowd[crowded[i].NodeID]
		}
		pick := pickCityNode(crowded, c.latency, c.setting, c.last)
		if !pick.found || pick.node.NodeID != c.want || pick.rule != c.rule || pick.settingExcluded != c.why {
			t.Errorf("%s: picked %s by %q (setting %q), want %s by %q (%q)", c.name, pick.node.NodeID, pick.rule,
				pick.settingExcluded, c.want, c.rule, c.why)
		}
	}
	if pick := pickCityNode(nodes[3:], near, "full", ""); pick.found || pick.settingExcluded != excludedFull {
		t.Fatalf("no candidate: %+v", pick)
	}
}

// Every player entering the city goes to one node, whatever its own
// latency; the console's 卡丁城服务器 moves the next ones, and an offline
// choice falls back to the automatic one.
func TestGlobalLobbyCityServer(t *testing.T) {
	h := newAdminHarness(t, harnessOptions{})
	clear := func() { h.cleanup("DELETE FROM app_settings WHERE name = 'cityServer'") }
	clear()
	t.Cleanup(clear)
	near, far := "city-near", "city-far"
	h.heartbeat(far, "远节点", "http://far.test:8788", 100)
	h.heartbeat(near, "近节点", "http://near.test:8788", 100)
	alice, bob := h.lobbyPlayer("ca"), h.lobbyPlayer("cb")
	alice.request(map[string]any{"type": "node-latency", "latency": map[string]int{near: 30, far: 200}})
	bob.request(map[string]any{"type": "node-latency", "latency": map[string]int{near: 200, far: 30}})
	cityHost := func(p *lobbyPlayer, want string) {
		t.Helper()
		reply := p.request(map[string]any{"type": "city-host"})
		claims, err := ticket.Verify([]byte(testSecret), reply["ticket"].(string), time.Now())
		if reply["type"] != "city-host" || reply["nodeId"] != want || err != nil || claims.NodeID != want ||
			claims.Use != ticket.UseCity || claims.PlayerID != p.id {
			t.Fatalf("city-host %v (%+v %v), want %s", reply, claims, err, want)
		}
	}

	// Automatic: the first goes by latency, the next one follows.
	cityHost(alice, near)
	cityHost(bob, near)
	if choices := h.api.lobby.recent(); choices[0].Rule != cityRuleLast || choices[1].Rule != cityRuleLatency {
		t.Fatalf("city choices %+v", choices[:2])
	}
	// Once the heartbeats show the crowd, the lobby follows it.
	h.api.lobby.mu.Lock()
	h.api.lobby.cityNode = ""
	h.api.lobby.mu.Unlock()
	h.heartbeat(near, "近节点", "http://near.test:8788", 100,
		contract.OnlinePlayer{PlayerID: "p1", Name: "城里的人", Room: contract.CityRoomPrefix + "1", Lobby: true})
	cityHost(bob, near)
	var nodes struct {
		Nodes []nodeRowJSON  `json:"nodes"`
		City  cityServerJSON `json:"city"`
	}
	h.adminGet("/api/admin/nodes", &nodes)
	if nodes.City.NodeID != "" || nodes.City.Next.NodeID != near || nodes.City.Next.Rule != cityRuleCrowd {
		t.Fatalf("automatic city %+v", nodes.City)
	}
	for _, row := range nodes.Nodes {
		if want := map[string]int{near: 1}[row.NodeID]; row.CityPlayers != want {
			t.Fatalf("city players of %s = %d", row.NodeID, row.CityPlayers)
		}
	}

	// Set in the console: everyone goes there.
	for _, body := range []map[string]any{{}, {"nodeId": "bad id"}, {"nodeId": contract.LobbyNodeID}} {
		h.put("/api/admin/city-server", body, h.adminHeader).expect(t, http.StatusBadRequest, "INVALID_CITY_SERVER")
	}
	var saved cityServerJSON
	h.put("/api/admin/city-server", map[string]any{"nodeId": far}, h.adminHeader).expect(t, http.StatusOK, "").
		json(t, &saved)
	if saved.NodeID != far || saved.UpdatedBy != h.adminName || saved.Next.NodeID != far ||
		saved.Next.Rule != cityRuleSetting {
		t.Fatalf("saved %+v", saved)
	}
	cityHost(alice, far)
	if choice := h.api.lobby.recent()[0]; choice.Rule != cityRuleSetting || choice.Setting != far {
		t.Fatalf("city choice %+v", choice)
	}

	// A node that is not online is skipped until it comes back.
	h.put("/api/admin/city-server", map[string]any{"nodeId": "city-gone"}, h.adminHeader).
		expect(t, http.StatusOK, "").json(t, &saved)
	if saved.Next.NodeID != near || saved.Next.SettingExcluded != excludedOffline {
		t.Fatalf("offline setting %+v", saved)
	}
	cityHost(alice, near)

	// Back to automatic.
	h.put("/api/admin/city-server", map[string]any{"nodeId": ""}, h.adminHeader).
		expect(t, http.StatusOK, "").json(t, &saved)
	if saved.NodeID != "" || saved.Next.NodeID != near {
		t.Fatalf("automatic again %+v", saved)
	}
}
