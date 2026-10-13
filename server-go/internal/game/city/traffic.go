package city

import (
	"cmp"
	"encoding/binary"
	"math"
	"math/rand/v2"
	"slices"
	"time"
)

// NPC traffic (CITY-NPC.md): each line drives its own law-abiding cars on
// the traffic network at 10 Hz. Cars keep their lane and the speed limit,
// slow for curves, follow at a safe distance (the intelligent driver
// model), stop at red lights and stop lines, give way by the junction's
// priorities, never enter a junction they cannot leave, and stop for
// members' karts in their way; a car held up by a kart that does not move
// goes round it slowly on the left. Members within trafficSendRadius get
// the cars near them five times a second (FrameTraffic).
const (
	// FrameTraffic is the traffic packet: a 12-byte header (marker,
	// version 1, car count uint16 LE, node tick uint32 LE, the network's id
	// as uint32 LE: its first 8 hex digits) and trafficEntryLength bytes
	// per car: id uint16, path uint16, distance along the path ×16 uint16,
	// speed ×4 uint8, flags uint8, model uint8, lateral offset (left
	// positive) ×10 int8. All little endian.
	FrameTraffic        = 0xC3
	trafficVersion      = 1
	trafficHeaderLength = 12
	trafficEntryLength  = 10

	trafficStepMs     = 100
	trafficSendSteps  = 2
	trafficSendRadius = 220.0
	trafficMaxSent    = 48
)

// Car flags on the wire.
const (
	CarBrake  = 1 << 0
	CarLeft   = 1 << 1
	CarRight  = 1 << 2
	CarHazard = 1 << 3
	CarHorn   = 1 << 4
)

// Driving (m, s, m/s²).
const (
	carLength      = 1.8 // bumper to bumper, a city-size kart with its rider
	carMinGap      = 1.6 // standing gap (IDM s0)
	carHeadway     = 1.2 // time gap (IDM T)
	carAccel       = 1.6
	carComfort     = 2.4 // comfortable braking
	carEmergency   = 7.0
	yellowStop     = 3.5 // a car stops for yellow when this deceleration suffices
	stopLineMargin = 0.8
	stopHoldS      = 1.0 // a full stop at a stop line lasts this long
	lookahead      = 45.0
	yieldSeconds   = 4.0 // a lower-priority movement waits for cars this close to their line
	yieldDistance  = 22.0
	laneHalf       = 1.3 // a kart this far (plus its own half width) from the lane is in it
	kartRadius     = 0.8
	detourOffset   = 3.0 // how far left a car goes round a stopped kart
	detourSpeed    = 3.0
	detourShift    = 1.2 // lateral m/s
	detourClear    = 1.4 // m beside a kart at which a car going round may pass it
	hornSeconds    = 0.6
	detourAfter    = 4.0  // s behind a kart that does not move
	stuckHidden    = 90.0 // s without progress before a car out of sight starts again elsewhere
	stuckAlways    = 240.0
	hiddenRadius   = 170.0
	maxKartSpeed   = 80.0
)

// trafficObstacle is a member (in its kart, or walking) or a parked kart
// as the traffic sees it. Members are keyed by their id, parked karts by
// parkedKey + their id.
type trafficObstacle struct {
	id     uint32
	x, z   float64
	vx, vz float64
}

// parkedKey offsets the keys of parked karts past the member ids.
const parkedKey = 1 << 16

type trafficCar struct {
	id     uint16
	model  uint8
	path   int
	s, v   float64
	factor float64 // of the speed limit
	accel  float64
	// next is the path after this one (a lane's link, a link's lane); after
	// the lane after a lane's link.
	next, after int
	// committed: allowed into the next link (and holding it).
	committed bool
	// stopped is how long the car has stood at its stop line.
	stopped float64
	// waited is how long the car has not moved for anything but its signal.
	waited float64
	// lateral is the offset left of the lane (m) while going round a kart.
	lateral, lateralTarget float64
	detourEnd              float64
	blockedFor             float64
	honkAt                 float64
	hornLeft               float64
	flags                  uint8
}

// traffic is one line's cars.
type traffic struct {
	net    *TrafficNetwork
	cars   []*trafficCar
	random *rand.Rand
	// onPath lists the cars on each path, nearest the start first (rebuilt each step).
	onPath map[int][]*trafficCar
	// held counts the cars on or committed to each link.
	held  map[int]int
	steps int
	// laneTotal is the summed lane length (spawn weights).
	laneTotal float64
	tracks    map[uint32]kartTrack
}

// kartTrack is a member's last kart position, when it was reached and the
// speed it was reached with.
type kartTrack struct {
	x, z, vx, vz float64
	at           int64
}

func newTraffic(net *TrafficNetwork, count int, seed uint64) *traffic {
	t := &traffic{net: net, random: rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15)),
		onPath: map[int][]*trafficCar{}, held: map[int]int{}, tracks: map[uint32]kartTrack{}}
	for _, p := range net.Paths {
		if !p.Link {
			t.laneTotal += p.Length
		}
	}
	for i := 0; i < count; i++ {
		car := &trafficCar{id: uint16(i + 1), model: uint8(t.random.IntN(256)), factor: 0.85 + 0.2*t.random.Float64()}
		if !t.place(car, nil, 0) {
			break
		}
		t.cars = append(t.cars, car)
	}
	return t
}

// place puts a car at a random free spot of a lane (away from the
// obstacles, when given, by more than clear m); false when none was found.
func (t *traffic) place(car *trafficCar, away []trafficObstacle, clear float64) bool {
	for attempt := 0; attempt < 200; attempt++ {
		target := t.random.Float64() * t.laneTotal
		var lane *TrafficPath
		for _, p := range t.net.Paths {
			if p.Link {
				continue
			}
			if target < p.Length {
				lane = p
				break
			}
			target -= p.Length
		}
		if lane == nil || lane.Length < 12 {
			continue
		}
		s := 4 + t.random.Float64()*(lane.Length-12)
		free := true
		for _, other := range t.cars {
			if other != car && other.path == lane.Index && math.Abs(other.s-s) < 14 {
				free = false
				break
			}
		}
		x, z, _, _ := lane.At(s)
		for _, o := range away {
			if math.Hypot(o.x-x, o.z-z) < clear {
				free = false
				break
			}
		}
		if !free {
			continue
		}
		car.path, car.s, car.v = lane.Index, s, lane.Limit*0.6
		car.committed, car.stopped, car.waited, car.blockedFor = false, 0, 0, 0
		car.lateral, car.lateralTarget = 0, 0
		t.chooseRoute(car)
		return true
	}
	return false
}

// chooseRoute picks the link a car on a lane takes: mostly straight on.
func (t *traffic) chooseRoute(car *trafficCar) {
	lane := t.net.Paths[car.path]
	total := 0.0
	weight := func(link *TrafficPath) float64 {
		switch link.Turn {
		case 'S':
			return 3
		default:
			return 1.5
		}
	}
	for _, id := range lane.Next {
		total += weight(t.net.Paths[id])
	}
	pick := t.random.Float64() * total
	car.next = lane.Next[len(lane.Next)-1]
	for _, id := range lane.Next {
		if pick < weight(t.net.Paths[id]) {
			car.next = id
			break
		}
		pick -= weight(t.net.Paths[id])
	}
	car.after = t.net.Paths[car.next].Next[0]
}

// index rebuilds the per-path lists and the link holds.
func (t *traffic) index() {
	clear(t.onPath)
	clear(t.held)
	for _, car := range t.cars {
		t.onPath[car.path] = append(t.onPath[car.path], car)
		if t.net.Paths[car.path].Link {
			t.held[car.path]++
		} else if car.committed {
			t.held[car.next]++
		}
	}
	for _, list := range t.onPath {
		slices.SortFunc(list, func(a, b *trafficCar) int { return cmp.Compare(a.s, b.s) })
	}
}

// observe records the members' karts for this step, with a speed from
// their last two different poses (0 once a kart has not moved for a second).
func (t *traffic) observe(members map[uint32]Pose, now int64) []trafficObstacle {
	out := make([]trafficObstacle, 0, len(members))
	for id, pose := range members {
		track, ok := t.tracks[id]
		switch {
		case !ok:
			track = kartTrack{x: pose.X, z: pose.Z, at: now}
		case track.x != pose.X || track.z != pose.Z:
			track.vx, track.vz = 0, 0
			if dt := float64(now-track.at) / 1000; dt > 0 {
				vx, vz := (pose.X-track.x)/dt, (pose.Z-track.z)/dt
				// Faster than any kart: a reset or respawn, not a speed.
				if math.Hypot(vx, vz) <= maxKartSpeed {
					track.vx, track.vz = vx, vz
				}
			}
			track.x, track.z, track.at = pose.X, pose.Z, now
		case now-track.at > 1000:
			track.vx, track.vz = 0, 0
		}
		t.tracks[id] = track
		out = append(out, trafficObstacle{id: id, x: track.x, z: track.z, vx: track.vx, vz: track.vz})
	}
	for id := range t.tracks {
		if _, ok := members[id]; !ok {
			delete(t.tracks, id)
		}
	}
	return out
}

// step advances every car by dt seconds at node time now.
func (t *traffic) step(now int64, dt float64, karts []trafficObstacle) {
	t.steps++
	t.index()
	for _, car := range t.cars {
		var near []trafficObstacle
		p := t.net.Paths[car.path]
		x, z, _, _ := p.At(car.s)
		for _, k := range karts {
			if math.Abs(k.x-x) < lookahead+10 && math.Abs(k.z-z) < lookahead+10 {
				near = append(near, k)
			}
		}
		t.drive(car, now, dt, near)
	}
	for _, car := range t.cars {
		t.move(car, dt)
	}
	// Cars stuck for long start again elsewhere, out of everyone's sight.
	for _, car := range t.cars {
		if car.waited < stuckHidden {
			continue
		}
		p := t.net.Paths[car.path]
		x, z, _, _ := p.At(car.s)
		seen := false
		for _, k := range karts {
			if math.Hypot(k.x-x, k.z-z) < hiddenRadius {
				seen = true
				break
			}
		}
		if !seen || car.waited >= stuckAlways {
			t.place(car, karts, hiddenRadius)
		}
	}
}

// route is the paths ahead of a car with the distance to their starts.
func (t *traffic) route(car *trafficCar) (paths [2]int, starts [2]float64, count int) {
	p := t.net.Paths[car.path]
	remaining := p.Length - car.s
	if p.Link {
		return [2]int{car.next, -1}, [2]float64{remaining, 0}, 1
	}
	link := t.net.Paths[car.next]
	return [2]int{car.next, car.after}, [2]float64{remaining, remaining + link.Length}, 2
}

// drive sets a car's acceleration for this step.
func (t *traffic) drive(car *trafficCar, now int64, dt float64, karts []trafficObstacle) {
	p := t.net.Paths[car.path]
	remaining := p.Length - car.s
	paths, starts, count := t.route(car)

	// Desired speed: the limit (the car's own share of it), the curves ahead.
	desired := p.Limit * car.factor
	desired = math.Min(desired, p.curveLimit(car.s, lookahead, carComfort, 0))
	for i := 0; i < count && starts[i] < lookahead; i++ {
		desired = math.Min(desired, t.net.Paths[paths[i]].curveLimit(0, lookahead-starts[i], carComfort, starts[i]))
	}

	// The nearest thing ahead: a car, a stop line, a kart.
	gap, leadSpeed := math.Inf(1), 0.0
	consider := func(g, v float64) {
		if g < gap {
			gap, leadSpeed = g, v
		}
	}
	list := t.onPath[car.path]
	if i := slices.Index(list, car); i >= 0 && i+1 < len(list) {
		ahead := list[i+1]
		consider(ahead.s-car.s-carLength, ahead.v)
	}
	if math.IsInf(gap, 1) {
		for i := 0; i < count && starts[i] < lookahead; i++ {
			if first := t.firstOn(paths[i]); first != nil {
				consider(starts[i]+first.s-carLength, first.v)
				break
			}
			// Cars just gone into another link of this lane share its start.
			if i == 0 && !p.Link {
				for _, sibling := range p.Next {
					if sibling == paths[0] {
						continue
					}
					if first := t.firstOn(sibling); first != nil && first.s < 6 {
						consider(starts[0]+first.s-carLength, first.v)
					}
				}
			}
		}
	}

	waitingForSignal := false
	if !p.Link && !car.committed {
		if remaining < 3 && car.v < 0.3 {
			car.stopped += dt
		} else {
			car.stopped = 0
		}
		if remaining < math.Max(25, car.v*car.v/(2*carComfort)+15) {
			allowed, signal := t.mayEnter(car, now, remaining)
			if allowed && remaining <= math.Max(3, car.v*car.v/(2*carComfort)+2) {
				car.committed = true
				t.held[car.next]++
			}
			if !car.committed {
				consider(remaining-stopLineMargin, 0)
				waitingForSignal = signal || !allowed
			}
		}
	}

	// Karts in the way (members never collide with cars; the cars stop for them).
	blocker, blockerSpeed := t.kartAhead(car, karts, &gap, &leadSpeed)
	if blocker != nil && gap < 8 && car.v < 0.5 && blockerSpeed < 0.5 {
		car.blockedFor += dt
	} else {
		car.blockedFor = 0
	}
	if car.blockedFor > detourAfter && !p.Link && car.lateralTarget == 0 {
		if along, ok := t.alongLane(p, blocker); ok && along+6 < p.Length {
			car.lateralTarget = detourOffset
			car.detourEnd = along + 6
		}
	}
	if car.lateralTarget != 0 {
		desired = math.Min(desired, detourSpeed)
		if p.Link || car.s > car.detourEnd {
			car.lateralTarget = 0
		}
	}

	// Intelligent driver model.
	v := car.v
	free := 1 - math.Pow(v/math.Max(desired, 0.1), 4)
	if desired < 0.1 {
		free = -1
	}
	interaction := 0.0
	if !math.IsInf(gap, 1) {
		want := carMinGap + v*carHeadway + v*(v-leadSpeed)/(2*math.Sqrt(carAccel*carComfort))
		g := math.Max(gap, 0.1)
		interaction = (want / g) * (want / g)
	}
	car.accel = math.Max(-carEmergency, carAccel*(free-interaction))
	if gap <= 0.05 {
		car.accel = -carEmergency
	}

	// Lights, indicators, horn.
	car.flags = 0
	if car.accel < -0.8 || car.v < 0.3 {
		car.flags |= CarBrake
	}
	turn := byte(0)
	if p.Link {
		turn = p.Turn
	} else if remaining < 35 {
		turn = t.net.Paths[car.next].Turn
	}
	switch {
	case car.lateralTarget != 0 || car.lateral > 0.2:
		car.flags |= CarLeft
	case turn == 'L':
		car.flags |= CarLeft
	case turn == 'R':
		car.flags |= CarRight
	}
	if car.blockedFor > 2 {
		car.flags |= CarHazard
		if car.blockedFor-car.honkAt > 5 || car.honkAt > car.blockedFor {
			car.honkAt = car.blockedFor
			car.hornLeft = hornSeconds
		}
	} else {
		car.honkAt = 0
	}
	// The horn sounds for a moment: long enough for a packet to carry it.
	if car.hornLeft > 0 {
		car.flags |= CarHorn
		car.hornLeft -= dt
	}
	if car.v < 0.3 && !waitingForSignal {
		car.waited += dt
	} else if car.v > 1 {
		car.waited = 0
	}
}

// headOn is the car furthest along a path (the head of its queue).
func (t *traffic) headOn(path int) *trafficCar {
	if list := t.onPath[path]; len(list) > 0 {
		return list[len(list)-1]
	}
	return nil
}

// firstOn is the car nearest a path's start (the end of its queue).
func (t *traffic) firstOn(path int) *trafficCar {
	if list := t.onPath[path]; len(list) > 0 {
		return list[0]
	}
	return nil
}

// mayEnter reports whether a car may go into its next link now, and
// whether a signal is what holds it.
func (t *traffic) mayEnter(car *trafficCar, now int64, remaining float64) (allowed, signal bool) {
	link := t.net.Paths[car.next]
	junction := t.net.Junctions[link.Junction]
	approach := junction.Approaches[link.Approach]
	switch junction.Control {
	case ControlSignal:
		aspect, _ := junction.Signal.Aspect(approach.Group, now)
		if aspect == AspectRed {
			return false, true
		}
		if aspect == AspectYellow && remaining > car.v*car.v/(2*yellowStop)+1 {
			return false, true
		}
	case ControlPriority, ControlStop:
		if link.Priority == 0 && car.stopped < stopHoldS {
			return false, false
		}
	}
	for _, c := range link.Conflicts {
		if t.held[c] > 0 {
			return false, false
		}
	}
	// Give way to the movements with priority over this one.
	for _, c := range link.Conflicts {
		other := t.net.Paths[c]
		if other.Priority <= link.Priority {
			continue
		}
		if junction.Control == ControlSignal {
			if aspect, _ := junction.Signal.Aspect(junction.Approaches[other.Approach].Group, now); aspect == AspectRed {
				continue
			}
		}
		// Only the car at the head of that lane can come: the ones behind it
		// wait for it (two waiting left turners must not wait for each other's
		// queues).
		rival := t.headOn(other.From)
		if rival == nil || rival.next != c || rival.committed {
			continue
		}
		left := t.net.Paths[other.From].Length - rival.s
		if left < yieldDistance || (rival.v > 0.5 && left/rival.v < yieldSeconds) {
			return false, false
		}
	}
	// Never block the junction: the lane after it needs room.
	if first := t.firstOn(car.after); first != nil && first.s < carLength+carMinGap+1.5 && first.v < 1 {
		return false, false
	}
	return true, false
}

// kartAhead finds the members' karts in the car's way, tightening the gap.
func (t *traffic) kartAhead(car *trafficCar, karts []trafficObstacle, gap, leadSpeed *float64) (*trafficObstacle, float64) {
	var blocker *trafficObstacle
	blockerSpeed := 0.0
	paths, starts, count := t.route(car)
	for i := range karts {
		k := &karts[i]
		along, lateral, dx, dz, ok := t.onRoute(car, k.x, k.z, paths, starts, count)
		if !ok {
			continue
		}
		// While going round, the car is lateral m left of its lane; once it
		// has steered out far enough to pass, the kart is no longer ahead.
		clear := laneHalf + kartRadius
		if car.lateralTarget != 0 {
			clear = detourClear
		}
		if math.Abs(lateral-car.lateral) > clear {
			continue
		}
		g := along - carLength/2 - kartRadius
		if g < -carLength {
			continue // already beside or behind
		}
		speed := k.vx*dx + k.vz*dz
		if g < *gap {
			*gap, *leadSpeed = g, math.Max(0, speed)
			blocker, blockerSpeed = k, math.Abs(speed)
		}
	}
	return blocker, blockerSpeed
}

// onRoute locates a point along the car's route ahead: distance from the
// car, signed lateral offset (left positive) and the route direction there.
func (t *traffic) onRoute(car *trafficCar, x, z float64, paths [2]int, starts [2]float64, count int) (along, lateral, dx, dz float64, ok bool) {
	try := func(p *TrafficPath, from, to, base float64) bool {
		s, d := p.Project(x, z, from, to)
		if d > laneHalf+kartRadius+detourOffset || s < from-0.01 || s > to+0.01 {
			return false
		}
		px, pz, ux, uz := p.At(s)
		lateral = (x-px)*uz - (z-pz)*ux
		along, dx, dz = base+s-from, ux, uz
		return true
	}
	p := t.net.Paths[car.path]
	if try(p, car.s, math.Min(p.Length, car.s+lookahead), 0) {
		return along, lateral, dx, dz, true
	}
	for i := 0; i < count && starts[i] < lookahead; i++ {
		q := t.net.Paths[paths[i]]
		if try(q, 0, math.Min(q.Length, lookahead-starts[i]), starts[i]) {
			return along, lateral, dx, dz, true
		}
	}
	return 0, 0, 0, 0, false
}

// alongLane is where on lane p a kart is (distance from the lane's start).
func (t *traffic) alongLane(p *TrafficPath, k *trafficObstacle) (float64, bool) {
	if k == nil {
		return 0, false
	}
	s, d := p.Project(k.x, k.z, 0, p.Length)
	return s, d < laneHalf+kartRadius+1
}

// move integrates a car and carries it onto the next path.
func (t *traffic) move(car *trafficCar, dt float64) {
	car.v = math.Max(0, car.v+car.accel*dt)
	car.s += car.v * dt
	if car.lateral != car.lateralTarget {
		// Steering out round a kart starts from standing.
		step := detourShift * dt
		if car.lateral < car.lateralTarget {
			car.lateral = math.Min(car.lateralTarget, car.lateral+step)
		} else {
			car.lateral = math.Max(car.lateralTarget, car.lateral-step)
		}
	}
	for {
		p := t.net.Paths[car.path]
		if car.s < p.Length {
			return
		}
		if !p.Link && !car.committed {
			// Never into a junction without leave (the stop line holds it).
			car.s, car.v = p.Length-0.01, 0
			return
		}
		car.s -= p.Length
		if p.Link {
			car.path = car.next
			t.chooseRoute(car)
		} else {
			car.path, car.next = car.next, car.after
			car.committed = false
		}
		car.stopped = 0
	}
}

// packet is the traffic packet for a member at (x, z): the nearest cars
// within trafficSendRadius.
func (t *traffic) packet(x, z float64, now int64) []byte {
	type near struct {
		car *trafficCar
		d   float64
	}
	var list []near
	for _, car := range t.cars {
		p := t.net.Paths[car.path]
		cx, cz, _, _ := p.At(car.s)
		if d := math.Hypot(cx-x, cz-z); d < trafficSendRadius {
			list = append(list, near{car, d})
		}
	}
	slices.SortFunc(list, func(a, b near) int { return cmp.Compare(a.d, b.d) })
	if len(list) > trafficMaxSent {
		list = list[:trafficMaxSent]
	}
	out := make([]byte, trafficHeaderLength+trafficEntryLength*len(list))
	out[0] = FrameTraffic
	out[1] = trafficVersion
	binary.LittleEndian.PutUint16(out[2:], uint16(len(list)))
	binary.LittleEndian.PutUint32(out[4:], uint32(now))
	binary.LittleEndian.PutUint32(out[8:], t.net.wireID())
	for i, n := range list {
		car := n.car
		at := out[trafficHeaderLength+trafficEntryLength*i:]
		binary.LittleEndian.PutUint16(at, car.id)
		binary.LittleEndian.PutUint16(at[2:], uint16(car.path))
		binary.LittleEndian.PutUint16(at[4:], uint16(math.Min(65535, math.Round(car.s*16))))
		at[6] = uint8(math.Min(255, math.Round(car.v*4)))
		at[7] = car.flags
		at[8] = car.model
		at[9] = uint8(int8(math.Max(-127, math.Min(127, math.Round(car.lateral*10)))))
	}
	return out
}

// trafficTick is a line's traffic step (10 Hz): the cars drive among the
// members (driving or walking; passengers ride with their driver) and the
// parked karts, and every second step each member gets the cars near it.
// It re-arms itself until Close.
func (inst *instance) trafficTick() {
	if inst.svc.closed.Load() {
		return
	}
	inst.mu.Lock()
	// An empty line stands still: nobody would see it.
	if t := inst.traffic; len(inst.members) > 0 {
		now := inst.svc.clock.Now()
		karts := make(map[uint32]Pose, len(inst.members)+len(inst.vehicles))
		for _, m := range inst.members {
			// A passenger is where its driver is.
			if m.posed && m.seat != SeatPassenger {
				karts[uint32(m.id)] = m.pose
			}
		}
		// Karts parked on the road are in the way too.
		for _, v := range inst.vehicles {
			if v.driver == nil {
				karts[parkedKey+uint32(v.id)] = v.pose
			}
		}
		t.step(now, trafficStepMs/1000.0, t.observe(karts, now))
		if t.steps%trafficSendSteps == 0 {
			for _, m := range inst.members {
				m.c.Binary(t.packet(m.pose.X, m.pose.Z, now))
			}
		}
	}
	inst.mu.Unlock()
	inst.svc.clock.AfterFunc(trafficStepMs*time.Millisecond, inst.trafficTick)
}
