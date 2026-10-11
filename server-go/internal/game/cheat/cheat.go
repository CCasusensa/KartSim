// Package cheat is the game node's side of the anti-cheat (ANTICHEAT.md):
// the events the lobby reports about each race and racer, and the
// violations it acts on. The checks themselves live in a separately built
// plugin (package plugin loads it); without one the node checks nothing
// beyond refusing to relay motion frames the browsers cannot decode.
//
// The lobby calls a Guard and everything it returns under its lock, one
// call at a time; none of them may block.
package cheat

// Actions the node takes about a violation.
const (
	// ActionKick: record the violation and kick the racer.
	ActionKick = "kick"
	// ActionLog: only record it.
	ActionLog = "log"
)

// Violation is a failed check: its code, the measured values and what
// the node should do about it.
type Violation struct {
	Code   string `json:"code"`
	Detail string `json:"detail"`
	Action string `json:"action"`
}

// RaceInfo describes a race once it counts down; StartAt is its start on
// the node clock (ms).
type RaceInfo struct {
	TrackID         string `json:"trackId"`
	Gameplay        string `json:"gameplay"`
	Mode            string `json:"mode"`
	ResourceVersion string `json:"resourceVersion"`
	Speed           int    `json:"speed"`
	StartAt         int64  `json:"startAt"`
}

// Finish is a racer's finish as the node saw it: the time it reported, the
// race time the node observed, the furthest route distance its frames
// reported and whether its frames should have reached the node all race
// long (another racer was still in the race to receive them).
type Finish struct {
	ElapsedMs    int     `json:"elapsedMs"`
	RacedMs      int64   `json:"racedMs"`
	Progress     float64 `json:"progress"`
	ExpectFrames bool    `json:"expectFrames"`
}

// Item race events (ItemEvent.Kind).
const (
	ItemUse    = "use"    // an item use the node accepted
	ItemPlace  = "place"  // a point a barricade's target or a time bomb's user reported
	ItemHit    = "hit"    // a victim's hit report
	ItemEscape = "escape" // a trapped racer's early escape
)

// ItemEvent is an item race event: what the node accepted, and the hit and
// escape reports also when it refused them (Error is the refusal's code).
// PlayerID is the racer who sent it: the user of a use or place, the victim
// of a hit or escape. Times are the node clock (ms); points are client
// coordinates (z up). States are the item's state lifetimes (ms) from the
// item data.
type ItemEvent struct {
	Kind     string      `json:"kind"`
	PlayerID string      `json:"playerId"`
	UseID    int         `json:"useId"`
	ItemID   int         `json:"itemId"`
	At       int64       `json:"at"`
	Targets  []string    `json:"targets,omitempty"`
	StartAt  int64       `json:"startAt,omitempty"`
	EtaMs    int         `json:"etaMs,omitempty"`
	Count    int         `json:"count,omitempty"`
	Point    *[3]float64 `json:"point,omitempty"`
	Result   string      `json:"result,omitempty"`
	By       string      `json:"by,omitempty"`
	Variant  string      `json:"variant,omitempty"`
	Shot     int         `json:"shot,omitempty"`
	HazardID int         `json:"hazardId,omitempty"`
	// Repeat: a report the node had recorded already (it answers the first
	// one again).
	Repeat bool           `json:"repeat,omitempty"`
	Error  string         `json:"error,omitempty"`
	States map[string]int `json:"states,omitempty"`
}

// Guard checks the races of one node.
type Guard interface {
	// StartRace registers a race at now (the node clock, ms).
	StartRace(info RaceInfo, now int64) Race
}

// Race is one race of a Guard.
type Race interface {
	// Racer registers a racer with the kart item it races with (0: the
	// practice kart).
	Racer(playerID string, kart int) Racer
	// ProgressCap is the most route distance a racer may have reached
	// racedMs after the start at lap (false: no opinion).
	ProgressCap(lap int, racedMs int64) (float64, bool)
	// Item checks an item race event; a violation is about the racer who
	// sent it (ItemEvent.PlayerID).
	Item(e ItemEvent) *Violation
	// End forgets the race.
	End()
}

// Racer is one racer of a Race.
type Racer interface {
	// Motion checks a motion frame's payload of kind received at now;
	// valid is false for one the browsers cannot decode (the node drops it
	// whatever the answer).
	Motion(kind int, valid bool, now int64, payload []byte) *Violation
	// Finish checks a finish; stats are fields for the node's log.
	Finish(f Finish) (v *Violation, stats map[string]any)
	// ItemUse reports an item use the node accepted.
	ItemUse(itemID int)
	// Cube checks an item cube eaten at now.
	Cube(cubeID int, now int64) *Violation
	// TeamCharge checks a team-charge report at now.
	TeamCharge(amount float64, now int64) *Violation
}
