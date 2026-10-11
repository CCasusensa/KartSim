package city

import (
	"encoding/binary"
	"math"

	"kartsim/internal/game/lobby"
)

// City motion frames (CITY.md 3, protocol 41) share the motion channel with
// the race frames and are told apart by their first byte: a race frame
// starts with its payload kind 1–10, a city frame with FrameMotion.
//
//	offset 0  FrameMotion (0xC1)
//	offset 1  payload kind 1–10 (the race payload kinds, motion_payload.go)
//	offset 2  sender id, uint16 LE: 0 from the browser, overwritten here
//	offset 4  sequence, uint32 LE
//	offset 8  the race payload of that kind (80–163 bytes)
//
// The radar packet (FrameRadar, 0xC2) goes to every member once a second:
// a 4-byte header (marker, 0, member count uint16 LE) and 7 bytes per
// member with a pose: id uint16, x*4 and z*4 as int16 (0.25 m), heading
// as uint8 (360° = 256).
const (
	FrameMotion = 0xC1
	FrameRadar  = 0xC2

	headerLength   = 8
	kindOffset     = 1
	idOffset       = 2
	sequenceOffset = 4
	minFrameLength = headerLength + 80
	maxFrameLength = headerLength + 163

	radarHeaderLength = 4
	radarEntryLength  = 7
)

// Interest (CITY.md 3.3): within fullRateRadius every frame is forwarded,
// up to InterestRadius only the even sequence numbers; the grid cells are
// cellSize meters.
const (
	fullRateRadius = 60.0
	cellSize       = 100.0
)

// Plausibility (CITY.md 3.2): a frame that moves the member further than
// teleportDistance, or faster than MaxSpeed, since the last one is dropped
// and counted; violationLimit of them within violationWindowMs kick the
// member (CHEAT). The speed uses at least minIntervalMs between frames, so
// two frames that arrive back to back (network jitter) are not a violation.
const (
	teleportDistance  = 200.0
	violationWindowMs = 10_000
	violationLimit    = 20
	minIntervalMs     = 50
)

// Payload offsets (client payload.ts, the same the anti-cheat reads): the
// kinematic kinds 2–10 carry the tick (4 bytes), then the position (three
// float32 LE) at 4 and the quaternion (w, x, y, z) at 16; the driving kind 1
// carries the tick, three flag bytes, then the position at 7 and the
// quaternion at 19.
const (
	kinematicPositionOffset   = 4
	kinematicQuaternionOffset = 16
	drivingPositionOffset     = 7
	drivingQuaternionOffset   = 19
)

// payloadPose reads a frame payload's pose in world coordinates. The wire
// vectors are (x, -z, y) of the browser's y-up world (outgoing-race-
// motion.ts wireVector), so world x = p[0], y = p[2], z = -p[1]. The
// heading is where the wire quaternion points the kart's forward axis:
// remote-fleet.ts webBasis takes the browser's forward from the rotation
// matrix, which in terms of the quaternion is x = 2(wz - xy),
// z = 1 - 2(x² + z²); 0 is north (-z), clockwise.
func payloadPose(kind int, payload []byte) (Pose, bool) {
	positionAt, quaternionAt := kinematicPositionOffset, kinematicQuaternionOffset
	if kind == 1 {
		positionAt, quaternionAt = drivingPositionOffset, drivingQuaternionOffset
	}
	if len(payload) < quaternionAt+16 {
		return Pose{}, false
	}
	wire := [3]float64{}
	for i := range wire {
		wire[i] = float64(math.Float32frombits(binary.LittleEndian.Uint32(payload[positionAt+4*i:])))
	}
	q := [4]float64{}
	for i := range q {
		q[i] = float64(math.Float32frombits(binary.LittleEndian.Uint32(payload[quaternionAt+4*i:])))
	}
	for _, v := range [...]float64{wire[0], wire[1], wire[2], q[0], q[1], q[2], q[3]} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return Pose{}, false
		}
	}
	pose := Pose{X: wire[0], Y: wire[2], Z: -wire[1]}
	if math.Abs(pose.X) > maxCoordinate || math.Abs(pose.Y) > maxCoordinate || math.Abs(pose.Z) > maxCoordinate {
		return Pose{}, false
	}
	pose.Heading = headingOf(q)
	return pose, true
}

// headingOf is the heading (degrees, 0 = north, clockwise) of a wire
// quaternion w, x, y, z; 0 for a degenerate one.
func headingOf(q [4]float64) float64 {
	w, x, y, z := q[0], q[1], q[2], q[3]
	norm := w*w + x*x + y*y + z*z
	if norm <= 0 || math.IsNaN(norm) || math.IsInf(norm, 0) {
		return 0
	}
	forwardX := 2 * (w*z - x*y) / norm
	forwardZ := (1 - 2*(x*x+z*z)/norm)
	if forwardX == 0 && forwardZ == 0 {
		return 0
	}
	return normalizeHeading(math.Atan2(forwardX, -forwardZ) * 180 / math.Pi)
}

// relay handles one city motion frame of c (CITY.md 3): validates it,
// records the sender's pose, checks plausibility and fans it out by
// interest. Invalid frames are dropped silently, like race frames.
func (inst *instance) relay(c *lobby.Client, frame []byte) {
	if len(frame) < minFrameLength || len(frame) > maxFrameLength || frame[0] != FrameMotion {
		return
	}
	kind, payload := int(frame[kindOffset]), frame[headerLength:]
	if kind < 1 || kind > 10 || !lobby.ValidMotionPayload(kind, payload) {
		return
	}
	pose, ok := payloadPose(kind, payload)
	inst.mu.Lock()
	defer inst.mu.Unlock()
	m := inst.members[c]
	if m == nil {
		return
	}
	now := inst.svc.clock.Now()
	if !ok || (!m.skipCheck && !inst.plausible(m, pose, now)) {
		if inst.violation(m, now) {
			inst.kickLocked(m, KickCheat)
		}
		return
	}
	m.skipCheck = false
	inst.place(m, pose, now)
	if m.state == StateAFK {
		inst.setState(m, StateDriving, now)
	}
	binary.LittleEndian.PutUint16(frame[idOffset:], m.id)
	even := binary.LittleEndian.Uint32(frame[sequenceOffset:])%2 == 0
	full := min(fullRateRadius, inst.svc.opts.InterestRadius)
	for _, other := range inst.grid.within(pose, inst.svc.opts.InterestRadius) {
		if other == m {
			continue
		}
		if even || horizontal(pose, other.pose) <= full {
			other.c.Binary(frame)
		}
	}
}

// plausible checks a new pose against the member's last one.
func (inst *instance) plausible(m *member, pose Pose, now int64) bool {
	dx, dy, dz := pose.X-m.pose.X, pose.Y-m.pose.Y, pose.Z-m.pose.Z
	distance := math.Sqrt(dx*dx + dy*dy + dz*dz)
	if distance > teleportDistance {
		return false
	}
	interval := max(now-m.lastMotion, minIntervalMs)
	return distance/float64(interval)*1000 <= inst.svc.opts.MaxSpeed
}

// violation counts a dropped frame; true once the member should be kicked.
func (inst *instance) violation(m *member, now int64) bool {
	if now-m.violationStart > violationWindowMs {
		m.violationStart = now
		m.violations = 0
	}
	m.violations++
	return m.violations >= violationLimit
}

// radarPacket encodes every posed member.
func (inst *instance) radarPacket() []byte {
	ids := make([]uint16, 0, len(inst.members))
	for id, m := range inst.byID {
		if m.posed {
			ids = append(ids, id)
		}
	}
	// Sorted so the packet is deterministic (tests, and a stable order for
	// the browser's radar list).
	for i := 1; i < len(ids); i++ {
		for j := i; j > 0 && ids[j] < ids[j-1]; j-- {
			ids[j], ids[j-1] = ids[j-1], ids[j]
		}
	}
	packet := make([]byte, radarHeaderLength+radarEntryLength*len(ids))
	packet[0] = FrameRadar
	binary.LittleEndian.PutUint16(packet[2:], uint16(len(ids)))
	for i, id := range ids {
		m := inst.byID[id]
		at := radarHeaderLength + radarEntryLength*i
		binary.LittleEndian.PutUint16(packet[at:], id)
		binary.LittleEndian.PutUint16(packet[at+2:], uint16(radarCoordinate(m.pose.X)))
		binary.LittleEndian.PutUint16(packet[at+4:], uint16(radarCoordinate(m.pose.Z)))
		packet[at+6] = byte(int(math.Round(m.pose.Heading/360*256)) & 0xFF)
	}
	return packet
}

// radarCoordinate is a coordinate in quarter meters, clamped to int16.
func radarCoordinate(meters float64) int16 {
	return int16(max(math.MinInt16, min(math.MaxInt16, math.Round(meters*4))))
}

// grid buckets members by cellSize so interest queries scan a few cells
// instead of every member.
type grid struct {
	cells map[cellKey]map[*member]struct{}
}

type cellKey struct{ x, z int32 }

func newGrid() grid { return grid{cells: map[cellKey]map[*member]struct{}{}} }

func cellOf(pose Pose) cellKey {
	return cellKey{int32(math.Floor(pose.X / cellSize)), int32(math.Floor(pose.Z / cellSize))}
}

// insert files m under its pose's cell.
func (g *grid) insert(m *member) cellKey {
	key := cellOf(m.pose)
	cell := g.cells[key]
	if cell == nil {
		cell = map[*member]struct{}{}
		g.cells[key] = cell
	}
	cell[m] = struct{}{}
	return key
}

// move refiles m after its pose changed.
func (g *grid) move(m *member) cellKey {
	key := cellOf(m.pose)
	if key == m.cell {
		return key
	}
	g.remove(m)
	return g.insert(m)
}

func (g *grid) remove(m *member) {
	cell := g.cells[m.cell]
	delete(cell, m)
	if len(cell) == 0 {
		delete(g.cells, m.cell)
	}
}

// within lists the members at most radius from pose on the ground plane.
func (g *grid) within(pose Pose, radius float64) []*member {
	center := cellOf(pose)
	reach := int32(math.Ceil(radius / cellSize))
	var found []*member
	for x := center.x - reach; x <= center.x+reach; x++ {
		for z := center.z - reach; z <= center.z+reach; z++ {
			for m := range g.cells[cellKey{x, z}] {
				if horizontal(pose, m.pose) <= radius {
					found = append(found, m)
				}
			}
		}
	}
	return found
}
