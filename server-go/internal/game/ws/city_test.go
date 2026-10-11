package ws

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"log/slog"
	"math"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"kartsim/internal/game/city"
	"kartsim/internal/game/lobby"
	"kartsim/internal/shared/netcfg"
)

// startCity is start with the city zone wired in (one line of two seats).
func startCity(t *testing.T) (*lobby.Lobby, *city.Service, string) {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	l := lobby.New(lobby.Options{NodeID: "game-ws", Presence: nopPresence{}, Tickets: anyTickets{},
		AllowGuests: true, Logger: log})
	zone, err := city.New(city.Options{Lines: 1, LinePlayers: 2, Profiles: l, Logger: log})
	if err != nil {
		t.Fatal(err)
	}
	zone.Start()
	s := NewServer(l, netcfg.LoopbackOnly(), Options{Logger: log, City: zone})
	server := httptest.NewServer(s)
	t.Cleanup(func() {
		_ = s.Shutdown(context.Background())
		zone.Close()
		server.Close()
	})
	return l, zone, "ws" + strings.TrimPrefix(server.URL, "http")
}

// cityFrame is a city motion frame of kind 2 at world x/z.
func cityFrame(sequence uint32, x, z float64) []byte {
	frame := make([]byte, 8+80)
	frame[0] = city.FrameMotion
	frame[1] = 2
	binary.LittleEndian.PutUint32(frame[4:], sequence)
	payload := frame[8:]
	binary.LittleEndian.PutUint32(payload[4:], math.Float32bits(float32(x)))
	binary.LittleEndian.PutUint32(payload[8:], math.Float32bits(float32(-z)))
	binary.LittleEndian.PutUint32(payload[16:], math.Float32bits(1)) // quaternion w
	return frame
}

// A hello'd client enters the city, its motion frames reach a member in
// range with its id stamped, the radar packet arrives, and rooms and the
// city exclude each other.
func TestCityJoinMotionAndExclusion(t *testing.T) {
	l, zone, url := startCity(t)
	request := func(conn *websocket.Conn, payload string) map[string]any {
		t.Helper()
		if err := conn.WriteMessage(websocket.TextMessage, []byte(payload)); err != nil {
			t.Fatal(err)
		}
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		for {
			kind, data, err := conn.ReadMessage()
			if err != nil {
				t.Fatal(err)
			}
			if kind != websocket.TextMessage {
				continue
			}
			var m map[string]any
			_ = json.Unmarshal(data, &m)
			if m["requestId"] == "q" {
				return m
			}
		}
	}
	hello := func(conn *websocket.Conn, name string) string {
		t.Helper()
		welcome := request(conn, `{"type":"hello","requestId":"q","protocolVersion":40,"ruleset":"launcher-room-v1",`+
			`"resourceVersion":"p3553","name":"`+name+`","ticket":"any","equipment":{"itemIds":{"1":2,"2":6,"3":0,`+
			`"4":0,"8":0,"9":0,"10":0,"11":0,"12":0,"16":0,"17":0,"18":0,"20":0,"21":0,"52":0,"26":0,"27":0,"30":0,`+
			`"31":0,"32":0,"36":0,"43":0,"45":0,"44":0,"46":0,"58":0,"59":0,"61":0,"70":4,"68":0,"69":0,"71":0,"76":0,`+
			`"77":0,"78":0},"kartSerial":0,"exceedType":0,"valueAt3E":0,"systemKart":"practiceKart"}}`)
		id, _ := welcome["playerId"].(string)
		if id == "" {
			t.Fatalf("hello: %v", welcome)
		}
		return id
	}
	// readUntil reads frames until one satisfies accept.
	readUntil := func(conn *websocket.Conn, accept func(kind int, data []byte) bool) {
		t.Helper()
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		for {
			kind, data, err := conn.ReadMessage()
			if err != nil {
				t.Fatal(err)
			}
			if accept(kind, data) {
				return
			}
		}
	}
	alice, bob, carol := dial(t, url), dial(t, url), dial(t, url)
	aliceID := hello(alice, "Alice")
	hello(bob, "Bob")
	hello(carol, "Carol")

	// Carol is in a room: no city for her; the city needs hello.
	created := request(carol, `{"type":"create","requestId":"q","name":"R","capacity":2,`+
		`"channelName":"speedIndiCombine","mode":"individual","speed":7,"speedVersion":"国服"}`)
	if created["type"] != "room" {
		t.Fatalf("create: %v", created)
	}
	if refused := request(carol, `{"type":"city-join","requestId":"q"}`); refused["code"] != "IN_ROOM" {
		t.Fatalf("city-join from a room: %v", refused)
	}
	stranger := dial(t, url)
	if refused := request(stranger, `{"type":"city-join","requestId":"q"}`); refused["code"] != "HELLO_REQUIRED" {
		t.Fatalf("city-join before hello: %v", refused)
	}

	snapshot := request(alice, `{"type":"city-join","requestId":"q"}`)
	if snapshot["type"] != "city" || snapshot["instanceId"] != "city-1" {
		t.Fatalf("city-join: %v", snapshot)
	}
	you := snapshot["you"].(map[string]any)
	aliceMemberID := int(you["id"].(float64))
	members := snapshot["members"].([]any)
	if len(members) != 1 || members[0].(map[string]any)["equipment"].(map[string]any)["systemKart"] != "practiceKart" {
		t.Fatalf("members: %v", members)
	}
	joined := request(bob, `{"type":"city-join","requestId":"q","line":1}`)
	if len(joined["members"].([]any)) != 2 {
		t.Fatalf("bob's snapshot: %v", joined)
	}
	readUntil(alice, func(kind int, data []byte) bool {
		return kind == websocket.TextMessage && strings.Contains(string(data), `"city-joined"`) &&
			strings.Contains(string(data), `"Bob"`)
	})
	// Rooms are closed to city members; the heartbeat shows the line.
	if refused := request(alice, `{"type":"create","requestId":"q","name":"R","capacity":2,`+
		`"channelName":"speedIndiCombine","mode":"individual","speed":7,"speedVersion":"国服"}`); refused["code"] != "IN_CITY" {
		t.Fatalf("create from the city: %v", refused)
	}
	if refused := request(bob, `{"type":"join","requestId":"q","roomId":"`+
		created["room"].(map[string]any)["roomId"].(string)+`"}`); refused["code"] != "IN_CITY" {
		t.Fatalf("join from the city: %v", refused)
	}
	players, _ := l.Online()
	rooms := map[string]string{}
	for _, p := range players {
		rooms[p.Name] = p.Room
	}
	if rooms["Alice"] != "city:1" || rooms["Bob"] != "city:1" || rooms["Carol"] != "R" {
		t.Fatalf("heartbeat rooms %v", rooms)
	}

	// Both start at spawn points; Bob moves next to Alice, then Alice's
	// frame reaches Bob with her id, and the radar packet lists both.
	if ok := request(bob, `{"type":"city-respawn","requestId":"q","spawn":"spawn-main"}`); ok["type"] != "ok" {
		t.Fatalf("respawn: %v", ok)
	}
	if err := alice.WriteMessage(websocket.BinaryMessage, cityFrame(1, 5, 95)); err != nil {
		t.Fatal(err)
	}
	readUntil(bob, func(kind int, data []byte) bool {
		if kind != websocket.BinaryMessage || data[0] != city.FrameMotion {
			return false
		}
		if int(binary.LittleEndian.Uint16(data[2:])) != aliceMemberID || data[1] != 2 || len(data) != 88 {
			t.Fatalf("relayed frame % x", data[:8])
		}
		return true
	})
	readUntil(bob, func(kind int, data []byte) bool {
		if kind != websocket.BinaryMessage || data[0] != city.FrameRadar {
			return false
		}
		if count := binary.LittleEndian.Uint16(data[2:]); count != 2 || len(data) != 4+7*2 {
			t.Fatalf("radar packet % x", data)
		}
		return true
	})
	// Race frames from a city member go nowhere (no room), city frames from
	// a room member go nowhere either.
	race := cityFrame(2, 0, 0)
	race[0] = 2
	if err := alice.WriteMessage(websocket.BinaryMessage, race); err != nil {
		t.Fatal(err)
	}
	if err := carol.WriteMessage(websocket.BinaryMessage, cityFrame(3, 0, 95)); err != nil {
		t.Fatal(err)
	}
	// Chat reaches the neighbour; leaving opens the rooms again, and the
	// line is empty once both are gone (the second by disconnect).
	if ok := request(alice, `{"type":"city-chat","requestId":"q","text":"你好","channel":"near"}`); ok["type"] != "ok" {
		t.Fatalf("chat: %v", ok)
	}
	readUntil(bob, func(kind int, data []byte) bool {
		return kind == websocket.TextMessage && strings.Contains(string(data), `"city-chat"`) &&
			strings.Contains(string(data), `"你好"`) && strings.Contains(string(data), `"playerId":"`+aliceID+`"`)
	})
	if left := request(alice, `{"type":"city-leave","requestId":"q"}`); left["type"] != "city-left" {
		t.Fatalf("leave: %v", left)
	}
	readUntil(bob, func(kind int, data []byte) bool {
		return kind == websocket.TextMessage && strings.Contains(string(data), `"city-left"`)
	})
	if created := request(alice, `{"type":"create","requestId":"q","name":"S","capacity":2,`+
		`"channelName":"speedIndiCombine","mode":"individual","speed":7,"speedVersion":"国服"}`); created["type"] != "room" {
		t.Fatalf("create after leaving: %v", created)
	}
	_ = bob.Close()
	deadline := time.Now().Add(5 * time.Second)
	for zone.Status()[0].Members != 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if status := zone.Status(); status[0].Members != 0 {
		t.Fatalf("line status %+v", status)
	}
}

// Without a city service, the city commands are unsupported and city
// frames are dropped (the race relay never sees the marker as a kind).
func TestWithoutCityService(t *testing.T) {
	_, url := start(t, Options{})
	conn := dial(t, url)
	hello := `{"type":"hello","requestId":"q","protocolVersion":40,"ruleset":"launcher-room-v1",` +
		`"resourceVersion":"p3553","name":"Alice","ticket":"any"}`
	if err := conn.WriteMessage(websocket.TextMessage, []byte(hello)); err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteMessage(websocket.BinaryMessage, cityFrame(1, 0, 0)); err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"city-join","requestId":"c"}`)); err != nil {
		t.Fatal(err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), `"requestId":"c"`) {
			if !strings.Contains(string(data), "UNSUPPORTED_COMMAND") {
				t.Fatalf("city-join: %s", data)
			}
			return
		}
	}
}
