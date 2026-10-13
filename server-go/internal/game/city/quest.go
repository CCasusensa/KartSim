package city

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"math"
	"net/http"
	"time"

	"kartsim/internal/game/lobby"
	"kartsim/internal/shared/contract"
)

// 卡丁城送货任务 (CITY-QUESTS.md): a member standing by a task-point NPC
// accepts one of its deliveries (city-quest-accept), drives the item to the
// receiving NPC and hands it over there (city-quest-deliver); the node then
// has the data service credit the reward. One delivery at a time. The node
// judges the limits from the member's motion frames: a speed delivery fails
// after more than SpeedGraceMs above its limit, a fragile one at its
// collision allowance plus one, a timed one at its deadline. Being moved
// farther than questJump at once (a respawn anywhere, a tow), or more than
// questJumpBudget in all, drops the item: the delivery is driven, not
// teleported or hopped there by road resets. A failure is the event
// city-quest-failed {quest, reason: SPEED | COLLISION | TIMEOUT | TELEPORT}.

// QuestRewards is the data service as the deliveries see it
// (cluster.CityQuests).
type QuestRewards interface {
	Reward(ctx context.Context, request contract.CityQuestRewardRequest) (contract.CityQuestReward, error)
}

// Failure reasons.
const (
	QuestFailSpeed     = "SPEED"
	QuestFailCollision = "COLLISION"
	QuestFailTimeout   = "TIMEOUT"
	QuestFailTeleport  = "TELEPORT"
)

const (
	// questReach is the slack (m) over the talk and arrive radii the node
	// allows for a pose a frame or two old.
	questReach = 4.0
	// Quest commands: a few a second.
	questRate, questBurst = 2.0, 4
	questCallTimeout      = 5 * time.Second
	// Payload offsets of the kinematic presentation (client payload.ts):
	// forward speed float32 at 80, collision sequence uint32 at 104, in
	// payloads of at least presentationLength bytes.
	forwardSpeedOffset      = 80
	collisionSequenceOffset = 104
	presentationLength      = 108
	// maxCollisionStep caps the collisions one frame may add (a wrapped or
	// reset counter is not a crash spree).
	maxCollisionStep = 5
	// questJump is the farthest (m) a delivery survives being moved at
	// once: a road reset beside the kart, as for a stalled one.
	questJump = emptyRespawn
	// questJumpBudget is how far (m) the resets of one delivery may move it in all.
	questJumpBudget = 2 * questJump
)

// questRun is a member's accepted delivery.
type questRun struct {
	quest      *Quest
	runID      string
	startedAt  int64
	deadline   int64 // 0 without a time limit
	collisions int
	// jumped is how far (m) the node has moved the member since the accept.
	jumped float64
	// lastSequence is the presentation collision counter last seen.
	lastSequence uint32
	seenSequence bool
	// overSince is when the kart went over a speed limit (0: not over).
	overSince int64
	// settling: the data service is crediting the delivery.
	settling bool
}

// questState is a member's delivery and command allowance.
type questState struct {
	run    *questRun
	calls  limiter
	primed bool
}

func (q *questState) allow(now int64) bool {
	if !q.primed {
		q.calls, q.primed = newLimiter(questRate, questBurst), true
	}
	return q.calls.allow(now)
}

func newRunID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func errQuestsOff() error { return fail(http.StatusServiceUnavailable, "CITY_QUESTS_OFF") }

// near reports whether m stands within radius (+ slack) of an NPC.
func near(m *member, npc QuestNPC, radius float64) bool {
	return math.Hypot(m.pose.X-npc.X, m.pose.Z-npc.Z) <= radius+questReach
}

func (r *questRun) object() lobby.Object {
	q := r.quest
	fields := lobby.Object{lobby.F("quest", q.ID), lobby.F("runId", r.runID), lobby.F("startedAt", r.startedAt),
		lobby.F("deadline", r.deadline), lobby.F("collisions", r.collisions)}
	if q.Kind == QuestSpeed {
		fields = append(fields, lobby.F("maxKmh", q.MaxKmh))
	}
	if q.Kind == QuestCollision {
		fields = append(fields, lobby.F("maxCollisions", q.MaxCollisions))
	}
	return fields
}

// acceptQuest is city-quest-accept {quest}: by the quest's giver, with no
// delivery under way.
func (inst *instance) acceptQuest(m *member, in lobby.Request, now int64) (lobby.Reply, error) {
	book := inst.svc.quests
	if book == nil || inst.svc.questRewards == nil {
		return lobby.Reply{}, errQuestsOff()
	}
	id, err := in.Text("quest", 1, 64)
	if err != nil {
		return lobby.Reply{}, err
	}
	quest := book.Quests[id]
	switch {
	case quest == nil:
		return lobby.Reply{}, lobby.Invalid("quest")
	case !m.quest.allow(now):
		return lobby.Reply{}, errRateLimited()
	case m.seat == SeatPassenger:
		return lobby.Reply{}, fail(http.StatusConflict, "PASSENGER")
	case m.quest.run != nil:
		return lobby.Reply{}, fail(http.StatusConflict, "QUEST_ACTIVE")
	case !near(m, book.NPCs[quest.Giver], book.Rules.TalkRadius):
		return lobby.Reply{}, fail(http.StatusConflict, "TOO_FAR")
	}
	run := &questRun{quest: quest, runID: newRunID(), startedAt: now}
	if quest.Kind == QuestTime {
		run.deadline = now + quest.TimeLimitMs
	}
	m.quest.run = run
	inst.svc.log.Info("city quest accepted", "line", inst.line, "player", m.playerID, "quest", quest.ID)
	return lobby.NewReply(append(lobby.Object{lobby.F("type", "city-quest")}, run.object()...)), nil
}

// abandonQuest is city-quest-abandon: gives the delivery up (no event).
func (inst *instance) abandonQuest(m *member, now int64) (lobby.Reply, error) {
	if !m.quest.allow(now) {
		return lobby.Reply{}, errRateLimited()
	}
	run := m.quest.run
	if run == nil {
		return lobby.Reply{}, fail(http.StatusConflict, "NO_QUEST")
	}
	if run.settling {
		return lobby.Reply{}, fail(http.StatusConflict, "QUEST_SETTLING")
	}
	m.quest.run = nil
	return okReply(), nil
}

// failQuest ends m's delivery with a city-quest-failed event.
func (inst *instance) failQuest(m *member, reason string) {
	run := m.quest.run
	if run == nil || run.settling {
		return
	}
	m.quest.run = nil
	inst.svc.log.Info("city quest failed", "line", inst.line, "player", m.playerID, "quest", run.quest.ID,
		"reason", reason)
	m.c.Text(lobby.Encode(lobby.Object{lobby.F("type", "city-quest-failed"), lobby.F("instanceId", inst.id),
		lobby.F("quest", run.quest.ID), lobby.F("reason", reason), lobby.F("collisions", run.collisions)}))
}

// questFrame judges an accepted motion frame against m's delivery limits.
func (inst *instance) questFrame(m *member, kind int, payload []byte, now int64) {
	run := m.quest.run
	if run == nil || run.settling {
		return
	}
	speed := m.speed
	presentation := kind != 1 && len(payload) >= presentationLength
	if presentation {
		if v := float64(math.Float32frombits(binary.LittleEndian.Uint32(payload[forwardSpeedOffset:]))); !math.IsNaN(v) &&
			!math.IsInf(v, 0) {
			speed = math.Abs(v)
		}
	}
	switch run.quest.Kind {
	case QuestSpeed:
		if speed*3.6 > run.quest.MaxKmh {
			if run.overSince == 0 {
				run.overSince = now
			} else if now-run.overSince >= inst.svc.quests.Rules.SpeedGraceMs {
				inst.failQuest(m, QuestFailSpeed)
			}
		} else {
			run.overSince = 0
		}
	case QuestCollision:
		if !presentation {
			return
		}
		sequence := binary.LittleEndian.Uint32(payload[collisionSequenceOffset:])
		if run.seenSequence && sequence != run.lastSequence {
			step := int(sequence - run.lastSequence)
			if step < 0 || step > maxCollisionStep {
				step = 1
			}
			run.collisions += step
			m.c.Text(lobby.Encode(lobby.Object{lobby.F("type", "city-quest-progress"), lobby.F("instanceId", inst.id),
				lobby.F("quest", run.quest.ID), lobby.F("collisions", run.collisions)}))
			if run.collisions > run.quest.MaxCollisions {
				inst.failQuest(m, QuestFailCollision)
				return
			}
		}
		run.lastSequence, run.seenSequence = sequence, true
	}
}

// questMoved fails m's delivery when the node moved it (from: before the
// move) farther than questJump, or past questJumpBudget in all.
func (inst *instance) questMoved(m *member, from Pose) {
	run := m.quest.run
	if run == nil {
		return
	}
	jump := horizontal(from, m.pose)
	run.jumped += jump
	if jump > questJump || run.jumped > questJumpBudget {
		inst.failQuest(m, QuestFailTeleport)
	}
}

// questTick fails the deliveries past their deadline (the 1 Hz tick).
func (inst *instance) questTick(now int64) {
	for _, m := range inst.members {
		if run := m.quest.run; run != nil && run.deadline > 0 && now > run.deadline {
			inst.failQuest(m, QuestFailTimeout)
		}
	}
}

// deliverQuest is city-quest-deliver: m hands the item over by the
// receiver; the data service credits the reward outside the line lock.
func (inst *instance) deliverQuest(c *lobby.Client) (lobby.Reply, error) {
	book := inst.svc.quests
	if book == nil || inst.svc.questRewards == nil {
		return lobby.Reply{}, errQuestsOff()
	}
	inst.mu.Lock()
	m := inst.members[c]
	if m == nil {
		inst.mu.Unlock()
		return lobby.Reply{}, errNotInCity()
	}
	now := inst.svc.clock.Now()
	run := m.quest.run
	var err error
	switch {
	case !m.quest.allow(now):
		err = errRateLimited()
	case run == nil:
		err = fail(http.StatusConflict, "NO_QUEST")
	case run.settling:
		err = fail(http.StatusConflict, "QUEST_SETTLING")
	case m.seat == SeatPassenger:
		err = fail(http.StatusConflict, "PASSENGER")
	case run.deadline > 0 && now > run.deadline:
		inst.failQuest(m, QuestFailTimeout)
		err = fail(http.StatusConflict, "QUEST_FAILED")
	case !near(m, book.NPCs[run.quest.Receiver], book.Rules.ArriveRadius):
		err = fail(http.StatusConflict, "TOO_FAR")
	}
	if err != nil {
		inst.mu.Unlock()
		return lobby.Reply{}, err
	}
	run.settling = true
	request := contract.CityQuestRewardRequest{AccountID: m.accountID, RunID: run.runID, QuestID: run.quest.ID,
		Exp: run.quest.Exp, Lucci: run.quest.Lucci}
	elapsed := now - run.startedAt
	inst.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), questCallTimeout)
	reward, err := inst.svc.questRewards.Reward(ctx, request)
	cancel()

	inst.mu.Lock()
	defer inst.mu.Unlock()
	run.settling = false
	if err != nil {
		// The delivery stands: the member may hand it over again.
		return lobby.Reply{}, dataRefusal(err)
	}
	if inst.members[c] == m && m.quest.run == run {
		m.quest.run = nil
	}
	m.lucci = reward.WalletLucci
	inst.svc.log.Info("city quest delivered", "line", inst.line, "player", m.playerID, "quest", run.quest.ID,
		"elapsedMs", elapsed, "exp", reward.Exp, "lucci", reward.Lucci, "capped", reward.Capped)
	levelUps := make([]lobby.Object, 0, len(reward.LevelUps))
	for _, up := range reward.LevelUps {
		levelUps = append(levelUps, lobby.Object{lobby.F("level", up.Level), lobby.F("lucci", up.Lucci),
			lobby.F("koin", up.Koin), lobby.F("coupon", up.Coupon)})
	}
	return lobby.NewReply(lobby.Object{lobby.F("type", "city-quest-done"), lobby.F("quest", run.quest.ID),
		lobby.F("elapsedMs", elapsed), lobby.F("collisions", run.collisions), lobby.F("exp", reward.Exp),
		lobby.F("lucci", reward.Lucci), lobby.F("capped", reward.Capped), lobby.F("levelUps", levelUps),
		lobby.F("walletLucci", reward.WalletLucci), lobby.F("totalExp", reward.TotalExp),
		lobby.F("level", reward.Level)}), nil
}
