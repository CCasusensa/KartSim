package city

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"sync"
	"time"

	"kartsim/internal/game/lobby"
	"kartsim/internal/shared/apierr"
	"kartsim/internal/shared/contract"
)

// 卡丁城加油 (FUEL.md): the node burns a member's tank by the distance its
// accepted motion frames cover, refuels it at a gas station and tows a
// stalled kart to the nearest station; the data service keeps the tanks and
// charges the 金币 (contract.PathCityFuel*). Calls to the data service run
// on the member's connection goroutine or a short-lived goroutine, never
// under the line lock: a tank's calls lock first, then the line.

// Fuel is the data service as the gas stations see it (cluster.CityFuel).
type Fuel interface {
	State(ctx context.Context, accountID string, equipment json.RawMessage) (contract.CityFuel, error)
	Save(ctx context.Context, request contract.CityFuelSaveRequest) (contract.CityFuelSaveResponse, error)
	Refuel(ctx context.Context, request contract.CityFuelRefuelRequest) (contract.CityFuelCharge, error)
	Rescue(ctx context.Context, request contract.CityFuelRescueRequest) (contract.CityFuelCharge, error)
}

const (
	// fuelCallTimeout bounds one data service call.
	fuelCallTimeout = 5 * time.Second
	// fuelSaveMs is how often a tank that burnt fuel is stored.
	fuelSaveMs = 30_000
	// fuelEventMs and fuelEventML pace the city-fuel updates while driving:
	// at most every 2 s, once 0.1 L has burnt.
	fuelEventMs = 2_000
	fuelEventML = 100
	// emptyCoast is how far (m, ground plane) a stalled kart may still roll
	// from where its tank ran dry; frames beyond it are dropped.
	emptyCoast = 80.0
	// emptyRespawn is how far a stalled kart's road reset may move it.
	emptyRespawn = 150.0
	// refuelSpeed is the fastest a kart may move and still refuel (m/s).
	refuelSpeed = 2.5
	// fullSlackML: a tank with less room than this (the 0.1 L the client
	// shows) is full; refuelling it is refused.
	fullSlackML = 100
	// stillMs: no motion frame for this long and the kart is standing.
	stillMs = 1_000
	// fuelWaitMs bounds how long Close waits for the last saves.
	fuelWaitMs = 3_000
)

// tank is a member's fuel. Every field but calls is guarded by the line
// lock; calls serializes the member's data service calls.
type tank struct {
	calls sync.Mutex
	// pending counts the saves queued for this tank (a member that changes
	// lines waits for them before the new line loads its tank).
	pending sync.WaitGroup

	accountID string
	kartKey   string
	kartName  string
	sizeClass string
	capacity  int64
	fuel      float64 // ml, as measured
	rev       int64
	saved     int64 // what the data service holds at rev
	savedAt   int64
	usePerM   float64 // ml per metre driven
	price     int64
	rescueFee int64
	// lucci is the owner's 金币 when the tank was loaded (the member's
	// balance, member.lucci, is what the browser shows).
	lucci int64
	// stall is where an empty tank stopped the kart (or a tow or reset put
	// it since).
	stall Pose
	// sentFuel/sentAt: the last city-fuel update.
	sentFuel float64
	sentAt   int64
	// saving: a save is queued or running; busy: a refuel or rescue;
	// left: the member left its line (the tank is saved until it holds
	// the last level).
	saving, busy, left bool
}

func newTank(accountID string, state contract.CityFuel) *tank {
	return &tank{accountID: accountID, kartKey: state.KartKey, kartName: state.KartName, sizeClass: state.SizeClass,
		capacity: state.CapacityML, fuel: float64(min(max(state.FuelML, 0), state.CapacityML)), rev: state.Rev,
		saved: state.FuelML, usePerM: float64(state.UseMLPerKm) / 1000, price: state.PricePerLiter,
		rescueFee: state.RescueFee, lucci: state.Lucci, sentFuel: float64(state.FuelML)}
}

// level is the fuel as stored and shown: whole ml, rounded up so a drop
// still left is not reported as empty.
func (t *tank) level() int64 { return int64(math.Ceil(t.fuel)) }

func (t *tank) empty() bool { return t.fuel <= 0 }

// object is the tank as its driver sees it, with the driver's 金币.
func (t *tank) object(lucci int64) lobby.Object {
	return lobby.Object{lobby.F("kartName", t.kartName), lobby.F("sizeClass", t.sizeClass),
		lobby.F("capacityMl", t.capacity), lobby.F("fuelMl", t.level()), lobby.F("useMlPerKm", int64(math.Round(t.usePerM*1000))),
		lobby.F("pricePerLiter", t.price), lobby.F("rescueFee", t.rescueFee), lobby.F("lucci", lucci),
		lobby.F("empty", t.empty())}
}

// adopt takes the data service's tank when a call found another revision.
func (t *tank) adopt(fuelML, rev int64) {
	t.fuel, t.rev, t.saved = float64(min(max(fuelML, 0), t.capacity)), rev, fuelML
}

// loadTank asks the data service for the tank a joining member drives;
// nil when fuel is off, the member has no account or the call fails (the
// member then drives without fuel).
func (s *Service) loadTank(profile lobby.Profile) *tank {
	if s.fuel == nil || profile.AccountID == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), fuelCallTimeout)
	defer cancel()
	state, err := s.fuel.State(ctx, profile.AccountID, profile.Equipment)
	if err != nil {
		s.log.Warn("city fuel state", "player", profile.PlayerID, "error", err)
		return nil
	}
	if !state.Enabled || state.CapacityML <= 0 || state.KartKey == "" {
		return nil
	}
	return newTank(profile.AccountID, state)
}

// fuelEvent tells the driver of a kart its tank changed.
func (inst *instance) fuelEvent(m *member, t *tank, reason string, now int64) {
	t.sentFuel, t.sentAt = t.fuel, now
	m.c.Text(lobby.Encode(lobby.Object{lobby.F("type", "city-fuel"), lobby.F("instanceId", inst.id),
		lobby.F("reason", reason), lobby.F("fuel", t.object(m.lucci))}))
}

// burn charges the tank of the kart m drives for moving from m.pose to
// pose (FUEL.md 2.1). It reports false for a stalled kart that rolled past
// emptyCoast: that frame is dropped.
func (inst *instance) burn(m *member, t *tank, pose Pose, now int64) bool {
	if t.empty() {
		return horizontal(pose, t.stall) <= emptyCoast
	}
	dx, dy, dz := pose.X-m.pose.X, pose.Y-m.pose.Y, pose.Z-m.pose.Z
	t.fuel = max(0, t.fuel-math.Sqrt(dx*dx+dy*dy+dz*dz)*t.usePerM)
	switch {
	case t.empty():
		t.fuel, t.stall = 0, pose
		inst.fuelEvent(m, t, "empty", now)
		inst.queueSave(t)
	case now-t.sentAt >= fuelEventMs && t.sentFuel-t.fuel >= fuelEventML:
		inst.fuelEvent(m, t, "drive", now)
	}
	return true
}

// queueSave stores the tank in the background unless a save is queued.
func (inst *instance) queueSave(t *tank) {
	if t.saving || t.level() == t.saved {
		return
	}
	t.saving = true
	inst.svc.saves.Add(1)
	t.pending.Add(1)
	go inst.save(t)
}

// save stores the tank's level at its revision (FUEL.md 3.2).
func (inst *instance) save(t *tank) {
	defer inst.svc.saves.Done()
	defer t.pending.Done()
	t.calls.Lock()
	defer t.calls.Unlock()
	inst.mu.Lock()
	request := contract.CityFuelSaveRequest{AccountID: t.accountID, KartKey: t.kartKey, FuelML: t.level(), Rev: t.rev}
	if request.FuelML == t.saved {
		t.saving = false
		inst.mu.Unlock()
		return
	}
	inst.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), fuelCallTimeout)
	defer cancel()
	response, err := inst.svc.fuel.Save(ctx, request)
	inst.mu.Lock()
	defer inst.mu.Unlock()
	t.saving = false
	t.savedAt = inst.svc.clock.Now()
	if err != nil {
		inst.svc.log.Warn("city fuel save", "account", t.accountID, "kart", t.kartKey, "error", err)
		return
	}
	if response.Applied {
		t.rev, t.saved = response.Rev, request.FuelML
	} else {
		// Someone else wrote the tank: theirs wins.
		t.adopt(response.FuelML, response.Rev)
	}
	// A member that left while this save ran burnt more since its snapshot.
	if t.left {
		inst.queueSave(t)
	}
}

// saveDue queues the periodic saves (the 1 Hz tick).
func (inst *instance) saveDue(now int64) {
	for _, m := range inst.members {
		for _, t := range m.tanks {
			if !t.busy && now-t.savedAt >= fuelSaveMs {
				inst.queueSave(t)
			}
		}
	}
}

// moving reports whether the member's kart is still rolling.
func (inst *instance) moving(m *member, now int64) bool {
	return m.speed > refuelSpeed && now-m.lastFrame < stillMs
}

// fuelCall prepares a refuel or rescue under the line lock: the member,
// its tank, not busy. The caller sets busy and unlocks.
func (inst *instance) fuelMember(c *lobby.Client) (*member, error) {
	m := inst.members[c]
	if m == nil {
		return nil, errNotInCity()
	}
	if m.seat != SeatDriver {
		return nil, fail(http.StatusConflict, "NOT_DRIVING")
	}
	t := m.drivenTank()
	if t == nil {
		return nil, fail(http.StatusForbidden, "CITY_FUEL_OFF")
	}
	if t.busy {
		return nil, fail(http.StatusTooManyRequests, "FUEL_BUSY")
	}
	return m, nil
}

// refuel is city-refuel {addMl?, requestId}: buys fuel for a kart standing
// at a gas station (FUEL.md 4.2); addMl 0 or absent fills the tank.
func (inst *instance) refuel(c *lobby.Client, in lobby.Request) (lobby.Reply, error) {
	requestID, err := in.Text("requestId", 1, 64)
	if err != nil {
		return lobby.Reply{}, err
	}
	var addML int64
	if in.HasNonNull("addMl") {
		value, err := in.Integer("addMl", 0, 1_000_000)
		if err != nil {
			return lobby.Reply{}, err
		}
		addML = int64(value)
	}
	inst.mu.Lock()
	m, err := inst.fuelMember(c)
	if err != nil {
		inst.mu.Unlock()
		return lobby.Reply{}, err
	}
	t, now := m.drivenTank(), inst.svc.clock.Now()
	station := inst.svc.cityMap.StationAt(m.pose.X, m.pose.Z)
	switch {
	case station == nil:
		err = fail(http.StatusConflict, "NOT_AT_STATION")
	case inst.moving(m, now):
		err = fail(http.StatusConflict, "KART_MOVING")
	case t.capacity-t.level() < fullSlackML:
		err = fail(http.StatusConflict, "TANK_FULL")
	case !m.fuelCalls.allow(now):
		err = errRateLimited()
	}
	if err != nil {
		inst.mu.Unlock()
		return lobby.Reply{}, err
	}
	t.busy = true
	inst.mu.Unlock()

	t.calls.Lock()
	inst.mu.Lock()
	request := contract.CityFuelRefuelRequest{AccountID: m.accountID, TankAccountID: t.accountID, KartKey: t.kartKey,
		RequestID: requestID, FuelML: t.level(), Rev: t.rev, AddML: addML}
	inst.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), fuelCallTimeout)
	charge, err := inst.svc.fuel.Refuel(ctx, request)
	cancel()
	t.calls.Unlock()

	inst.mu.Lock()
	defer inst.mu.Unlock()
	t.busy = false
	if err != nil {
		return lobby.Reply{}, dataRefusal(err)
	}
	now = inst.svc.clock.Now()
	m.lucci = charge.Lucci
	if charge.Stale {
		t.adopt(charge.FuelML, charge.Rev)
	} else {
		// What the kart burnt while the call ran (normally nothing).
		burnt := max(0, float64(request.FuelML)-t.fuel)
		t.fuel = max(0, float64(charge.FuelML)-burnt)
		t.rev, t.saved = charge.Rev, charge.FuelML
		inst.svc.log.Info("city refuel", "line", inst.line, "player", m.playerID, "station", station.ID,
			"addedMl", charge.AddedML, "cost", charge.Cost)
	}
	t.sentFuel, t.sentAt = t.fuel, now
	return lobby.NewReply(lobby.Object{lobby.F("type", "city-refuel"), lobby.F("station", station.ID),
		lobby.F("addedMl", charge.AddedML), lobby.F("cost", charge.Cost), lobby.F("stale", charge.Stale),
		lobby.F("fuel", t.object(m.lucci))}), nil
}

// rescue is city-rescue {requestId}: a stalled kart pays the tow (free
// when the wallet holds less) and is put at the nearest station's park
// pose (FUEL.md 4.3).
func (inst *instance) rescue(c *lobby.Client, in lobby.Request) (lobby.Reply, error) {
	requestID, err := in.Text("requestId", 1, 64)
	if err != nil {
		return lobby.Reply{}, err
	}
	inst.mu.Lock()
	m, err := inst.fuelMember(c)
	if err != nil {
		inst.mu.Unlock()
		return lobby.Reply{}, err
	}
	t, now := m.drivenTank(), inst.svc.clock.Now()
	station := inst.svc.cityMap.NearestStation(m.pose.X, m.pose.Z)
	switch {
	case !t.empty():
		err = fail(http.StatusConflict, "TANK_NOT_EMPTY")
	case station == nil:
		err = fail(http.StatusConflict, "NO_STATION")
	case !m.fuelCalls.allow(now):
		err = errRateLimited()
	}
	if err != nil {
		inst.mu.Unlock()
		return lobby.Reply{}, err
	}
	t.busy = true
	inst.mu.Unlock()

	t.calls.Lock()
	inst.mu.Lock()
	request := contract.CityFuelRescueRequest{AccountID: m.accountID, TankAccountID: t.accountID, KartKey: t.kartKey,
		RequestID: requestID, FuelML: t.level(), Rev: t.rev}
	inst.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), fuelCallTimeout)
	charge, err := inst.svc.fuel.Rescue(ctx, request)
	cancel()
	t.calls.Unlock()

	inst.mu.Lock()
	defer inst.mu.Unlock()
	t.busy = false
	if err != nil {
		return lobby.Reply{}, dataRefusal(err)
	}
	now = inst.svc.clock.Now()
	m.lucci = charge.Lucci
	if charge.Stale {
		t.adopt(charge.FuelML, charge.Rev)
		t.sentFuel, t.sentAt = t.fuel, now
		return lobby.NewReply(lobby.Object{lobby.F("type", "city-rescue"), lobby.F("stale", true),
			lobby.F("fuel", t.object(m.lucci))}), nil
	}
	t.rev, t.saved = charge.Rev, charge.FuelML
	pose := Pose{X: station.Park.X, Y: station.Park.Y, Z: station.Park.Z, Heading: station.Park.Heading}
	if inst.members[c] == m {
		inst.moveLocked(m, pose, now)
	}
	t.stall = pose
	t.sentFuel, t.sentAt = t.fuel, now
	inst.svc.log.Info("city rescue", "line", inst.line, "player", m.playerID, "station", station.ID,
		"cost", charge.Cost, "free", charge.Free)
	return lobby.NewReply(lobby.Object{lobby.F("type", "city-rescue"), lobby.F("station", station.ID),
		lobby.F("stationName", station.Name), lobby.F("pose", pose.object()), lobby.F("cost", charge.Cost),
		lobby.F("free", charge.Free), lobby.F("fuel", t.object(m.lucci))}), nil
}

// dataRefusal passes a data service refusal (INSUFFICIENT_FUNDS, TANK_FULL,
// CITY_FUEL_OFF…) on to the player and reports anything else as 503.
func dataRefusal(err error) error {
	if rejected, ok := apierr.As(err); ok && rejected.Status < 500 {
		return rejected
	}
	return fail(http.StatusServiceUnavailable, "DATA_SERVICE_UNAVAILABLE")
}

// waitSaves waits up to fuelWaitMs for the saves in flight (shutdown).
func (s *Service) waitSaves() {
	done := make(chan struct{})
	go func() {
		s.saves.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(fuelWaitMs * time.Millisecond):
		s.log.Warn("city fuel saves still running at shutdown")
	}
}
