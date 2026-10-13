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
