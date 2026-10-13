package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"kartsim/internal/data/cache"
	"kartsim/internal/data/datatest"
	"kartsim/internal/shared/contract"
	"kartsim/internal/shared/ticket"
)

// lobbyPlayer is one browser on the global lobby's socket.
type lobbyPlayer struct {
	t    *testing.T
	conn *websocket.Conn
	id   string
	next int
	// events keeps the pushes seen while waiting for replies.
	events []map[string]any
}

// starterGear is equipment a new account owns after its starter gift.
func starterGear() json.RawMessage {
	ids := map[string]int{}
	for _, slot := range equipmentSlots {
		ids[fmt.Sprint(slot)] = 0
	}
	ids["1"], ids["2"], ids["70"] = 2, 6, 4
	raw, _ := json.Marshal(map[string]any{"itemIds": ids, "kartSerial": 0, "exceedType": 0, "valueAt3E": 0,
		"systemKart": "practiceKart"})
	return raw
}

func (h *harness) lobbyPlayer(prefix string) *lobbyPlayer {
	h.t.Helper()
	u := datatest.Unique()
	_, token := h.register(prefix+u, prefix+u)
	h.claimStarter(token, 2, 6, 4)
	var issued contract.TicketResponse
	h.post("/multiplayer/lobby/ticket", nil, bearerHeader(token)).expect(h.t, http.StatusOK, "").json(h.t, &issued)
	if issued.NodeID != contract.LobbyNodeID {
		h.t.Fatalf("lobby ticket %+v", issued)
	}
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(h.public.URL, "http")+"/multiplayer/lobby/ws", nil)
	if err != nil {
		h.t.Fatal(err)
	}
	h.t.Cleanup(func() { conn.Close() })
	p := &lobbyPlayer{t: h.t, conn: conn}
	welcome := p.request(map[string]any{"type": "hello", "protocolVersion": contract.ProtocolVersion,
		"ruleset": contract.Ruleset, "resourceVersion": "p3553", "name": "x", "ticket": issued.Ticket,
		"equipment": starterGear()})
	if welcome["type"] != "welcome" {
		h.t.Fatalf("lobby hello %v", welcome)
	}
	p.id = welcome["playerId"].(string)
	return p
}

func (p *lobbyPlayer) read() map[string]any {
	p.t.Helper()
	_ = p.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, data, err := p.conn.ReadMessage()
	if err != nil {
		p.t.Fatalf("read: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		p.t.Fatal(err)
	}
	return m
}

func (p *lobbyPlayer) request(value map[string]any) map[string]any {
	p.t.Helper()
	p.next++
	id := fmt.Sprint("r", p.next)
	value["requestId"] = id
	if err := p.conn.WriteJSON(value); err != nil {
		p.t.Fatal(err)
	}
	for {
		m := p.read()
		if m["requestId"] == id {
			return m
		}
		p.events = append(p.events, m)
	}
}

// waitFor returns the first push of type typ.
func (p *lobbyPlayer) waitFor(typ string) map[string]any {
	p.t.Helper()
	for i, m := range p.events {
		if m["type"] == typ {
			p.events = append(p.events[:i], p.events[i+1:]...)
			return m
		}
	}
	for {
		if m := p.read(); m["type"] == typ {
			return m
		} else {
			p.events = append(p.events, m)
		}
	}
}

// A room made on the data service's lobby socket is handed to the best
// game node at start: each member gets a ticket for that node; the node
// claims the room once and returns it, and the members see it again.
func TestGlobalLobbyHandsRoomsToNodes(t *testing.T) {
	h := newHarness(t, harnessOptions{mysql: true})
	near, far := "near-node", "far-node"
	h.heartbeat(far, "远节点", "http://far.test:8788", 100)
	h.heartbeat(near, "近节点", "http://near.test:8788", 100)
	alice, bob := h.lobbyPlayer("ga"), h.lobbyPlayer("gb")
	for _, p := range []*lobbyPlayer{alice, bob} {
		p.request(map[string]any{"type": "node-latency", "latency": map[string]int{near: 30, far: 200}})
	}
	room := alice.request(map[string]any{"type": "create", "name": "全局房间", "capacity": 4,
		"channelName": "speedIndiCombine", "mode": "individual", "speed": 7, "speedVersion": "国服",
		"equipment": starterGear()})["room"].(map[string]any)
	roomID := room["roomId"].(string)
	room = bob.request(map[string]any{"type": "join", "roomId": roomID, "equipment": starterGear()})["room"].(map[string]any)
	room = bob.request(map[string]any{"type": "ready", "roomId": roomID, "revision": room["revision"],
		"ready": true})["room"].(map[string]any)
	start := alice.request(map[string]any{"type": "start", "roomId": roomID, "revision": room["revision"]})
	if start["type"] != "room" {
		t.Fatalf("start %v", start)
	}

	aliceHost, bobHost := alice.waitFor("race-host"), bob.waitFor("race-host")
	if aliceHost["nodeId"] != near || aliceHost["origin"] != "http://near.test:8788" || bobHost["nodeId"] != near {
		t.Fatalf("race-host %v %v", aliceHost, bobHost)
	}
	claims, err := ticket.Verify([]byte(testSecret), aliceHost["ticket"].(string), time.Now())
	if err != nil || claims.NodeID != near || claims.PlayerID != alice.id || claims.Use != ticket.UseRace ||
		claims.Handoff == "" || claims.AccountID == "" {
		t.Fatalf("race ticket %+v %v", claims, err)
	}
	// The console keeps why the node was picked.
	if choices := h.api.lobby.recent(); len(choices) != 1 || choices[0].Kind != choiceRace || choices[0].NodeID != near ||
		choices[0].RoomID != roomID || choices[0].RoomName != "全局房间" || len(choices[0].Players) != 2 ||
		!choices[0].Players[0].Counted || len(choices[0].Nodes) != 2 || *choices[0].Nodes[0].Score != 30 {
		t.Fatalf("node choices %+v", choices)
	}

	// Only the chosen node may claim it, and only while it is away.
	h.call(contract.PathRoomClaim, contract.RoomClaimRequest{NodeID: far, HandoffID: claims.Handoff}).
		expect(t, http.StatusForbidden, "NODE_MISMATCH")
	var handoff contract.RoomHandoff
	h.call(contract.PathRoomClaim, contract.RoomClaimRequest{NodeID: near, HandoffID: claims.Handoff}).
		expect(t, http.StatusOK, "").json(t, &handoff)
	if handoff.Room.RoomID != roomID || len(handoff.Room.Members) != 2 {
		t.Fatalf("handoff %+v", handoff)
	}

	// The node's heartbeat lists the racers as the lobby's: still held.
	beat := contract.HeartbeatRequest{NodeID: near, Name: "近节点", Origin: "http://near.test:8788", Capacity: 100,
		Players: []contract.OnlinePlayer{
			{PlayerID: alice.id, Name: handoff.Room.Members[0].Name, AccountID: handoff.Room.Members[0].AccountID, Lobby: true},
			{PlayerID: "stale-player", Name: "Nobody", AccountID: "no-such-account", Lobby: true}},
		StartedAt: time.Now().UnixMilli(), ProtocolVersion: contract.ProtocolVersion}
	h.api.lobby.heartbeat(t.Context()) // the lobby's own registration and claims
	var beatResp contract.HeartbeatResponse
	h.call(contract.PathHeartbeat, beat).expect(t, http.StatusOK, "").json(t, &beatResp)
	if len(beatResp.Conflicts) != 1 || beatResp.Conflicts[0] != "stale-player" {
		t.Fatalf("heartbeat conflicts %v", beatResp.Conflicts)
	}
	var list contract.GameServerList
	h.get("/multiplayer/game-servers", nil).expect(t, http.StatusOK, "").json(t, &list)
	for _, server := range list.Servers {
		if server.NodeID == contract.LobbyNodeID {
			t.Fatal("the lobby is listed as a game server")
		}
	}

	// The node gives it back after the race.
	state := handoff.Room
	state.Revision += 9
	state.Members[0].Ready, state.Members[1].Ready = false, false
	h.call(contract.PathRoomReturn, contract.RoomReturnRequest{NodeID: near, HandoffID: claims.Handoff, Room: &state}).
		expect(t, http.StatusOK, "")
	back := bob.waitFor("room")["room"].(map[string]any)
	if back["phase"] != "open" || back["revision"].(float64) <= float64(state.Revision) ||
		len(back["members"].([]any)) != 2 {
		t.Fatalf("room back %v", back)
	}
	// Returned twice: the second is ignored.
	h.call(contract.PathRoomReturn, contract.RoomReturnRequest{NodeID: near, HandoffID: claims.Handoff, Room: &state}).
		expect(t, http.StatusOK, "")
	h.call(contract.PathRoomClaim, contract.RoomClaimRequest{NodeID: near, HandoffID: claims.Handoff}).
		expect(t, http.StatusNotFound, "ROOM_NOT_FOUND")
	// No game node may call itself the lobby.
	h.call(contract.PathHeartbeat, contract.HeartbeatRequest{NodeID: contract.LobbyNodeID, Capacity: 1,
		Players: []contract.OnlinePlayer{}}).expect(t, http.StatusBadRequest, "INVALID_NODE_ID")
}

// The node choice: within capacity, the lowest worst-case latency, then the
// least loaded.
func TestPickNode(t *testing.T) {
	nodes := []cache.Node{
		{NodeID: "a", Capacity: 10, Players: 9, ProtocolVersion: contract.ProtocolVersion},
		{NodeID: "b", Capacity: 100, Players: 50, ProtocolVersion: contract.ProtocolVersion},
		{NodeID: "c", Capacity: 100, Players: 10, ProtocolVersion: contract.ProtocolVersion},
		{NodeID: "old", Capacity: 100, ProtocolVersion: 39},
	}
	report := map[string]int{"a": 10, "b": 40, "c": 40, "old": 1}
	pick := pickNode(nodes, []map[string]int{report, report})
	if !pick.found || pick.node.NodeID != "c" {
		t.Fatalf("picked %s, want c (a is full for 2, b and c tie on latency, c is emptier)", pick.node.NodeID)
	}
	if pick.excluded["a"] != excludedFull || pick.excluded["old"] != excludedProtocol || pick.scores["b"] != 40 {
		t.Fatalf("pick %+v", pick)
	}
	if pick := pickNode(nodes, []map[string]int{report}); pick.node.NodeID != "a" {
		t.Fatalf("picked %s, want a", pick.node.NodeID)
	}
	if pick := pickNode(nodes[3:], []map[string]int{report}); pick.found {
		t.Fatal("picked a node of another protocol")
	}
}

// A player without a latency report does not make every node score the
// same: the others' reports still choose the node.
func TestPickNodeSkipsUnmeasuredPlayers(t *testing.T) {
	nodes := []cache.Node{
		{NodeID: "bj", Capacity: 400, ProtocolVersion: contract.ProtocolVersion},
		{NodeID: "gz", Capacity: 100, Players: 20, ProtocolVersion: contract.ProtocolVersion},
		{NodeID: "old", Capacity: 100, ProtocolVersion: 39},
	}
	gz := map[string]int{"bj": 45, "gz": 8}
	pick := pickNode(nodes, []map[string]int{nil, gz})
	if pick.node.NodeID != "gz" || pick.counted[0] || !pick.counted[1] || pick.scores["gz"] != 8 {
		t.Fatalf("pick %+v, want gz on the measured player's latency", pick)
	}
	// A report of only nodes that cannot take the room does not count either.
	pick = pickNode(nodes, []map[string]int{{"old": 5}, gz})
	if pick.node.NodeID != "gz" || pick.counted[0] {
		t.Fatalf("pick %+v", pick)
	}
	// A counted player who did not reach a node makes it unknownLatency.
	hk := map[string]int{"bj": 60}
	pick = pickNode(nodes, []map[string]int{hk, gz})
	if pick.node.NodeID != "bj" || pick.scores["gz"] != unknownLatency || pick.scores["bj"] != 60 {
		t.Fatalf("pick %+v, want bj (hk never reached gz)", pick)
	}
	// Nobody measured: every node scores 0 and the emptiest wins.
	pick = pickNode(nodes, []map[string]int{nil, nil})
	if pick.node.NodeID != "bj" || pick.scores["gz"] != 0 {
		t.Fatalf("pick %+v, want the emptiest", pick)
	}
}

// The record of a pick lists the candidates by score, then the excluded.
func TestNodeChoiceRecord(t *testing.T) {
	nodes := []cache.Node{
		{NodeID: "old", Name: "旧", Capacity: 100, ProtocolVersion: 39},
		{NodeID: "bj", Name: "北京", Capacity: 400, ProtocolVersion: contract.ProtocolVersion},
		{NodeID: "gz", Name: "广州", Capacity: 100, ProtocolVersion: contract.ProtocolVersion},
	}
	choice := nodeChoice{Players: []choicePlayer{{Name: "港"}, {Name: "穗", Latency: map[string]int{"bj": 45, "gz": 8}}}}
	choice.describe(nodes, pickNode(nodes, []map[string]int{nil, choice.Players[1].Latency}))
	if choice.NodeID != "gz" || choice.NodeName != "广州" || choice.Players[0].Counted || !choice.Players[1].Counted {
		t.Fatalf("choice %+v", choice)
	}
	if order := []string{choice.Nodes[0].NodeID, choice.Nodes[1].NodeID, choice.Nodes[2].NodeID}; order[0] != "gz" ||
		order[1] != "bj" || order[2] != "old" || choice.Nodes[2].Excluded != excludedProtocol || choice.Nodes[2].Score != nil {
		t.Fatalf("nodes %+v", choice.Nodes)
	}
	if got := choice.logLatency(); got != "港{未测速} 穗{bj:45 gz:8}" {
		t.Fatalf("latency log %q", got)
	}
	if got := choice.logScores(); got != "gz=8 bj=45 old=protocol" {
		t.Fatalf("scores log %q", got)
	}
}
