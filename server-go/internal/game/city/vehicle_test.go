package city

import (
	"encoding/json"
	"math"
	"strconv"
	"testing"
	"time"
)

func seatOf(t *testing.T, events []map[string]any, id int) map[string]any {
	t.Helper()
	for _, e := range ofType(events, "city-seat") {
		if e["id"] == float64(id) {
			return e
		}
	}
	t.Fatalf("no city-seat for %d in %v", id, events)
	return nil
}

func vehicleIn(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	v, ok := body["vehicle"].(map[string]any)
	if !ok {
		t.Fatalf("no vehicle in %v", body)
	}
	return v
}

// E gets out: the kart stays parked where it stopped, the member walks
// (frames relayed, nothing burnt) and gets back in its own kart.
func TestExitParksTheKartAndWalks(t *testing.T) {
	h, fuel := newFuelHarness(t, 10_000, 5_000)
	a, b := h.driver("甲"), h.driver("乙")
	snapshot := h.join(a, `{"type":"city-join"}`)
	if vehicles := snapshot["vehicles"].([]any); len(vehicles) != 1 ||
		vehicles[0].(map[string]any)["driver"] != float64(a.id) {
		t.Fatalf("snapshot vehicles %v", snapshot["vehicles"])
	}
	joined := h.join(b, `{"type":"city-join"}`)
	if len(joined["vehicles"].([]any)) != 2 {
		t.Fatalf("b sees %v", joined["vehicles"])
	}
	h.at(a, 0, 10, 0, 0)
	h.at(b, 3, 10, 0, 0)
	h.refused(a, `{"type":"city-enter","vehicle":`+itoa(b.id)+`}`, "ALREADY_IN_KART")
	b.sink.events(t)

	reply := h.must(a, `{"type":"city-exit"}`)
	pose := reply["pose"].(map[string]any)
	if reply["seat"] != SeatFoot || math.Abs(pose["x"].(float64)+sideStep) > 1e-9 || vehicleIn(t, reply)["driver"] != 0.0 {
		t.Fatalf("exit reply %v", reply)
	}
	events := b.sink.events(t)
	if seat := seatOf(t, events, a.id); seat["seat"] != SeatFoot || seat["vehicle"] != 0.0 {
		t.Fatalf("b saw %v", seat)
	}
	if parked := ofType(events, "city-vehicle"); len(parked) != 1 || vehicleIn(t, parked[0])["driver"] != 0.0 {
		t.Fatalf("b's vehicle events %v", parked)
	}
	h.refused(a, `{"type":"city-exit"}`, "NOT_IN_KART")

	// Walking: relayed, no fuel.
	var seq uint32
	b.sink.takeFrames()
	h.svc.RelayMotion(a.c, motionFrame(seq, -1.4, 10, 0, 90))
	h.drive(a, &seq, 0, 4, 1)
	if got := len(b.sink.takeMotion()); got != 6 {
		t.Fatalf("b saw %d walking frames, want 6", got)
	}
	if levels := fuel.savedLevels(); len(levels) != 0 {
		t.Fatalf("walking saved fuel %v", levels)
	}
	h.must(a, `{"type":"city-respawn","pose":{"x":20,"y":10,"z":0,"heading":0}}`)
	h.refused(a, `{"type":"city-enter","vehicle":`+itoa(a.id)+`}`, "TOO_FAR")
	h.must(a, `{"type":"city-respawn","pose":{"x":1,"y":10,"z":0,"heading":0}}`)
	back := h.must(a, `{"type":"city-enter","vehicle":`+itoa(a.id)+`}`)
	if back["seat"] != SeatDriver || fuelOf(t, back)["fuelMl"] != 5000.0 {
		t.Fatalf("enter reply %v", back)
	}
	h.refused(a, `{"type":"city-enter","vehicle":999}`, "ALREADY_IN_KART")
}

// Someone else may drive away an unlocked parked kart; it burns the
// owner's tank and the driver pays for its fuel. A locked kart takes only
// its owner.
func TestDriveSomeoneElsesKart(t *testing.T) {
	h, fuel := newFuelHarness(t, 10_000, 5_000)
	a, b := h.driver("甲"), h.driver("乙")
	h.join(a, `{"type":"city-join"}`)
	h.join(b, `{"type":"city-join"}`)
	h.at(a, 0, 10, 0, 90)
	h.at(b, 3, 10, 0, 90)
	h.must(a, `{"type":"city-exit"}`)
	h.must(a, `{"type":"city-respawn","pose":{"x":-30,"y":10,"z":0,"heading":0}}`)
	h.must(b, `{"type":"city-exit"}`)

	locked := h.must(a, `{"type":"city-lock","locked":true}`)
	if vehicleIn(t, locked)["locked"] != true {
		t.Fatalf("lock reply %v", locked)
	}
	h.refused(b, `{"type":"city-enter","vehicle":`+itoa(a.id)+`}`, "VEHICLE_LOCKED")
	h.must(a, `{"type":"city-lock","locked":false}`)
	reply := h.must(b, `{"type":"city-enter","vehicle":`+itoa(a.id)+`}`)
	if reply["seat"] != SeatDriver || vehicleIn(t, reply)["driver"] != float64(b.id) || vehicleIn(t, reply)["owner"] != float64(a.id) {
		t.Fatalf("enter reply %v", reply)
	}
	b.sink.events(t)

	// b's driving burns a's tank and b hears about it.
	var seq uint32
	h.svc.RelayMotion(b.c, motionFrame(seq, 0, 10, 0, 90))
	h.drive(b, &seq, 10, 90, 10)
	drives := ofType(b.sink.events(t), "city-fuel")
	if len(drives) == 0 {
		t.Fatal("no fuel updates for the driver")
	}
	inst := h.svc.lines[0]
	inst.mu.Lock()
	owner := inst.byID[uint16(a.id)].own
	ownerFuel, accountA := owner.tank.fuel, owner.tank.accountID
	ownB := inst.byID[uint16(b.id)].own.tank.fuel
	inst.mu.Unlock()
	if ownerFuel > 4_850 || ownB != 5_000 {
		t.Fatalf("a's tank %v, b's own tank %v", ownerFuel, ownB)
	}
	h.clock.Advance(2 * time.Second)
	h.must(b, `{"type":"city-refuel","requestId":"r1","addMl":1000}`)
	request := fuel.refuels[len(fuel.refuels)-1]
	profileB, _ := h.lobby.Profile(b.c)
	if request.AccountID != profileB.AccountID || request.TankAccountID != accountA {
		t.Fatalf("refuel request %+v (b %s, a %s)", request, profileB.AccountID, accountA)
	}
	// The owner's tank was not someone else's to save: b's own kart stands where b left it.
	h.refused(b, `{"type":"city-equipment","equipment":{"itemIds":{"1":3}}}`, "NOT_IN_OWN_KART")
}

// A kart someone drives takes a passenger: the driver's frames carry it,
// its own frames are dropped, and the driver getting out puts it down.
func TestPassengerRidesAlong(t *testing.T) {
	h := newHarness(t, Options{Lines: 1})
	a, b, watcher := h.player("甲"), h.player("乙"), h.player("丙")
	h.join(a, `{"type":"city-join"}`)
	h.join(b, `{"type":"city-join"}`)
	h.join(watcher, `{"type":"city-join"}`)
	h.at(a, 0, 10, 0, 90)
	h.at(b, 3, 10, 0, 90)
	h.at(watcher, 10, 10, 0, 0)
	h.must(b, `{"type":"city-exit"}`)
	ride := h.must(b, `{"type":"city-enter","vehicle":`+itoa(a.id)+`}`)
	if ride["seat"] != SeatPassenger || vehicleIn(t, ride)["passenger"] != float64(b.id) {
		t.Fatalf("ride reply %v", ride)
	}
	third := h.player("丁")
	h.join(third, `{"type":"city-join"}`)
	h.at(third, 1, 10, 0, 0)
	h.must(third, `{"type":"city-exit"}`)
	h.refused(third, `{"type":"city-enter","vehicle":`+itoa(a.id)+`}`, "VEHICLE_FULL")
	h.refused(b, `{"type":"city-respawn","pose":{"x":0,"y":10,"z":0,"heading":0}}`, "PASSENGER")

	var seq uint32
	h.svc.RelayMotion(a.c, motionFrame(seq, 0, 10, 0, 90))
	h.drive(a, &seq, 10, 30, 10)
	inst := h.svc.lines[0]
	inst.mu.Lock()
	passengerX := inst.byID[uint16(b.id)].pose.X
	inst.mu.Unlock()
	if passengerX != 30 {
		t.Fatalf("passenger at x %v, want 30", passengerX)
	}
	watcher.sink.takeFrames()
	h.svc.RelayMotion(b.c, motionFrame(99, 500, 10, 0, 0))
	if frames := watcher.sink.takeMotion(); len(frames) != 0 {
		t.Fatalf("a passenger's frame was relayed")
	}
	b.sink.events(t)
	h.must(a, `{"type":"city-exit"}`)
	if dropped := seatOf(t, b.sink.events(t), b.id); dropped["seat"] != SeatFoot || dropped["reason"] != "dropped" {
		t.Fatalf("b was not dropped: %v", dropped)
	}
}

// The owner leaving the city takes its kart: whoever drives it is put
// down, and the line hears the kart is gone.
func TestOwnerLeavingRecallsTheKart(t *testing.T) {
	h := newHarness(t, Options{Lines: 1})
	a, b := h.player("甲"), h.player("乙")
	h.join(a, `{"type":"city-join"}`)
	h.join(b, `{"type":"city-join"}`)
	h.at(a, 0, 10, 0, 90)
	h.at(b, 3, 10, 0, 90)
	h.must(a, `{"type":"city-exit"}`)
	h.must(b, `{"type":"city-exit"}`)
	h.must(b, `{"type":"city-enter","vehicle":`+itoa(a.id)+`}`)
	b.sink.events(t)
	h.must(a, `{"type":"city-leave"}`)
	events := b.sink.events(t)
	if recalled := seatOf(t, events, b.id); recalled["seat"] != SeatFoot || recalled["reason"] != "recalled" {
		t.Fatalf("b %v", recalled)
	}
	gone := ofType(events, "city-vehicle-gone")
	if len(gone) != 1 || gone[0]["id"] != float64(a.id) {
		t.Fatalf("gone %v", gone)
	}
	// b gets back into its own kart.
	h.must(b, `{"type":"city-respawn","pose":{"x":3,"y":10,"z":0,"heading":0}}`)
	h.must(b, `{"type":"city-enter","vehicle":`+itoa(b.id)+`}`)
}

// A garage change brings the new kart's tank (the data service is asked
// once per kart and visit) and saves the old one.
func TestGarageChangeSwitchesTheTank(t *testing.T) {
	h, fuel := newFuelHarness(t, 10_000, 5_000)
	a := h.driver("甲")
	profile, _ := h.lobby.Profile(a.c)
	profile.Equipment = json.RawMessage(`{"itemIds":{"1":3,"3":1}}`)
	h.lobby.set(a.c, profile)
	h.join(a, `{"type":"city-join"}`)
	var seq uint32
	h.svc.RelayMotion(a.c, motionFrame(seq, 0, 10, 0, 90))
	h.drive(a, &seq, 10, 100, 10) // 200 ml off item 1
	a.sink.events(t)
	h.must(a, `{"type":"city-equipment","equipment":{"itemIds":{"1":3,"3":7}}}`)
	if switched := ofType(a.sink.events(t), "city-fuel"); len(switched) != 1 || switched[0]["reason"] != "equip" ||
		fuelOf(t, switched[0])["fuelMl"] != 5000.0 {
		t.Fatalf("switch %v", switched)
	}
	eventually(t, "the old tank's save", func() bool {
		levels := fuel.savedLevels()
		return len(levels) == 1 && levels[0] == 4_800
	})
	h.clock.Advance(time.Second)
	h.must(a, `{"type":"city-equipment","equipment":{"itemIds":{"1":3,"3":1}}}`)
	back := ofType(a.sink.events(t), "city-fuel")
	if len(back) != 1 || fuelOf(t, back[0])["fuelMl"] != 4800.0 {
		t.Fatalf("back on item 1: %v", back)
	}
	fuel.mu.Lock()
	defer fuel.mu.Unlock()
	if len(fuel.states) != 2 || fuel.states[1] != profile.AccountID+" item:7" {
		t.Fatalf("state calls %v", fuel.states)
	}
}

func itoa(id int) string { return strconv.Itoa(id) }
