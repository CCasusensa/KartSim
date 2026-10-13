package lobby

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"testing"
	"time"

	"kartsim/internal/shared/apierr"
	"kartsim/internal/shared/contract"
	"kartsim/internal/shared/ticket"
)

// globalLobby is a data service lobby (Home) and a game node (RaceHost)
// wired together the way GLOBAL_LOBBY.md describes.
type globalLobby struct {
	t     *testing.T
	home  *harness // the lobby
	node  *harness // the game node
	fakes *handoffFakes
}

type handoffFakes struct {
	mu        sync.Mutex
	node      *harness
	handoffs  map[string]contract.RoomHandoff
	latency   map[string]map[string]int
	returns   []contract.RoomReturnRequest
	failNext  error
	claimFail error
}

func (f *handoffFakes) Handoff(_ context.Context, handoff contract.RoomHandoff,
	latency map[string]map[string]int) (HandoffPlan, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.failNext; err != nil {
		f.failNext = nil
		return HandoffPlan{}, err
	}
	f.handoffs[handoff.HandoffID] = handoff
	f.latency = latency
	origin := "http://node.test:8788"
	plan := HandoffPlan{Node: NodeEntry{NodeID: testNodeID, Name: "测试节点", Origin: &origin},
		Tickets: map[string]string{}}
	for _, m := range handoff.Room.Members {
		plan.Tickets[m.PlayerID] = f.node.sign(ticket.Claims{Guest: true, Nickname: m.Name, PlayerID: m.PlayerID,
			Use: ticket.UseRace, Handoff: handoff.HandoffID})
	}
	return plan, nil
}

func (f *handoffFakes) CityHost(_ context.Context, player CityPlayer) (NodeEntry, error) {
	return NodeEntry{NodeID: testNodeID, Name: "测试节点", Ticket: f.node.sign(ticket.Claims{Guest: true,
		Nickname: player.Name, PlayerID: player.PlayerID, Use: ticket.UseCity})}, nil
}

func (f *handoffFakes) Claim(_ context.Context, handoffID string) (contract.RoomHandoff, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.claimFail != nil {
		return contract.RoomHandoff{}, f.claimFail
	}
	handoff, ok := f.handoffs[handoffID]
	if !ok {
		return contract.RoomHandoff{}, apierr.New(http.StatusNotFound, "ROOM_NOT_FOUND")
	}
	return handoff, nil
}

func (f *handoffFakes) Return(req contract.RoomReturnRequest) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.returns = append(f.returns, req)
}

func (f *handoffFakes) returned() []contract.RoomReturnRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]contract.RoomReturnRequest(nil), f.returns...)
}

func newGlobalLobby(t *testing.T) *globalLobby {
	t.Helper()
	fakes := &handoffFakes{handoffs: map[string]contract.RoomHandoff{}}
	g := &globalLobby{t: t, fakes: fakes}
	g.node = newHarnessWith(t, func(o *Options) { o.RaceHost = fakes })
	fakes.node = g.node
	g.home = newHarnessWith(t, func(o *Options) { o.Home = fakes })
	return g
}

// eventually waits for the lobby's background handoff.
func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

// raceHost waits for c's race-host event in the lobby.
func (g *globalLobby) raceHost(c *Client) map[string]any {
	g.t.Helper()
	var event map[string]any
	eventually(g.t, "race-host", func() bool {
		for _, e := range g.home.sink(c).events(g.t) {
			if e["type"] == "race-host" {
				event = e
				return true
			}
		}
		return false
	})
	return event
}

// enterNode says hello on the node with a race ticket and returns the
// welcome and the room snapshot sent after it.
func (g *globalLobby) enterNode(name, raceTicket string) (*Client, map[string]any, map[string]any) {
	g.t.Helper()
	c := g.node.newClient()
	payload, _ := json.Marshal(helloRequest(name, raceTicket))
	in, err := ParseRequest(payload)
	if err != nil {
		g.t.Fatal(err)
	}
	reply, err := g.node.lobby.Handle(context.Background(), c, in)
	if err != nil {
		g.t.Fatalf("race hello: %v", err)
	}
	welcome := decodeObject(g.t, reply.Encode(""))
	if reply.Then() == nil {
		g.t.Fatal("no room after the welcome")
	}
	return c, welcome, object(decodeObject(g.t, reply.Then())["room"])
}

// The whole trip: a room waits in the lobby, races on the node with the
// same players and player IDs, and comes back to the lobby when everyone
// returned, with the race settled by the node.
func TestRoomRacesOnANodeAndComesBack(t *testing.T) {
	g := newGlobalLobby(t)
	players := g.home.connectN(2)
	alice, bob := players[0], players[1]
	aliceID, bobID := alice.playerID, bob.playerID
	g.home.must(alice, map[string]any{"type": "node-latency", "latency": map[string]int{testNodeID: 35}})
	room := g.home.joinAndReady(players, g.home.create(players, "ordinary", "speedIndiCombine", 4))
	roomID := room["roomId"].(string)
	started := g.home.command(alice, map[string]any{"type": "start", "roomId": roomID, "revision": room["revision"]})
	if started["phase"] != "open" || started["race"] != nil {
		t.Fatalf("lobby start reply %v", started)
	}

	aliceHost, bobHost := g.raceHost(alice), g.raceHost(bob)
	if aliceHost["nodeId"] != testNodeID || aliceHost["origin"] != "http://node.test:8788" ||
		aliceHost["ticket"] == bobHost["ticket"] || g.fakes.latency[aliceID][testNodeID] != 35 {
		t.Fatalf("race-host %v %v latency %v", aliceHost, bobHost, g.fakes.latency)
	}
	// The away room shows as gaming and takes nobody new.
	carol := g.home.connect("Carol")
	rooms := g.home.must(carol, map[string]any{"type": "list-ordinary", "page": 0})
	if summary := object(list(rooms["rooms"])[0]); summary["gaming"] != true {
		t.Fatalf("away room summary %v", summary)
	}
	if code := g.home.errorCode(carol, map[string]any{"type": "join", "roomId": roomID}); code != "ROOM_RACING" {
		t.Fatalf("join of an away room: %s", code)
	}
	if code := g.home.errorCode(bob, map[string]any{"type": "ready", "roomId": roomID, "ready": false}); code != "ROOM_NOT_OPEN" {
		t.Fatalf("mutation of an away room: %s", code)
	}

	// On the node: same IDs, the race already loading.
	aliceNode, welcome, nodeRoom := g.enterNode("Player0", aliceHost["ticket"].(string))
	if welcome["playerId"] != aliceID || nodeRoom["phase"] != "loading" || nodeRoom["roomId"] != roomID ||
		nodeRoom["revision"].(float64) <= started["revision"].(float64) {
		t.Fatalf("node welcome %v room %v", welcome, nodeRoom)
	}
	bobNode, _, _ := g.enterNode("Player1", bobHost["ticket"].(string))
	if len(g.node.presence.claims) != 0 {
		t.Fatalf("the node claimed lobby players: %v", g.node.presence.claims)
	}
	online, _ := g.node.lobby.Online()
	if len(online) != 2 || !online[0].Lobby {
		t.Fatalf("node online %+v", online)
	}
	// A ticket cannot be used twice; a lobby player outside the room has none.
	if code := g.node.errorCode(g.node.newClient(), helloRequest("Player0", aliceHost["ticket"].(string))); code != "TICKET_REUSED" {
		t.Fatalf("reused race ticket: %s", code)
	}

	raceID := raceOf(nodeRoom)["raceId"]
	for _, c := range []*Client{aliceNode, bobNode} {
		g.node.command(c, map[string]any{"type": "loaded", "roomId": roomID, "raceId": raceID})
	}
	g.node.clock.Advance(3 * time.Second)
	for i, c := range []*Client{aliceNode, bobNode} {
		g.node.command(c, map[string]any{"type": "finish", "roomId": roomID, "raceId": raceID,
			"elapsedMs": 60_000 + i*1000})
	}
	g.node.clock.Advance(11 * time.Second)
	if len(g.node.recorder.settlements()) != 1 {
		t.Fatalf("settlements %d", len(g.node.recorder.settlements()))
	}
	g.node.must(aliceNode, map[string]any{"type": "return-room", "roomId": roomID, "raceId": raceID})
	if len(g.fakes.returned()) != 0 {
		t.Fatal("returned before everyone was back")
	}
	g.node.must(bobNode, map[string]any{"type": "return-room", "roomId": roomID, "raceId": raceID})
	returns := g.fakes.returned()
	if len(returns) != 1 || returns[0].Room == nil || len(returns[0].Room.Members) != 2 ||
		returns[0].NodeID != testNodeID {
		t.Fatalf("returns %+v", returns)
	}
	if last := g.node.sink(bobNode).last(t); last["type"] != "room-home" {
		t.Fatalf("node session's last event %v", last)
	}
	if len(g.node.lobby.rooms) != 0 {
		t.Fatal("the node kept the room")
	}

	// Back in the lobby: open, everyone in, revision past the node's.
	g.home.lobby.ReturnHome(returns[0].HandoffID, returns[0].Room, "")
	back := object(g.home.sink(bob).last(t)["room"])
	if back["phase"] != "open" || len(list(back["members"])) != 2 || back["race"] != nil ||
		back["revision"].(float64) <= float64(returns[0].Room.Revision) || back["hostId"] != aliceID {
		t.Fatalf("room back home %v", back)
	}
	if memberOf(t, back, bobID)["ready"] != false {
		t.Fatal("ready marks survived the race")
	}
	g.home.command(bob, map[string]any{"type": "ready", "roomId": roomID, "revision": back["revision"], "ready": true})
}

// The node cannot be chosen: the room reopens with the reason.
func TestHandoffWithoutANode(t *testing.T) {
	g := newGlobalLobby(t)
	players := g.home.connectN(2)
	room := g.home.joinAndReady(players, g.home.create(players, "ordinary", "speedIndiCombine", 4))
	g.fakes.failNext = apierr.New(http.StatusServiceUnavailable, RaceErrorNoServer)
	g.home.command(players[0], map[string]any{"type": "start", "roomId": room["roomId"], "revision": room["revision"]})
	var back map[string]any
	eventually(t, "room back", func() bool {
		events := g.home.sink(players[1]).events(t)
		if len(events) == 0 {
			return false
		}
		back = object(events[len(events)-1]["room"])
		return back["raceError"] == RaceErrorNoServer
	})
	if back["phase"] != "open" || memberOf(t, back, players[1].playerID)["ready"] != true {
		t.Fatalf("room %v", back)
	}
}

// A member who leaves the lobby while the room races is not brought back;
// the lobby keeps the room for the others.
func TestLeavingTheLobbyDuringTheRace(t *testing.T) {
	g := newGlobalLobby(t)
	players := g.home.connectN(3)
	room := g.home.joinAndReady(players, g.home.create(players, "ordinary", "speedIndiCombine", 4))
	roomID := room["roomId"].(string)
	g.home.command(players[0], map[string]any{"type": "start", "roomId": roomID, "revision": room["revision"]})
	g.raceHost(players[2])
	g.home.lobby.Disconnect(players[2])

	state := g.fakes.handoffs[g.home.lobby.rooms[roomID].away.handoffID].Room
	g.home.lobby.ReturnHome(g.home.lobby.rooms[roomID].away.handoffID, &state, "")
	back := object(g.home.sink(players[0]).last(t)["room"])
	if len(list(back["members"])) != 2 {
		t.Fatalf("members back %v", back["members"])
	}
}

// Racers who never reach the node: the loading window drops them, and with
// nobody left the room goes home with LOAD_TIMEOUT.
func TestRoomGoesHomeWhenNobodyLoads(t *testing.T) {
	g := newGlobalLobby(t)
	players := g.home.connectN(2)
	room := g.home.joinAndReady(players, g.home.create(players, "ordinary", "speedIndiCombine", 4))
	g.home.command(players[0], map[string]any{"type": "start", "roomId": room["roomId"], "revision": room["revision"]})
	aliceHost := g.raceHost(players[0])
	g.enterNode("Player0", aliceHost["ticket"].(string))
	g.node.clock.Advance(31 * time.Second)
	returns := g.fakes.returned()
	if len(returns) != 1 || returns[0].Room == nil || returns[0].Room.RaceError != "LOAD_TIMEOUT" {
		t.Fatalf("returns %+v", returns)
	}
	g.home.lobby.ReturnHome(returns[0].HandoffID, returns[0].Room, "")
	back := object(g.home.sink(players[1]).last(t)["room"])
	if back["raceError"] != "LOAD_TIMEOUT" || back["phase"] != "open" {
		t.Fatalf("room %v", back)
	}
}

// The lobby's watchdog brings back a room whose node is gone.
func TestReturnHomeWithoutTheNode(t *testing.T) {
	g := newGlobalLobby(t)
	players := g.home.connectN(2)
	room := g.home.joinAndReady(players, g.home.create(players, "ordinary", "speedIndiCombine", 4))
	g.home.command(players[0], map[string]any{"type": "start", "roomId": room["roomId"], "revision": room["revision"]})
	g.raceHost(players[0])
	away := g.home.lobby.AwayRooms()
	if len(away) != 1 {
		t.Fatalf("away %v", away)
	}
	for handoffID, nodeID := range away {
		if nodeID != testNodeID {
			t.Fatalf("node %q", nodeID)
		}
		g.home.lobby.ReturnHome(handoffID, nil, RaceErrorServerLost)
	}
	back := object(g.home.sink(players[1]).last(t)["room"])
	if back["raceError"] != RaceErrorServerLost || len(list(back["members"])) != 2 {
		t.Fatalf("room %v", back)
	}
}

// Race tickets are for the room's members; a failed claim is reported.
func TestRaceTicketChecks(t *testing.T) {
	g := newGlobalLobby(t)
	stranger := g.node.sign(ticket.Claims{Guest: true, Nickname: "Stranger", PlayerID: newUUID(), Use: ticket.UseRace,
		Handoff: "missing"})
	if code := g.node.errorCode(g.node.newClient(), helloRequest("Stranger", stranger)); code != "ROOM_NOT_FOUND" {
		t.Fatalf("unknown handoff: %s", code)
	}
	players := g.home.connectN(2)
	room := g.home.joinAndReady(players, g.home.create(players, "ordinary", "speedIndiCombine", 4))
	g.home.command(players[0], map[string]any{"type": "start", "roomId": room["roomId"], "revision": room["revision"]})
	host := g.raceHost(players[0])
	handoffID := g.home.lobby.rooms[room["roomId"].(string)].away.handoffID
	outsider := g.node.sign(ticket.Claims{Guest: true, Nickname: "Outsider", PlayerID: newUUID(), Use: ticket.UseRace,
		Handoff: handoffID})
	g.enterNode("Player0", host["ticket"].(string))
	if code := g.node.errorCode(g.node.newClient(), helloRequest("Outsider", outsider)); code != "NOT_RACE_PARTICIPANT" {
		t.Fatalf("outsider: %s", code)
	}
	// A node without RaceHost refuses lobby tickets.
	plain := newHarness(t)
	if code := plain.errorCode(plain.newClient(), helloRequest("Player0", plain.sign(ticket.Claims{Guest: true,
		Nickname: "Player0", PlayerID: newUUID(), Use: ticket.UseCity}))); code != "TICKET_INVALID" {
		t.Fatalf("lobby ticket on a plain node: %s", code)
	}
}

// The city: the lobby sends the player to a node, which takes the session
// without claiming it.
func TestCityHost(t *testing.T) {
	g := newGlobalLobby(t)
	alice := g.home.connect("Alice")
	reply := g.home.must(alice, map[string]any{"type": "city-host"})
	if reply["type"] != "city-host" || reply["nodeId"] != testNodeID || reply["ticket"] == "" {
		t.Fatalf("city-host %v", reply)
	}
	c := g.node.newClient()
	welcome := g.node.must(c, helloRequest("Alice", reply["ticket"].(string)))
	if welcome["playerId"] != alice.playerID || len(g.node.presence.claims) != 0 {
		t.Fatalf("city welcome %v claims %v", welcome, g.node.presence.claims)
	}
}

// A racer whose node session ended (it returned and dropped, or lost the
// connection) but who is still in the lobby room stays in it; the seats and
// teams after the race come from the node.
func TestRoomComesHomeWithTheLobbyMembers(t *testing.T) {
	g := newGlobalLobby(t)
	players := g.home.connectN(3)
	room := g.home.joinAndReady(players, g.home.create(players, "ordinary", "speedIndiCombine", 4))
	roomID := room["roomId"].(string)
	g.home.command(players[0], map[string]any{"type": "start", "roomId": roomID, "revision": room["revision"]})
	g.raceHost(players[0])
	handoffID := g.home.lobby.rooms[roomID].away.handoffID
	state := g.fakes.handoffs[handoffID].Room
	// The node lost player 2 and moved player 1 to seat 3.
	state.Members = []contract.RoomMember{state.Members[0], state.Members[1]}
	state.Members[1].Slot = 3
	g.home.lobby.ReturnHome(handoffID, &state, "")
	back := object(g.home.sink(players[2]).last(t)["room"])
	if len(list(back["members"])) != 3 {
		t.Fatalf("members %v", back["members"])
	}
	if memberOf(t, back, players[1].playerID)["slot"].(float64) != 3 ||
		memberOf(t, back, players[2].playerID)["ready"] != false {
		t.Fatalf("seats after the race %v", back["members"])
	}
}
