package lobby

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

// cityEquip runs the lobby's half of city-equipment with the given value.
func (h *harness) cityEquip(c *Client, value any) (json.RawMessage, error) {
	h.t.Helper()
	payload, err := json.Marshal(map[string]any{"type": "city-equipment", "equipment": value})
	if err != nil {
		h.t.Fatal(err)
	}
	in, err := ParseRequest(payload)
	if err != nil {
		h.t.Fatal(err)
	}
	return h.lobby.CityEquipment(context.Background(), c, in)
}

// A garage change in the city is checked like a room's equipment command
// and becomes the session's equipment (CITY.md 2, city-equipment).
func TestCityEquipmentChecksAndStoresEquipment(t *testing.T) {
	h := newHarness(t)
	o := withOwnership(h)
	o.set([]int{900}, nil)
	player := h.connectAccount("Player", "acc-player")

	_, err := h.cityEquip(h.newClient(), gear(387))
	assertEqual(t, codeOf(t, err), "HELLO_REQUIRED")
	calls := o.callCount()
	_, err = h.cityEquip(player, map[string]any{})
	assertEqual(t, codeOf(t, err), "INVALID_EQUIPMENT")
	if o.callCount() != calls {
		t.Fatal("invalid equipment was checked")
	}
	before := player.equipment
	_, err = h.cityEquip(player, gear(900))
	assertEqual(t, codeOf(t, err), "ITEM_NOT_OWNED")
	assertEqual(t, player.equipment, before)

	applied, err := h.cityEquip(player, gear(1637))
	if err != nil {
		t.Fatal(err)
	}
	assertEqual(t, string(applied), compactGear(t, gear(1637)))
	assertEqual(t, player.equipment, json.RawMessage(compactGear(t, gear(1637))))
	profile, _ := h.lobby.Profile(player)
	assertEqual(t, string(profile.Equipment), compactGear(t, gear(1637)))

	o.set(nil, errors.New("timeout"))
	_, err = h.cityEquip(player, gear(2001))
	assertEqual(t, codeOf(t, err), "DATA_SERVICE_UNAVAILABLE")
	assertEqual(t, player.equipment, json.RawMessage(compactGear(t, gear(1637))))

	// A room member changes gear with the room's own command.
	o.set(nil, nil)
	h.command(player, createRequest(map[string]any{"capacity": 2}))
	_, err = h.cityEquip(player, gear(387))
	assertEqual(t, codeOf(t, err), "IN_ROOM")
}
