package city

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

// The delivery quests (CITY-QUESTS.md): a copy of
// design/open-world/vice-city/city-quests.json, built by
// client/tools/city/quests/build-city-quests.mjs (the browser loads the
// same file for the dialogues). TestEmbeddedQuestsMatchDesign checks the
// copy.
//
//go:embed city-quests.json
var embeddedQuests []byte

// Quest kinds (the limit a delivery has).
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
	SpeedGraceMs int64   `json:"speedGraceMs"`
}

// QuestNPC is a task-point NPC's spot (design x, z).
type QuestNPC struct {
	Name string  `json:"name"`
	X    float64 `json:"x"`
	Z    float64 `json:"z"`
}

// Quest is one delivery: who gives it, who receives it, its limit and its
// base reward (before the data service's rates).
type Quest struct {
	ID            string  `json:"id"`
	Giver         string  `json:"giver"`
	Receiver      string  `json:"receiver"`
	Kind          string  `json:"kind"`
	DistanceM     int64   `json:"distanceM"`
	Lucci         int64   `json:"lucci"`
	Exp           int64   `json:"exp"`
	MaxKmh        float64 `json:"maxKmh"`
	MaxCollisions int     `json:"maxCollisions"`
	TimeLimitMs   int64   `json:"timeLimitMs"`
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
	if raw.Version != 1 || raw.Rules.ArriveRadius <= 0 || raw.Rules.TalkRadius <= 0 {
		return nil, fmt.Errorf("city quests: bad version or rules")
	}
	book := &QuestBook{Rules: raw.Rules, NPCs: raw.NPCs, Quests: map[string]*Quest{}}
	for _, q := range raw.Quests {
		_, giver := raw.NPCs[q.Giver]
		_, receiver := raw.NPCs[q.Receiver]
		bad := !giver || !receiver || q.Giver == q.Receiver || q.Lucci < 0 || q.Exp < 0 ||
			book.Quests[q.ID] != nil
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
