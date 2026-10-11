package city

import (
	"encoding/binary"
	"math"
	"strings"
	"testing"
	"time"

	"kartsim/internal/game/lobby"
)

func TestJoinAssignsIdsLinesAndSpawns(t *testing.T) {
	h := newHarness(t, Options{Lines: 2, LinePlayers: 2})
	alice, bob, carol := h.player("Alice"), h.player("Bob"), h.player("Carol")
	snapshot := h.join(alice, `{"type":"city-join"}`)
	if snapshot["instanceId"] != "city-1" || snapshot["line"] != 1.0 || snapshot["capacity"] != 2.0 ||
		snapshot["name"] != "卡丁城 线路 1" || alice.id != 1 {
		t.Fatalf("snapshot %v", snapshot)
	}
	you := snapshot["you"].(map[string]any)
	if spawn := you["spawn"].(map[string]any); spawn["id"] != "spawn-main" || spawn["z"] != 95.0 {
		t.Fatalf("first spawn %v", spawn)
	}
	if members := snapshot["members"].([]any); len(members) != 1 {
		t.Fatalf("members %v", members)
	}
	if alice.c.CityLine() != 1 {
		t.Fatalf("line %d", alice.c.CityLine())
	}
	// Without a line the emptier line is chosen; with one, that line.
	if snapshot := h.join(bob, `{"type":"city-join"}`); snapshot["line"] != 2.0 || bob.id != 1 {
		t.Fatalf("bob %v %d", snapshot, bob.id)
	}
	snapshot = h.join(carol, `{"type":"city-join","line":1}`)
	if snapshot["line"] != 1.0 || carol.id != 2 {
		t.Fatalf("carol %v %d", snapshot, carol.id)
	}
	// The second spawn of line 1 rotates past the main one; the roster is
	// sorted by id and carries the hello equipment.
	you = snapshot["you"].(map[string]any)
	if spawn := you["spawn"].(map[string]any); spawn["id"] != "spawn-homes" {
		t.Fatalf("second spawn %v", spawn)
	}
	members := snapshot["members"].([]any)
	first := members[0].(map[string]any)
	if len(members) != 2 || first["id"] != 1.0 || first["name"] != "Alice" || first["state"] != "driving" ||
		first["equipment"].(map[string]any)["itemIds"] == nil {
		t.Fatalf("members %v", members)
	}
	if pose := first["pose"].(map[string]any); pose["z"] != 95.0 || pose["heading"] != 0.0 {
		t.Fatalf("alice's pose %v", pose)
	}
	// Alice heard Carol come in; line 2's Bob did not.
	joined := ofType(alice.sink.events(t), "city-joined")
	if len(joined) != 1 || joined[0]["member"].(map[string]any)["name"] != "Carol" {
		t.Fatalf("alice's events %v", joined)
	}
	if events := bob.sink.events(t); len(events) != 0 {
		t.Fatalf("bob's events %v", events)
	}
	// Line 1 is full; so is the only other line once Dave takes it.
	dave := h.player("Dave")
	h.refused(dave, `{"type":"city-join","line":1}`, "CITY_LINE_FULL")
	h.join(dave, `{"type":"city-join"}`)
	h.refused(h.player("Eve"), `{"type":"city-join"}`, "CITY_FULL")
	h.refused(h.player("Eve"), `{"type":"city-join","line":3}`, "INVALID_LINE")

	// Leaving frees the seat and the id, which the next member reuses;
	// the others hear city-left.
	if reply := h.must(alice, `{"type":"city-leave"}`); reply["type"] != "city-left" {
		t.Fatalf("leave %v", reply)
	}
	if alice.c.CityLine() != 0 {
		t.Fatal("alice still in the city")
	}
	left := ofType(carol.sink.events(t), "city-left")
	if len(left) != 1 || left[0]["id"] != 1.0 || left[0]["playerId"] != "player-1" {
		t.Fatalf("carol's events %v", left)
	}
	h.refused(alice, `{"type":"city-leave"}`, "NOT_IN_CITY")
	h.refused(alice, `{"type":"city-chat","text":"hi","channel":"city"}`, "NOT_IN_CITY")
	eve := h.player("Eve")
	if h.join(eve, `{"type":"city-join","line":1}`); eve.id != 1 {
		t.Fatalf("eve got id %d", eve.id)
	}
	// A disconnect is a leave.
	h.svc.Disconnect(eve.c)
	if eve.c.CityLine() != 0 || len(ofType(carol.sink.events(t), "city-left")) != 1 {
		t.Fatal("disconnect did not leave")
	}
}

func TestJoinRefusals(t *testing.T) {
	h := newHarness(t, Options{Lines: 1})
	stranger := h.player("Nobody")
	h.lobby.by = map[*lobby.Client]lobby.Profile{}
	h.refused(stranger, `{"type":"city-join"}`, "HELLO_REQUIRED")
	racer := h.player("Racer")
	profile, _ := h.lobby.Profile(racer.c)
	profile.InRoom = true
	h.lobby.set(racer.c, profile)
	h.refused(racer, `{"type":"city-join"}`, "IN_ROOM")
	kicked := h.player("Kicked")
	profile, _ = h.lobby.Profile(kicked.c)
	profile.Kicked = true
	h.lobby.set(kicked.c, profile)
	h.refused(kicked, `{"type":"city-join"}`, "CHEAT_DETECTED")
	h.refused(h.player("Odd"), `{"type":"city-join","line":"1"}`, "INVALID_LINE")

	off := newHarness(t, Options{Disabled: true})
	off.refused(off.player("Alice"), `{"type":"city-join"}`, "CITY_DISABLED")
	off.refused(off.player("Alice"), `{"type":"city-leave"}`, "NOT_IN_CITY")
}

// Joining again switches lines; joining the same line answers a snapshot.
func TestJoinSwitchesLines(t *testing.T) {
	h := newHarness(t, Options{Lines: 2})
	alice, bob := h.player("Alice"), h.player("Bob")
	h.join(alice, `{"type":"city-join","line":1}`)
	h.join(bob, `{"type":"city-join","line":1}`)
	bob.sink.events(t)
	if snapshot := h.join(alice, `{"type":"city-join","line":2}`); snapshot["line"] != 2.0 || alice.c.CityLine() != 2 {
		t.Fatalf("switch %v", snapshot)
	}
	if left := ofType(bob.sink.events(t), "city-left"); len(left) != 1 {
		t.Fatalf("bob's events %v", left)
	}
	if snapshot := h.join(alice, `{"type":"city-join","line":2}`); snapshot["line"] != 2.0 {
		t.Fatalf("rejoin %v", snapshot)
	}
}

func TestMotionInterestAndCadence(t *testing.T) {
	h := newHarness(t, Options{Lines: 1, InterestRadius: 160})
	alice, near, mid, far, parked := h.player("Alice"), h.player("Near"), h.player("Mid"), h.player("Far"),
		h.player("Parked")
	for _, p := range []*peer{alice, near, mid, far, parked} {
		h.join(p, `{"type":"city-join"}`)
	}
	h.at(alice, 0, 0, 0, 0)
	h.at(near, 30, 0, 0, 0)
	h.at(mid, 0, 0, 100, 0)
	h.at(far, 200, 0, 200, 0)
	h.at(parked, 10, 0, 10, 0)
	h.must(parked, `{"type":"city-state","state":"parked"}`)
	for _, p := range []*peer{alice, near, mid, far, parked} {
		p.sink.events(t)
		p.sink.takeFrames()
	}
	odd := motionFrame(1, 1, 0, 0, 90)
	even := motionFrame(2, 2, 0, 0, 90)
	h.svc.RelayMotion(alice.c, odd)
	h.svc.RelayMotion(alice.c, even)
	// Within 60 m every frame, 60–160 m the even ones, beyond nothing;
	// parked members receive too. The id is stamped on the way.
	if frames := near.sink.takeFrames(); len(frames) != 2 || senderID(frames[0]) != alice.id ||
		senderID(frames[1]) != alice.id {
		t.Fatalf("near got %d frames", len(frames))
	}
	if frames := mid.sink.takeFrames(); len(frames) != 1 || binary.LittleEndian.Uint32(frames[0][sequenceOffset:]) != 2 {
		t.Fatalf("mid got %v", frames)
	}
	if frames := far.sink.takeFrames(); len(frames) != 0 {
		t.Fatalf("far got %d frames", len(frames))
	}
	if frames := parked.sink.takeFrames(); len(frames) != 2 {
		t.Fatalf("parked got %d frames", len(frames))
	}
	if frames := alice.sink.takeFrames(); len(frames) != 0 {
		t.Fatalf("the sender got its own frame")
	}
	// The pose was recorded in world coordinates with the heading.
	members, _ := h.svc.Members(1)
	if members[0].Pose != (Pose{X: 2, Y: 0, Z: 0, Heading: 90}) {
		t.Fatalf("alice's pose %+v", members[0].Pose)
	}
	// Frames from outside the city, malformed frames and race frames are
	// dropped.
	h.svc.RelayMotion(h.player("Stranger").c, even)
	h.svc.RelayMotion(alice.c, even[:40])
	race := append([]byte(nil), even...)
	race[0] = 2
	h.svc.RelayMotion(alice.c, race)
	bad := motionFrame(3, 0, 0, 0, 0)
	bad[kindOffset] = 11
	h.svc.RelayMotion(alice.c, bad)
	zeroQuaternion := motionFrame(4, 0, 0, 0, 0)
	for i := range 16 {
		zeroQuaternion[headerLength+kinematicQuaternionOffset+i] = 0
	}
	h.svc.RelayMotion(alice.c, zeroQuaternion)
	if frames := near.sink.takeFrames(); len(frames) != 0 {
		t.Fatalf("near got %d bad frames", len(frames))
	}
	// A frame of another member is not relayed to the sender... but is to
	// Alice, now that Near sends.
	h.svc.RelayMotion(near.c, motionFrame(1, 31, 0, 0, 0))
	if frames := alice.sink.takeFrames(); len(frames) != 1 || senderID(frames[0]) != near.id {
		t.Fatalf("alice got %v", frames)
	}
}

func TestMotionPlausibilityKicksRepeatOffenders(t *testing.T) {
	// A day of AFK allowance: the test skips an hour at one point.
	h := newHarness(t, Options{Lines: 1, MaxSpeed: 150, AFKTimeout: 24 * time.Hour})
	alice, bob := h.player("Alice"), h.player("Bob")
	h.join(alice, `{"type":"city-join"}`)
	h.join(bob, `{"type":"city-join"}`)
	// The first frame after a join is not checked (the browser may load
	// away from the spawn point).
	h.svc.RelayMotion(alice.c, motionFrame(1, 500, 0, 500, 0))
	if frames := bob.sink.takeMotion(); len(frames) != 0 {
		t.Fatal("bob is far away yet got a frame")
	}
	h.at(bob, 500, 0, 500, 0)
	bob.sink.takeMotion()
	// 100 m in 1 s is fine; 200 m in 1 s is too fast; 201 m is a teleport
	// whatever the time.
	h.clock.Advance(time.Second)
	h.svc.RelayMotion(alice.c, motionFrame(2, 600, 0, 500, 0))
	h.clock.Advance(time.Second)
	h.svc.RelayMotion(alice.c, motionFrame(3, 800, 0, 500, 0))
	h.clock.Advance(time.Hour)
	h.svc.RelayMotion(alice.c, motionFrame(4, 801, 0, 500, 0))
	if frames := bob.sink.takeMotion(); len(frames) != 1 {
		t.Fatalf("bob got %d frames", len(frames))
	}
	// Two frames back to back are judged over at least 50 ms (an even
	// sequence: Bob is 107 m away).
	h.svc.RelayMotion(alice.c, motionFrame(6, 607, 0, 500, 0))
	if frames := bob.sink.takeMotion(); len(frames) != 1 {
		t.Fatalf("a 7 m hop was refused: %d frames", len(frames))
	}
	// A declared respawn resets the reference.
	h.must(alice, `{"type":"city-respawn","spawn":"spawn-beach"}`)
	h.svc.RelayMotion(alice.c, motionFrame(8, 820, 0, 480, 0))
	h.at(bob, 820, 0, 480, 0)
	bob.sink.takeMotion()
	bob.sink.events(t)
	alice.sink.events(t)
	// 20 implausible frames within 10 s kick the cheater (the teleport
	// above was more than 10 s ago once the window moves on).
	h.clock.Advance(11 * time.Second)
	for i := range 19 {
		h.svc.RelayMotion(alice.c, motionFrame(uint32(10+i), 5000, 0, 5000, 0))
		if alice.c.CityLine() != 1 {
			t.Fatalf("kicked after %d violations", i+1)
		}
	}
	h.svc.RelayMotion(alice.c, motionFrame(40, 5000, 0, 5000, 0))
	if alice.c.CityLine() != 0 {
		t.Fatal("cheater still in the city")
	}
	kicked := ofType(alice.sink.events(t), "city-kicked")
	if len(kicked) != 1 || kicked[0]["reason"] != KickCheat {
		t.Fatalf("alice's events %v", kicked)
	}
	if len(alice.sink.closed) != 0 {
		t.Fatal("a cheat kick closed the connection")
	}
	if left := ofType(bob.sink.events(t), "city-left"); len(left) != 1 {
		t.Fatalf("bob's events %v", left)
	}
	if frames := bob.sink.takeMotion(); len(frames) != 0 {
		t.Fatalf("implausible frames were relayed: %d", len(frames))
	}
}

func TestChatChannelsAndMute(t *testing.T) {
	h := newHarness(t, Options{Lines: 1, ChatRadius: 60})
	alice, near, plaza, harbor := h.player("Alice"), h.player("Near"), h.player("Plaza"), h.player("Harbor")
	for _, p := range []*peer{alice, near, plaza, harbor} {
		h.join(p, `{"type":"city-join"}`)
	}
	h.at(alice, 0, 0, 0, 0)      // the plaza (circle r=230)
	h.at(near, 50, 0, 0, 0)      // within 60 m, same district
	h.at(plaza, 0, 0, 200, 0)    // the plaza, out of chat range
	h.at(harbor, 820, 0, 480, 0) // the harbor district
	for _, p := range []*peer{alice, near, plaza, harbor} {
		p.sink.events(t)
	}
	texts := func(p *peer) []string {
		var lines []string
		for _, e := range ofType(p.sink.events(t), "city-chat") {
			lines = append(lines, e["channel"].(string)+":"+e["text"].(string))
		}
		return lines
	}
	if reply := h.must(alice, `{"type":"city-chat","text":"hi near","channel":"near"}`); reply["type"] != "ok" {
		t.Fatalf("chat reply %v", reply)
	}
	h.must(alice, `{"type":"city-chat","text":"hi district","channel":"district"}`)
	h.must(alice, `{"type":"city-chat","text":"hi city","channel":"city"}`)
	want := map[*peer]string{
		alice:  "near:hi near,district:hi district,city:hi city",
		near:   "near:hi near,district:hi district,city:hi city",
		plaza:  "district:hi district,city:hi city",
		harbor: "city:hi city",
	}
	for p, lines := range want {
		if got := strings.Join(texts(p), ","); got != lines {
			t.Fatalf("got %q, want %q", got, lines)
		}
	}
	// The event names the sender and numbers the line.
	h.must(harbor, `{"type":"city-chat","text":"ahoy","channel":"city"}`)
	chat := ofType(alice.sink.events(t), "city-chat")
	if len(chat) != 1 || chat[0]["id"] != float64(harbor.id) || chat[0]["playerId"] != "player-4" ||
		chat[0]["name"] != "Harbor" || chat[0]["sequence"] != 4.0 || chat[0]["instanceId"] != "city-1" {
		t.Fatalf("chat event %v", chat)
	}
	// Validation.
	h.refused(alice, `{"type":"city-chat","text":"","channel":"city"}`, "INVALID_TEXT")
	h.refused(alice, `{"type":"city-chat","text":"   ","channel":"city"}`, "INVALID_TEXT")
	h.refused(alice, `{"type":"city-chat","text":"a\nb","channel":"city"}`, "INVALID_TEXT")
	h.refused(alice, `{"type":"city-chat","text":"`+strings.Repeat("字", 61)+`","channel":"city"}`, "INVALID_TEXT")
	h.refused(alice, `{"type":"city-chat","text":"hi","channel":"club"}`, "INVALID_CHANNEL")
	h.refused(alice, `{"type":"city-chat","text":"hi"}`, "INVALID_CHANNEL")
	// Flooding: the burst of 5 (3 used) then a 10 s mute, which a rejoin
	// does not lift.
	h.must(alice, `{"type":"city-chat","text":"4","channel":"city"}`)
	h.must(alice, `{"type":"city-chat","text":"5","channel":"city"}`)
	h.refused(alice, `{"type":"city-chat","text":"6","channel":"city"}`, "CHAT_MUTED")
	h.clock.Advance(5 * time.Second)
	h.refused(alice, `{"type":"city-chat","text":"7","channel":"city"}`, "CHAT_MUTED")
	h.must(alice, `{"type":"city-leave"}`)
	h.join(alice, `{"type":"city-join"}`)
	h.refused(alice, `{"type":"city-chat","text":"8","channel":"city"}`, "CHAT_MUTED")
	h.clock.Advance(6 * time.Second)
	h.must(alice, `{"type":"city-chat","text":"9","channel":"city"}`)
	// An admin mute.
	h.svc.Mute("player-1", time.Minute)
	h.refused(alice, `{"type":"city-chat","text":"10","channel":"city"}`, "CHAT_MUTED")
	h.svc.Mute("player-1", 0)
	h.must(alice, `{"type":"city-chat","text":"11","channel":"city"}`)
}

func TestEmoteStateAndRespawn(t *testing.T) {
	h := newHarness(t, Options{Lines: 1, InterestRadius: 160})
	alice, near, far := h.player("Alice"), h.player("Near"), h.player("Far")
	for _, p := range []*peer{alice, near, far} {
		h.join(p, `{"type":"city-join"}`)
	}
	h.at(alice, 0, 0, 0, 0)
	h.at(near, 100, 0, 0, 0)
	h.at(far, 1000, 0, 0, 0)
	for _, p := range []*peer{alice, near, far} {
		p.sink.events(t)
	}
	h.must(alice, `{"type":"city-emote","emote":3}`)
	h.refused(alice, `{"type":"city-emote","emote":0}`, "INVALID_EMOTE")
	h.refused(alice, `{"type":"city-emote","emote":17}`, "INVALID_EMOTE")
	if emotes := ofType(near.sink.events(t), "city-emote"); len(emotes) != 1 || emotes[0]["emote"] != 3.0 ||
		emotes[0]["id"] != float64(alice.id) {
		t.Fatalf("near's emotes %v", emotes)
	}
	if events := far.sink.events(t); len(events) != 0 {
		t.Fatalf("far's events %v", events)
	}
	if events := alice.sink.events(t); len(events) != 0 {
		t.Fatalf("alice's own emote came back: %v", events)
	}
	// Emotes are limited to 2/s (burst 4).
	for range 3 {
		h.must(alice, `{"type":"city-emote","emote":1}`)
	}
	h.refused(alice, `{"type":"city-emote","emote":1}`, "RATE_LIMITED")
	near.sink.events(t)

	h.must(alice, `{"type":"city-state","state":"parked"}`)
	h.refused(alice, `{"type":"city-state","state":"afk"}`, "INVALID_STATE")
	if states := ofType(far.sink.events(t), "city-state"); len(states) != 1 || states[0]["state"] != "parked" {
		t.Fatalf("far's states %v", states)
	}
	members, _ := h.svc.Members(1)
	if members[0].State != StateParked {
		t.Fatalf("members %v", members)
	}

	h.must(alice, `{"type":"city-respawn","spawn":"spawn-garage"}`)
	respawns := ofType(near.sink.events(t), "city-respawn")
	if len(respawns) != 1 || respawns[0]["pose"].(map[string]any)["z"] != -560.0 ||
		respawns[0]["pose"].(map[string]any)["heading"] != 180.0 {
		t.Fatalf("near's respawns %v", respawns)
	}
	h.refused(alice, `{"type":"city-respawn","spawn":"spawn-moon"}`, "INVALID_SPAWN")
	h.refused(alice, `{"type":"city-respawn"}`, "INVALID_SPAWN")
	h.refused(alice, `{"type":"city-respawn","pose":{"x":1,"y":2}}`, "INVALID_POSE")
	h.refused(alice, `{"type":"city-respawn","pose":{"x":1,"y":2,"z":3,"heading":"n"}}`, "INVALID_POSE")
	h.refused(alice, `{"type":"city-respawn","pose":{"x":1e9,"y":2,"z":3,"heading":0}}`, "INVALID_POSE")
	h.must(alice, `{"type":"city-respawn","pose":{"x":1,"y":2,"z":3,"heading":-90}}`)
	members, _ = h.svc.Members(1)
	if members[0].Pose != (Pose{X: 1, Y: 2, Z: 3, Heading: 270}) {
		t.Fatalf("pose %+v", members[0].Pose)
	}
}

func TestAFKMarksThenKicks(t *testing.T) {
	h := newHarness(t, Options{Lines: 1, AFKTimeout: 10 * time.Second})
	alice, bob, parked := h.player("Alice"), h.player("Bob"), h.player("Parked")
	for _, p := range []*peer{alice, bob, parked} {
		h.join(p, `{"type":"city-join"}`)
	}
	h.must(parked, `{"type":"city-state","state":"parked"}`)
	for _, p := range []*peer{alice, bob, parked} {
		p.sink.events(t)
	}
	h.clock.Advance(9 * time.Second)
	h.svc.RelayMotion(bob.c, motionFrame(1, 0, 0, 0, 0))
	h.clock.Advance(time.Second)
	// Alice has been silent for 10 s: afk, and told so, like everyone.
	states := ofType(alice.sink.events(t), "city-state")
	if len(states) != 1 || states[0]["id"] != float64(alice.id) || states[0]["state"] != StateAFK {
		t.Fatalf("alice's states %v", states)
	}
	if states := ofType(bob.sink.events(t), "city-state"); len(states) != 1 {
		t.Fatalf("bob's states %v", states)
	}
	// Bob moved 9 s ago and the parked member never goes afk.
	h.clock.Advance(8 * time.Second)
	members, _ := h.svc.Members(1)
	if members[0].State != StateAFK || members[1].State != StateDriving || members[2].State != StateParked {
		t.Fatalf("members %+v", members)
	}
	// Moving again ends afk.
	h.svc.RelayMotion(alice.c, motionFrame(1, 0, 0, 0, 0))
	if states := ofType(bob.sink.events(t), "city-state"); len(states) != 1 || states[0]["state"] != StateDriving {
		t.Fatalf("bob's states %v", states)
	}
	// Silent for 10 s again: afk; after 10 s more: kicked and closed. Bob
	// keeps driving until 5 s before that.
	h.clock.Advance(5 * time.Second)
	h.svc.RelayMotion(bob.c, motionFrame(2, 0, 0, 0, 0))
	h.clock.Advance(5 * time.Second)
	h.clock.Advance(10 * time.Second)
	if alice.c.CityLine() != 0 {
		t.Fatal("afk member still in the city")
	}
	kicked := ofType(alice.sink.events(t), "city-kicked")
	if len(kicked) != 1 || kicked[0]["reason"] != KickAFK {
		t.Fatalf("alice's events %v", kicked)
	}
	if len(alice.sink.closed) != 1 || alice.sink.closed[0] != "1000 city afk" {
		t.Fatalf("closed %v", alice.sink.closed)
	}
	// Bob, silent for 15 s, is afk but not kicked yet.
	members, _ = h.svc.Members(1)
	if bob.c.CityLine() != 1 || len(members) != 2 || members[0].State != StateAFK {
		t.Fatalf("bob %d %+v", bob.c.CityLine(), members)
	}
}

func TestRadarPacket(t *testing.T) {
	h := newHarness(t, Options{Lines: 1})
	alice, bob, fresh := h.player("Alice"), h.player("Bob"), h.player("Fresh")
	for _, p := range []*peer{alice, bob, fresh} {
		h.join(p, `{"type":"city-join"}`)
	}
	h.svc.RelayMotion(bob.c, motionFrame(1, -12.5, 3, 100.25, 90))
	h.at(alice, 10000, 0, -10000, 359)
	for _, p := range []*peer{alice, bob, fresh} {
		p.sink.takeFrames()
	}
	h.clock.Advance(time.Second)
	// Everyone gets the same packet; Fresh, without a pose, is not in it.
	var packet []byte
	for _, p := range []*peer{alice, bob, fresh} {
		frames := p.sink.takeFrames()
		if len(frames) != 1 || frames[0][0] != FrameRadar {
			t.Fatalf("member %d got %v", p.id, frames)
		}
		if packet != nil && string(packet) != string(frames[0]) {
			t.Fatal("packets differ")
		}
		packet = frames[0]
	}
	want := []byte{FrameRadar, 0, 2, 0}
	entry := func(id uint16, x, z int16, heading byte) []byte {
		b := make([]byte, 7)
		binary.LittleEndian.PutUint16(b, id)
		binary.LittleEndian.PutUint16(b[2:], uint16(x))
		binary.LittleEndian.PutUint16(b[4:], uint16(z))
		b[6] = heading
		return b
	}
	want = append(want, entry(1, math.MaxInt16, math.MinInt16, 255)...) // clamped, 359° → 255
	want = append(want, entry(2, -50, 401, 64)...)                      // ×4, 90° → 64
	if string(packet) != string(want) {
		t.Fatalf("packet % x\n   want % x", packet, want)
	}
	// Radar packets go out every second, even when nobody moves.
	h.clock.Advance(3 * time.Second)
	if frames := alice.sink.takeFrames(); len(frames) != 3 {
		t.Fatalf("%d packets in 3 s", len(frames))
	}
}

func TestClockAndWeather(t *testing.T) {
	rolls := []float64{0, 0, 0.1, 0.25, 0.5}
	h := newHarness(t, Options{Lines: 1, DayLength: 48 * time.Minute, RainPercent: 20, SnowPercent: 10,
		Random: func() float64 {
			roll := rolls[0]
			rolls = rolls[1:]
			return roll
		}})
	alice := h.player("Alice")
	snapshot := h.join(alice, `{"type":"city-join"}`)
	clock := snapshot["clock"].(map[string]any)
	// A line starts at 08:00 with 5 minutes of clear weather (roll 0).
	if clock["serverTick"] != 0.0 || clock["dayLengthMs"] != 2880000.0 || clock["weather"] != WeatherClear ||
		clock["weatherUntilTick"] != 300000.0 || math.Abs(clock["timeOfDay"].(float64)-8.0/24) > 1e-9 {
		t.Fatalf("clock %v", clock)
	}
	// city-clock every 30 s.
	h.clock.Advance(29 * time.Second)
	if events := ofType(alice.sink.events(t), "city-clock"); len(events) != 0 {
		t.Fatalf("early clock %v", events)
	}
	h.clock.Advance(time.Second)
	events := ofType(alice.sink.events(t), "city-clock")
	if len(events) != 1 || events[0]["clock"].(map[string]any)["serverTick"] != 30000.0 {
		t.Fatalf("clock events %v", events)
	}
	// At 5 min the segment ends: roll 0 → rain (< 20%) for 5 + 0.1×10 min,
	// announced at once.
	h.clock.Advance(4*time.Minute + 30*time.Second)
	events = ofType(alice.sink.events(t), "city-clock")
	last := events[len(events)-1]["clock"].(map[string]any)
	if last["weather"] != WeatherRain || last["weatherUntilTick"] != 660000.0 {
		t.Fatalf("after 5 min %v", events)
	}
	// Then clear (after rain always clear) for 5 + 0.25×10 min; then the
	// roll 0.5 (50%) keeps it clear: no weather event, just the periodic
	// ones.
	h.clock.Advance(6 * time.Minute)
	events = ofType(alice.sink.events(t), "city-clock")
	last = events[len(events)-1]["clock"].(map[string]any)
	if last["weather"] != WeatherClear || last["weatherUntilTick"] != 660000.0+450000 {
		t.Fatalf("after 11 min %v", last)
	}
	// Time of day advanced 11 minutes of a 48-minute day.
	if got := last["timeOfDay"].(float64); math.Abs(got-(8.0/24+11.0/48)) > 1e-9 {
		t.Fatalf("timeOfDay %v", got)
	}
	// An admin sets the time and the weather; the line reports both.
	if err := h.svc.SetTimeOfDay(1, 0.5); err != nil {
		t.Fatal(err)
	}
	if err := h.svc.SetWeather(0, WeatherSnow, time.Minute); err != nil {
		t.Fatal(err)
	}
	if err := h.svc.SetWeather(1, "hail", time.Minute); err == nil {
		t.Fatal("hail accepted")
	}
	events = ofType(alice.sink.events(t), "city-clock")
	last = events[len(events)-1]["clock"].(map[string]any)
	if len(events) != 2 || last["weather"] != WeatherSnow || math.Abs(last["timeOfDay"].(float64)-0.5) > 1e-9 {
		t.Fatalf("admin clock %v", events)
	}
	status := h.svc.Status()
	if len(status) != 1 || status[0].Weather != WeatherSnow || status[0].Members != 1 || status[0].TimeOfDay != 0.5 {
		t.Fatalf("status %+v", status)
	}
	// The forced minute ends in clear.
	h.clock.Advance(time.Minute)
	events = ofType(alice.sink.events(t), "city-clock")
	if last = events[len(events)-1]["clock"].(map[string]any); last["weather"] != WeatherClear {
		t.Fatalf("after the forced snow %v", last)
	}

	// Weather off: always clear, with no scheduled change.
	off := newHarness(t, Options{Lines: 1, WeatherOff: true, RainPercent: 100})
	bob := off.player("Bob")
	clock = off.join(bob, `{"type":"city-join"}`)["clock"].(map[string]any)
	if clock["weather"] != WeatherClear || clock["weatherUntilTick"] != 0.0 {
		t.Fatalf("weather off %v", clock)
	}
	off.clock.Advance(20 * time.Minute)
	for _, e := range ofType(bob.sink.events(t), "city-clock") {
		if e["clock"].(map[string]any)["weather"] != WeatherClear {
			t.Fatalf("weather off changed: %v", e)
		}
	}
}

func TestAdminKickAndCloseLine(t *testing.T) {
	h := newHarness(t, Options{Lines: 2})
	alice, bob := h.player("Alice"), h.player("Bob")
	h.join(alice, `{"type":"city-join","line":1}`)
	h.join(bob, `{"type":"city-join","line":1}`)
	bob.sink.events(t)
	if kicked, err := h.svc.Kick(1, "player-1"); err != nil || !kicked {
		t.Fatalf("kick %v %v", kicked, err)
	}
	if kicked, _ := h.svc.Kick(1, "player-1"); kicked {
		t.Fatal("kicked twice")
	}
	if _, err := h.svc.Kick(3, "player-1"); err == nil {
		t.Fatal("line 3 exists")
	}
	if events := ofType(alice.sink.events(t), "city-kicked"); len(events) != 1 || events[0]["reason"] != KickAdmin {
		t.Fatalf("alice's events %v", events)
	}
	if alice.c.CityLine() != 0 || len(alice.sink.closed) != 0 {
		t.Fatal("an admin kick ended the connection")
	}
	if left := ofType(bob.sink.events(t), "city-left"); len(left) != 1 {
		t.Fatalf("bob's events %v", left)
	}
	// The kicked player may come back; a closed line refuses everyone and
	// drops its members with SHUTDOWN.
	h.join(alice, `{"type":"city-join","line":1}`)
	if err := h.svc.CloseLine(1); err != nil {
		t.Fatal(err)
	}
	for _, p := range []*peer{alice, bob} {
		if events := ofType(p.sink.events(t), "city-kicked"); len(events) != 1 || events[0]["reason"] != KickShutdown {
			t.Fatalf("events %v", events)
		}
	}
	h.refused(alice, `{"type":"city-join","line":1}`, "CITY_LINE_FULL")
	if snapshot := h.join(alice, `{"type":"city-join"}`); snapshot["line"] != 2.0 {
		t.Fatalf("auto line %v", snapshot)
	}
	status := h.svc.Status()
	if !status[0].Closed || status[0].Members != 0 || status[1].Members != 1 {
		t.Fatalf("status %+v", status)
	}
	if err := h.svc.OpenLine(1); err != nil {
		t.Fatal(err)
	}
	// Bob gets the freed id 1 and, fourth to spawn on the line, the beach
	// spawn in the harbor district.
	h.join(bob, `{"type":"city-join","line":1}`)
	members, err := h.svc.Members(1)
	if err != nil || len(members) != 1 || members[0].ID != 1 || members[0].Name != "Bob" ||
		members[0].District != "harbor" {
		t.Fatalf("members %+v %v", members, err)
	}
}

func TestHeadingOf(t *testing.T) {
	// Forward (2(wz − xy), ·, 1 − 2(x² + z²)) in the browser's y-up world:
	// identity faces +z (south), (0, 1, 0, 0) faces north, w = z = 1/√2 east.
	r := 1 / math.Sqrt2
	for _, tc := range []struct {
		q    [4]float64
		want float64
	}{
		{[4]float64{1, 0, 0, 0}, 180},
		{[4]float64{0, 1, 0, 0}, 0},
		{[4]float64{r, 0, 0, r}, 90},
		{[4]float64{r, 0, 0, -r}, 270},
		{[4]float64{2, 0, 0, 2}, 90}, // not normalized
		{[4]float64{0, 0, 0, 0}, 0},
	} {
		if got := headingOf(tc.q); math.Abs(got-tc.want) > 1e-6 {
			t.Errorf("headingOf(%v) = %v, want %v", tc.q, got, tc.want)
		}
	}
	// A driving (kind 1) payload carries its pose 3 bytes later; without
	// an extent the wire and design frames coincide.
	payload := make([]byte, 113)
	binary.LittleEndian.PutUint32(payload[drivingPositionOffset:], math.Float32bits(5))
	binary.LittleEndian.PutUint32(payload[drivingPositionOffset+4:], math.Float32bits(-7))
	binary.LittleEndian.PutUint32(payload[drivingPositionOffset+8:], math.Float32bits(2))
	binary.LittleEndian.PutUint32(payload[drivingQuaternionOffset+4:], math.Float32bits(1))
	pose, ok := (&Map{}).payloadPose(1, payload)
	if !ok || pose != (Pose{X: 5, Y: 2, Z: 7, Heading: 0}) {
		t.Fatalf("driving pose %+v %v", pose, ok)
	}
}

// The payload position is in the shifted physics frame of the city track
// (client x = design x + 1200, client y = 1200 - design z, from
// meta.extent); poses are design coordinates.
func TestPayloadPoseAppliesTheMapOffset(t *testing.T) {
	if designMap.OffsetX != 1200 || designMap.OffsetZ != 1200 {
		t.Fatalf("offsets %v %v", designMap.OffsetX, designMap.OffsetZ)
	}
	payload := make([]byte, 80)
	wire := func(p [3]float64) {
		for i, v := range p {
			binary.LittleEndian.PutUint32(payload[kinematicPositionOffset+4*i:], math.Float32bits(float32(v)))
		}
		binary.LittleEndian.PutUint32(payload[kinematicQuaternionOffset+4:], math.Float32bits(1)) // north
	}
	wire([3]float64{1200, 1200, 0})
	if pose, ok := designMap.payloadPose(2, payload); !ok || pose != (Pose{}) {
		t.Fatalf("the fountain: %+v %v", pose, ok)
	}
	// The beach spawn (820, 480) sits at client (2020, 720).
	wire([3]float64{2020, 720, 3})
	if pose, ok := designMap.payloadPose(2, payload); !ok || pose != (Pose{X: 820, Y: 3, Z: 480}) {
		t.Fatalf("the beach: %+v %v", pose, ok)
	}
	// And a relayed frame at the fountain lands the member in the plaza.
	h := newHarness(t, Options{Lines: 1})
	alice := h.player("Alice")
	h.join(alice, `{"type":"city-join"}`)
	h.svc.RelayMotion(alice.c, motionFrame(1, 0, 0, 0, 0))
	members, _ := h.svc.Members(1)
	if members[0].Pose != (Pose{}) || members[0].District != "plaza" {
		t.Fatalf("member %+v", members[0])
	}
}
