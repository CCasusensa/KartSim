package lobby

import (
	"kartsim/internal/shared/ticket"
	"testing"
)

func TestGMIdentityAndRoomHandoff(t *testing.T) {
	h := newHarness(t)
	gm := h.newClient()
	h.must(gm, helloRequest("ignored", h.sign(ticket.Claims{AccountID: "gm-account", Nickname: "Developer", GM: true})))
	ordinary := h.newClient()
	spoofed := helloRequest("Normal", h.sign(ticket.Claims{AccountID: "normal-account", Nickname: "Normal"}))
	spoofed["gm"] = true
	h.must(ordinary, spoofed)
	if !gm.gm || ordinary.gm {
		t.Fatal("GM must come only from the signed account ticket")
	}
	h.create([]*Client{gm}, "ordinary", "speedIndiCombine", 8)
	r := h.lobby.rooms[gm.roomID]
	if len(r.members) != 1 || !r.members[0].gm {
		t.Fatal("room lost GM identity")
	}
	snapshot := r.members[0].snapshot()
	found := false
	for _, f := range snapshot {
		if f.key == "gm" {
			found = true
		}
	}
	if !found {
		t.Fatal("GM absent from client snapshot")
	}
	state := exportRoom(r)
	restored, err := importRoom(state)
	if err != nil {
		t.Fatal(err)
	}
	if !state.Members[0].GM || !restored.members[0].gm {
		t.Fatal("handoff lost GM identity")
	}
}
