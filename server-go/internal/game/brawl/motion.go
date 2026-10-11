package brawl

import (
	"encoding/binary"
	"math"
)

// The motion frames of an AI racer: protocol 40 (client motion.ts) with
// payload kind 7 (client payload.ts encodeKinematicSample): pose, the
// presentation the remote kart is drawn with, the race progress the
// browsers rank it by, the collision state and the kart animation.
const (
	headerLength  = 8
	payloadKind   = 7
	payloadLength = 149
	// FrameLength is the length of an AI racer's motion frame.
	FrameLength = headerLength + payloadLength
	// noFinish is finishElapsedMs while the racer has not finished.
	noFinish = 0xffff_ffff
	// boosterNitro is the physics state of a nitro boost (driving/
	// booster-state.ts): the browsers show the kart's booster flame.
	boosterNitro = 3
)

// pose is what one motion frame says about a kart.
type pose struct {
	position, velocity vec3 // three.js world
	heading            vec3
	speed              float64 // forward m/s
	steer              float64 // -1..1
	boosting           bool
	distance           float64 // route distance
	lap                int
	finishElapsedMs    int64 // -1 while racing
	collision          bool
}

// wire is a three.js world vector in the client coordinates motion frames
// carry ([x, -z, y]).
func wire(v vec3) [3]float64 { return [3]float64{v.x, -v.z, v.y} }

// quaternion is the [w, x, y, z] motion quaternion of a level kart facing
// heading, as the browser computes it for a body reset onto a route frame
// (server-go/test/lib/item-bot-lib.mjs routeBasis and quaternionFromMatrix).
func quaternion(heading vec3) [4]float64 {
	client := vec3{heading.x, -heading.z, heading.y}
	reverse := vec3{0, -1, 0}
	if client.length() > 1e-6 {
		reverse = client.scale(-1)
	}
	r := reverse.cross(vec3{0, 0, 1}).unit(vec3{1, 0, 0})
	u := r.cross(reverse).unit(vec3{0, 0, 1})
	m := [3][3]float64{
		{r.x, reverse.x, u.x},
		{r.y, reverse.y, u.y},
		{r.z, reverse.z, u.z},
	}
	e, t, i := m[0][0], m[0][1], m[0][2]
	rr, s, o := m[1][0], m[1][1], m[1][2]
	a, c, l := m[2][0], m[2][1], m[2][2]
	if trace := e + s + l; trace > 0 {
		b := math.Sqrt(trace + 1)
		k := 0.5 / b
		return [4]float64{b * 0.5, (c - o) * k, (i - a) * k, (rr - t) * k}
	}
	diagonal := [3]float64{e, s, l}
	d := 0
	if diagonal[1] > diagonal[d] {
		d = 1
	}
	if diagonal[2] > diagonal[d] {
		d = 2
	}
	f := (d + 1) % 3
	p := (f + 1) % 3
	v := [3][3]float64{{e, t, i}, {rr, s, o}, {a, c, l}}
	w := math.Sqrt(diagonal[d] - diagonal[f] - diagonal[p] + 1)
	g := 0.5 / w
	var q [3]float64
	q[d] = w * 0.5
	q[f] = (v[f][d] + v[d][f]) * g
	q[p] = (v[p][d] + v[d][p]) * g
	return [4]float64{(v[p][f] - v[f][p]) * g, q[0], q[1], q[2]}
}

// encodeFrame writes one motion frame: the header names the racer's room
// slot and race, the payload its pose at tick (the node clock in ms).
func encodeFrame(slot int, raceTag byte, sequence uint32, tick int64, p pose) []byte {
	frame := make([]byte, FrameLength)
	frame[0] = payloadKind
	frame[2] = byte(slot)
	frame[3] = raceTag
	binary.LittleEndian.PutUint32(frame[4:], sequence)
	b := frame[headerLength:]
	f32 := func(offset int, value float64) {
		binary.LittleEndian.PutUint32(b[offset:], math.Float32bits(float32(value)))
	}
	binary.LittleEndian.PutUint32(b, uint32(tick))
	floats := make([]float64, 0, 19)
	position, velocity := wire(p.position), wire(p.velocity)
	q := quaternion(p.heading)
	floats = append(floats, position[:]...)
	floats = append(floats, q[:]...)
	floats = append(floats, velocity[:]...)
	floats = append(floats, 0, 0, 0, 0, 0, 0, 0, 0, 0) // angular velocity, vector5C, vector68
	for index, value := range floats {
		f32(4+4*index, value)
	}
	// Presentation.
	f32(80, p.speed)
	f32(84, p.steer)
	f32(88, 0) // tire transient
	f32(92, 0) // collision strength
	state := byte(0)
	if p.boosting {
		state = boosterNitro
	}
	b[96] = state
	b[97] = 0 // visual scale mode
	b[98] = 0 // lamps, motorcycle, instant acceleration
	// Race progress.
	binary.LittleEndian.PutUint64(b[108:], math.Float64bits(p.distance))
	binary.LittleEndian.PutUint32(b[116:], uint32(p.lap))
	finish := uint32(noFinish)
	if p.finishElapsedMs >= 0 {
		finish = uint32(p.finishElapsedMs)
	}
	binary.LittleEndian.PutUint32(b[120:], finish)
	// Collision: scale 1 x 1, no reset.
	f32(128, 1)
	f32(132, 1)
	if p.collision {
		b[136] = 1
	}
	// Kart animation.
	b[137] = state
	f32(141, p.speed*3.6) // display speed km/h
	return frame
}
