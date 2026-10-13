package city

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

// The quests (CITY-QUESTS.md): a copy of
// design/open-world/vice-city/city-quests.json, built by
// client/tools/city/quests/build-city-quests.mjs (the browser loads the
// same file for the dialogues). TestEmbeddedQuestsMatchDesign checks the
// copy.
//
//go:embed city-quests.json
var embeddedQuests []byte

// Quest types (what a quest asks).
const (
	// QuestDelivery: carry an item from the giver to the receiver.
	QuestDelivery = "delivery"
	// QuestPassenger: the giver rides in the back seat to the receiver.
	QuestPassenger = "passenger"
	// QuestCollect: pass by every stop, then go to the receiver.
	QuestCollect = "collect"
	// QuestSearch: find the item hidden in an area, then bring it to the receiver.
	QuestSearch = "search"
)

// Quest kinds (the limit a quest has).
const (
	QuestNormal    = "normal"
	QuestSpeed     = "speed"
	QuestCollision = "collision"
	QuestTime      = "time"
)

// QuestBook is the parsed city-quests.json.
type QuestBook struct {
	Rules  QuestRules
	NPCs   map[string]QuestNPC
	Quests map[string]*Quest
}

// QuestRules are the distances and grace the node judges with.
type QuestRules struct {
	ArriveRadius float64 `json:"arriveRadius"`
	TalkRadius   float64 `json:"talkRadius"`
	// PickupRadius: how near a stop or a hidden item counts as reaching it.
	PickupRadius float64        `json:"pickupRadius"`
	SpeedGraceMs int64          `json:"speedGraceMs"`
	Passenger    PassengerRules `json:"passenger"`
	Search       SearchRules    `json:"search"`
}

// PassengerRules: the passenger's satisfaction starts at 100 and drops by
// CollisionPenalty a collision and SpeedPenaltyPerS a second above
// ComfortKmh; at 0 the passenger gets out. The tip is the 金币 reward ×
// TipMax × satisfaction / 100.
type PassengerRules struct {
	CollisionPenalty float64 `json:"collisionPenalty"`
	ComfortKmh       float64 `json:"comfortKmh"`
	SpeedPenaltyPerS float64 `json:"speedPenaltyPerS"`
	TipMax           float64 `json:"tipMax"`
}

// SearchRules: the signal is 5 bars within SignalBands[0] m of the hidden
// item, 4 within SignalBands[1] … and 1 bar beyond the last band.
type SearchRules struct {
	SignalBands []float64 `json:"signalBands"`
}

// QuestPoint is a named spot (design x, z).
type QuestPoint struct {
	Name string  `json:"name"`
	X    float64 `json:"x"`
	Z    float64 `json:"z"`
}

// QuestArea is where a search's item lies: one of Spots, picked per run.
type QuestArea struct {
	Name   string       `json:"name"`
	X      float64      `json:"x"`
	Z      float64      `json:"z"`
	Radius float64      `json:"radius"`
	Spots  []QuestPoint `json:"spots"`
}

// QuestNPC is a task-point NPC's spot (design x, z).
type QuestNPC struct {
	Name string  `json:"name"`
	X    float64 `json:"x"`
	Z    float64 `json:"z"`
}

// Quest is one quest: what it asks, who gives it, who receives it, its
// limit and its base reward (before the data service's rates).
type Quest struct {
	ID            string       `json:"id"`
	Type          string       `json:"type"`
	Giver         string       `json:"giver"`
	Receiver      string       `json:"receiver"`
	Kind          string       `json:"kind"`
	Stops         []QuestPoint `json:"stops"`
	Area          *QuestArea   `json:"area"`
	DistanceM     int64        `json:"distanceM"`
	Lucci         int64        `json:"lucci"`
	Exp           int64        `json:"exp"`
	MaxKmh        float64      `json:"maxKmh"`
	MaxCollisions int          `json:"maxCollisions"`
	TimeLimitMs   int64        `json:"timeLimitMs"`
}

// DefaultQuests parses the embedded quest table.
func DefaultQuests() (*QuestBook, error) { return ParseQuests(embeddedQuests) }

// ParseQuests parses and checks a city-quests.json document.
func ParseQuests(data []byte) (*QuestBook, error) {
	var raw struct {
		Version int                 `json:"version"`
		Rules   QuestRules          `json:"rules"`
		NPCs    map[string]QuestNPC `json:"npcs"`
		Quests  []*Quest            `json:"quests"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("city quests: %w", err)
	}
	rules := raw.Rules
	if raw.Version != 2 || rules.ArriveRadius <= 0 || rules.TalkRadius <= 0 || rules.PickupRadius <= 0 ||
		rules.Passenger.ComfortKmh <= 0 || rules.Passenger.TipMax < 0 || len(rules.Search.SignalBands) == 0 {
		return nil, fmt.Errorf("city quests: bad version or rules")
	}
	book := &QuestBook{Rules: rules, NPCs: raw.NPCs, Quests: map[string]*Quest{}}
	for _, q := range raw.Quests {
		_, giver := raw.NPCs[q.Giver]
		_, receiver := raw.NPCs[q.Receiver]
		bad := !giver || !receiver || q.Lucci < 0 || q.Exp < 0 || book.Quests[q.ID] != nil
		switch q.Type {
		case QuestDelivery, QuestPassenger:
			bad = bad || q.Giver == q.Receiver
		case QuestCollect:
			bad = bad || len(q.Stops) < 2
		case QuestSearch:
			bad = bad || q.Area == nil || len(q.Area.Spots) == 0
		default:
			bad = true
		}
		switch q.Kind {
		case QuestNormal:
		case QuestSpeed:
			bad = bad || q.MaxKmh <= 0
		case QuestCollision:
			bad = bad || q.MaxCollisions < 0
		case QuestTime:
			bad = bad || q.TimeLimitMs <= 0
		default:
			bad = true
		}
		if bad {
			return nil, fmt.Errorf("city quests: quest %q is invalid", q.ID)
		}
		book.Quests[q.ID] = q
	}
	return book, nil
}
