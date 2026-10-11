package brawl

import (
	"math"
	"math/rand/v2"
	"slices"
)

// Driving model of the AI racers (BRAWL.md 3). Speeds are three.js meters
// per second along the course; every number here is a game-design choice,
// not original data.
const (
	// cruiseMin and cruiseSpread: a racer's cruising speed is cruiseMin plus
	// up to cruiseSpread by its skill. The starter practice kart tops out
	// near 55 m/s without a boost (measured in the browser), so the best AI
	// keeps up with a good player's drifting and nitro and the field spreads
	// out behind.
	cruiseMin    = 44.0
	cruiseSpread = 16.0
	// acceleration and braking (m/s²).
	acceleration = 14.0
	braking      = 32.0
	// cornerLook is how far ahead a racer reads the corner; a 90° turn
	// within it costs cornerSlowdown of its speed.
	cornerLook     = 35.0
	cornerSlowdown = 0.32
	// boostFactor for boostMinMs..boostMaxMs every boostGapMinMs.. (+spread).
	boostFactor    = 1.2
	boostMinMs     = 1_200
	boostMaxMs     = 2_200
	boostGapMinMs  = 5_000
	boostGapMaxMs  = 14_000
	draftFactor    = 1.04 // within draftRange behind another racer's lane
	draftRange     = 18.0
	laneSpeed      = 2.6 // m/s across the road
	passGap        = 9.0 // m: a slower racer this close ahead is passed or followed
	passWidth      = 2.1 // m: lanes closer than this collide
	finishedFactor = 0.45
	// reactionMaxMs: the racers set off up to this long after the start.
	reactionMaxMs = 450
	// stepMs bounds one simulation step.
	stepMs = 50
)

// Spec names an AI racer of a race.
type Spec struct {
	PlayerID string
	Slot     int
}

// Bot is one AI racer.
type Bot struct {
	Spec
	cruise     float64
	skill      float64
	u          float64 // meters driven, from the start line (negative behind it)
	speed      float64
	lane       float64
	laneTarget float64
	laneUntil  int64
	reactAt    int64
	boostUntil int64
	nextBoost  int64
	finishedAt int64 // 0 while racing
	steer      float64
	heading    vec3
	sequence   uint32
}

// Finished reports whether the racer crossed the line of its last lap.
func (b *Bot) Finished() bool { return b.finishedAt != 0 }

// Field is the AI racers of one race.
type Field struct {
	track   *Track
	startAt int64
	raceTag byte
	bots    []*Bot
	rng     *rand.Rand
	at      int64
}

// NewField places the AI racers on their start places (their room slots)
// of track for a race starting at startAt (node clock ms). seed makes the
// race's skills, lanes and boosts repeatable.
func NewField(track *Track, raceTag byte, startAt int64, specs []Spec, seed uint64) *Field {
	f := &Field{track: track, startAt: startAt, raceTag: raceTag, at: startAt,
		rng: rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))}
	for _, spec := range specs {
		place := track.grid[spec.Slot]
		u := place.u
		if u > track.loop/2 {
			u -= track.loop // behind the line: still on lap 0
		}
		// Skill leans high: most racers are decent, a few are slow.
		skill := 1 - math.Pow(f.rng.Float64(), 1.6)
		_, heading := track.center(u)
		lane := place.position.sub(track.mustCenter(u)).dot(right(heading))
		bot := &Bot{Spec: spec, skill: skill, cruise: cruiseMin + cruiseSpread*skill, u: u,
			lane: lane, laneTarget: lane, heading: heading,
			reactAt:   startAt + int64(f.rng.Float64()*reactionMaxMs*(1.2-skill)),
			nextBoost: startAt + int64(boostGapMinMs/2+f.rng.Float64()*boostGapMaxMs)}
		bot.laneUntil = startAt + 1_500 + int64(f.rng.Float64()*2_000)
		f.bots = append(f.bots, bot)
	}
	return f
}

func (t *Track) mustCenter(u float64) vec3 {
	center, _ := t.center(u)
	return center
}

// Bots are the field's racers in slot order.
func (f *Field) Bots() []*Bot { return f.bots }

// Track is the course the field drives.
func (f *Field) Track() *Track { return f.track }

// Advance simulates the field up to now (node clock ms) and returns the
// racers that crossed their last lap's line meanwhile.
func (f *Field) Advance(now int64) []*Bot {
	var finished []*Bot
	for f.at < now {
		step := min(now-f.at, stepMs)
		f.at += step
		finished = append(finished, f.step(f.at, float64(step)/1000)...)
	}
	return finished
}

func (f *Field) step(now int64, dt float64) []*Bot {
	if now <= f.startAt {
		return nil
	}
	order := slices.Clone(f.bots)
	slices.SortFunc(order, func(a, b *Bot) int { return cmpFloat(b.u, a.u) }) // leader first
	var finished []*Bot
	for index, bot := range order {
		if now < bot.reactAt {
			continue
		}
		low, high := f.track.laneBounds(bot.u, 25)
		target := bot.cruise * f.cornerFactor(bot.u)
		if bot.Finished() {
			target = bot.cruise * finishedFactor
		}
		// Boosts: a nitro now and then, more often for better racers.
		if now >= bot.nextBoost && !bot.Finished() {
			bot.boostUntil = now + int64(boostMinMs+f.rng.Float64()*(boostMaxMs-boostMinMs))
			gap := boostGapMinMs + f.rng.Float64()*(boostGapMaxMs-boostGapMinMs)*(1.3-bot.skill)
			bot.nextBoost = bot.boostUntil + int64(gap)
		}
		if now < bot.boostUntil {
			target *= boostFactor
		}
		// Traffic: draft behind a racer in the same lane, pass a slower one
		// close ahead on the side with more room, or follow it.
		for k := index - 1; k >= 0; k-- {
			ahead := order[k] // nearest first
			gap := ahead.u - bot.u
			if gap > draftRange {
				break
			}
			if gap <= 0 || math.Abs(ahead.lane-bot.lane) >= passWidth {
				continue
			}
			target *= draftFactor
			if gap < passGap && ahead.speed < target {
				left, right := ahead.lane-passWidth-0.4, ahead.lane+passWidth+0.4
				switch {
				case left >= low && (right > high || bot.lane <= ahead.lane):
					bot.laneTarget, bot.laneUntil = left, now+2_500
				case right <= high:
					bot.laneTarget, bot.laneUntil = right, now+2_500
				default:
					target = min(target, ahead.speed)
				}
			}
			break
		}
		if now >= bot.laneUntil {
			// A new line every few seconds, somewhere on the road.
			bot.laneTarget = low + f.rng.Float64()*(high-low)
			bot.laneUntil = now + 2_000 + int64(f.rng.Float64()*4_000)
		}
		switch {
		case bot.speed < target:
			bot.speed = min(target, bot.speed+acceleration*dt)
		case bot.speed > target:
			bot.speed = max(target, bot.speed-braking*dt)
		}
		previousLane := bot.lane
		desired := min(max(bot.laneTarget, low), high)
		bot.lane += max(-laneSpeed*dt, min(laneSpeed*dt, desired-bot.lane))
		bot.u += bot.speed * dt
		_, heading := f.track.center(bot.u)
		turn := heading.cross(bot.heading).y / max(dt, 1e-3) // rad/s, positive turning right
		bot.steer = max(-1, min(1, 0.6*turn+0.5*(bot.lane-previousLane)/max(dt, 1e-3)/laneSpeed))
		bot.heading = heading
		if !bot.Finished() && bot.u >= float64(f.track.Laps)*f.track.loop {
			bot.finishedAt = now
			finished = append(finished, bot)
		}
	}
	return finished
}

// cornerFactor is the share of cruising speed a racer at u keeps for the
// turn ahead.
func (f *Field) cornerFactor(u float64) float64 {
	_, now := f.track.center(u)
	_, ahead := f.track.center(u + cornerLook)
	horizontal := func(v vec3) vec3 { return vec3{v.x, 0, v.z}.unit(vec3{0, 0, -1}) }
	angle := math.Acos(max(-1, min(1, horizontal(now).dot(horizontal(ahead)))))
	return 1 - cornerSlowdown*min(1, angle/(math.Pi/2))
}

// Progress is a racer's route distance and lap as the browser counts them
// (lap 0 before the start line, distance never below -LastLength there).
func (f *Field) Progress(b *Bot) (float64, int) {
	t := f.track
	laps := math.Floor(b.u / t.loop)
	within := b.u - laps*t.loop
	distance := laps*t.Lap + t.routeAt(within)
	if b.u < 0 {
		return max(distance, -t.LastLength), 0
	}
	return distance, int(laps) + 1
}

// FinishElapsedMs is a finished racer's race time, -1 while racing.
func (f *Field) FinishElapsedMs(b *Bot) int64 {
	if !b.Finished() {
		return -1
	}
	return b.finishedAt - f.startAt
}

// Position is a racer's place in three.js world meters.
func (f *Field) Position(b *Bot) vec3 {
	position, _ := f.track.surface(b.u, b.lane)
	return position
}

// Frame is a racer's next motion frame at tick now (node clock ms).
func (f *Field) Frame(b *Bot, now int64) []byte {
	position, heading := f.track.surface(b.u, b.lane)
	distance, lap := f.Progress(b)
	b.sequence++
	moving := b.speed > 0.1
	return encodeFrame(b.Slot, f.raceTag, b.sequence, now, pose{
		position: position, velocity: heading.scale(b.speed), heading: heading, speed: b.speed,
		steer: b.steer, boosting: moving && now < b.boostUntil, distance: distance, lap: lap,
		finishElapsedMs: f.FinishElapsedMs(b), collision: true,
	})
}

// Distance is the straight distance between two places (m).
func Distance(a, b [3]float64) float64 {
	return math.Sqrt((a[0]-b[0])*(a[0]-b[0]) + (a[1]-b[1])*(a[1]-b[1]) + (a[2]-b[2])*(a[2]-b[2]))
}

// WirePosition is a racer's place in motion frame (client) coordinates.
func (f *Field) WirePosition(b *Bot) [3]float64 { return wire(f.Position(b)) }

func cmpFloat(a, b float64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}
