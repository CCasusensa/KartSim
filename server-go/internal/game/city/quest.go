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

// 卡丁城任务 (CITY-QUESTS.md): a member standing by a task-point NPC accepts
// one of its quests (city-quest-accept) and finishes it by the receiving
// NPC (city-quest-deliver); the node then has the data service credit the
// reward. One quest at a time, of four types:
//
//   - delivery: carry an item from the giver to the receiver;
//   - passenger: the giver rides in the member's back seat (only while it
//     drives, with the back seat free) to the receiver; its satisfaction
//     drops with collisions and speeding, pays a tip, and at 0 ends the ride;
//   - collect: pass within PickupRadius of every stop, then go to the receiver;
//   - search: the item lies at one of the area's spots (picked per run);
//     the node sends a signal (1–5 bars) by how near the member is, and
//     passing within PickupRadius finds it; then go to the receiver.
//
// The node judges the limits from the member's motion frames: a speed quest
// fails after more than SpeedGraceMs above its limit, a collision quest at
// its allowance plus one, a timed one at its deadline. Being moved farther
// than questJump at once (a respawn anywhere, a tow), or more than
// questJumpBudget in all, ends it: quests are driven, not teleported or
// hopped by road resets. A failure is the event city-quest-failed {quest,
// reason: SPEED | COLLISION | TIMEOUT | TELEPORT | UNHAPPY | EXITED}; what
// changes on the way is city-quest-progress.

// QuestRewards is the data service as the quests see it (cluster.CityQuests).
type QuestRewards interface {
	Reward(ctx context.Context, request contract.CityQuestRewardRequest) (contract.CityQuestReward, error)
}

// Failure reasons.
const (
	QuestFailSpeed     = "SPEED"
	QuestFailCollision = "COLLISION"
	QuestFailTimeout   = "TIMEOUT"
	QuestFailTeleport  = "TELEPORT"
	// QuestFailUnhappy: the passenger's satisfaction ran out.
	QuestFailUnhappy = "UNHAPPY"
	// QuestFailExited: the driver left its seat with a passenger aboard.
	QuestFailExited = "EXITED"
)

const (
	// questReach is the slack (m) over the talk, arrive and pickup radii
	// the node allows for a pose a frame or two old.
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
	// questJump is the farthest (m) a quest survives being moved at
	// once: a road reset beside the kart, as for a stalled one.
	questJump = emptyRespawn
	// questJumpBudget is how far (m) the resets of one quest may move it in all.
	questJumpBudget = 2 * questJump
	// maxFrameGap caps the time (s) one frame's speeding costs a passenger.
	maxFrameGap = 0.5
	// satisfactionEvery is how often (ms) a passenger's falling
	// satisfaction is reported while it only drifts (collisions report at once).
	satisfactionEvery = 500
)

// questRun is a member's accepted quest.
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
	// lastFrameAt is when the previous motion frame came (0: none yet).
	lastFrameAt int64
	// Passenger: satisfaction 0–100, what was last reported and when.
	satisfaction float64
	sentMood     int
	sentMoodAt   int64
	// Collect: which stops were reached.
	collected []bool
	// Search: where the item lies, whether it was found, the last signal sent.
	spot   QuestPoint
	found  bool
	signal int
	// settling: the data service is crediting the quest.
	settling bool
}

// questState is a member's quest and command allowance.
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

// carriesPassenger reports whether m drives a quest passenger (its back seat is taken).
func (m *member) carriesPassenger() bool {
	return m.quest.run != nil && m.quest.run.quest.Type == QuestPassenger
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

// mood is a passenger's satisfaction as reported (a whole percent).
func (r *questRun) mood() int { return int(math.Ceil(math.Max(0, r.satisfaction))) }

// ready reports whether the quest can be finished at the receiver.
func (r *questRun) ready() bool {
	switch r.quest.Type {
	case QuestCollect:
		for _, done := range r.collected {
			if !done {
				return false
			}
		}
	case QuestSearch:
		return r.found
	}
	return true
}

// progress is what the run has done so far, by type.
func (r *questRun) progress() lobby.Object {
	fields := lobby.Object{lobby.F("collisions", r.collisions)}
	switch r.quest.Type {
	case QuestPassenger:
		fields = append(fields, lobby.F("satisfaction", r.mood()))
	case QuestCollect:
		fields = append(fields, lobby.F("collected", r.collected))
	case QuestSearch:
		fields = append(fields, lobby.F("found", r.found), lobby.F("signal", r.signal))
	}
	return fields
}

func (r *questRun) object() lobby.Object {
	q := r.quest
	fields := lobby.Object{lobby.F("quest", q.ID), lobby.F("questType", q.Type), lobby.F("runId", r.runID),
		lobby.F("startedAt", r.startedAt), lobby.F("deadline", r.deadline)}
	fields = append(fields, r.progress()...)
	if q.Kind == QuestSpeed {
		fields = append(fields, lobby.F("maxKmh", q.MaxKmh))
	}
	if q.Kind == QuestCollision {
		fields = append(fields, lobby.F("maxCollisions", q.MaxCollisions))
	}
	return fields
}

// acceptQuest is city-quest-accept {quest}: by the quest's giver, with no
// quest under way; a passenger only gets into a driven kart with its back
// seat free.
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
	case quest.Type == QuestPassenger && (m.seat != SeatDriver || m.vehicle == nil):
		return lobby.Reply{}, fail(http.StatusConflict, "NOT_DRIVING")
	case quest.Type == QuestPassenger && m.vehicle.passenger != nil:
		return lobby.Reply{}, fail(http.StatusConflict, "SEAT_TAKEN")
	}
	run := &questRun{quest: quest, runID: newRunID(), startedAt: now, satisfaction: 100, sentMood: 100}
	if quest.Kind == QuestTime {
		run.deadline = now + quest.TimeLimitMs
	}
	switch quest.Type {
	case QuestCollect:
		run.collected = make([]bool, len(quest.Stops))
	case QuestSearch:
		run.spot = quest.Area.Spots[inst.svc.questPick(len(quest.Area.Spots))]
		run.signal = inst.signal(run, m.pose)
	}
	m.quest.run = run
	inst.svc.log.Info("city quest accepted", "line", inst.line, "player", m.playerID, "quest", quest.ID)
	if quest.Type == QuestPassenger {
		// The back seat is taken: nobody else boards while the passenger rides.
		inst.vehicleEvent(m.vehicle, nil)
	}
	return lobby.NewReply(append(lobby.Object{lobby.F("type", "city-quest")}, run.object()...)), nil
}

// abandonQuest is city-quest-abandon: gives the quest up (no event).
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
	inst.endQuest(m)
	return okReply(), nil
}

// endQuest drops m's quest; a passenger's ride frees the back seat.
func (inst *instance) endQuest(m *member) {
	run := m.quest.run
	m.quest.run = nil
	if run != nil && run.quest.Type == QuestPassenger && m.vehicle != nil {
		inst.vehicleEvent(m.vehicle, nil)
	}
}

// failQuest ends m's quest with a city-quest-failed event.
func (inst *instance) failQuest(m *member, reason string) {
	run := m.quest.run
	if run == nil || run.settling {
		return
	}
	inst.endQuest(m)
	inst.svc.log.Info("city quest failed", "line", inst.line, "player", m.playerID, "quest", run.quest.ID,
		"reason", reason)
	m.c.Text(lobby.Encode(lobby.Object{lobby.F("type", "city-quest-failed"), lobby.F("instanceId", inst.id),
		lobby.F("quest", run.quest.ID), lobby.F("reason", reason), lobby.F("collisions", run.collisions)}))
}

// sendProgress tells m what its quest has done so far.
func (inst *instance) sendProgress(m *member, run *questRun) {
	m.c.Text(lobby.Encode(append(lobby.Object{lobby.F("type", "city-quest-progress"), lobby.F("instanceId", inst.id),
		lobby.F("quest", run.quest.ID)}, run.progress()...)))
}

// signal is the search signal (1–5 bars) at pose.
func (inst *instance) signal(run *questRun, pose Pose) int {
	d := math.Hypot(pose.X-run.spot.X, pose.Z-run.spot.Z)
	bars := 5
	for _, band := range inst.svc.quests.Rules.Search.SignalBands {
		if d <= band {
			return bars
		}
		bars--
	}
	return max(bars, 1)
}

// questFrame judges an accepted motion frame against m's quest.
func (inst *instance) questFrame(m *member, kind int, payload []byte, now int64) {
	run := m.quest.run
	if run == nil || run.settling {
		return
	}
	q, rules := run.quest, inst.svc.quests.Rules
	if q.Type == QuestPassenger && m.seat != SeatDriver {
		inst.failQuest(m, QuestFailExited)
		return
	}
	gap := 0.0
	if run.lastFrameAt > 0 {
		gap = math.Min(maxFrameGap, float64(now-run.lastFrameAt)/1000)
	}
	run.lastFrameAt = now
	speed := m.speed
	presentation := kind != 1 && len(payload) >= presentationLength
	if presentation {
		if v := float64(math.Float32frombits(binary.LittleEndian.Uint32(payload[forwardSpeedOffset:]))); !math.IsNaN(v) &&
			!math.IsInf(v, 0) {
			speed = math.Abs(v)
		}
	}
	report := false
	// Collisions count against a collision limit and a passenger's mood.
	if presentation && (q.Kind == QuestCollision || q.Type == QuestPassenger) {
		sequence := binary.LittleEndian.Uint32(payload[collisionSequenceOffset:])
		if run.seenSequence && sequence != run.lastSequence {
			step := int(sequence - run.lastSequence)
			if step < 0 || step > maxCollisionStep {
				step = 1
			}
			run.collisions += step
			run.satisfaction -= rules.Passenger.CollisionPenalty * float64(step)
			report = true
		}
		run.lastSequence, run.seenSequence = sequence, true
	}
	if q.Kind == QuestCollision && run.collisions > q.MaxCollisions {
		inst.failQuest(m, QuestFailCollision)
		return
	}
	if q.Kind == QuestSpeed {
		if speed*3.6 > q.MaxKmh {
			if run.overSince == 0 {
				run.overSince = now
			} else if now-run.overSince >= rules.SpeedGraceMs {
				inst.failQuest(m, QuestFailSpeed)
				return
			}
		} else {
			run.overSince = 0
		}
	}
	switch q.Type {
	case QuestPassenger:
		if speed*3.6 > rules.Passenger.ComfortKmh {
			run.satisfaction -= rules.Passenger.SpeedPenaltyPerS * gap
		}
		if run.satisfaction <= 0 {
			run.satisfaction = 0
			inst.failQuest(m, QuestFailUnhappy)
			return
		}
		if mood := run.mood(); mood != run.sentMood && (report || now-run.sentMoodAt >= satisfactionEvery) {
			report = true
		}
	case QuestCollect:
		for i, stop := range q.Stops {
			if !run.collected[i] && math.Hypot(m.pose.X-stop.X, m.pose.Z-stop.Z) <= rules.PickupRadius+questReach {
				run.collected[i] = true
				report = true
			}
		}
	case QuestSearch:
		if !run.found && math.Hypot(m.pose.X-run.spot.X, m.pose.Z-run.spot.Z) <= rules.PickupRadius+questReach {
			run.found, run.signal = true, 5
			report = true
		}
	}
	if report {
		run.sentMood, run.sentMoodAt = run.mood(), now
		inst.sendProgress(m, run)
	}
}

// questMoved fails m's quest when the node moved it (from: before the
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

// questExited ends a passenger's ride when its driver leaves the seat.
func (inst *instance) questExited(m *member) {
	if run := m.quest.run; run != nil && run.quest.Type == QuestPassenger && m.seat != SeatDriver {
		inst.failQuest(m, QuestFailExited)
	}
}

// questTick fails the quests past their deadline and updates the search
// signals (the 1 Hz tick).
func (inst *instance) questTick(now int64) {
	for _, m := range inst.members {
		run := m.quest.run
		if run == nil || run.settling {
			continue
		}
		if run.deadline > 0 && now > run.deadline {
			inst.failQuest(m, QuestFailTimeout)
			continue
		}
		if run.quest.Type == QuestSearch && !run.found {
			if bars := inst.signal(run, m.pose); bars != run.signal {
				run.signal = bars
				inst.sendProgress(m, run)
			}
		}
	}
}

// tip is a passenger's tip on the 金币 reward (rounded to 10).
func (inst *instance) tip(run *questRun) int64 {
	if run.quest.Type != QuestPassenger {
		return 0
	}
	share := inst.svc.quests.Rules.Passenger.TipMax * float64(run.mood()) / 100
	return int64(math.Round(float64(run.quest.Lucci)*share/10)) * 10
}

// deliverQuest is city-quest-deliver: m finishes its quest by the
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
	case run.quest.Type == QuestPassenger && m.seat != SeatDriver:
		inst.failQuest(m, QuestFailExited)
		err = fail(http.StatusConflict, "QUEST_FAILED")
	case run.quest.Type == QuestCollect && !run.ready():
		err = fail(http.StatusConflict, "NOT_COLLECTED")
	case run.quest.Type == QuestSearch && !run.ready():
		err = fail(http.StatusConflict, "NOT_FOUND")
	case !near(m, book.NPCs[run.quest.Receiver], book.Rules.ArriveRadius):
		err = fail(http.StatusConflict, "TOO_FAR")
	}
	if err != nil {
		inst.mu.Unlock()
		return lobby.Reply{}, err
	}
	run.settling = true
	tip := inst.tip(run)
	request := contract.CityQuestRewardRequest{AccountID: m.accountID, RunID: run.runID, QuestID: run.quest.ID,
		Exp: run.quest.Exp, Lucci: run.quest.Lucci + tip}
	elapsed := now - run.startedAt
	inst.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), questCallTimeout)
	reward, err := inst.svc.questRewards.Reward(ctx, request)
	cancel()

	inst.mu.Lock()
	defer inst.mu.Unlock()
	run.settling = false
	if err != nil {
		// The quest stands: the member may finish it again.
		return lobby.Reply{}, dataRefusal(err)
	}
	if inst.members[c] == m && m.quest.run == run {
		inst.endQuest(m)
	}
	m.lucci = reward.WalletLucci
	inst.svc.log.Info("city quest delivered", "line", inst.line, "player", m.playerID, "quest", run.quest.ID,
		"elapsedMs", elapsed, "exp", reward.Exp, "lucci", reward.Lucci, "tip", tip, "capped", reward.Capped)
	levelUps := make([]lobby.Object, 0, len(reward.LevelUps))
	for _, up := range reward.LevelUps {
		levelUps = append(levelUps, lobby.Object{lobby.F("level", up.Level), lobby.F("lucci", up.Lucci),
			lobby.F("koin", up.Koin), lobby.F("coupon", up.Coupon)})
	}
	reply := lobby.Object{lobby.F("type", "city-quest-done"), lobby.F("quest", run.quest.ID),
		lobby.F("elapsedMs", elapsed), lobby.F("collisions", run.collisions), lobby.F("exp", reward.Exp),
		lobby.F("lucci", reward.Lucci), lobby.F("capped", reward.Capped), lobby.F("levelUps", levelUps),
		lobby.F("walletLucci", reward.WalletLucci), lobby.F("totalExp", reward.TotalExp),
		lobby.F("level", reward.Level)}
	if run.quest.Type == QuestPassenger {
		reply = append(reply, lobby.F("satisfaction", run.mood()), lobby.F("tip", tip))
	}
	return lobby.NewReply(reply), nil
}
