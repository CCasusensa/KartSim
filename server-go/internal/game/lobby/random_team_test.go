package lobby

import (
	"fmt"
	"testing"
)

// 隊伍隨機分配 (not in Java): the host's switch on a team room, saved with
// the rules and shown in the snapshot only while on.
func TestRandomTeamSwitchIsHostOnlyOnTeamRooms(t *testing.T) {
	h := newHarness(t)
	players := h.connectN(2)
	solo := h.create(players, "ordinary", "speedIndiCombine", 2)
	code := h.errorCode(players[0], map[string]any{"type": "random-team",
		"roomId": solo["roomId"], "revision": solo["revision"], "enabled": true})
	assertEqual(t, code, "TEAM_REQUIRED")
	h.must(players[0], map[string]any{"type": "leave", "roomId": solo["roomId"]})

	room := h.create(players, "ordinary", "speedTeamCombine", 4)
	roomID := room["roomId"].(string)
	room = h.command(players[1], map[string]any{"type": "join", "roomId": roomID})
	code = h.errorCode(players[1], map[string]any{"type": "random-team",
		"roomId": roomID, "revision": room["revision"], "enabled": true})
	assertEqual(t, code, "HOST_REQUIRED")
	if _, shown := room["randomTeam"]; shown {
		t.Fatalf("randomTeam shown while off: %v", room)
	}

	room = h.command(players[0], map[string]any{"type": "random-team",
		"roomId": roomID, "revision": room["revision"], "enabled": true})
	assertEqual(t, room["randomTeam"], true)
	assertEqual(t, h.recorder.savedRules(t, roomID)["randomTeam"], true)
	if !containsEvent(h.sink(players[1]).events(t), map[string]any{"type": "room", "room": room}) {
		t.Fatal("the other member was not told the switch")
	}

	room = h.command(players[0], map[string]any{"type": "random-team",
		"roomId": roomID, "revision": room["revision"], "enabled": false})
	if _, shown := room["randomTeam"]; shown {
		t.Fatalf("randomTeam shown after switching off: %v", room)
	}
	if _, saved := h.recorder.savedRules(t, roomID)["randomTeam"]; saved {
		t.Fatal("randomTeam saved after switching off")
	}
}

// With the switch on, the start deals the members into two teams as even
// as possible, whatever teams they chose: each team seated in its own
// slots, the frozen roster carries the deal, the race says so, and a
// closed slot a racer lands on opens.
func TestRandomTeamStartDealsEvenTeams(t *testing.T) {
	h := newHarness(t)
	players := h.connectN(4)
	room := h.joinAndReady(players, h.create(players, "ordinary", "speedTeamCombine", 8))
	roomID := room["roomId"].(string)
	host := players[0]
	// Everyone chooses team 1 (four slots): without the switch the start refuses.
	for _, p := range players[1:] {
		if memberOf(t, room, p.playerID)["team"] != float64(1) {
			room = h.command(p, map[string]any{"type": "team", "roomId": roomID,
				"revision": room["revision"], "team": 1})
		}
	}
	assertEqual(t, teamCounts(room), map[string]int{"1": 4})
	code := h.errorCode(host, map[string]any{"type": "start", "roomId": roomID, "revision": room["revision"]})
	assertEqual(t, code, "TEAM_REQUIRED")

	for _, slot := range []int{4, 5, 6, 7} {
		room = h.command(host, map[string]any{"type": "slot", "roomId": roomID,
			"revision": room["revision"], "slot": slot, "closed": true})
	}
	room = h.command(host, map[string]any{"type": "random-team", "roomId": roomID,
		"revision": room["revision"], "enabled": true})
	room = h.command(host, map[string]any{"type": "start", "roomId": roomID, "revision": room["revision"]})
	race := raceOf(room)
	assertEqual(t, race["randomTeam"], true)
	assertEqual(t, room["randomTeam"], true)
	assertEqual(t, teamCounts(room), map[string]int{"1": 2, "2": 2})
	assertSeatedByTeam(t, room)
	for _, raw := range list(race["roster"]) {
		entry := object(raw)
		live := memberOf(t, room, entry["playerId"].(string))
		assertEqual(t, entry["team"], live["team"])
		assertEqual(t, entry["slot"], live["slot"])
		assertEqual(t, object(race["startSlots"])[entry["playerId"].(string)], live["slot"])
	}
	// Team 2's dealt members opened slots 4 and 5; 6 and 7 stay closed.
	assertEqual(t, room["closedSlots"], []any{6, 7})
	// The data service keeps the switch with the rules it already saves.
	assertEqual(t, h.recorder.savedRules(t, roomID)["randomTeam"], true)
}

// An odd number of racers: the larger half is team 1.
func TestRandomTeamDealsOddCountThreeAndTwo(t *testing.T) {
	h := newHarness(t)
	players := h.connectN(5)
	room := h.joinAndReady(players, h.create(players, "ordinary", "speedTeamCombine", 8))
	roomID := room["roomId"].(string)
	room = h.command(players[0], map[string]any{"type": "random-team", "roomId": roomID,
		"revision": room["revision"], "enabled": true})
	room = h.command(players[0], map[string]any{"type": "start", "roomId": roomID, "revision": room["revision"]})
	assertEqual(t, teamCounts(room), map[string]int{"1": 3, "2": 2})
	assertSeatedByTeam(t, room)
	if _, closed := room["closedSlots"]; closed {
		t.Fatalf("closed slots appeared: %v", room["closedSlots"])
	}
}

// teamCounts is how many members each team ("1", "2") has.
func teamCounts(room map[string]any) map[string]int {
	counts := map[string]int{}
	for _, raw := range list(room["members"]) {
		counts[fmt.Sprint(object(raw)["team"])]++
	}
	return counts
}

// assertSeatedByTeam checks every member has its own slot inside its team's
// range: team 1 in 0…3, team 2 in 4…7.
func assertSeatedByTeam(t *testing.T, room map[string]any) {
	t.Helper()
	seated := map[any]bool{}
	for _, raw := range list(room["members"]) {
		m := object(raw)
		if seated[m["slot"]] {
			t.Fatalf("slot %v seated twice: %v", m["slot"], room["members"])
		}
		seated[m["slot"]] = true
		slot, team := m["slot"].(float64), m["team"].(float64)
		if (team == 1 && slot > 3) || (team == 2 && (slot < 4 || slot > 7)) {
			t.Fatalf("member %v seated outside its team's slots", m)
		}
	}
}
