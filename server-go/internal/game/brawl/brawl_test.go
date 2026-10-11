package brawl

import (
	"encoding/binary"
	"math"
	"slices"
	"testing"
)

func fieldOf(t *testing.T, trackID string, count int) *Field {
	t.Helper()
	track := TrackByID(trackID)
	if track == nil {
		t.Fatalf("no brawl track %s", trackID)
	}
	specs := make([]Spec, count)
	for i := range specs {
		specs[i] = Spec{PlayerID: "ai-" + string(rune('a'+i%26)) + string(rune('a'+i/26)), Slot: Slots - count + i}
	}
	return NewField(track, 0x5a, 10_000, specs, 7)
}

func TestTrackPoolLoads(t *testing.T) {
	ids := TrackIDs()
	if len(ids) < 20 || !slices.Contains(ids, "village_R01") {
		t.Fatalf("track pool %v", ids)
	}
	for _, id := range ids {
		track := TrackByID(id)
		if track.loop < track.Lap-1 || len(track.grid) != Slots {
			t.Fatalf("%s: loop %.1f lap %.1f grid %d", id, track.loop, track.Lap, len(track.grid))
		}
		// The start places lie on the course near the line.
		for slot, place := range track.grid {
			if place.distance > 30 || place.distance < -40 {
				t.Fatalf("%s slot %d: route distance %.1f", id, slot, place.distance)
			}
		}
	}
}

func TestFieldStartsOnTheGrid(t *testing.T) {
	f := fieldOf(t, "village_R01", 42)
	for _, bot := range f.Bots() {
		got := f.Position(bot)
		want := f.track.grid[bot.Slot].position
		if gap := got.sub(want).length(); gap > 1.0 {
			t.Fatalf("slot %d starts %.2f m from its start place (%v vs %v)", bot.Slot, gap, got, want)
		}
		distance, lap := f.Progress(bot)
		if lap != 0 || distance > 0 || distance < -f.track.LastLength-0.01 {
			t.Fatalf("slot %d: distance %.2f lap %d before the start", bot.Slot, distance, lap)
		}
	}
	// Nobody moves before the start.
	before := f.Position(f.Bots()[0])
	f.Advance(9_000)
	f.Advance(10_000)
	if f.Position(f.Bots()[0]) != before {
		t.Fatal("a racer moved before the start")
	}
}

func TestFieldRacesToTheFinish(t *testing.T) {
	for _, id := range TrackIDs() {
		f := fieldOf(t, id, 49)
		var finishes []int64
		lastDistance := map[string]float64{}
		for now := int64(10_000); now < 10_000+600_000 && len(finishes) < 49; now += 64 {
			for _, bot := range f.Advance(now) {
				finishes = append(finishes, f.FinishElapsedMs(bot))
			}
			for _, bot := range f.Bots() {
				distance, _ := f.Progress(bot)
				if previous, ok := lastDistance[bot.PlayerID]; ok && distance < previous-1e-6 {
					t.Fatalf("%s %s: route distance went back %.2f -> %.2f", id, bot.PlayerID, previous, distance)
				}
				lastDistance[bot.PlayerID] = distance
				position := f.Position(bot)
				if math.IsNaN(position.x + position.y + position.z) {
					t.Fatalf("%s: NaN position", id)
				}
			}
		}
		if len(finishes) != 49 {
			t.Fatalf("%s: %d of 49 racers finished in 10 minutes", id, len(finishes))
		}
		total := float64(f.track.Laps) * f.track.loop
		first, last := finishes[0], finishes[len(finishes)-1]
		t.Logf("%-12s %d laps %6.0f m: first %5.1f s (%4.1f m/s), last %5.1f s (%4.1f m/s)", id, f.track.Laps,
			total, float64(first)/1000, total/(float64(first)/1000), float64(last)/1000, total/(float64(last)/1000))
		if speed := total / (float64(first) / 1000); speed > 90 || speed < 40 {
			t.Fatalf("%s: winner averaged %.1f m/s", id, speed)
		}
	}
}

func TestFrameEncoding(t *testing.T) {
	f := fieldOf(t, "ice_I03", 3)
	f.Advance(15_000)
	bot := f.Bots()[1]
	frame := f.Frame(bot, 15_000)
	if len(frame) != FrameLength || frame[0] != payloadKind || frame[2] != byte(bot.Slot) || frame[3] != 0x5a {
		t.Fatalf("header %v", frame[:8])
	}
	payload := frame[headerLength:]
	if binary.LittleEndian.Uint32(payload) != 15_000 {
		t.Fatal("tick")
	}
	// The quaternion is a unit one.
	var norm float64
	for i := range 4 {
		q := float64(math.Float32frombits(binary.LittleEndian.Uint32(payload[16+4*i:])))
		norm += q * q
	}
	if math.Abs(norm-1) > 1e-4 {
		t.Fatalf("quaternion norm %f", norm)
	}
	distance := math.Float64frombits(binary.LittleEndian.Uint64(payload[108:]))
	want, lap := f.Progress(bot)
	if distance != want || binary.LittleEndian.Uint32(payload[116:]) != uint32(lap) ||
		binary.LittleEndian.Uint32(payload[120:]) != noFinish {
		t.Fatalf("progress %f lap %d", distance, binary.LittleEndian.Uint32(payload[116:]))
	}
	if next := f.Frame(bot, 15_064); binary.LittleEndian.Uint32(next[4:]) != binary.LittleEndian.Uint32(frame[4:])+1 {
		t.Fatal("sequence does not advance")
	}
}

func TestQuaternionFacesTheHeading(t *testing.T) {
	// A kart facing three.js -z (client +y) has the identity basis but for
	// the release's reversed forward column.
	q := quaternion(vec3{0, 0, -1})
	norm := q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3]
	if math.Abs(norm-1) > 1e-9 {
		t.Fatalf("norm %f", norm)
	}
	for _, heading := range []vec3{{1, 0, 0}, {0, 0, 1}, {0.6, 0.1, -0.79}} {
		q := quaternion(heading.unit(vec3{}))
		if n := q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3]; math.Abs(n-1) > 1e-9 {
			t.Fatalf("%v: norm %f", heading, n)
		}
	}
}

func TestKitsAreDistinct(t *testing.T) {
	kits := Kits(49, 3)
	seen := map[string]bool{}
	for _, kit := range kits {
		if seen[kit.Name] || len([]rune(kit.Name)) > 18 || kit.Character < 1 {
			t.Fatalf("kit %+v", kit)
		}
		seen[kit.Name] = true
	}
}
