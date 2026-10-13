package city

import (
	"encoding/json"
	"math"
	"net/http"
	"strconv"

	"kartsim/internal/game/lobby"
)

// 下车步行 (CITY.md 7): every member brings one kart, its vehicle, into the
// city and starts in its driver's seat. E gets out (city-exit): the kart
// stays where it stopped, everyone sees it parked, and the member walks.
// E next to a kart gets in (city-enter): an empty one is driven away (its
// owner's, or anyone's while its owner has not locked it, city-lock), one
// someone drives takes a passenger on its back seat. Driving someone else's
// kart burns its owner's tank. When the owner leaves the city its kart goes
// with it: whoever is in it is put down on foot.

// Seats of a member (member.seat).
const (
	SeatDriver    = "driver"
	SeatPassenger = "passenger"
	SeatFoot      = "foot"
)

// Seat changes: a few per second (E pressed, a lock toggled).
const (
	seatRate, seatBurst = 2.0, 4
	// enterReach is how far (m, ground plane) a member on foot may be from
	// a kart to get in; exitReach how far from it it may get out.
	enterReach = 5.0
	exitReach  = 8.0
	// sideStep is where a member is put down beside a kart (m, to its left
	// for the driver, to its right for the passenger): about a half-size
	// kart's width.
	sideStep = 1.4
)

// vehicle is a member's kart in the line. Its id is its owner's member id.
type vehicle struct {
	id        uint16
	owner     *member
	equipment json.RawMessage
	// pose is where it is: its driver's last pose while driven.
	pose   Pose
	locked bool
	// driver and passenger are who sit in it (nil: empty seat).
	driver, passenger *member
	// tank is the owner's fuel for this kart (nil: fuel off).
	tank *tank
}

func (v *vehicle) object() lobby.Object {
	seat := func(m *member) int {
		if m == nil {
			return 0
		}
		return int(m.id)
	}
	return lobby.Object{lobby.F("id", int(v.id)), lobby.F("owner", int(v.owner.id)), lobby.F("playerId", v.owner.playerID),
		lobby.F("ownerName", v.owner.name), lobby.F("equipment", v.equipment), lobby.F("pose", v.pose.object()),
		lobby.F("locked", v.locked), lobby.F("driver", seat(v.driver)), lobby.F("passenger", seat(v.passenger))}
}

// drivenTank is the tank of the kart m drives, nil on foot, as a passenger
// or with fuel off.
func (m *member) drivenTank() *tank {
	if m.seat != SeatDriver || m.vehicle == nil {
		return nil
	}
	return m.vehicle.tank
}

// vehicleEvent tells the line (but except) a kart changed.
func (inst *instance) vehicleEvent(v *vehicle, except *member) {
	inst.broadcast(lobby.Encode(lobby.Object{lobby.F("type", "city-vehicle"), lobby.F("instanceId", inst.id),
		lobby.F("vehicle", v.object())}), except)
}

// seatEvent tells the line where a member sits now; reason names a seat
// change the member did not ask for ("recalled": the owner took the kart
// away; "dropped": the driver got out).
func (inst *instance) seatEvent(m *member, reason string) {
	vehicleID := 0
	if m.vehicle != nil {
		vehicleID = int(m.vehicle.id)
	}
	fields := lobby.Object{lobby.F("type", "city-seat"), lobby.F("instanceId", inst.id), lobby.F("id", int(m.id)),
		lobby.F("playerId", m.playerID), lobby.F("seat", m.seat), lobby.F("vehicle", vehicleID),
		lobby.F("pose", m.pose.object())}
	if reason != "" {
		fields = append(fields, lobby.F("reason", reason))
	}
	inst.broadcast(lobby.Encode(fields), nil)
}

// beside is a pose next to a kart: sign -1 its left, +1 its right.
func beside(p Pose, sign float64) Pose {
	// Heading 0 is north (-z), clockwise: the right of the kart is (cos h, sin h).
	h := p.Heading * math.Pi / 180
	return Pose{X: p.X + sign*sideStep*math.Cos(h), Y: p.Y, Z: p.Z + sign*sideStep*math.Sin(h), Heading: p.Heading}
}

// footLocked puts m down on foot at pose.
func (inst *instance) footLocked(m *member, pose Pose, now int64, reason string) {
	m.seat, m.vehicle = SeatFoot, nil
	inst.moveLocked(m, pose, now)
	inst.seatEvent(m, reason)
}

// carryLocked moves a kart's passenger with it (driver frames, tows).
func (inst *instance) carryLocked(v *vehicle, pose Pose, now int64) {
	v.pose = pose
	if p := v.passenger; p != nil {
		p.pose, p.posed, p.lastMotion = pose, true, now
		p.cell = inst.grid.move(p)
	}
}

// parsePose reads a pose field ({x,y,z,heading}).
func parsePose(in lobby.Request, name string) (Pose, error) {
	fields, ok := in.Object(name)
	if !ok {
		return Pose{}, lobby.Invalid(name)
	}
	values := [4]float64{}
	for i, key := range []string{"x", "y", "z", "heading"} {
		value, ok := fields.Number(key)
		if !ok || math.IsNaN(value) || math.IsInf(value, 0) || math.Abs(value) > maxCoordinate {
			return Pose{}, lobby.Invalid(name)
		}
		values[i] = value
	}
	return Pose{X: values[0], Y: values[1], Z: values[2], Heading: normalizeHeading(values[3])}, nil
}

// exit is city-exit {pose?}: the member gets out where it sits. A driver
// leaves the kart parked where it stopped (and puts its passenger down);
// pose is where the member stands, within exitReach of the kart (default:
// beside it).
func (inst *instance) exit(m *member, in lobby.Request, now int64) (lobby.Reply, error) {
	v := m.vehicle
	if m.seat == SeatFoot || v == nil {
		return lobby.Reply{}, fail(http.StatusConflict, "NOT_IN_KART")
	}
	side := -1.0
	if m.seat == SeatPassenger {
		side = 1
	}
	if m.seat == SeatDriver {
		v.pose = m.pose
	}
	pose := beside(v.pose, side)
	if in.HasNonNull("pose") {
		asked, err := parsePose(in, "pose")
		if err != nil {
			return lobby.Reply{}, err
		}
		if horizontal(asked, v.pose) > exitReach {
			return lobby.Reply{}, fail(http.StatusConflict, "TOO_FAR")
		}
		pose = asked
	}
	if !m.seats.allow(now) {
		return lobby.Reply{}, errRateLimited()
	}
	if m.seat == SeatDriver {
		v.driver = nil
		if p := v.passenger; p != nil {
			v.passenger = nil
			inst.footLocked(p, beside(v.pose, 1), now, "dropped")
		}
	} else {
		v.passenger = nil
	}
	inst.footLocked(m, pose, now, "")
	inst.vehicleEvent(v, nil)
	return lobby.NewReply(lobby.Object{lobby.F("type", "city-seat"), lobby.F("seat", SeatFoot),
		lobby.F("pose", pose.object()), lobby.F("vehicle", v.object())}), nil
}

// enter is city-enter {vehicle}: a member on foot gets into the kart with
// that id within enterReach: the driver's seat when it is empty, else the
// back seat. A locked kart takes nobody but its owner.
func (inst *instance) enter(m *member, in lobby.Request, now int64) (lobby.Reply, error) {
	if m.seat != SeatFoot {
		return lobby.Reply{}, fail(http.StatusConflict, "ALREADY_IN_KART")
	}
	id, err := in.Integer("vehicle", 1, math.MaxUint16)
	if err != nil {
		return lobby.Reply{}, err
	}
	v := inst.vehicles[uint16(id)]
	switch {
	case v == nil:
		return lobby.Reply{}, fail(http.StatusNotFound, "VEHICLE_NOT_FOUND")
	case horizontal(m.pose, v.pose) > enterReach:
		return lobby.Reply{}, fail(http.StatusConflict, "TOO_FAR")
	case v.locked && v.owner != m:
		return lobby.Reply{}, fail(http.StatusConflict, "VEHICLE_LOCKED")
	case v.driver != nil && v.passenger != nil:
		return lobby.Reply{}, fail(http.StatusConflict, "VEHICLE_FULL")
	}
	if !m.seats.allow(now) {
		return lobby.Reply{}, errRateLimited()
	}
	reply := lobby.Object{lobby.F("type", "city-seat")}
	if v.driver == nil {
		v.driver, m.seat, m.vehicle = m, SeatDriver, v
		inst.moveLocked(m, v.pose, now)
		if t := v.tank; t != nil {
			t.stall = v.pose
			t.sentFuel, t.sentAt = t.fuel, now
			reply = append(reply, lobby.F("fuel", t.object(m.lucci)))
		}
	} else {
		v.passenger, m.seat, m.vehicle = m, SeatPassenger, v
		inst.moveLocked(m, v.pose, now)
	}
	inst.seatEvent(m, "")
	inst.vehicleEvent(v, nil)
	return lobby.NewReply(append(reply, lobby.F("seat", m.seat), lobby.F("pose", m.pose.object()),
		lobby.F("vehicle", v.object()))), nil
}

// lock is city-lock {locked}: the owner locks or unlocks its kart. Whoever
// sits in it stays; a locked kart takes nobody else in.
func (inst *instance) lock(m *member, in lobby.Request, now int64) (lobby.Reply, error) {
	locked, err := in.Bool("locked")
	if err != nil {
		return lobby.Reply{}, err
	}
	if !m.seats.allow(now) {
		return lobby.Reply{}, errRateLimited()
	}
	v := m.own
	if v.locked != locked {
		v.locked = locked
		inst.vehicleEvent(v, nil)
	}
	return lobby.NewReply(lobby.Object{lobby.F("type", "city-vehicle"), lobby.F("vehicle", v.object())}), nil
}

// releaseLocked takes a leaving member out of the karts: the kart it drove
// parks where it is, its own kart leaves with it (whoever is in it is put
// down on foot) and its tanks are saved.
func (inst *instance) releaseLocked(m *member, now int64) {
	if v := m.vehicle; v != nil && v != m.own {
		if m.seat == SeatDriver {
			v.driver = nil
			v.pose = m.pose
			if p := v.passenger; p != nil {
				v.passenger = nil
				inst.footLocked(p, beside(v.pose, 1), now, "dropped")
			}
		} else if v.passenger == m {
			v.passenger = nil
		}
		inst.vehicleEvent(v, nil)
	}
	m.seat, m.vehicle = SeatFoot, nil
	own := m.own
	if own == nil {
		return
	}
	if d := own.driver; d != nil && d != m {
		own.driver = nil
		inst.footLocked(d, beside(own.pose, -1), now, "recalled")
	}
	if p := own.passenger; p != nil && p != m {
		own.passenger = nil
		inst.footLocked(p, beside(own.pose, 1), now, "recalled")
	}
	delete(inst.vehicles, own.id)
	inst.broadcast(lobby.Encode(lobby.Object{lobby.F("type", "city-vehicle-gone"), lobby.F("instanceId", inst.id),
		lobby.F("id", int(own.id))}), m)
	for _, t := range m.tanks {
		t.left = true
		inst.queueSave(t) // what it burnt since the last save
	}
}

// kartKeyOf is the data service's name of the kart an equipment document
// drives (contract.CityFuel.KartKey): "item:<itemId>" or
// "system:<systemKart>"; "" when it names none.
func kartKeyOf(equipment json.RawMessage) string {
	var doc struct {
		ItemIDs    map[string]int `json:"itemIds"`
		SystemKart string         `json:"systemKart"`
	}
	if json.Unmarshal(equipment, &doc) != nil {
		return ""
	}
	kart, ok := doc.ItemIDs["3"]
	switch {
	case !ok:
		return ""
	case kart > 0:
		return "item:" + strconv.Itoa(kart)
	default:
		return "system:" + doc.SystemKart
	}
}
