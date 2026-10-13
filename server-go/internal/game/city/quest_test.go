package city

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"kartsim/internal/shared/contract"
)

// fakeQuestRewards records the deliveries the node credits.
type fakeQuestRewards struct {
	mu       sync.Mutex
	requests []contract.CityQuestRewardRequest
}

func (f *fakeQuestRewards) Reward(_ context.Context, request contract.CityQuestRewardRequest) (contract.CityQuestReward, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.requests = append(f.requests, request)
	return contract.CityQuestReward{Exp: request.Exp, Lucci: request.Lucci, WalletLucci: 10_000 + request.Lucci,
		TotalExp: request.Exp, Level: 2, LevelUps: []contract.CityQuestLevelUp{{Level: 2, Lucci: 200}}}, nil
}

func questHarness(t *testing.T) (*harness, *fakeQuestRewards, *QuestBook) {
	t.Helper()
	rewards := &fakeQuestRewards{}
	h := newHarness(t, Options{Lines: 1, QuestRewards: rewards, AFKTimeout: 24 * time.Hour})
	return h, rewards, h.svc.quests
}

// presentationFrame is a kind-3 city frame (108-byte payload) at a design
// position with a forward speed (m/s) and a collision counter.
func presentationFrame(sequence uint32, x, z, speed float64, collisions uint32) []byte {
	base := motionFrame(sequence, x, 10, z, 0)
	frame := make([]byte, headerLength+108)
	copy(frame, base)
	frame[kindOffset] = 3
	payload := frame[headerLength:]
	binary.LittleEndian.PutUint32(payload[forwardSpeedOffset:], math.Float32bits(float32(speed)))
	binary.LittleEndian.PutUint32(payload[collisionSequenceOffset:], collisions)
	return frame
}

func (h *harness) atNPC(p *peer, npc QuestNPC) {
	h.t.Helper()
	h.at(p, npc.X+1, 10, npc.Z, 0)
}

// droveTo puts p beside npc as if it had driven there (a respawn that far
// would end a delivery).
func (h *harness) droveTo(p *peer, npc QuestNPC) {
	h.t.Helper()
	inst := h.svc.lineOf(p.c)
	inst.mu.Lock()
	defer inst.mu.Unlock()
	inst.place(inst.members[p.c], Pose{X: npc.X + 1, Y: 10, Z: npc.Z}, h.clock.Now())
}

func TestEmbeddedQuestsMatchDesign(t *testing.T) {
	source := filepath.Join("..", "..", "..", "..", "design", "open-world", "vice-city", "city-quests.json")
	design, err := os.ReadFile(source)
	if err != nil {
		if os.IsNotExist(err) {
			t.Skipf("%s is not in this checkout", source)
		}
		t.Fatal(err)
	}
	if !bytes.Equal(design, embeddedQuests) {
		t.Fatalf("internal/game/city/city-quests.json differs from %s; rebuild with build-city-quests.mjs", source)
	}
	book, err := DefaultQuests()
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]int{}
	for _, q := range book.Quests {
		kinds[q.Kind]++
	}
	if len(book.Quests) < 8 || kinds[QuestSpeed] == 0 || kinds[QuestCollision] == 0 || kinds[QuestTime] == 0 || kinds[QuestNormal] == 0 {
		t.Fatalf("quests by kind %v", kinds)
	}
}

// Accept at the giver, deliver at the receiver: the data service credits the
// quest's reward once, with the run id it was accepted under.
func TestQuestAcceptAndDeliver(t *testing.T) {
	h, rewards, book := questHarness(t)
	quest := book.Quests["beach-brochures"]
	p := h.player("Alice")
	h.join(p, `{"type":"city-join"}`)
	h.at(p, -400, 10, 300, 0) // far from every NPC (the main spawn is beside the beach guide)
	h.refused(p, `{"type":"city-quest-accept","quest":"beach-brochures"}`, "TOO_FAR")
	h.refused(p, `{"type":"city-quest-accept","quest":"nope"}`, "INVALID_QUEST")
	h.atNPC(p, book.NPCs[quest.Giver])
	accepted := h.must(p, `{"type":"city-quest-accept","quest":"beach-brochures"}`)
	if accepted["type"] != "city-quest" || accepted["quest"] != "beach-brochures" || accepted["runId"] == "" ||
		accepted["deadline"] != float64(0) {
		t.Fatalf("accept %v", accepted)
	}
	h.refused(p, `{"type":"city-quest-accept","quest":"beach-coconut"}`, "QUEST_ACTIVE")
	h.refused(p, `{"type":"city-quest-deliver"}`, "TOO_FAR")
	h.clock.Advance(2 * time.Second)
	h.droveTo(p, book.NPCs[quest.Receiver])
	done := h.must(p, `{"type":"city-quest-deliver"}`)
	if done["type"] != "city-quest-done" || done["exp"] != float64(quest.Exp) || done["lucci"] != float64(quest.Lucci) ||
		done["level"] != float64(2) || len(done["levelUps"].([]any)) != 1 {
		t.Fatalf("deliver %v", done)
	}
	if len(rewards.requests) != 1 || rewards.requests[0].RunID != accepted["runId"] ||
		rewards.requests[0].QuestID != quest.ID || rewards.requests[0].Exp != quest.Exp {
		t.Fatalf("credited %+v", rewards.requests)
	}
	h.clock.Advance(2 * time.Second)
	h.refused(p, `{"type":"city-quest-deliver"}`, "NO_QUEST")
	// A new delivery may start; abandoning it ends it quietly.
	h.atNPC(p, book.NPCs[quest.Giver])
	h.must(p, `{"type":"city-quest-accept","quest":"beach-coconut"}`)
	h.must(p, `{"type":"city-quest-abandon"}`)
	h.refused(p, `{"type":"city-quest-abandon"}`, "NO_QUEST")
	// Commands are limited to a few a second.
	for range 6 {
		_, _ = h.call(p, `{"type":"city-quest-abandon"}`)
	}
	h.refused(p, `{"type":"city-quest-abandon"}`, "RATE_LIMITED")
}

func questEvents(t *testing.T, p *peer, typ string) []map[string]any {
	t.Helper()
	return ofType(p.sink.events(t), typ)
}

// A speed delivery fails after more than a second over its limit; a moment
// over it does not.
func TestQuestSpeedLimit(t *testing.T) {
	h, _, book := questHarness(t)
	quest := book.Quests["vicepoint-cake"]
	giver := book.NPCs[quest.Giver]
	p := h.player("Bob")
	h.join(p, `{"type":"city-join"}`)
	h.atNPC(p, giver)
	h.must(p, `{"type":"city-quest-accept","quest":"vicepoint-cake"}`)
	limit := quest.MaxKmh / 3.6
	x, seq := giver.X+1, uint32(1)
	send := func(speed float64) {
		h.clock.Advance(100 * time.Millisecond)
		x += speed * 0.1
		h.svc.RelayMotion(p.c, presentationFrame(seq, x, giver.Z, speed, 0))
		seq++
	}
	for range 5 {
		send(limit + 3) // half a second over
	}
	for range 5 {
		send(limit - 2)
	}
	if failed := questEvents(t, p, "city-quest-failed"); len(failed) != 0 {
		t.Fatalf("failed after a moment over the limit: %v", failed)
	}
	for range 12 {
		send(limit + 3)
	}
	failed := questEvents(t, p, "city-quest-failed")
	if len(failed) != 1 || failed[0]["reason"] != QuestFailSpeed || failed[0]["quest"] != quest.ID {
		t.Fatalf("speeding: %v", failed)
	}
	h.refused(p, `{"type":"city-quest-deliver"}`, "NO_QUEST")
}

// A fragile delivery counts the kart's collisions and fails past its allowance.
func TestQuestCollisionLimit(t *testing.T) {
	h, _, book := questHarness(t)
	quest := book.Quests["havana-glasses"]
	giver := book.NPCs[quest.Giver]
	p := h.player("Cleo")
	h.join(p, `{"type":"city-join"}`)
	h.atNPC(p, giver)
	h.must(p, `{"type":"city-quest-accept","quest":"havana-glasses"}`)
	x, seq, collisions := giver.X+1, uint32(1), uint32(40)
	send := func() {
		h.clock.Advance(100 * time.Millisecond)
		x += 1
		h.svc.RelayMotion(p.c, presentationFrame(seq, x, giver.Z, 10, collisions))
		seq++
	}
	send() // the counter's starting value is no collision
	for i := 0; i < quest.MaxCollisions; i++ {
		collisions++
		send()
	}
	events := p.sink.events(t)
	if progress := ofType(events, "city-quest-progress"); len(progress) != quest.MaxCollisions ||
		progress[len(progress)-1]["collisions"] != float64(quest.MaxCollisions) {
		t.Fatalf("progress %v", progress)
	}
	if failed := ofType(events, "city-quest-failed"); len(failed) != 0 {
		t.Fatalf("failed within the allowance: %v", failed)
	}
	collisions++
	send()
	failed := questEvents(t, p, "city-quest-failed")
	if len(failed) != 1 || failed[0]["reason"] != QuestFailCollision {
		t.Fatalf("one collision too many: %v", failed)
	}
}

// A timed delivery fails at its deadline, on the line's tick.
func TestQuestTimeLimit(t *testing.T) {
	h, rewards, book := questHarness(t)
	quest := book.Quests["havana-sandwich"]
	p := h.player("Dan")
	h.join(p, `{"type":"city-join"}`)
	h.atNPC(p, book.NPCs[quest.Giver])
	accepted := h.must(p, `{"type":"city-quest-accept","quest":"havana-sandwich"}`)
	if accepted["deadline"].(float64) <= accepted["startedAt"].(float64) {
		t.Fatalf("no deadline: %v", accepted)
	}
	p.sink.events(t)
	h.clock.Advance(time.Duration(quest.TimeLimitMs)*time.Millisecond - 2*time.Second)
	if failed := questEvents(t, p, "city-quest-failed"); len(failed) != 0 {
		t.Fatalf("failed before the deadline: %v", failed)
	}
	h.clock.Advance(4 * time.Second)
	failed := questEvents(t, p, "city-quest-failed")
	if len(failed) != 1 || failed[0]["reason"] != QuestFailTimeout {
		t.Fatalf("past the deadline: %v", failed)
	}
	h.droveTo(p, book.NPCs[quest.Receiver])
	h.refused(p, `{"type":"city-quest-deliver"}`, "NO_QUEST")
	if len(rewards.requests) != 0 {
		t.Fatal("a failed delivery was credited")
	}
}

// Without a reward API the quests are off.
func TestQuestsOff(t *testing.T) {
	h := newHarness(t, Options{Lines: 1})
	p := h.player("Eve")
	h.join(p, `{"type":"city-join"}`)
	h.refused(p, `{"type":"city-quest-accept","quest":"beach-brochures"}`, "CITY_QUESTS_OFF")
}

// A delivery is driven: a road reset beside the kart keeps it, a respawn
// across the city drops the item.
func TestQuestTeleport(t *testing.T) {
	h, rewards, book := questHarness(t)
	quest := book.Quests["beach-brochures"]
	giver := book.NPCs[quest.Giver]
	p := h.player("Finn")
	h.join(p, `{"type":"city-join"}`)
	h.atNPC(p, giver)
	h.must(p, `{"type":"city-quest-accept","quest":"beach-brochures"}`)
	h.clock.Advance(2 * time.Second)
	h.must(p, fmt.Sprintf(`{"type":"city-respawn","pose":{"x":%g,"y":10,"z":%g,"heading":0}}`, giver.X+40, giver.Z))
	if failed := questEvents(t, p, "city-quest-failed"); len(failed) != 0 {
		t.Fatalf("a road reset failed the delivery: %v", failed)
	}
	receiver := book.NPCs[quest.Receiver]
	h.clock.Advance(2 * time.Second)
	h.must(p, fmt.Sprintf(`{"type":"city-respawn","pose":{"x":%g,"y":10,"z":%g,"heading":0}}`, receiver.X+1, receiver.Z))
	failed := questEvents(t, p, "city-quest-failed")
	if len(failed) != 1 || failed[0]["reason"] != QuestFailTeleport {
		t.Fatalf("teleporting to the receiver: %v", failed)
	}
	h.refused(p, `{"type":"city-quest-deliver"}`, "NO_QUEST")
	if len(rewards.requests) != 0 {
		t.Fatal("a teleported delivery was credited")
	}
	// Hopping by short resets runs out of allowance too.
	h.atNPC(p, giver)
	h.clock.Advance(2 * time.Second)
	h.must(p, `{"type":"city-quest-accept","quest":"beach-brochures"}`)
	x := giver.X + 1
	for hop := 0; hop < 3; hop++ {
		x += 120
		h.clock.Advance(time.Second)
		h.must(p, fmt.Sprintf(`{"type":"city-respawn","pose":{"x":%g,"y":10,"z":%g,"heading":0}}`, x, giver.Z))
	}
	if failed := questEvents(t, p, "city-quest-failed"); len(failed) != 1 || failed[0]["reason"] != QuestFailTeleport {
		t.Fatalf("hopping 360 m by resets: %v", failed)
	}
}

// questDriver is a member with an account (so it has its own kart) in the
// quest harness, driving it.
func questDriver(h *harness, name string) *peer {
	p := h.driver(name)
	h.join(p, `{"type":"city-join"}`)
	return p
}

// frameAt places p at (x, z) as if it drove there and sends a kind-3 frame
// from there a tenth of a second after the last.
func (h *harness) frameAt(p *peer, seq *uint32, x, z, speed float64, collisions uint32) {
	h.t.Helper()
	h.clock.Advance(100 * time.Millisecond)
	h.droveTo(p, QuestNPC{X: x - 1, Z: z})
	*seq++
	h.svc.RelayMotion(p.c, presentationFrame(*seq, x, z, speed, collisions))
}

// A passenger rides only in a driven kart with a free back seat, takes the
// seat from other members, loses satisfaction to collisions and speeding,
// and tips by it at the end.
func TestQuestPassenger(t *testing.T) {
	h, rewards, book := questHarness(t)
	quest := book.Quests["wenwen-ride"]
	giver, receiver := book.NPCs[quest.Giver], book.NPCs[quest.Receiver]
	p, other := questDriver(h, "Gus"), questDriver(h, "Hal")
	h.atNPC(p, giver)
	h.must(p, `{"type":"city-exit"}`)
	h.clock.Advance(2 * time.Second)
	h.refused(p, `{"type":"city-quest-accept","quest":"wenwen-ride"}`, "NOT_DRIVING")
	h.must(p, fmt.Sprintf(`{"type":"city-enter","vehicle":%d}`, p.id))
	h.clock.Advance(2 * time.Second)
	other.sink.events(t)
	accepted := h.must(p, `{"type":"city-quest-accept","quest":"wenwen-ride"}`)
	if accepted["questType"] != QuestPassenger || accepted["satisfaction"] != float64(100) {
		t.Fatalf("accept %v", accepted)
	}
	if seen := ofType(other.sink.events(t), "city-vehicle"); len(seen) != 1 ||
		vehicleIn(t, seen[0])["npcPassenger"] != quest.Giver {
		t.Fatalf("others see %v", seen)
	}
	h.atNPC(other, giver)
	h.clock.Advance(2 * time.Second)
	h.must(other, `{"type":"city-exit"}`)
	h.clock.Advance(2 * time.Second)
	h.refused(other, fmt.Sprintf(`{"type":"city-enter","vehicle":%d}`, p.id), "VEHICLE_FULL")

	seq, collisions := uint32(0), uint32(7)
	x := giver.X + 1
	h.frameAt(p, &seq, x, giver.Z, 10, collisions)
	collisions++ // one collision: −15
	h.frameAt(p, &seq, x+1, giver.Z, 10, collisions)
	for range 20 { // two seconds at 100 km/h: −8
		x += 2.8
		h.frameAt(p, &seq, x, giver.Z, 100/3.6, collisions)
	}
	progress := questEvents(t, p, "city-quest-progress")
	if len(progress) == 0 || progress[0]["satisfaction"] != float64(85) ||
		progress[len(progress)-1]["satisfaction"] != float64(77) {
		t.Fatalf("satisfaction %v", progress)
	}
	h.clock.Advance(2 * time.Second)
	h.droveTo(p, receiver)
	done := h.must(p, `{"type":"city-quest-deliver"}`)
	tip := int64(math.Round(float64(quest.Lucci)*0.3*0.77/10)) * 10
	if done["satisfaction"] != float64(77) || done["tip"] != float64(tip) || len(rewards.requests) != 1 ||
		rewards.requests[0].Lucci != quest.Lucci+tip {
		t.Fatalf("deliver %v, credited %+v", done, rewards.requests)
	}
}

// Leaving the driver's seat ends a ride; so does a passenger's patience.
func TestQuestPassengerFails(t *testing.T) {
	h, _, book := questHarness(t)
	giver := book.NPCs[book.Quests["bazzi-ride"].Giver]
	p := questDriver(h, "Ivy")
	h.atNPC(p, giver)
	h.must(p, `{"type":"city-quest-accept","quest":"bazzi-ride"}`)
	h.clock.Advance(2 * time.Second)
	h.must(p, `{"type":"city-exit"}`)
	if failed := questEvents(t, p, "city-quest-failed"); len(failed) != 1 || failed[0]["reason"] != QuestFailExited {
		t.Fatalf("exit: %v", failed)
	}
	h.clock.Advance(2 * time.Second)
	h.must(p, fmt.Sprintf(`{"type":"city-enter","vehicle":%d}`, p.id))
	h.clock.Advance(2 * time.Second)
	h.must(p, `{"type":"city-quest-accept","quest":"bazzi-ride"}`)
	seq, collisions := uint32(0), uint32(0)
	h.frameAt(p, &seq, giver.X+1, giver.Z, 5, collisions)
	for range 7 { // 7 × 15 > 100
		collisions++
		h.frameAt(p, &seq, giver.X+1, giver.Z, 5, collisions)
	}
	if failed := questEvents(t, p, "city-quest-failed"); len(failed) != 1 || failed[0]["reason"] != QuestFailUnhappy {
		t.Fatalf("unhappy: %v", failed)
	}
}

// A collection is finished only once every stop was reached.
func TestQuestCollect(t *testing.T) {
	h, rewards, book := questHarness(t)
	quest := book.Quests["foreman-tools"]
	giver := book.NPCs[quest.Giver]
	p := questDriver(h, "Jo")
	h.atNPC(p, giver)
	accepted := h.must(p, `{"type":"city-quest-accept","quest":"foreman-tools"}`)
	if got := accepted["collected"].([]any); len(got) != len(quest.Stops) || got[0] != false {
		t.Fatalf("accept %v", accepted)
	}
	h.clock.Advance(2 * time.Second)
	h.refused(p, `{"type":"city-quest-deliver"}`, "NOT_COLLECTED")
	seq := uint32(0)
	for i, stop := range quest.Stops {
		h.frameAt(p, &seq, stop.X+20, stop.Z, 5, 0) // not there yet
		h.frameAt(p, &seq, stop.X+6, stop.Z, 5, 0)
		progress := questEvents(t, p, "city-quest-progress")
		if len(progress) != 1 || progress[0]["collected"].([]any)[i] != true {
			t.Fatalf("stop %d: %v", i, progress)
		}
	}
	h.clock.Advance(2 * time.Second)
	h.droveTo(p, book.NPCs[quest.Receiver])
	h.must(p, `{"type":"city-quest-deliver"}`)
	if len(rewards.requests) != 1 || rewards.requests[0].Lucci != quest.Lucci {
		t.Fatalf("credited %+v", rewards.requests)
	}
}

// A search's signal grows as the member nears the hidden item; passing by
// it finds it, and only then can it be handed over.
func TestQuestSearch(t *testing.T) {
	h, _, book := questHarness(t)
	h.svc.questPick = func(n int) int { return n - 1 }
	quest := book.Quests["florist-puppy"]
	giver := book.NPCs[quest.Giver]
	spot := quest.Area.Spots[len(quest.Area.Spots)-1]
	p := questDriver(h, "Kit")
	h.atNPC(p, giver)
	accepted := h.must(p, `{"type":"city-quest-accept","quest":"florist-puppy"}`)
	if accepted["found"] != false || accepted["signal"].(float64) < 1 {
		t.Fatalf("accept %v", accepted)
	}
	h.clock.Advance(2 * time.Second)
	h.refused(p, `{"type":"city-quest-deliver"}`, "NOT_FOUND")
	seq := uint32(0)
	h.frameAt(p, &seq, spot.X+50, spot.Z, 5, 0)
	h.clock.Advance(time.Second) // the tick reports the signal
	if progress := questEvents(t, p, "city-quest-progress"); len(progress) == 0 ||
		progress[len(progress)-1]["signal"] != float64(4) {
		t.Fatalf("signal at 50 m: %v", progress)
	}
	h.frameAt(p, &seq, spot.X+5, spot.Z, 5, 0)
	if progress := questEvents(t, p, "city-quest-progress"); len(progress) != 1 || progress[0]["found"] != true {
		t.Fatalf("found: %v", progress)
	}
	h.clock.Advance(2 * time.Second)
	h.droveTo(p, book.NPCs[quest.Receiver])
	h.must(p, `{"type":"city-quest-deliver"}`)
}
