package lobby

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"strconv"
	"time"

	"kartsim/internal/game/brawl"
)

// 50人乱斗 (BRAWL.md): an individual speed race of up to 50 seats. When it
// starts, every open seat nobody sits in gets an AI racer, which the node
// drives (internal/game/brawl) and whose motion frames it sends to the
// players. Players' frames go to every other player, whatever recipient
// mask they carry (a mask byte names only slots 0–7), thinned by distance
// like the browser's own cadence (race-peer-cadence.ts).
const (
	// brawlTickMs is how often the AI racers move and may send a frame (the
	// browser's motion interval).
	brawlTickMs = 64
	// brawlRuleset names the race data a 50人乱斗 race carries.
	brawlRuleset = "web-brawl-v1"
)

// brawlRace is the 50人乱斗 state of a race.
type brawlRace struct {
	// botIDs are the AI racers' player IDs, by roster order.
	botIDs []string
	field  *brawl.Field
	bots   map[string]*brawl.Bot
	// positions are every racer's latest place (motion frame coordinates),
	// sent says when a racer's frame last went to a recipient.
	positions map[string][3]float64
	sent      map[[2]string]int64
	seed      uint64
}

func (b *brawlRace) isBot(playerID string) bool {
	return b != nil && slices.Contains(b.botIDs, playerID)
}

func (b *brawlRace) snapshot() obj {
	return obj{{"ruleset", brawlRuleset}, {"aiIds", append([]string{}, b.botIDs...)}}
}

// openSeats are the seats of a 50人乱斗 room an AI racer takes at the start:
// below the capacity, not closed and empty.
func openSeats(r *room) []int {
	var seats []int
	for slot := range r.capacity {
		if slices.Contains(r.closedSlots, slot) || slices.ContainsFunc(r.members,
			func(m *member) bool { return m.slot == slot }) {
			continue
		}
		seats = append(seats, slot)
	}
	return seats
}

// seatBrawlBots fills the open seats of a starting 50人乱斗 race with AI
// racers: in the frozen roster (an "ai" member with the AI's equipment),
// on their seats' start places, and loaded from the start.
func (l *Lobby) seatBrawlBots(r *room, rc *race) {
	if rc.brawl == nil {
		return
	}
	seats := openSeats(r)
	var seed [8]byte
	copy(seed[:], rc.id)
	rc.brawl.seed = binary.LittleEndian.Uint64(seed[:]) ^ uint64(l.clock.Now())
	kits := brawl.Kits(len(seats), rc.brawl.seed)
	for i, slot := range seats {
		id := fmt.Sprintf("ai%02d-%s", slot, rc.id[:8])
		kit := kits[i]
		equipment := brawlEquipment(kit)
		rc.roster = append(rc.roster, obj{{"playerId", id}, {"name", kit.Name}, {"slot", slot},
			{"ready", true}, {"team", nil}, {"equipment", equipment}, {"ai", true}})
		rc.rosterIDs = append(rc.rosterIDs, id)
		rc.startSlots = append(rc.startSlots, slot)
		rc.rosterAccounts[id] = ""
		rc.rosterNames[id] = kit.Name
		rc.rosterTeams[id] = 0
		rc.rosterEquipment = append(rc.rosterEquipment, equipment)
		rc.loadedIDs = append(rc.loadedIDs, id)
		rc.brawl.botIDs = append(rc.brawl.botIDs, id)
	}
}

// brawlEquipment is an AI racer's equipment: the starter system kart and
// its kit's rider, paint and dye, everything else empty.
func brawlEquipment(kit brawl.Kit) json.RawMessage {
	ids := make(map[string]int, len(equipmentSlots))
	for _, slot := range equipmentSlots {
		ids[strconv.Itoa(slot)] = 0
	}
	ids["1"], ids["2"], ids["70"] = kit.Character, kit.Paint, kit.Dye
	raw, _ := json.Marshal(struct {
		ItemIDs    map[string]int `json:"itemIds"`
		KartSerial int            `json:"kartSerial"`
		ExceedType int            `json:"exceedType"`
		ValueAt3E  int            `json:"valueAt3E"`
		SystemKart string         `json:"systemKart"`
	}{ids, 0, 0, 0, brawl.KartKey})
	return compactJSON(raw)
}

// startBrawlField puts the AI racers of a race that starts counting down on
// the grid and starts driving them.
func (l *Lobby) startBrawlField(r *room) {
	rc := r.race
	b := rc.brawl
	if b == nil || rc.startAt == nil || b.field != nil {
		return
	}
	track := brawl.TrackByID(rc.trackID)
	if track == nil {
		// The track pool and the data file come from the same export.
		l.log.Error("50人乱斗 race on a track without AI data", "track", rc.trackID)
		return
	}
	var specs []brawl.Spec
	for i, id := range rc.rosterIDs {
		if b.isBot(id) {
			specs = append(specs, brawl.Spec{PlayerID: id, Slot: rc.startSlots[i]})
		}
	}
	b.field = brawl.NewField(track, motionRaceTag(rc.id), *rc.startAt, specs, b.seed)
	b.bots = map[string]*brawl.Bot{}
	for _, bot := range b.field.Bots() {
		b.bots[bot.PlayerID] = bot
	}
	b.positions = map[string][3]float64{}
	b.sent = map[[2]string]int64{}
	l.scheduleBrawlTick(r.id, rc.id)
}

func (l *Lobby) scheduleBrawlTick(roomID, raceID string) {
	l.schedule(brawlTickMs*time.Millisecond, func() { l.brawlTick(roomID, raceID) })
}

// brawlTick moves the AI racers, records their progress and finishes, and
// sends their frames. It runs from the countdown until the race is over
// (raceOverAt), or the race is gone.
func (l *Lobby) brawlTick(roomID, raceID string) {
	r := l.rooms[roomID]
	if r == nil || r.race == nil || r.race.id != raceID || r.race.brawl == nil || r.race.brawl.field == nil {
		return
	}
	rc := r.race
	now := l.clock.Now()
	switch r.phase {
	case "countdown", "racing":
	case "finished":
		if rc.raceOverAt == nil || now >= *rc.raceOverAt {
			return
		}
	default:
		return
	}
	b := rc.brawl
	finished := b.field.Advance(now)
	if r.phase == "racing" {
		for _, bot := range b.field.Bots() {
			distance, lap := b.field.Progress(bot)
			if !rc.hasFinished(bot.PlayerID) {
				rc.current[bot.PlayerID] = routeSample{distance: distance, lap: lap}
				rc.progress[bot.PlayerID] = max(rc.progress[bot.PlayerID], distance)
			}
		}
		for _, bot := range finished {
			l.brawlBotFinished(r, bot)
		}
		if len(finished) > 0 {
			r.revision++
			l.broadcastRoom(r, nil)
		}
	}
	for _, bot := range b.field.Bots() {
		b.positions[bot.PlayerID] = b.field.WirePosition(bot)
	}
	var frame []byte
	for _, bot := range b.field.Bots() {
		frame = nil
		for _, m := range r.members {
			if !l.brawlRecipient(r, m.playerID) || !b.due(bot.PlayerID, m.playerID, now) {
				continue
			}
			if frame == nil {
				frame = b.field.Frame(bot, now)
			}
			if recipient := l.clients[m.playerID]; recipient != nil {
				recipient.sink.Binary(frame)
			}
		}
	}
	l.scheduleBrawlTick(roomID, raceID)
}

// brawlBotFinished records an AI racer's finish like a player's (lobby.go
// finish): the first finish opens the 10 s finish window. The caller
// announces it.
func (l *Lobby) brawlBotFinished(r *room, bot *brawl.Bot) {
	rc := r.race
	if rc.hasFinished(bot.PlayerID) {
		return
	}
	elapsed := int(rc.brawl.field.FinishElapsedMs(bot))
	rc.finishes = append(rc.finishes, finishRow{playerID: bot.PlayerID, elapsedMs: elapsed,
		serverAt: l.clock.Now()})
	if rc.finishDeadline == nil {
		deadline := l.clock.Now() + 10_000
		rc.finishDeadline = &deadline
		roomID, raceID := r.id, rc.id
		l.schedule(10*time.Second, func() { l.finalizeRace(roomID, raceID) })
	}
}

// brawlRecipient reports whether a member gets the race's motion: a loaded
// racer still in it.
func (l *Lobby) brawlRecipient(r *room, playerID string) bool {
	return slices.Contains(r.race.loadedIDs, playerID) && !r.race.isOut(playerID)
}

// Distance cadence (race-peer-cadence.ts tiers): a racer within 40 m of the
// recipient gets every frame; within 60 m one per 128 ms, within 100 m one
// per 256 ms, further one per 512 ms (a few ms early, for the 64 ms beat).
func cadenceMs(distance float64) int64 {
	switch {
	case distance < 40:
		return 0
	case distance < 60:
		return 120
	case distance < 100:
		return 250
	}
	return 500
}

// due reports whether sender's frame goes to recipient now, and if so
// notes it. Without a known place for either, every frame goes.
func (b *brawlRace) due(sender, recipient string, now int64) bool {
	from, ok := b.positions[sender]
	to, known := b.positions[recipient]
	key := [2]string{sender, recipient}
	if ok && known {
		if last, sent := b.sent[key]; sent && now-last < cadenceMs(brawl.Distance(from, to)) {
			return false
		}
	}
	b.sent[key] = now
	return true
}

// relayBrawlMotion sends a player's frame of a 50人乱斗 race to the other
// players by distance cadence, and keeps its place.
func (l *Lobby) relayBrawlMotion(r *room, c *Client, frame []byte) {
	b := r.race.brawl
	if b.positions == nil {
		b.positions = map[string][3]float64{}
		b.sent = map[[2]string]int64{}
	}
	payload := frame[motionHeaderLength:]
	var place [3]float64
	for i := range place {
		place[i] = float64(math.Float32frombits(binary.LittleEndian.Uint32(payload[4+4*i:])))
	}
	b.positions[c.playerID] = place
	now := l.clock.Now()
	for _, m := range r.members {
		if m.playerID == c.playerID || !l.brawlRecipient(r, m.playerID) || !b.due(c.playerID, m.playerID, now) {
			continue
		}
		if recipient := l.clients[m.playerID]; recipient != nil {
			recipient.sink.Binary(frame)
		}
	}
}

// brawlRewardRanks maps a 50人乱斗 race's reward ranks onto an eight-racer
// race (BRAWL.md 4): of total racers, rank r counts as 1 + (r-1)*8/total.
// The reward formula then sees at most eight racers, so a full field is
// worth what a full room of the release is.
func brawlRewardRank(rank, total int) int {
	if total <= maxRoomCapacity {
		return rank
	}
	return 1 + (rank-1)*maxRoomCapacity/total
}
