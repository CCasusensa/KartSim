package lobby

import (
	"encoding/binary"
	"encoding/json"
	"math"
	"slices"
	"strings"
	"testing"
	"time"

	"kartsim/internal/game/brawl"
	"kartsim/internal/shared/rewards"
)

func (h *harness) createBrawl(host *Client, capacity int) map[string]any {
	h.t.Helper()
	return h.create([]*Client{host}, "brawl", "speedIndiCombine", capacity)
}

func (h *harness) startBrawlRace(host *Client, room map[string]any) map[string]any {
	h.t.Helper()
	return h.command(host, map[string]any{"type": "start", "roomId": room["roomId"], "revision": room["revision"]})
}

func rosterAI(race map[string]any) (players, ai []map[string]any) {
	for _, entry := range list(race["roster"]) {
		if object(entry)["ai"] == true {
			ai = append(ai, object(entry))
		} else {
			players = append(players, object(entry))
		}
	}
	return players, ai
}

func TestBrawlCreationRules(t *testing.T) {
	h := newHarness(t)
	host := h.connect("Host")
	request := func(gameplay, channel string, capacity int) map[string]any {
		return map[string]any{"type": "create", "name": "乱斗", "capacity": capacity, "password": "",
			"channelName": channel, "gameplay": gameplay, "mode": "individual", "speed": 7, "speedVersion": "国服"}
	}
	for _, c := range []struct {
		gameplay, channel string
		capacity          int
		code              string
	}{
		{"ordinary", "speedIndiCombine", 9, "INVALID_CAPACITY"},
		{"giant", "speedIndiCombine", 50, "INVALID_CAPACITY"},
		{"brawl", "speedIndiCombine", 51, "INVALID_CAPACITY"},
		{"brawl", "speedIndiInfinit", 50, "INVALID_CHANNEL"},
	} {
		req := request(c.gameplay, c.channel, c.capacity)
		if c.channel == "speedIndiInfinit" {
			req["speed"] = 4
		}
		if got := h.errorCode(host, req); got != c.code {
			t.Fatalf("%+v: %s", c, got)
		}
	}
	room := h.command(host, request("brawl", "speedIndiCombine", brawl.Slots))
	assertEqual(t, room["capacity"], 50)
	assertEqual(t, room["trackId"], "village_R01")
	roomID := room["roomId"]
	if got := h.errorCode(host, map[string]any{"type": "track", "roomId": roomID, "revision": room["revision"],
		"trackId": "ice_I05"}); got != "INVALID_TRACK" {
		t.Fatalf("track outside the pool: %s", got)
	}
	room = h.command(host, map[string]any{"type": "track", "roomId": roomID, "revision": room["revision"],
		"trackId": "ice_I03"})
	if got := h.errorCode(host, map[string]any{"type": "random-track", "roomId": roomID,
		"revision": room["revision"], "randomTrackCode": 3}); got != "INVALID_TRACK" {
		t.Fatalf("random code 3: %s", got)
	}
	room = h.command(host, map[string]any{"type": "random-track", "roomId": roomID,
		"revision": room["revision"], "randomTrackCode": 0})
	// Seats up to 49 can be closed in a brawl room, and only there.
	room = h.command(host, map[string]any{"type": "slot", "roomId": roomID, "revision": room["revision"],
		"slot": 49, "closed": true})
	assertEqual(t, room["closedSlots"], []int{49})
	other := h.connect("Other")
	ordinary := h.command(other, request("ordinary", "speedIndiCombine", 8))
	if got := h.errorCode(other, map[string]any{"type": "slot", "roomId": ordinary["roomId"],
		"revision": ordinary["revision"], "slot": 8, "closed": true}); got != "INVALID_SLOT" {
		t.Fatalf("slot 8 of an ordinary room: %s", got)
	}
}

func TestBrawlStartsAloneWithAIInTheOpenSeats(t *testing.T) {
	h := newHarness(t)
	host := h.connect("Host")
	room := h.createBrawl(host, brawl.Slots)
	for _, slot := range []int{10, 11, 12} {
		room = h.command(host, map[string]any{"type": "slot", "roomId": room["roomId"],
			"revision": room["revision"], "slot": slot, "closed": true})
	}
	room = h.startBrawlRace(host, room)
	race := raceOf(room)
	players, ai := rosterAI(race)
	if len(players) != 1 || len(ai) != brawl.Slots-1-3 {
		t.Fatalf("roster: %d players, %d AI", len(players), len(ai))
	}
	slots := object(race["startSlots"])
	seen := map[int]bool{}
	for id, slot := range slots {
		n := int(slot.(float64))
		if seen[n] || n < 0 || n >= brawl.Slots || (n >= 10 && n <= 12) {
			t.Fatalf("%s starts in slot %d", id, n)
		}
		seen[n] = true
	}
	loaded := list(race["loadedIds"])
	aiIDs := list(object(race["brawl"])["aiIds"])
	if len(aiIDs) != len(ai) || len(loaded) != len(ai) {
		t.Fatalf("aiIds %d, loaded %d", len(aiIDs), len(loaded))
	}
	assertEqual(t, object(race["brawl"])["ruleset"], brawlRuleset)
	for _, entry := range ai {
		raw, _ := json.Marshal(entry["equipment"])
		name := entry["name"].(string)
		if !validEquipment(raw, true) || !strings.HasPrefix(name, brawl.NamePrefix) || entry["ready"] != true {
			t.Fatalf("AI roster entry %v", entry)
		}
	}
	// Alone with every seat closed, there is nobody to race.
	h2 := newHarness(t)
	solo := h2.connect("Solo")
	small := h2.createBrawl(solo, 2)
	small = h2.command(solo, map[string]any{"type": "slot", "roomId": small["roomId"],
		"revision": small["revision"], "slot": 1, "closed": true})
	if got := h2.errorCode(solo, map[string]any{"type": "start", "roomId": small["roomId"],
		"revision": small["revision"]}); got != "NOT_ENOUGH_PLAYERS" {
		t.Fatalf("start without open seats: %s", got)
	}
}

// brawlRace starts a brawl race of players and loads it; it returns the
// room at the countdown.
func (h *harness) brawlRace(players []*Client, capacity int) map[string]any {
	h.t.Helper()
	room := h.joinAndReady(players, h.createBrawl(players[0], capacity))
	room = h.startBrawlRace(players[0], room)
	raceID := raceOf(room)["raceId"]
	for _, p := range players {
		room = h.command(p, map[string]any{"type": "loaded", "roomId": room["roomId"], "raceId": raceID})
	}
	assertEqual(h.t, room["phase"], "countdown")
	return room
}

func TestBrawlAIFramesAreValidAndThinnedByDistance(t *testing.T) {
	h := newHarness(t)
	host := h.connect("Host")
	room := h.brawlRace([]*Client{host}, brawl.Slots)
	raceID := raceOf(room)["raceId"].(string)
	// The countdown: the AI racers stand on the grid and send frames.
	h.clock.Advance(3_000 * time.Millisecond)
	h.clock.Advance(20 * time.Second)
	sink := h.sink(host)
	sink.mu.Lock()
	frames := slices.Clone(sink.frames)
	sink.mu.Unlock()
	if len(frames) == 0 {
		t.Fatal("no AI frames")
	}
	perSlot := map[byte]int{}
	for _, frame := range frames {
		if len(frame) != brawl.FrameLength || frame[motionRaceTagOffset] != motionRaceTag(raceID) ||
			!validPayload(int(frame[0]), frame[motionHeaderLength:]) || frame[motionSlotOffset] == 0 {
			t.Fatalf("invalid AI frame %v", frame[:8])
		}
		perSlot[frame[motionSlotOffset]]++
	}
	if len(perSlot) != brawl.Slots-1 {
		t.Fatalf("frames from %d AI racers", len(perSlot))
	}
	// The host never sent its place, so every frame goes: 23 s of 64 ms
	// beats. Once it has, far racers come less often.
	most := 0
	for _, n := range perSlot {
		most = max(most, n)
	}
	if most < 300 {
		t.Fatalf("at most %d frames per AI racer in 23 s", most)
	}
	far := motionFrame(raceID, 0, 0, motionHeaderLength+kinematicPayloadLength(7))
	binary.LittleEndian.PutUint32(far[motionHeaderLength+4:], math.Float32bits(1e5))
	h.lobby.RelayMotion(host, far)
	before := sink.frameCount()
	h.clock.Advance(10 * time.Second)
	if got := sink.frameCount() - before; got > (brawl.Slots-1)*25 {
		t.Fatalf("%d frames in 10 s from racers 100 km away", got)
	}
}

func TestBrawlPlayersHearEachOtherWhateverTheMask(t *testing.T) {
	h := newHarness(t)
	players := h.connectN(2)
	room := h.brawlRace(players, brawl.Slots)
	raceID := raceOf(room)["raceId"].(string)
	before := h.sink(players[1]).frameCount()
	h.lobby.RelayMotion(players[0], motionFrame(raceID, 0, 0, motionHeaderLength+kinematicPayloadLength(7)))
	if h.sink(players[1]).frameCount() != before+1 {
		t.Fatal("a brawl frame with an empty mask was not relayed")
	}
}

func TestBrawlResultsAndRewards(t *testing.T) {
	h := newHarness(t)
	host := h.connect("Host")
	room := h.brawlRace([]*Client{host}, brawl.Slots)
	roomID, raceID := room["roomId"], raceOf(room)["raceId"]
	h.clock.Advance(3 * time.Second) // racing
	h.clock.Advance(60 * time.Second)
	room = h.command(host, map[string]any{"type": "finish", "roomId": roomID, "raceId": raceID,
		"elapsedMs": 60_000})
	race := raceOf(room)
	assertEqual(t, room["phase"], "finished")
	results := list(race["results"])
	if len(results) != brawl.Slots {
		t.Fatalf("%d results", len(results))
	}
	first := object(results[0])
	assertEqual(t, first["playerId"], memberOf(t, room, first["playerId"].(string))["playerId"])
	// The AI racers still on the track rank by how far they got.
	settlement := h.recorder.settlements()[0]
	previous := math.Inf(1)
	for _, result := range settlement.Results[1:] {
		distance := float64(result.DistanceMeters)
		if result.AccountID != "" || distance > previous+1 || result.ElapsedMs != nil {
			t.Fatalf("AI result %+v after %.0f m", result, previous)
		}
		previous = distance
	}
	// Only the player is rewarded, as the winner of an eight-racer race.
	if len(settlement.Rewards) != 1 {
		t.Fatalf("rewards %+v", settlement.Rewards)
	}
	want := rewards.RaceRewards(rewards.RaceInput{Channel: "speedIndiCombine", Mode: "individual",
		Racers: []rewards.Racer{{PlayerID: "p", Rank: 1, Finished: true}}, Counted: 8,
		Rates: rewards.DefaultRates()})[0]
	got := settlement.Rewards[0]
	if int64(got.Exp) != want.Exp || int64(got.Lucci) != want.Lucci {
		t.Fatalf("reward %+v, want %+v", got, want.Reward)
	}
	// Nothing keeps ticking once the race is over.
	h.clock.Advance(10 * time.Second)
	h.command(host, map[string]any{"type": "return-room", "roomId": roomID, "raceId": raceID})
	h.clock.Advance(time.Second)
	if pending := h.clock.pending(); pending > 2 {
		t.Fatalf("%d timers left after the race", pending)
	}
}

func TestBrawlAIFinishOpensTheWindow(t *testing.T) {
	h := newHarness(t)
	host := h.connect("Host")
	room := h.brawlRace([]*Client{host}, brawl.Slots)
	h.clock.Advance(3 * time.Second)
	// The player never finishes: the first AI finish opens the 10 s window,
	// then the race ends with the player last.
	h.clock.Advance(240 * time.Second)
	last := h.sink(host).last(t)
	final := object(last["room"])
	if final == nil {
		final = room
	}
	settlement := h.recorder.settlements()
	if len(settlement) != 1 {
		t.Fatalf("%d settlements", len(settlement))
	}
	results := settlement[0].Results
	if results[0].ElapsedMs == nil || results[len(results)-1].Name != "Host" {
		t.Fatalf("first %+v last %+v", results[0], results[len(results)-1])
	}
	unfinished := rewards.RaceRewards(rewards.RaceInput{Channel: "speedIndiCombine", Mode: "individual",
		Racers: []rewards.Racer{{PlayerID: "p", Rank: 8}}, Counted: 8, Rates: rewards.DefaultRates()})[0]
	if got := settlement[0].Rewards[0]; int64(got.Exp) != unfinished.Exp || int64(got.Lucci) != unfinished.Lucci {
		t.Fatalf("unfinished player reward %+v", got)
	}
}

func TestBrawlStopsWhenThePlayersLeave(t *testing.T) {
	h := newHarness(t)
	host := h.connect("Host")
	room := h.brawlRace([]*Client{host}, brawl.Slots)
	h.clock.Advance(5 * time.Second)
	h.must(host, map[string]any{"type": "leave", "roomId": room["roomId"]})
	h.clock.Advance(time.Second)
	if pending := h.clock.pending(); pending > 1 {
		t.Fatalf("%d timers left after everyone left", pending)
	}
}

func TestBrawlSeatsFiftyPlayers(t *testing.T) {
	h := newHarnessWith(t, func(o *Options) { o.MaxPlayers = 100 })
	players := h.connectN(brawl.Slots)
	room := h.joinAndReady(players, h.createBrawl(players[0], brawl.Slots))
	if len(list(room["members"])) != brawl.Slots {
		t.Fatalf("%d members", len(list(room["members"])))
	}
	extra := h.connect("Extra")
	if got := h.errorCode(extra, map[string]any{"type": "join", "roomId": room["roomId"]}); got != "ROOM_FULL" {
		t.Fatalf("51st join: %s", got)
	}
	room = h.startBrawlRace(players[0], room)
	_, ai := rosterAI(raceOf(room))
	if len(ai) != 0 || len(list(raceOf(room)["roster"])) != brawl.Slots {
		t.Fatalf("full room raced %d AI", len(ai))
	}
}

func TestBrawlRewardRank(t *testing.T) {
	for _, c := range []struct{ rank, total, want int }{
		{1, 50, 1}, {7, 50, 1}, {8, 50, 2}, {50, 50, 8}, {25, 50, 4}, {3, 5, 3}, {8, 8, 8},
	} {
		if got := brawlRewardRank(c.rank, c.total); got != c.want {
			t.Fatalf("rank %d of %d: %d, want %d", c.rank, c.total, got, c.want)
		}
	}
}
