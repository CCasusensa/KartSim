package city

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
)

// The NPC traffic network (CITY-NPC.md): lanes and junction links built
// from the Vice City asphalt by client/tools/city/traffic, a copy of
// design/open-world/vice-city/traffic-network.json (the browser loads the
// same file). Paths are indexed as on the wire: lanes first, then links.
//
//go:embed traffic-network.json
var embeddedTraffic []byte

// Junction controls.
const (
	ControlNone     = "none"
	ControlSignal   = "signal"
	ControlPriority = "priority"
	ControlStop     = "stop"
)

// Approach roles.
const (
	RoleMajor  = "major"
	RoleMinor  = "minor"
	RoleSignal = "signal"
)

// TrafficNetwork is the parsed traffic-network.json.
type TrafficNetwork struct {
	ID        string
	Paths     []*TrafficPath
	Junctions []*TrafficJunction
}

// wireID is the network's id as the traffic packet carries it (its first
// 8 hex digits): a browser with another network ignores the packets.
func (n *TrafficNetwork) wireID() uint32 {
	var id uint32
	for i := 0; i < 8 && i < len(n.ID); i++ {
		c := n.ID[i]
		var v byte
		switch {
		case c >= '0' && c <= '9':
			v = c - '0'
		case c >= 'a' && c <= 'f':
			v = c - 'a' + 10
		}
		id = id<<4 | uint32(v)
	}
	return id
}

// TrafficPath is a lane (between junctions) or a link (across one).
type TrafficPath struct {
	Index int
	Link  bool
	// Limit is the speed limit (m/s).
	Limit float64
	// Next are the paths a car can continue on: a lane's links, a link's lane.
	Next []int
	// X, Z, Y are the points (design coordinates); S their distance along the path.
	X, Z, Y, S []float64
	Length     float64
	// maxSpeed[i] is the fastest a car may pass point i (the curve there).
	maxSpeed []float64

	// Lanes: the junctions at the start and end, the lane's index (0 inner)
	// among Lanes of its direction, the distance to its right kerb (m), and
	// the approach of the end junction it arrives by.
	Start, End  int
	Lane, Lanes int
	Curb        float64
	Approach    int

	// Links: the junction, the lane it leaves, the turn (L, S, R), the
	// priority of the movement (2 through/right of the major or green street,
	// 1 left turns, 0 the stem of a give-way junction or an all-way stop),
	// the links that cannot be used at the same time, and the approach.
	Junction  int
	From      int
	Turn      byte
	Priority  int
	Conflicts []int
}

// TrafficJunction is a junction and how it is controlled.
type TrafficJunction struct {
	X, Z       float64
	Control    string
	Signal     *SignalPlan
	Approaches []TrafficApproach
}

// TrafficApproach is one street end at a junction: the lanes arriving by it
// and leaving by it, its role and (signals) its phase group.
type TrafficApproach struct {
	In, Out []int
	Role    string
	Group   int
}

// SignalPlan is a two-phase signal (seconds): group 0 green, yellow, all
// red, group 1 green, yellow, all red, repeating on the node clock shifted
// by Offset. The browser runs the same plan for the lights it draws.
type SignalPlan struct {
	GreenA float64 `json:"greenA"`
	GreenB float64 `json:"greenB"`
	Yellow float64 `json:"yellow"`
	AllRed float64 `json:"allRed"`
	Offset float64 `json:"offset"`
}

// Signal aspects.
const (
	AspectRed = iota
	AspectGreen
	AspectYellow
)

// Cycle is the plan's length in ms.
func (p *SignalPlan) Cycle() int64 {
	return int64(math.Round((p.GreenA + p.GreenB + 2*(p.Yellow+p.AllRed)) * 1000))
}

// Aspect is what group shows at node time now (ms), and how long (ms) it
// has shown it.
func (p *SignalPlan) Aspect(group int, now int64) (aspect int, since int64) {
	cycle := p.Cycle()
	t := (now + int64(p.Offset*1000)) % cycle
	if t < 0 {
		t += cycle
	}
	ms := func(s float64) int64 { return int64(math.Round(s * 1000)) }
	greenA, greenB, yellow, allRed := ms(p.GreenA), ms(p.GreenB), ms(p.Yellow), ms(p.AllRed)
	// Group 0's window starts at 0, group 1's after group 0's green, yellow and all red.
	start := int64(0)
	green := greenA
	if group == 1 {
		start = greenA + yellow + allRed
		green = greenB
	}
	local := (t - start + cycle) % cycle
	switch {
	case local < green:
		return AspectGreen, local
	case local < green+yellow:
		return AspectYellow, local - green
	default:
		return AspectRed, local - green - yellow
	}
}

type rawTrafficNetwork struct {
	Version int    `json:"version"`
	ID      string `json:"id"`
	Paths   []struct {
		Kind      string    `json:"kind"`
		Limit     float64   `json:"limit"`
		Next      []int     `json:"next"`
		P         []float64 `json:"p"`
		Lane      int       `json:"lane"`
		Lanes     int       `json:"lanes"`
		Start     int       `json:"start"`
		End       int       `json:"end"`
		Curb      float64   `json:"curb"`
		Junction  int       `json:"junction"`
		Turn      string    `json:"turn"`
		From      int       `json:"from"`
		Priority  int       `json:"priority"`
		Conflicts []int     `json:"conflicts"`
	} `json:"paths"`
	Junctions []struct {
		X          float64     `json:"x"`
		Z          float64     `json:"z"`
		Control    string      `json:"control"`
		Signal     *SignalPlan `json:"signal"`
		Approaches []struct {
			In    []int  `json:"in"`
			Out   []int  `json:"out"`
			Role  string `json:"role"`
			Group int    `json:"group"`
		} `json:"approaches"`
	} `json:"junctions"`
}

// lateralAccel (m/s²) bounds the speed through a curve: v² κ ≤ lateralAccel.
const lateralAccel = 2.2

// DefaultTraffic parses the embedded traffic network.
func DefaultTraffic() (*TrafficNetwork, error) { return ParseTraffic(embeddedTraffic) }

// ParseTraffic parses and checks a traffic-network.json document.
func ParseTraffic(data []byte) (*TrafficNetwork, error) {
	var raw rawTrafficNetwork
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("traffic network: %w", err)
	}
	if raw.Version != 1 {
		return nil, fmt.Errorf("traffic network: version %d", raw.Version)
	}
	n := &TrafficNetwork{ID: raw.ID}
	for _, rj := range raw.Junctions {
		j := &TrafficJunction{X: rj.X, Z: rj.Z, Control: rj.Control, Signal: rj.Signal}
		if j.Control == ControlSignal && (j.Signal == nil || j.Signal.Cycle() <= 0) {
			return nil, fmt.Errorf("traffic network: signal junction without a plan")
		}
		for _, a := range rj.Approaches {
			j.Approaches = append(j.Approaches, TrafficApproach{In: a.In, Out: a.Out, Role: a.Role, Group: a.Group})
		}
		n.Junctions = append(n.Junctions, j)
	}
	for i, rp := range raw.Paths {
		if len(rp.P) < 6 || len(rp.P)%3 != 0 {
			return nil, fmt.Errorf("traffic network: path %d has %d coordinates", i, len(rp.P))
		}
		p := &TrafficPath{Index: i, Link: rp.Kind == "link", Limit: rp.Limit, Next: rp.Next, Lane: rp.Lane,
			Lanes: rp.Lanes, Start: rp.Start, End: rp.End, Curb: rp.Curb, Junction: rp.Junction, From: rp.From,
			Priority: rp.Priority, Conflicts: rp.Conflicts, Approach: -1}
		if rp.Turn != "" {
			p.Turn = rp.Turn[0]
		}
		for k := 0; k < len(rp.P); k += 3 {
			p.X = append(p.X, rp.P[k])
			p.Z = append(p.Z, rp.P[k+1])
			p.Y = append(p.Y, rp.P[k+2])
		}
		p.S = make([]float64, len(p.X))
		for k := 1; k < len(p.X); k++ {
			p.S[k] = p.S[k-1] + math.Hypot(p.X[k]-p.X[k-1], p.Z[k]-p.Z[k-1])
		}
		p.Length = p.S[len(p.S)-1]
		if p.Length <= 0 || p.Limit <= 0 || len(p.Next) == 0 {
			return nil, fmt.Errorf("traffic network: path %d is degenerate", i)
		}
		n.Paths = append(n.Paths, p)
	}
	for _, p := range n.Paths {
		for _, next := range p.Next {
			if next < 0 || next >= len(n.Paths) || n.Paths[next].Link == p.Link {
				return nil, fmt.Errorf("traffic network: path %d continues on %d", p.Index, next)
			}
		}
		if p.Link && (p.Junction < 0 || p.Junction >= len(n.Junctions)) {
			return nil, fmt.Errorf("traffic network: link %d at junction %d", p.Index, p.Junction)
		}
		if !p.Link && (p.End < 0 || p.End >= len(n.Junctions)) {
			return nil, fmt.Errorf("traffic network: lane %d ends at junction %d", p.Index, p.End)
		}
		p.maxSpeed = curveSpeeds(p)
	}
	for _, j := range n.Junctions {
		for ai, a := range j.Approaches {
			for _, lane := range a.In {
				if lane >= 0 && lane < len(n.Paths) {
					n.Paths[lane].Approach = ai
				}
			}
		}
	}
	for _, p := range n.Paths {
		if p.Link {
			p.Approach = n.Paths[p.From].Approach
		}
	}
	return n, nil
}

// curveSpeeds is the curve speed at each point of a path (from the turn
// between its neighbouring segments), capped by the limit.
func curveSpeeds(p *TrafficPath) []float64 {
	out := make([]float64, len(p.X))
	for i := range out {
		out[i] = p.Limit
		if i == 0 || i == len(p.X)-1 {
			continue
		}
		ax, az := p.X[i]-p.X[i-1], p.Z[i]-p.Z[i-1]
		bx, bz := p.X[i+1]-p.X[i], p.Z[i+1]-p.Z[i]
		la, lb := math.Hypot(ax, az), math.Hypot(bx, bz)
		if la < 1e-6 || lb < 1e-6 {
			continue
		}
		turn := math.Abs(math.Atan2(ax*bz-az*bx, ax*bx+az*bz))
		curvature := turn / ((la + lb) / 2)
		if curvature > 1e-6 {
			out[i] = math.Min(p.Limit, math.Sqrt(lateralAccel/curvature))
		}
	}
	return out
}

// At is the point at distance s along the path (clamped to its ends) and
// the unit direction there.
func (p *TrafficPath) At(s float64) (x, z, dx, dz float64) {
	k := p.segment(s)
	x0, z0 := p.X[k], p.Z[k]
	ex, ez := p.X[k+1]-x0, p.Z[k+1]-z0
	length := p.S[k+1] - p.S[k]
	t := 0.0
	if length > 0 {
		t = math.Max(0, math.Min(1, (s-p.S[k])/length))
		ex, ez = ex/length, ez/length
	}
	return x0 + (p.X[k+1]-x0)*t, z0 + (p.Z[k+1]-z0)*t, ex, ez
}

// segment is the index k with S[k] <= s < S[k+1] (clamped).
func (p *TrafficPath) segment(s float64) int {
	lo, hi := 0, len(p.S)-2
	for lo < hi {
		mid := (lo + hi + 1) / 2
		if p.S[mid] <= s {
			lo = mid
		} else {
			hi = mid - 1
		}
	}
	return lo
}

// Project is the distance along the path of the point nearest (x, z) and
// how far (x, z) is from it, searching from distance from to to.
func (p *TrafficPath) Project(x, z, from, to float64) (s, lateral float64) {
	best := math.Inf(1)
	for k := p.segment(from); k < len(p.X)-1 && p.S[k] <= to; k++ {
		ax, az := p.X[k], p.Z[k]
		bx, bz := p.X[k+1], p.Z[k+1]
		dx, dz := bx-ax, bz-az
		l2 := dx*dx + dz*dz
		t := 0.0
		if l2 > 0 {
			t = math.Max(0, math.Min(1, ((x-ax)*dx+(z-az)*dz)/l2))
		}
		d := math.Hypot(x-ax-dx*t, z-az-dz*t)
		if d < best {
			best = d
			s = p.S[k] + t*(p.S[k+1]-p.S[k])
		}
	}
	return s, best
}

// curveLimit is the fastest a car `ahead` m before distance s may go so it
// can still slow down (at comfortable deceleration b) for every curve of
// the path within reach m of s.
func (p *TrafficPath) curveLimit(s, reach, b, ahead float64) float64 {
	limit := math.Inf(1)
	for k := p.segment(s) + 1; k < len(p.X) && p.S[k] <= s+reach; k++ {
		d := math.Max(0, p.S[k]-s) + ahead
		limit = math.Min(limit, math.Sqrt(p.maxSpeed[k]*p.maxSpeed[k]+2*b*d))
	}
	return limit
}
