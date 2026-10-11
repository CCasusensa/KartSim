// Package brawl runs the AI racers of a 50人乱斗 race (BRAWL.md): the game
// node fills the open seats of the room with them when the race starts and
// drives them along the track's course line, sending their motion frames to
// the players like any racer's.
package brawl

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"sort"
	"sync"
)

// Slots is how many racers a 50人乱斗 race has: room seats and start places.
const Slots = 50

//go:embed tracks.json
var tracksJSON []byte

// vec3 is a three.js world vector (meters, y up).
type vec3 struct{ x, y, z float64 }

func (a vec3) add(b vec3) vec3      { return vec3{a.x + b.x, a.y + b.y, a.z + b.z} }
func (a vec3) sub(b vec3) vec3      { return vec3{a.x - b.x, a.y - b.y, a.z - b.z} }
func (a vec3) scale(k float64) vec3 { return vec3{a.x * k, a.y * k, a.z * k} }
func (a vec3) dot(b vec3) float64   { return a.x*b.x + a.y*b.y + a.z*b.z }
func (a vec3) length() float64      { return math.Sqrt(a.dot(a)) }
func (a vec3) cross(b vec3) vec3 {
	return vec3{a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x}
}
func (a vec3) unit(fallback vec3) vec3 {
	if size := a.length(); size > 1e-6 {
		return a.scale(1 / size)
	}
	return fallback
}

// Track is the closed course the AI racers drive on one track, from
// client/tools/export-brawl-tracks.mjs. Distances: u is meters driven along
// the course from its first frame (the loop closes from the last frame back
// to the first); route distance is what the browser counts (world/
// route-state.ts), which does not grow across the spans between sections
// that do not meet.
type Track struct {
	ID   string
	Laps int
	// Lap is the route distance of one lap; LastLength the last section's,
	// the least route distance a racer reports before the start line.
	Lap, LastLength float64
	points          []vec3
	forwards        []vec3
	route           []float64 // route distance of each frame within the lap
	drive           []float64 // u of each frame
	loop            float64   // u of one whole lap
	road            [][]float64
	grid            []gridPlace
}

// gridPlace is a start place: the browser's snapped start position, its u
// on the course and its route distance.
type gridPlace struct {
	position vec3
	u        float64
	distance float64
}

// roadOffsets are the lateral offsets (m) of the road heights per frame.
var roadOffsets []float64

var (
	loadOnce sync.Once
	tracks   map[string]*Track
	trackIDs []string
	loadErr  error
)

type trackRow struct {
	ID         string       `json:"id"`
	Laps       int          `json:"laps"`
	Lap        float64      `json:"lap"`
	LastLength float64      `json:"lastLength"`
	Frames     [][7]float64 `json:"frames"`
	Road       [][]*float64 `json:"road"`
	Grid       [][5]float64 `json:"grid"`
}

func load() {
	var document struct {
		RoadOffsets []float64  `json:"roadOffsets"`
		Tracks      []trackRow `json:"tracks"`
	}
	if loadErr = json.Unmarshal(tracksJSON, &document); loadErr != nil {
		return
	}
	roadOffsets = document.RoadOffsets
	tracks = map[string]*Track{}
	for _, row := range document.Tracks {
		track, err := newTrack(row)
		if err != nil {
			loadErr = fmt.Errorf("brawl track %s: %w", row.ID, err)
			return
		}
		tracks[row.ID] = track
		trackIDs = append(trackIDs, row.ID)
	}
}

func newTrack(row trackRow) (*Track, error) {
	n := len(row.Frames)
	if n < 3 || len(row.Road) != n || len(row.Grid) != Slots || row.Laps < 1 || !(row.Lap > 0) {
		return nil, fmt.Errorf("incomplete course")
	}
	t := &Track{ID: row.ID, Laps: row.Laps, Lap: row.Lap, LastLength: row.LastLength}
	for i, frame := range row.Frames {
		t.points = append(t.points, vec3{frame[0], frame[1], frame[2]})
		t.forwards = append(t.forwards, vec3{frame[3], frame[4], frame[5]}.unit(vec3{0, 0, -1}))
		t.route = append(t.route, frame[6])
		if i > 0 && frame[6] < row.Frames[i-1][6] {
			return nil, fmt.Errorf("route distance goes back at frame %d", i)
		}
		heights := make([]float64, len(row.Road[i]))
		if len(heights) != len(roadOffsets) {
			return nil, fmt.Errorf("road profile %d has %d heights", i, len(heights))
		}
		for k, height := range row.Road[i] {
			heights[k] = math.NaN()
			if height != nil {
				heights[k] = *height / 10
			}
		}
		t.road = append(t.road, heights)
	}
	u := 0.0
	for i := range t.points {
		t.drive = append(t.drive, u)
		u += t.points[(i+1)%n].sub(t.points[i]).length()
	}
	t.loop = u
	for _, place := range row.Grid {
		t.grid = append(t.grid, gridPlace{position: vec3{place[0], place[1], place[2]}, u: place[3],
			distance: place[4]})
	}
	return t, nil
}

func ensureLoaded() {
	loadOnce.Do(load)
	if loadErr != nil {
		panic(loadErr)
	}
}

// TrackByID is the brawl course of a track, nil for a track outside the pool.
func TrackByID(id string) *Track {
	ensureLoaded()
	return tracks[id]
}

// TrackIDs is the 50人乱斗 track pool in the export's order.
func TrackIDs() []string {
	ensureLoaded()
	return slices.Clone(trackIDs)
}

// segment finds the frame span holding u (0 <= u < loop): its first frame,
// the next one (0 after the last frame) and how far along it u lies (0..1).
func (t *Track) segment(u float64) (int, int, float64) {
	u = math.Mod(u, t.loop)
	if u < 0 {
		u += t.loop
	}
	i := sort.SearchFloat64s(t.drive, u)
	if i == len(t.drive) || t.drive[i] > u {
		i--
	}
	i = max(i, 0)
	j := (i + 1) % len(t.points)
	end := t.loop
	if j != 0 {
		end = t.drive[j]
	}
	span := end - t.drive[i]
	if span < 1e-6 {
		return i, j, 0
	}
	return i, j, min(1, max(0, (u-t.drive[i])/span))
}

// routeAt is the route distance within the lap at u.
func (t *Track) routeAt(u float64) float64 {
	i, j, f := t.segment(u)
	to := t.Lap
	if j != 0 {
		to = t.route[j]
	}
	return t.route[i] + f*(to-t.route[i])
}

// center is the course line at u and its heading: a cubic Hermite curve
// through the frames with their route headings as tangents, so the line
// bends smoothly through corners whose frames lie far apart.
func (t *Track) center(u float64) (vec3, vec3) {
	i, j, f := t.segment(u)
	p0, p1 := t.points[i], t.points[j]
	span := p1.sub(p0).length()
	if span < 1e-6 {
		return p0, t.forwards[i]
	}
	m0, m1 := t.forwards[i].scale(span), t.forwards[j].scale(span)
	f2, f3 := f*f, f*f*f
	position := p0.scale(2*f3 - 3*f2 + 1).add(m0.scale(f3 - 2*f2 + f)).
		add(p1.scale(-2*f3 + 3*f2)).add(m1.scale(f3 - f2))
	tangent := p0.scale(6*f2 - 6*f).add(m0.scale(3*f2 - 4*f + 1)).
		add(p1.scale(-6*f2 + 6*f)).add(m1.scale(3*f2 - 2*f))
	return position, tangent.unit(t.forwards[i])
}

// right is the kart's right vector on heading forward, as the browser's
// resetFromRouteFrame builds it (the start places lie along it).
func right(forward vec3) vec3 {
	client := vec3{forward.x, -forward.z, forward.y}
	reverse := vec3{0, -1, 0}
	if client.length() > 1e-6 {
		reverse = client.scale(-1)
	}
	r := reverse.cross(vec3{0, 0, 1}).unit(vec3{1, 0, 0})
	return vec3{r.x, r.z, -r.y}
}

// heightAt is the road height (m above the course frame) at lateral offset
// lane on frame i, NaN for no road there.
func (t *Track) heightAt(i int, lane float64) float64 {
	offsets := roadOffsets
	if lane <= offsets[0] {
		return t.road[i][0]
	}
	last := len(offsets) - 1
	if lane >= offsets[last] {
		return t.road[i][last]
	}
	k := sort.SearchFloat64s(offsets, lane)
	if offsets[k] == lane {
		return t.road[i][k]
	}
	a, b := t.road[i][k-1], t.road[i][k]
	switch {
	case math.IsNaN(a):
		return b
	case math.IsNaN(b):
		return a
	}
	f := (lane - offsets[k-1]) / (offsets[k] - offsets[k-1])
	return a + f*(b-a)
}

// lanes is the drivable span around the course line on frame i: the run of
// road samples through offset 0 whose neighbors differ by at most 1.5 m.
func (t *Track) lanes(i int) (float64, float64) {
	heights := t.road[i]
	center := slices.Index(roadOffsets, 0)
	if center < 0 || math.IsNaN(heights[center]) {
		return 0, 0
	}
	left, right := center, center
	for left > 0 && !math.IsNaN(heights[left-1]) && math.Abs(heights[left-1]-heights[left]) <= 1.5 {
		left--
	}
	for right < len(heights)-1 && !math.IsNaN(heights[right+1]) &&
		math.Abs(heights[right+1]-heights[right]) <= 1.5 {
		right++
	}
	return roadOffsets[left], roadOffsets[right]
}

// laneBounds is the narrowest drivable span over the course from u to
// u+ahead, less a kart's half width on each side.
func (t *Track) laneBounds(u, ahead float64) (float64, float64) {
	const margin = 1.6
	low, high := math.Inf(-1), math.Inf(1)
	i, _, _ := t.segment(u)
	end, _, _ := t.segment(u + ahead)
	for steps := 0; steps <= len(t.points); steps++ {
		l, r := t.lanes(i)
		low, high = max(low, l+margin), min(high, r-margin)
		if i == end {
			break
		}
		i = (i + 1) % len(t.points)
	}
	if low > high {
		middle := (low + high) / 2
		return middle, middle
	}
	return low, high
}

// surface is the kart's place at u, lane meters right of the course line:
// on the road there, or at the course line's height where the road is
// missing (a jump).
func (t *Track) surface(u, lane float64) (vec3, vec3) {
	center, heading := t.center(u)
	i, j, f := t.segment(u)
	position := center.add(right(heading).scale(lane))
	a, b := t.heightAt(i, lane), t.heightAt(j, lane)
	switch {
	case math.IsNaN(a) && math.IsNaN(b):
		return position, heading
	case math.IsNaN(a):
		a = b
	case math.IsNaN(b):
		b = a
	}
	// Heights are relative to each frame's course point (right is level).
	position.y = center.y + a + f*(b-a)
	return position, heading
}
