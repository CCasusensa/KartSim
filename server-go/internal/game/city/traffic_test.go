package city

import (
	"bytes"
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func testTraffic(t *testing.T, count int) *traffic {
	t.Helper()
	net, err := DefaultTraffic()
	if err != nil {
		t.Fatal(err)
	}
	return newTraffic(net, count, 7)
}

func TestTrafficNetworkIsWellFormed(t *testing.T) {
	net, err := DefaultTraffic()
	if err != nil {
		t.Fatal(err)
	}
	if len(net.Paths) < 500 || len(net.Junctions) < 50 {
		t.Fatalf("network too small: %d paths, %d junctions", len(net.Paths), len(net.Junctions))
	}
	signals := 0
	for _, j := range net.Junctions {
		if j.Control == ControlSignal {
			signals++
		}
	}
	if signals == 0 {
		t.Fatal("no signal junctions")
	}
	// Every lane leads somewhere and every link ends on a lane leaving its junction.
	for _, p := range net.Paths {
		if p.Link {
			lane := net.Paths[p.Next[0]]
			if lane.Start != p.Junction {
				t.Fatalf("link %d at junction %d leads to lane %d starting at %d", p.Index, p.Junction, lane.Index, lane.Start)
			}
			if net.Paths[p.From].End != p.Junction {
				t.Fatalf("link %d leaves lane %d that does not end at its junction", p.Index, p.From)
			}
		}
		if p.Length >= 4000 {
			t.Fatalf("path %d is %f m long", p.Index, p.Length)
		}
	}
	// From any lane every other lane is reachable (no trap the traffic piles into).
	reach := func(start int) int {
		seen := map[int]bool{start: true}
		queue := []int{start}
		for len(queue) > 0 {
			p := net.Paths[queue[0]]
			queue = queue[1:]
			for _, n := range p.Next {
				if !seen[n] {
					seen[n] = true
					queue = append(queue, n)
				}
			}
		}
		return len(seen)
	}
	if got := reach(0); got != len(net.Paths) {
		t.Fatalf("from lane 0 only %d of %d paths are reachable", got, len(net.Paths))
	}
}

func TestSignalPlan(t *testing.T) {
	plan := &SignalPlan{GreenA: 14, GreenB: 11, Yellow: 3, AllRed: 2, Offset: 0}
	cases := []struct {
		group  int
		at     int64
		aspect int
	}{
		{0, 0, AspectGreen}, {0, 13_999, AspectGreen}, {0, 14_000, AspectYellow}, {0, 17_000, AspectRed},
		{1, 0, AspectRed}, {1, 18_999, AspectRed}, {1, 19_000, AspectGreen}, {1, 30_000, AspectYellow},
		{1, 33_000, AspectRed}, {0, 34_999, AspectRed}, {0, 35_000, AspectGreen},
	}
	for _, c := range cases {
		if got, _ := plan.Aspect(c.group, c.at); got != c.aspect {
			t.Errorf("group %d at %d: aspect %d, want %d", c.group, c.at, got, c.aspect)
		}
	}
}

// TestTrafficKeepsTheRules drives a full line for half an hour of node time
// and checks after every step: no car runs into the one ahead, nobody
// enters a junction on red, conflicting links are never used together, and
// the traffic keeps moving.
func TestTrafficKeepsTheRules(t *testing.T) {
	tr := testTraffic(t, 200)
	if len(tr.cars) != 200 {
		t.Fatalf("placed %d cars", len(tr.cars))
	}
	type where struct{ path int }
	last := map[uint16]where{}
	for _, car := range tr.cars {
		last[car.id] = where{car.path}
	}
	travelled := 0.0
	entries, redEntries := 0, 0
	const steps = 30 * 60 * 1000 / trafficStepMs
	now := int64(1_000_000)
	for step := 0; step < steps; step++ {
		now += trafficStepMs
		before := map[uint16]float64{}
		for _, car := range tr.cars {
			before[car.id] = car.s
		}
		tr.step(now, trafficStepMs/1000.0, nil)
		tr.index()
		for _, car := range tr.cars {
			p := tr.net.Paths[car.path]
			if prev := last[car.id]; prev.path != car.path {
				if p.Link {
					entries++
					j := tr.net.Junctions[p.Junction]
					if j.Control == ControlSignal {
						if aspect, since := j.Signal.Aspect(j.Approaches[p.Approach].Group, now); aspect == AspectRed && since > 1500 {
							redEntries++
						}
					}
				}
				last[car.id] = where{car.path}
			} else {
				travelled += car.s - before[car.id]
			}
		}
		for path, list := range tr.onPath {
			for i := 1; i < len(list); i++ {
				if gap := list[i].s - list[i-1].s; gap < carLength*0.5 {
					t.Fatalf("step %d: cars %d and %d %.2f m apart on path %d", step, list[i-1].id, list[i].id, gap, path)
				}
			}
			p := tr.net.Paths[path]
			if !p.Link || len(list) == 0 {
				continue
			}
			for _, c := range p.Conflicts {
				// Both still inside the crossing area (not just leaving it).
				other := tr.onPath[c]
				if len(other) > 0 && list[0].s < p.Length-carLength && other[0].s < tr.net.Paths[c].Length-carLength &&
					list[len(list)-1].s > carLength && other[len(other)-1].s > carLength {
					t.Fatalf("step %d: conflicting links %d and %d both in use", step, path, c)
				}
			}
		}
	}
	if redEntries > 0 {
		t.Fatalf("%d of %d junction entries on red", redEntries, entries)
	}
	average := travelled / float64(len(tr.cars)) / (steps * trafficStepMs / 1000.0)
	t.Logf("average speed %.2f m/s, %d junction entries", average, entries)
	if average < 3 {
		t.Fatalf("traffic crawls: average %.2f m/s", average)
	}
	stuck := 0
	for _, car := range tr.cars {
		if car.waited > 60 {
			stuck++
		}
	}
	if stuck > len(tr.cars)/20 {
		t.Fatalf("%d cars stuck", stuck)
	}
}

// TestTrafficStopsForAKartAndGoesRound parks a kart on a lane in front of a car.
func TestTrafficStopsForAKartAndGoesRound(t *testing.T) {
	tr := testTraffic(t, 1)
	car := tr.cars[0]
	var lane *TrafficPath
	for _, p := range tr.net.Paths {
		if !p.Link && p.Length > 150 && p.Limit >= 9 {
			lane = p
			break
		}
	}
	if lane == nil {
		t.Fatal("no long lane")
	}
	car.path, car.s, car.v = lane.Index, 10, lane.Limit
	tr.chooseRoute(car)
	kx, kz, _, _ := lane.At(70)
	kart := []trafficObstacle{{id: 1, x: kx, z: kz}}
	now := int64(5_000_000)
	minGap := math.Inf(1)
	stoppedBehind := false
	for step := 0; step < 400 && car.path == lane.Index; step++ {
		now += trafficStepMs
		tr.step(now, 0.1, kart)
		if car.path != lane.Index {
			break
		}
		gap := 70 - car.s - carLength/2 - kartRadius
		if math.Abs(car.lateral) < laneHalf+kartRadius && car.s < 70 {
			minGap = math.Min(minGap, gap)
		}
		if car.v < 0.1 && gap < 6 && gap > 0 {
			stoppedBehind = true
		}
	}
	if !stoppedBehind {
		t.Fatalf("the car never stopped behind the kart (min gap %.2f)", minGap)
	}
	if minGap < 0 {
		t.Fatalf("the car ran into the kart (gap %.2f)", minGap)
	}
	if car.path == lane.Index && car.s < 76 {
		t.Fatalf("the car did not go round the kart (s %.1f, lateral %.1f)", car.s, car.lateral)
	}
}

func TestTrafficPacket(t *testing.T) {
	tr := testTraffic(t, 50)
	car := tr.cars[0]
	x, z, _, _ := tr.net.Paths[car.path].At(car.s)
	packet := tr.packet(x, z, 1234)
	if packet[0] != FrameTraffic || packet[1] != trafficVersion {
		t.Fatalf("header %v", packet[:2])
	}
	count := int(binary.LittleEndian.Uint16(packet[2:]))
	if count < 1 || len(packet) != trafficHeaderLength+count*trafficEntryLength {
		t.Fatalf("count %d, length %d", count, len(packet))
	}
	if binary.LittleEndian.Uint32(packet[4:]) != 1234 {
		t.Fatal("tick")
	}
	if binary.LittleEndian.Uint32(packet[8:]) != tr.net.wireID() {
		t.Fatal("network id")
	}
	first := packet[trafficHeaderLength:]
	if binary.LittleEndian.Uint16(first) != car.id || int(binary.LittleEndian.Uint16(first[2:])) != car.path {
		t.Fatalf("nearest car is not first: %v", first[:4])
	}
	if s := float64(binary.LittleEndian.Uint16(first[4:])) / 16; math.Abs(s-car.s) > 1.0/16 {
		t.Fatalf("distance %f, want %f", s, car.s)
	}
}

func TestEmbeddedTrafficMatchesDesign(t *testing.T) {
	source := filepath.Join("..", "..", "..", "..", "design", "open-world", "vice-city", "traffic-network.json")
	design, err := os.ReadFile(source)
	if err != nil {
		if os.IsNotExist(err) {
			t.Skipf("%s is not in this checkout", source)
		}
		t.Fatal(err)
	}
	if !bytes.Equal(design, embeddedTraffic) {
		t.Fatalf("internal/game/city/traffic-network.json differs from %s; rebuild with client/tools/city/traffic/build-traffic-network.mjs", source)
	}
}

// TestLineSendsTraffic: a member on a line with traffic gets the cars near
// it five times a second; an empty line does not drive.
func TestLineSendsTraffic(t *testing.T) {
	h := newHarness(t, Options{Lines: 1, Traffic: 120})
	inst := h.svc.lines[0]
	before := make([]float64, len(inst.traffic.cars))
	for i, car := range inst.traffic.cars {
		before[i] = car.s
	}
	h.clock.Advance(2 * time.Second)
	for i, car := range inst.traffic.cars {
		if car.s != before[i] {
			t.Fatal("an empty line drove its cars")
		}
	}
	p := h.player("Alice")
	h.join(p, `{"type":"city-join"}`)
	// Put the member where some cars are.
	car := inst.traffic.cars[0]
	x, z, _, _ := inst.traffic.net.Paths[car.path].At(car.s)
	h.at(p, x, 10, z, 0)
	p.sink.takeFrames()
	h.clock.Advance(time.Second)
	var packets [][]byte
	for _, frame := range p.sink.takeFrames() {
		if frame[0] == FrameTraffic {
			packets = append(packets, frame)
		}
	}
	if len(packets) != 5 {
		t.Fatalf("%d traffic packets in a second, want 5", len(packets))
	}
	last := packets[len(packets)-1]
	if count := int(binary.LittleEndian.Uint16(last[2:])); count == 0 {
		t.Fatal("no cars near the member")
	}
	if binary.LittleEndian.Uint32(last[8:]) != inst.traffic.net.wireID() || inst.traffic.net.wireID() == 0 {
		t.Fatal("network id")
	}
}
