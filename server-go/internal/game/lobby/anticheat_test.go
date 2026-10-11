package lobby

import (
	"bytes"
	"encoding/binary"
	"log/slog"
	"math"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"kartsim/internal/game/cheat"
	"kartsim/internal/game/itemmode"
	"kartsim/internal/shared/contract"
)

// fakeGuard is an in-process cheat.Guard: it records what the lobby
// reports and answers with the scripted functions (nil: no violation).
type fakeGuard struct {
	races  []*fakeRace
	motion func(x *fakeRacer, kind int, valid bool, payload []byte) *cheat.Violation
	finish func(x *fakeRacer, f cheat.Finish) (*cheat.Violation, map[string]any)
	cube   func(x *fakeRacer, cubeID int) *cheat.Violation
	charge func(x *fakeRacer, amount float64) *cheat.Violation
	item   func(e cheat.ItemEvent) *cheat.Violation
	cap    float64 // the progress cap (0: no opinion)
}

type fakeRace struct {
	g      *fakeGuard
	info   cheat.RaceInfo
	racers map[string]*fakeRacer
	items  []cheat.ItemEvent
	ended  bool
}

type fakeFrame struct {
	kind  int
	valid bool
	now   int64
}

type fakeRacer struct {
	race     *fakeRace
	playerID string
	kart     int
	frames   []fakeFrame
	items    []int
	cubes    []int
	slots    [][2]int // claimed and real item slots, by cube
	charges  []float64
	finishes []cheat.Finish
}

func (g *fakeGuard) StartRace(info cheat.RaceInfo, _ int64) cheat.Race {
	r := &fakeRace{g: g, info: info, racers: map[string]*fakeRacer{}}
	g.races = append(g.races, r)
	return r
}

func (r *fakeRace) Racer(playerID string, kart int) cheat.Racer {
	x := &fakeRacer{race: r, playerID: playerID, kart: kart}
	r.racers[playerID] = x
	return x
}

func (r *fakeRace) ProgressCap(int, int64) (float64, bool) { return r.g.cap, r.g.cap > 0 }
func (r *fakeRace) End()                                   { r.ended = true }

func (r *fakeRace) Item(e cheat.ItemEvent) *cheat.Violation {
	r.items = append(r.items, e)
	if r.g.item == nil {
		return nil
	}
	return r.g.item(e)
}

func (x *fakeRacer) Motion(kind int, valid bool, now int64, payload []byte) *cheat.Violation {
	x.frames = append(x.frames, fakeFrame{kind, valid, now})
	if x.race.g.motion == nil {
		return nil
	}
	return x.race.g.motion(x, kind, valid, payload)
}

func (x *fakeRacer) Finish(f cheat.Finish) (*cheat.Violation, map[string]any) {
	x.finishes = append(x.finishes, f)
	if x.race.g.finish == nil {
		return nil, nil
	}
	return x.race.g.finish(x, f)
}

func (x *fakeRacer) ItemUse(itemID int) { x.items = append(x.items, itemID) }

func (x *fakeRacer) Cube(cubeID, claimed, slots int, _ int64) *cheat.Violation {
	x.cubes = append(x.cubes, cubeID)
	x.slots = append(x.slots, [2]int{claimed, slots})
	if x.race.g.cube == nil {
		return nil
	}
	return x.race.g.cube(x, cubeID)
}

func (x *fakeRacer) TeamCharge(amount float64, _ int64) *cheat.Violation {
	x.charges = append(x.charges, amount)
	if x.race.g.charge == nil {
		return nil
	}
	return x.race.g.charge(x, amount)
}

// cheatHarness runs the lobby with g as its anti-cheat; its log lines are
// in the returned buffer.
func cheatHarness(t *testing.T, g *fakeGuard, adjust func(*Options)) (*harness, *bytes.Buffer) {
	t.Helper()
	logs := &bytes.Buffer{}
	h := newHarnessWith(t, func(opts *Options) {
		opts.AntiCheat = g
		opts.Logger = slog.New(slog.NewTextHandler(logs, nil))
		if adjust != nil {
			adjust(opts)
		}
	})
	return h, logs
}

// connectClosing is connect with a sink that records close requests.
func (h *harness) connectClosing(name string) (*Client, *closingSink) {
	h.t.Helper()
	sink := &closingSink{}
	c := NewClient(sink)
	h.sinks[c] = &sink.recordingSink
	h.must(c, helloRequest(name, h.guestTicket()))
	return c, sink
}

// kartFrame is a kind 10 frame of raceID at x meters east with route
// distance and lap, ticked with the lobby clock.
func (h *harness) kartFrame(raceID string, x, distance float64, lap int) []byte {
	frame := progressFrame(raceID, 10, distance)
	payload := frame[motionHeaderLength:]
	binary.LittleEndian.PutUint32(payload, uint32(h.clock.Now()))
	binary.LittleEndian.PutUint32(payload[4:], math.Float32bits(float32(x)))
	binary.LittleEndian.PutUint32(frame[lapOffset:], uint32(lap))
	return frame
}

func (h *harness) cheatReports() []contract.AntiCheatReport { return h.recorder.antiCheatReports() }

// farIsCheating flags frames more than 1000 m east (with action).
func farIsCheating(action string) func(*fakeRacer, int, bool, []byte) *cheat.Violation {
	return func(_ *fakeRacer, _ int, valid bool, payload []byte) *cheat.Violation {
		if !valid {
			return &cheat.Violation{Code: "BAD_FRAME", Detail: "坏帧", Action: action}
		}
		if math.Float32frombits(binary.LittleEndian.Uint32(payload[4:])) > 1000 {
			return &cheat.Violation{Code: "FAR", Detail: "太远", Action: action}
		}
		return nil
	}
}

// Without a plugin nothing is checked, but a payload the browsers cannot
// decode is never relayed.
func TestNoPluginOnlyDropsBadFrames(t *testing.T) {
	h := newHarness(t)
	a, b := h.connect("A"), h.connect("B")
	_, raceID := h.startRace([]*Client{a, b}, "ordinary", "speedIndiCombine", 2)
	h.lobby.RelayMotion(a, h.kartFrame(raceID, 5_000, 10, 1))
	bad := h.kartFrame(raceID, 0, 10, 1)
	binary.LittleEndian.PutUint32(bad[motionHeaderLength+16:], 0) // a zero quaternion
	h.lobby.RelayMotion(a, bad)
	if got := h.sink(b).frameCount(); got != 1 {
		t.Fatalf("frames relayed %d, want 1", got)
	}
	if len(h.cheatReports()) != 0 {
		t.Fatal("reports without a plugin")
	}
}

// The plugin hears of the race at its countdown, each racer with its kart,
// the frames (invalid ones at any time, valid ones while racing and before
// the racer's finish), item uses, cubes (not with test grants), team
// charges and finishes; its progress cap bounds the settled distance; the
// race ends when the room reopens.
func TestPluginHearsTheRace(t *testing.T) {
	g := &fakeGuard{cap: 2_000}
	h, logs := cheatHarness(t, g, nil)
	a, b := h.connect("A"), h.connect("B")
	room := h.joinAndReady([]*Client{a, b}, h.create([]*Client{a, b}, "ordinary", "speedTeamCombine", 2))
	roomID := room["roomId"].(string)
	room = h.command(a, map[string]any{"type": "start", "roomId": roomID, "revision": room["revision"]})
	raceID := raceOf(room)["raceId"].(string)
	h.must(a, map[string]any{"type": "loaded", "roomId": roomID, "raceId": raceID})
	h.must(b, map[string]any{"type": "loaded", "roomId": roomID, "raceId": raceID})
	if len(g.races) != 1 {
		t.Fatalf("races %d after the countdown began", len(g.races))
	}
	race := g.races[0]
	if race.info.TrackID != "village_R01" || race.info.Gameplay != "ordinary" || race.info.Mode != "team" ||
		race.info.Speed != 7 || race.info.ResourceVersion != "p3553" || race.info.StartAt != h.clock.Now()+3_000 {
		t.Fatalf("race info %+v", race.info)
	}
	// Countdown: a valid frame is not checked, an invalid one is.
	h.lobby.RelayMotion(a, h.kartFrame(raceID, 0, 10, 1))
	bad := h.kartFrame(raceID, 0, 10, 1)
	binary.LittleEndian.PutUint32(bad[motionHeaderLength+16:], 0)
	h.lobby.RelayMotion(a, bad)
	h.clock.Advance(4 * time.Second) // racing for a second
	h.lobby.RelayMotion(a, h.kartFrame(raceID, 10, 1e7, 1))
	x := race.racers[a.playerID]
	if x == nil || x.kart != 1 || len(x.frames) != 2 || x.frames[0].valid || !x.frames[1].valid ||
		x.frames[1].kind != 10 || x.frames[1].now != h.clock.Now() {
		t.Fatalf("racer %+v", x)
	}
	h.must(a, map[string]any{"type": "team-charge", "roomId": roomID, "raceId": raceID, "sequence": 1, "charge": 2_500_000})
	h.clock.Advance(79 * time.Second)
	h.must(a, map[string]any{"type": "finish", "roomId": roomID, "raceId": raceID, "elapsedMs": 80_000})
	h.lobby.RelayMotion(a, h.kartFrame(raceID, 20, 30, 2))
	if len(x.frames) != 2 || len(x.charges) != 1 || x.charges[0] != 2_500_000 || len(x.finishes) != 1 ||
		x.finishes[0] != (cheat.Finish{ElapsedMs: 80_000, RacedMs: 80_000, Progress: 2_000, ExpectFrames: true}) {
		t.Fatalf("after the finish %+v", x)
	}
	h.must(b, map[string]any{"type": "finish", "roomId": roomID, "raceId": raceID, "elapsedMs": 80_100})
	if d := h.recorder.settlements()[0].Results; d[0].DistanceMeters != 2_000 {
		t.Fatalf("settled distance %d, want the plugin's cap", d[0].DistanceMeters)
	}
	for _, p := range []*Client{a, b} {
		h.must(p, map[string]any{"type": "return-room", "roomId": roomID, "raceId": raceID})
	}
	if !race.ended {
		t.Fatal("the race did not end in the plugin")
	}
	if strings.Contains(logs.String(), "anti-cheat stats") {
		t.Fatal("stats logged without any")
	}
}

func TestPluginHearsItemRaces(t *testing.T) {
	for _, grants := range []bool{false, true} {
		g := &fakeGuard{}
		h, _ := cheatHarness(t, g, func(opts *Options) { opts.ItemTestGrants = grants })
		a, b := h.connect("A"), h.connect("B")
		ir := h.startItemRace([]*Client{a, b}, "itemIndiCombine")
		ir.random.values = append(ir.random.values, 0)
		ir.rawReply(a, "cube", map[string]any{"cubeId": 1, "capacity": 2})
		x := g.races[0].racers[a.playerID]
		if grants {
			if x != nil && len(x.cubes) != 0 {
				t.Fatal("cubes checked with test grants on")
			}
			continue
		}
		if x == nil || len(x.cubes) != 1 || x.cubes[0] != 1 {
			t.Fatalf("cubes %+v", x)
		}
		// The claimed slots go to the plugin beside the kart's own (kart 1: 2).
		ir.rawReply(a, "cube", map[string]any{"cubeId": 2, "capacity": 3})
		if len(x.slots) != 2 || x.slots[0] != [2]int{2, 2} || x.slots[1] != [2]int{3, 2} {
			t.Fatalf("slots %v", x.slots)
		}
		slots := ir.send(a, "slots", nil)["slots"].([]any)
		if len(slots) != 2 {
			t.Fatalf("a kart 1 racer holds %d slots", len(slots))
		}
		if item := int(slots[0].(float64)); item >= 0 {
			ir.send(a, "use", map[string]any{"itemId": item, "point": map[string]any{"x": 1, "y": 2, "z": 3}})
			if len(x.items) != 1 || x.items[0] != item {
				t.Fatalf("item uses %v, want [%d]", x.items, item)
			}
		}
		h.must(a, map[string]any{"type": "finish", "roomId": ir.roomID, "raceId": ir.raceID, "elapsedMs": 10_000,
			"perfectStart": true})
		if len(x.finishes) != 1 || !x.finishes[0].PerfectStart || x.finishes[0].RacedMs <= 0 {
			t.Fatalf("finishes %+v", x.finishes)
		}
	}
}

// The roadblock runner's finish wins the race, so the plugin checks it; a
// kick ends the race as the runner leaving (the blockers win).
func TestPluginChecksTheRoadblockRunnersFinish(t *testing.T) {
	g := &fakeGuard{finish: func(x *fakeRacer, f cheat.Finish) (*cheat.Violation, map[string]any) {
		return &cheat.Violation{Code: "EARLY", Detail: "早", Action: cheat.ActionKick}, nil
	}}
	h, _ := cheatHarness(t, g, nil)
	players := make([]*Client, 5)
	for i := range players {
		players[i], _ = h.connectClosing("P" + strconv.Itoa(i))
	}
	roomID, raceID := h.startRace(players, "roadblock", "speedIndiCombine", 5)
	h.clock.Advance(10 * time.Second)
	if code := h.errorCode(players[0], map[string]any{"type": "finish", "roomId": roomID, "raceId": raceID,
		"elapsedMs": 10_000}); code != "CHEAT_DETECTED" {
		t.Fatalf("runner finish: %s", code)
	}
	runner := g.races[0].racers[players[0].playerID]
	if runner == nil || len(runner.finishes) != 1 || runner.finishes[0].ElapsedMs != 10_000 || runner.finishes[0].RacedMs <= 0 {
		t.Fatalf("runner checks %+v", runner)
	}
	room := object(h.sink(players[1]).last(t)["room"])
	outcome := object(raceOf(room)["roadblockOutcome"])
	if room["phase"] != "finished" || outcome["runnerWon"] != false || outcome["reason"] != "runner-left" {
		t.Fatalf("outcome %v (%v)", outcome, room["phase"])
	}
}

// In an RP race the plugin judges the kart the node drew, not the racer's own.
func TestPluginJudgesTheRpKart(t *testing.T) {
	g := &fakeGuard{}
	h, _ := cheatHarness(t, g, nil)
	a, _ := h.connectClosing("A")
	b, _ := h.connectClosing("B")
	_, raceID := h.startRace([]*Client{a, b}, "rp", "speedIndiInfinit", 2)
	h.lobby.RelayMotion(a, h.kartFrame(raceID, 0, 10, 1))
	x := g.races[0].racers[a.playerID]
	drawn, ok := rpKart(h.lobby.rooms[h.lobby.clients[a.playerID].roomID].race, a.playerID)
	if x == nil || !ok || x.kart != drawn || !slices.Contains(rpKarts, drawn) {
		t.Fatalf("racer %+v, drawn %d %v", x, drawn, ok)
	}
}

// The plugin hears item uses, placed points and every judged hit report
// (repeats marked, refusals with their code), with the item's lifetimes; a
// report it refuses kicks the reporter.
func TestPluginHearsItemReports(t *testing.T) {
	g := &fakeGuard{item: func(e cheat.ItemEvent) *cheat.Violation {
		if e.Kind == cheat.ItemHit && e.Error != "" {
			return &cheat.Violation{Code: "LIAR", Detail: e.Error, Action: cheat.ActionKick}
		}
		return nil
	}}
	h, _ := cheatHarness(t, g, nil)
	a, _ := h.connectClosing("A")
	b, bSink := h.connectClosing("B")
	ir := h.startItemRace([]*Client{a, b}, "itemIndiCombine")
	ir.at(a, 500, 1)
	ir.at(b, 600, 1)
	ir.grant(a, 1, itemmode.GroupHigh, itemmode.Rocket)
	used := ir.send(a, "use", map[string]any{"itemId": itemmode.Rocket, "targetId": b.playerID})
	ir.send(b, "hit", map[string]any{"useId": 1, "itemId": 7, "result": "blocked", "by": "shield"})
	ir.send(b, "hit", map[string]any{"useId": 1, "itemId": 7, "result": "hit"})
	if code := ir.reject(b, "hit", map[string]any{"useId": 9, "itemId": 7, "result": "hit"}); code != "CHEAT_DETECTED" {
		t.Fatalf("refused report: %s", code)
	}
	race := g.races[0]
	if len(race.items) != 4 {
		t.Fatalf("item events %+v", race.items)
	}
	use, first, repeat, refused := race.items[0], race.items[1], race.items[2], race.items[3]
	if use.Kind != cheat.ItemUse || use.PlayerID != a.playerID || use.UseID != 1 || use.ItemID != 7 ||
		len(use.Targets) != 1 || use.Targets[0] != b.playerID || use.StartAt != int64(used["startAt"].(float64)) ||
		use.EtaMs != int(used["etaMs"].(float64)) || use.Count != 1 || use.States["Use"] != 1500 || use.Point != nil {
		t.Fatalf("use %+v", use)
	}
	if first.Kind != cheat.ItemHit || first.PlayerID != b.playerID || first.Result != "blocked" ||
		first.By != "shield" || first.Repeat || first.Error != "" || first.At != h.clock.Now() {
		t.Fatalf("report %+v", first)
	}
	if !repeat.Repeat || repeat.Result != "hit" || refused.Error != "INVALID_USE" || refused.UseID != 9 {
		t.Fatalf("repeat %+v, refused %+v", repeat, refused)
	}
	assertEqual(t, bSink.closes, []string{"1008 anti-cheat"})
	if reports := h.cheatReports(); len(reports) != 1 || reports[0].Code != "LIAR" || reports[0].PlayerID != b.playerID {
		t.Fatalf("reports %+v", reports)
	}
}

// A kick: the racer is told why, leaves the race at once and is closed;
// nobody receives the frame, its later commands and frames are refused,
// and it ranks as retired without a reward.
func TestPluginKick(t *testing.T) {
	g := &fakeGuard{motion: farIsCheating(cheat.ActionKick)}
	h, logs := cheatHarness(t, g, nil)
	cheater, sink := h.connectClosing("Cheater")
	honest, _ := h.connectClosing("Honest")
	roomID, raceID := h.startRace([]*Client{cheater, honest}, "ordinary", "speedIndiCombine", 2)

	h.lobby.RelayMotion(cheater, h.kartFrame(raceID, 0, 10, 1))
	h.clock.Advance(64 * time.Millisecond)
	h.lobby.RelayMotion(cheater, h.kartFrame(raceID, 2_000, 14, 1))
	if got := h.sink(honest).frameCount(); got != 1 {
		t.Fatalf("honest racer got %d frames, want only the first", got)
	}
	kick := h.sink(cheater).last(t)
	if kick["type"] != "error" || kick["code"] != "CHEAT_DETECTED" || kick["check"] != "FAR" {
		t.Fatalf("kick %v", kick)
	}
	assertEqual(t, sink.closes, []string{"1008 anti-cheat"})
	reports := h.cheatReports()
	if len(reports) != 1 || reports[0].Code != "FAR" || reports[0].Detail != "太远" ||
		reports[0].Action != contract.AntiCheatKick || reports[0].PlayerID != cheater.playerID ||
		reports[0].RaceID != raceID || reports[0].TrackID != "village_R01" || reports[0].NodeID != testNodeID ||
		len(reports[0].EventID) != 36 {
		t.Fatalf("reports %+v", reports)
	}
	if !strings.Contains(logs.String(), "check=FAR") {
		t.Fatalf("not logged: %s", logs)
	}
	room := object(h.sink(honest).last(t)["room"])
	assertEqual(t, len(list(room["members"])), 1)
	assertEqual(t, room["phase"], "racing")

	if code := h.errorCode(cheater, map[string]any{"type": "clock", "clientTick": 1}); code != "CHEAT_DETECTED" {
		t.Fatalf("command after the kick: %s", code)
	}
	h.lobby.RelayMotion(cheater, h.kartFrame(raceID, 2_000, 20, 1))
	if got := h.sink(honest).frameCount(); got != 1 {
		t.Fatal("a kicked racer's frame was relayed")
	}
	h.lobby.Disconnect(cheater)

	h.clock.Advance(100 * time.Second)
	h.must(honest, map[string]any{"type": "finish", "roomId": roomID, "raceId": raceID, "elapsedMs": 100_000})
	settlement := h.recorder.settlements()[0]
	if len(settlement.Results) != 2 || settlement.Results[0].PlayerID != honest.playerID ||
		settlement.Results[1].PlayerID != cheater.playerID || settlement.Results[1].ElapsedMs != nil {
		t.Fatalf("results %+v", settlement.Results)
	}
	for _, reward := range settlement.Rewards {
		if reward.PlayerID == cheater.playerID {
			t.Fatalf("the kicked racer was rewarded: %+v", reward)
		}
	}
}

// A logged violation is recorded; nothing else changes.
func TestPluginLogsOnly(t *testing.T) {
	g := &fakeGuard{motion: farIsCheating(cheat.ActionLog)}
	h, _ := cheatHarness(t, g, nil)
	a, aSink := h.connectClosing("A")
	b, _ := h.connectClosing("B")
	_, raceID := h.startRace([]*Client{a, b}, "ordinary", "speedIndiCombine", 2)
	h.lobby.RelayMotion(a, h.kartFrame(raceID, 5_000, 10, 1))
	reports := h.cheatReports()
	if len(reports) != 1 || reports[0].Action != contract.AntiCheatLog || len(aSink.closes) != 0 ||
		h.sink(b).frameCount() != 1 {
		t.Fatalf("log: %+v, closes %v, frames %d", reports, aSink.closes, h.sink(b).frameCount())
	}
}

// A refused finish, cube or team charge answers CHEAT_DETECTED and kicks;
// a finish's stats are logged.
func TestPluginRefusesCommands(t *testing.T) {
	kick := func(code string) *cheat.Violation {
		return &cheat.Violation{Code: code, Detail: code, Action: cheat.ActionKick}
	}
	g := &fakeGuard{
		finish: func(x *fakeRacer, f cheat.Finish) (*cheat.Violation, map[string]any) {
			if f.ElapsedMs < 30_000 {
				return kick("QUICK"), nil
			}
			return nil, map[string]any{"frames": 7, "kart": x.kart}
		},
		charge: func(*fakeRacer, float64) *cheat.Violation { return kick("CHARGE") },
	}
	h, logs := cheatHarness(t, g, nil)
	a, _ := h.connectClosing("A")
	b, _ := h.connectClosing("B")
	roomID, raceID := h.startRace([]*Client{a, b}, "ordinary", "speedIndiCombine", 2)
	h.clock.Advance(20 * time.Second)
	if code := h.errorCode(a, map[string]any{"type": "finish", "roomId": roomID, "raceId": raceID,
		"elapsedMs": 20_000}); code != "CHEAT_DETECTED" {
		t.Fatalf("refused finish: %s", code)
	}
	h.clock.Advance(20 * time.Second)
	h.must(b, map[string]any{"type": "finish", "roomId": roomID, "raceId": raceID, "elapsedMs": 40_000})
	if !strings.Contains(logs.String(), "anti-cheat stats") || !strings.Contains(logs.String(), "frames=7") ||
		!strings.Contains(logs.String(), "kart=1") {
		t.Fatalf("stats not logged: %s", logs)
	}

	g = &fakeGuard{charge: func(*fakeRacer, float64) *cheat.Violation { return kick("CHARGE") }}
	h, _ = cheatHarness(t, g, nil)
	players := []*Client{}
	for _, name := range []string{"C", "D"} {
		c, _ := h.connectClosing(name)
		players = append(players, c)
	}
	roomID, raceID = h.startRace(players, "ordinary", "speedTeamCombine", 2)
	if code := h.errorCode(players[0], map[string]any{"type": "team-charge", "roomId": roomID, "raceId": raceID,
		"sequence": 1, "charge": 100}); code != "CHEAT_DETECTED" {
		t.Fatalf("refused team charge: %s", code)
	}
}
