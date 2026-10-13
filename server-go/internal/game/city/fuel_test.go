package city

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"kartsim/internal/shared/apierr"
	"kartsim/internal/shared/contract"
)

// fakeFuel is the data service's tank API: it records the calls and
// answers like the store does.
type fakeFuel struct {
	mu        sync.Mutex
	state     contract.CityFuel
	saves     []contract.CityFuelSaveRequest
	refuels   []contract.CityFuelRefuelRequest
	rescues   []contract.CityFuelRescueRequest
	refuseErr error
	// hold, when set, keeps every save waiting until it is closed.
	hold chan struct{}
	// states lists the State calls ("<accountId> <kartKey>").
	states []string
}

func (f *fakeFuel) State(_ context.Context, accountID string, equipment json.RawMessage) (contract.CityFuel, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	state := f.state
	if key := kartKeyOf(equipment); key != "" {
		state.KartKey = key
	}
	f.states = append(f.states, accountID+" "+state.KartKey)
	return state, nil
}

func (f *fakeFuel) Save(_ context.Context, request contract.CityFuelSaveRequest) (contract.CityFuelSaveResponse, error) {
	f.mu.Lock()
	hold := f.hold
	f.saves = append(f.saves, request)
	f.mu.Unlock()
	if hold != nil {
		<-hold
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	return contract.CityFuelSaveResponse{FuelML: request.FuelML, Rev: request.Rev + 1, Applied: true}, nil
}

func (f *fakeFuel) Refuel(_ context.Context, request contract.CityFuelRefuelRequest) (contract.CityFuelCharge, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.refuels = append(f.refuels, request)
	if f.refuseErr != nil {
		return contract.CityFuelCharge{}, f.refuseErr
	}
	add, room := request.AddML, f.state.CapacityML-request.FuelML
	if add <= 0 || add > room {
		add = room
	}
	cost := (add*f.state.PricePerLiter + 999) / 1000
	f.state.Lucci -= cost
	return contract.CityFuelCharge{FuelML: request.FuelML + add, Rev: request.Rev + 1, AddedML: add, Cost: cost,
		Lucci: f.state.Lucci}, nil
}

func (f *fakeFuel) Rescue(_ context.Context, request contract.CityFuelRescueRequest) (contract.CityFuelCharge, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.rescues = append(f.rescues, request)
	f.state.Lucci -= f.state.RescueFee
	return contract.CityFuelCharge{FuelML: request.FuelML, Rev: request.Rev + 1, Cost: f.state.RescueFee,
		Lucci: f.state.Lucci}, nil
}

func (f *fakeFuel) savedLevels() []int64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	levels := make([]int64, len(f.saves))
	for i, save := range f.saves {
		levels[i] = save.FuelML
	}
	return levels
}

// fuelMap has the main spawn at the origin, a far spawn, and two gas
// stations: fuel-a 100 m east of the main spawn, fuel-b 2 km east.
func fuelMap(t *testing.T) *Map {
	t.Helper()
	m, err := Load(fmt.Appendf(nil, `{"meta":{"extent":[[%g,-100],[100,%g]]},
		"districts":[{"id":"all","circle":[0,0,5000]}],
		"pois":[{"id":"spawn-main","kind":"spawn","at":[0,0],"y":10,"heading":0},
		  {"id":"spawn-far","kind":"spawn","at":[1000,0],"y":10,"heading":0},
		  {"id":"fuel-a","name":"甲加油站","kind":"fuel","at":[100,0],"y":10,"heading":90,
		   "zone":[[90,-10],[110,-10],[110,10],[90,10]],"park":{"at":[100,0],"y":10,"heading":90}},
		  {"id":"fuel-b","name":"乙加油站","kind":"fuel","at":[2000,0],"y":10,"heading":0,
		   "zone":[[1990,-10],[2010,-10],[2010,10],[1990,10]],"park":{"at":[2000,5],"y":10,"heading":180}}]}`,
		-designMap.OffsetX, designMap.OffsetZ))
	if err != nil {
		t.Fatal(err)
	}
	return m
}

// newFuelHarness is a harness on fuelMap whose players have accounts and
// a tank of capacity ml holding fuelML, burning 2 ml per metre.
func newFuelHarness(t *testing.T, capacity, fuelML int64) (*harness, *fakeFuel) {
	t.Helper()
	fuel := &fakeFuel{state: contract.CityFuel{Enabled: true, KartKey: "item:1", KartName: "爆烈 C1", SizeClass: "medium",
		CapacityML: capacity, FuelML: fuelML, UseMLPerKm: 2000, PricePerLiter: 5, RescueFee: 300, Lucci: 10_000}}
	return newHarness(t, Options{Lines: 1, Map: fuelMap(t), Fuel: fuel}), fuel
}

func (h *harness) driver(name string) *peer {
	p := h.player(name)
	profile, _ := h.lobby.Profile(p.c)
	profile.AccountID = fmt.Sprintf("00000000-0000-4000-8000-%012d", h.n)
	h.lobby.set(p.c, profile)
	return p
}

// drive sends frames from x0 to x1 along z = 0 in steps of step metres,
// half a second apart.
func (h *harness) drive(p *peer, seq *uint32, x0, x1, step float64) {
	for x := x0; x <= x1+1e-9; x += step {
		h.clock.Advance(500 * time.Millisecond)
		*seq++
		h.svc.RelayMotion(p.c, motionFrame(*seq, x, 10, 0, 90))
	}
}

func eventually(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for range 500 {
		if ok() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func fuelOf(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	fuel, ok := body["fuel"].(map[string]any)
	if !ok {
		t.Fatalf("no fuel in %v", body)
	}
	return fuel
}

// Driving burns by distance, sends paced city-fuel updates, and an empty
// tank stalls the kart: it may roll 80 m, not respawn away, and its last
// level is saved (FUEL.md 2).
func TestFuelBurnsAndStalls(t *testing.T) {
	h, fuel := newFuelHarness(t, 10_000, 1_000)
	a, watcher := h.driver("甲"), h.driver("乙")
	snapshot := h.join(a, `{"type":"city-join"}`)
	you := snapshot["you"].(map[string]any)
	if got := fuelOf(t, you); got["fuelMl"] != 1000.0 || got["capacityMl"] != 10_000.0 || got["empty"] != false ||
		got["kartName"] != "爆烈 C1" || got["useMlPerKm"] != 2000.0 {
		t.Fatalf("joined tank %v", got)
	}
	var seq uint32
	h.svc.RelayMotion(a.c, motionFrame(seq, 0, 10, 0, 90)) // the first frame after a join is not charged
	h.drive(a, &seq, 10, 300, 10)                          // 300 m at 2 ml/m
	drives := ofType(a.sink.events(t), "city-fuel")
	if len(drives) == 0 || drives[len(drives)-1]["reason"] != "drive" {
		t.Fatalf("no drive updates: %v", drives)
	}
	last := fuelOf(t, drives[len(drives)-1])["fuelMl"].(float64)
	if last < 400 || last > 600 {
		t.Fatalf("last update %v ml after 300 m", last)
	}
	h.drive(a, &seq, 310, 500, 10) // the tank runs dry at 500 m
	empty := ofType(a.sink.events(t), "city-fuel")
	if len(empty) == 0 || empty[len(empty)-1]["reason"] != "empty" || fuelOf(t, empty[len(empty)-1])["empty"] != true {
		t.Fatalf("no empty event: %v", empty)
	}
	eventually(t, "the empty tank's save", func() bool {
		levels := fuel.savedLevels()
		return len(levels) > 0 && levels[len(levels)-1] == 0
	})

	// A stalled kart's road reset stays near; a spawn respawn or a far pose is refused.
	h.refused(a, `{"type":"city-respawn","spawn":"spawn-far"}`, "FUEL_EMPTY")
	h.refused(a, `{"type":"city-respawn","pose":{"x":700,"y":10,"z":0,"heading":0}}`, "FUEL_EMPTY")
	h.at(a, 520, 10, 0, 90)
	h.join(watcher, `{"type":"city-join"}`)
	h.at(watcher, 560, 10, 0, 0)
	watcher.sink.takeFrames()
	h.drive(a, &seq, 530, 590, 30) // 70 m from the reset: still coasting
	if got := len(watcher.sink.takeMotion()); got != 3 {
		t.Fatalf("watcher saw %d coasting frames, want 3", got)
	}
	h.drive(a, &seq, 620, 620, 30) // 100 m: dropped
	if got := len(watcher.sink.takeMotion()); got != 0 {
		t.Fatalf("a stalled kart past its coast was relayed (%d frames)", got)
	}
}

// Refuelling needs a standing kart inside a station; the node charges what
// it measured and passes the data service's refusals on (FUEL.md 4.2).
func TestRefuelAtStation(t *testing.T) {
	h, fuel := newFuelHarness(t, 10_000, 1_000)
	a := h.driver("甲")
	h.join(a, `{"type":"city-join"}`)
	h.refused(a, `{"type":"city-refuel","requestId":"r0"}`, "NOT_AT_STATION")

	h.at(a, 95, 10, 0, 90)
	var seq uint32
	h.svc.RelayMotion(a.c, motionFrame(seq, 95, 10, 0, 90))
	h.drive(a, &seq, 100, 105, 5) // 10 m/s through the station
	h.refused(a, `{"type":"city-refuel","requestId":"r0"}`, "KART_MOVING")
	h.clock.Advance(2 * time.Second) // standing

	fuel.refuseErr = apierr.New(http.StatusConflict, "INSUFFICIENT_FUNDS")
	h.refused(a, `{"type":"city-refuel","requestId":"r1"}`, "INSUFFICIENT_FUNDS")
	fuel.refuseErr = errors.New("connection refused")
	h.refused(a, `{"type":"city-refuel","requestId":"r2"}`, "DATA_SERVICE_UNAVAILABLE")
	fuel.refuseErr = nil

	h.clock.Advance(2 * time.Second)
	reply := h.must(a, `{"type":"city-refuel","requestId":"r3","addMl":2000}`)
	tank := fuelOf(t, reply)
	level := tank["fuelMl"].(float64)
	if reply["station"] != "fuel-a" || reply["addedMl"] != 2000.0 || reply["cost"] != 10.0 || tank["lucci"] != 9990.0 ||
		level < 2970 || level > 3000 {
		t.Fatalf("refuel reply %v", reply)
	}
	request := fuel.refuels[len(fuel.refuels)-1]
	if request.RequestID != "r3" || request.KartKey != "item:1" || request.AddML != 2000 || request.Rev != 0 ||
		request.FuelML < 970 || request.FuelML > 1000 {
		t.Fatalf("refuel request %+v", request)
	}
	h.clock.Advance(2 * time.Second)
	full := fuelOf(t, h.must(a, `{"type":"city-refuel","requestId":"r4"}`))
	if full["fuelMl"] != 10_000.0 {
		t.Fatalf("fill up %v", full)
	}
	h.clock.Advance(2 * time.Second)
	h.refused(a, `{"type":"city-refuel","requestId":"r5"}`, "TANK_FULL")
}

// Less room than the 0.1 L the client shows is a full tank too: no 1 金币
// refill of a few millilitres.
func TestRefuelNearlyFullTank(t *testing.T) {
	h, fuel := newFuelHarness(t, 10_000, 9_950)
	a := h.driver("甲")
	h.join(a, `{"type":"city-join"}`)
	h.at(a, 100, 10, 0, 90)
	h.clock.Advance(2 * time.Second)
	h.refused(a, `{"type":"city-refuel","requestId":"r1"}`, "TANK_FULL")
	if len(fuel.refuels) != 0 {
		t.Fatalf("the data service was asked: %+v", fuel.refuels)
	}
}

// An empty tank starts at the station nearest the spawn; a rescue tows a
// stalled kart to the nearest station and the members around see it go
// (FUEL.md 4.3).
func TestRescueTowsToNearestStation(t *testing.T) {
	h, fuel := newFuelHarness(t, 10_000, 0)
	a, near := h.driver("甲"), h.driver("乙")
	snapshot := h.join(a, `{"type":"city-join"}`)
	spawn := snapshot["you"].(map[string]any)["spawn"].(map[string]any)
	if spawn["x"] != 100.0 || spawn["z"] != 0.0 || spawn["heading"] != 90.0 {
		t.Fatalf("empty tank spawned at %v, want fuel-a's park", spawn)
	}
	// Reset 60 m back up the road, then call the rescue.
	h.at(a, 40, 10, 0, 90)
	h.join(near, `{"type":"city-join"}`)
	h.at(near, 50, 10, 0, 0)
	near.sink.events(t)
	reply := h.must(a, `{"type":"city-rescue","requestId":"tow1"}`)
	pose := reply["pose"].(map[string]any)
	if reply["station"] != "fuel-a" || reply["stationName"] != "甲加油站" || reply["cost"] != 300.0 ||
		pose["x"] != 100.0 || pose["heading"] != 90.0 || fuelOf(t, reply)["lucci"] != 9700.0 {
		t.Fatalf("rescue reply %v", reply)
	}
	if moved := ofType(near.sink.events(t), "city-respawn"); len(moved) != 1 {
		t.Fatalf("the member nearby saw %d respawns", len(moved))
	}
	if len(fuel.rescues) != 1 || fuel.rescues[0].RequestID != "tow1" || fuel.rescues[0].FuelML != 0 {
		t.Fatalf("rescue requests %+v", fuel.rescues)
	}
	// Refuelled, the tank is no longer empty and a rescue is refused.
	h.clock.Advance(2 * time.Second)
	h.must(a, `{"type":"city-refuel","requestId":"r1","addMl":500}`)
	h.clock.Advance(2 * time.Second)
	h.refused(a, `{"type":"city-rescue","requestId":"tow2"}`, "TANK_NOT_EMPTY")
}

// The tank is saved every 30 s while it burns and once more on leaving.
func TestFuelSavedPeriodicallyAndOnLeave(t *testing.T) {
	h, fuel := newFuelHarness(t, 10_000, 5_000)
	a := h.driver("甲")
	h.join(a, `{"type":"city-join"}`)
	var seq uint32
	h.svc.RelayMotion(a.c, motionFrame(seq, 0, 10, 0, 90))
	h.drive(a, &seq, 10, 100, 10) // 200 ml
	if levels := fuel.savedLevels(); len(levels) != 0 {
		t.Fatalf("saved early: %v", levels)
	}
	h.clock.Advance(31 * time.Second)
	eventually(t, "the periodic save", func() bool { return len(fuel.savedLevels()) == 1 })
	if levels := fuel.savedLevels(); levels[0] != 4_800 {
		t.Fatalf("periodic save %v", levels)
	}
	h.drive(a, &seq, 110, 150, 10) // 100 ml more
	h.must(a, `{"type":"city-leave"}`)
	eventually(t, "the leave save", func() bool { return len(fuel.savedLevels()) == 2 })
	fuel.mu.Lock()
	last := fuel.saves[1]
	fuel.mu.Unlock()
	if last.FuelML != 4_700 || last.Rev != 1 {
		t.Fatalf("leave save %+v", last)
	}
}

// With fuel off (or no account) the city drives without a tank.
func TestFuelOff(t *testing.T) {
	h, fuel := newFuelHarness(t, 10_000, 5_000)
	fuel.state.Enabled = false
	a := h.driver("甲")
	snapshot := h.join(a, `{"type":"city-join"}`)
	if _, ok := snapshot["you"].(map[string]any)["fuel"]; ok {
		t.Fatalf("a tank while fuel is off: %v", snapshot["you"])
	}
	h.refused(a, `{"type":"city-refuel","requestId":"r"}`, "CITY_FUEL_OFF")
	fuel.state.Enabled = true
	guest := h.player("游客") // no account
	if _, ok := h.join(guest, `{"type":"city-join"}`)["you"].(map[string]any)["fuel"]; ok {
		t.Fatal("a member without an account has a tank")
	}

}

func TestStationZone(t *testing.T) {
	m := fuelMap(t)
	if len(m.Stations) != 2 || m.Stations[0].Name != "甲加油站" || m.Stations[1].Park.Heading != 180 {
		t.Fatalf("stations %+v", m.Stations)
	}
	for _, c := range []struct {
		x, z float64
		want string
	}{{100, 0, "fuel-a"}, {111, 0, "fuel-a"}, {112, 0, ""}, {2000, 9, "fuel-b"}, {500, 0, ""}} {
		got := ""
		if s := m.StationAt(c.x, c.z); s != nil {
			got = s.ID
		}
		if got != c.want {
			t.Errorf("StationAt(%g, %g) = %q, want %q", c.x, c.z, got, c.want)
		}
	}
	if s := m.NearestStation(1200, 0); s == nil || s.ID != "fuel-b" {
		t.Fatalf("nearest to 1200: %+v", s)
	}
	if _, err := Load([]byte(`{"pois":[{"id":"spawn-main","kind":"spawn","at":[0,0]},
		{"id":"f","kind":"fuel","at":[0,0],"zone":[[0,0],[1,0],[1,1]],"park":{"at":[50,50]}}]}`)); err == nil {
		t.Fatal("a station parking outside its zone loaded")
	}
}

// A member that leaves while a periodic save is still running gets one
// more save with what it burnt after that save's snapshot.
func TestFuelLeaveDuringSave(t *testing.T) {
	h, fuel := newFuelHarness(t, 10_000, 5_000)
	fuel.hold = make(chan struct{})
	a := h.driver("甲")
	h.join(a, `{"type":"city-join"}`)
	var seq uint32
	h.svc.RelayMotion(a.c, motionFrame(seq, 0, 10, 0, 90))
	h.drive(a, &seq, 10, 100, 10) // 200 ml
	h.clock.Advance(31 * time.Second)
	eventually(t, "the periodic save to start", func() bool { return len(fuel.savedLevels()) == 1 })
	h.drive(a, &seq, 110, 150, 10) // 100 ml more while it waits
	h.must(a, `{"type":"city-leave"}`)
	close(fuel.hold)
	eventually(t, "the last save", func() bool {
		levels := fuel.savedLevels()
		return len(levels) == 2 && levels[1] == 4_700
	})
	fuel.mu.Lock()
	defer fuel.mu.Unlock()
	if fuel.saves[0].FuelML != 4_800 || fuel.saves[1].Rev != 1 {
		t.Fatalf("saves %+v", fuel.saves)
	}
}
