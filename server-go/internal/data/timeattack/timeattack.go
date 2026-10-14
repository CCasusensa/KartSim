// Package timeattack is the 练习计时赛 mission table the data service judges:
// the 赛道对决 (track duel) events and the 练习目标 (training goals) of each
// track, exported from the release zeta_/cn/content/timeAttack/
// timeAttackMission.xml (client/tools/export-timeattack-missions.mjs), plus
// the rules of the 排位计时赛 (ranked time attack). See server-go/TIMEATTACK.md.
package timeattack

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"time"
)

//go:embed missions.json
var embedded []byte

// Beijing is the zone of every period in the data.
var Beijing = time.FixedZone("UTC+8", 8*60*60)

// Ranked time attack (stage_rankingTimeAttackReady chargeLucciConfirm).
const (
	// RankedEntryLucci is the fee of one ranked run (进行排位计时赛需要500金币).
	RankedEntryLucci = 500
	// RankingSize is how many records a track keeps replays for and lists.
	RankingSize = 10
	// MaxReplayBytes bounds an uploaded replay (.ksv); a 10 Hz pose track of
	// a ten-minute run is under 120 KB before its deflate.
	MaxReplayBytes = 512 * 1024
)

// Record modes (timeattack_records.mode).
const (
	ModePractice = "practice"
	ModeRanked   = "ranked"
)

// Goal types (GoalSet.Type).
const (
	GoalFinish  = "finish"  // 完成赛道: finishes, cumulative
	GoalBooster = "booster" // 使用加速器道具（完成时累积）: boosters used, cumulative
	GoalCrash   = "crash"   // 撞击次数%s次以内: finishes with at most Requirement crashes, per stage
	GoalRecord  = "record"  // 达成赛道纪录: one finish within Requirement ms
)

// Reward types (Reward.Type).
const (
	RewardStock  = "stock"  // a shop stock (RewardStocks)
	RewardLucci  = "lucci"  // 金币
	RewardRP     = "rp"     // experience
	RewardEmblem = "emblem" // an emblem id
)

// MaxDifficulty is the highest 难度设定 level (NPC sets off 5 s later).
const MaxDifficulty = 3

// Reward is one mission prize.
type Reward struct {
	Type  string `json:"type"`
	Value int    `json:"value"`
}

// StockItem is one item of a reward stock.
type StockItem struct {
	Category int `json:"category"`
	ItemID   int `json:"itemId"`
	Count    int `json:"count"`
	Days     int `json:"days"`
}

// Stock is a reward stock's items.
type Stock struct {
	Name  string      `json:"name"`
	Items []StockItem `json:"items"`
}

// NPC is a duel stage's opponent.
type NPC struct {
	Name        string `json:"name"`
	CharacterID int    `json:"characterId"`
	KartID      int    `json:"kartId"`
	Color       int    `json:"color"`
	Dye         int    `json:"dye"`
}

// Difficulty is one 难度设定 level above 无: after Point consecutive losses
// the NPC may set off AdvantageMs later, and a win at that level also earns
// its special reward once.
type Difficulty struct {
	Point       int    `json:"point"`
	AdvantageMs int    `json:"advantageMs"`
	Reward      Reward `json:"reward"`
}

// DuelStage is one NPC of a duel event; a stage opens when the previous
// one was won.
type DuelStage struct {
	Stage int    `json:"stage"`
	Ksv   string `json:"ksv"`
	// NPCTimeMs is the NPC's time, the best time of its recording (Ksv): the
	// browser plays that .ksv in the race, so the NPC crosses the line then.
	NPCTimeMs   int64        `json:"npcTimeMs"`
	Speed       int          `json:"speed"`
	TeamBooster bool         `json:"teamBooster"`
	NPC         NPC          `json:"npc"`
	Messages    DuelMessages `json:"messages"`
	// Difficulties lists the levels 无 (advantage 0), 1, 2 and 3 in order.
	Difficulties []Difficulty `json:"difficulties"`
	Reward       *Reward      `json:"reward"`
}

// DuelMessages are the NPC's lines of the difficulty and the victory popups.
type DuelMessages struct {
	Difficulty []string `json:"difficulty"`
	Win        []string `json:"win"`
}

// Duel is one 赛道对决 event: a track for a period.
type Duel struct {
	TrackID string      `json:"trackId"`
	From    string      `json:"from"`
	To      string      `json:"to"`
	Stages  []DuelStage `json:"stages"`

	from, to time.Time
}

// Key names the event: its track and start (the mission rows' key).
func (d *Duel) Key() string { return d.TrackID + "@" + d.From }

// Active reports whether now lies in the event's period.
func (d *Duel) Active(now time.Time) bool { return !now.Before(d.from) && !now.After(d.to) }

// Period is the event's period in Unix milliseconds.
func (d *Duel) Period() (from, to int64) { return d.from.UnixMilli(), d.to.UnixMilli() }

// GoalStage is one stage of a training goal set.
type GoalStage struct {
	Count       int    `json:"count"`
	Requirement int    `json:"requirement"`
	Reward      Reward `json:"reward"`
}

// GoalSet is one 练习目标 of a track with its stages in order.
type GoalSet struct {
	Title  string      `json:"title"`
	Type   string      `json:"type"`
	Hidden bool        `json:"hidden"`
	Stages []GoalStage `json:"stages"`
}

// Data is the parsed table.
type Data struct {
	GeneratedFrom string               `json:"generatedFrom"`
	Duels         []Duel               `json:"duels"`
	Training      map[string][]GoalSet `json:"training"`
	RewardStocks  map[string]Stock     `json:"rewardStocks"`
}

var (
	defaultOnce sync.Once
	defaultData *Data
	defaultErr  error
)

// Default parses the embedded table once.
func Default() (*Data, error) {
	defaultOnce.Do(func() { defaultData, defaultErr = Parse(embedded) })
	return defaultData, defaultErr
}

// Parse decodes and validates a missions.json document.
func Parse(raw []byte) (*Data, error) {
	var data Data
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, fmt.Errorf("missions.json: %w", err)
	}
	if len(data.Duels) == 0 || len(data.Training) == 0 {
		return nil, errors.New("missions.json: no duels or training goals")
	}
	for i := range data.Duels {
		d := &data.Duels[i]
		var err error
		if d.from, err = time.ParseInLocation("2006-01-02T15:04:05", d.From, Beijing); err != nil {
			return nil, fmt.Errorf("duel %s: from: %w", d.TrackID, err)
		}
		if d.to, err = time.ParseInLocation("2006-01-02T15:04:05", d.To, Beijing); err != nil {
			return nil, fmt.Errorf("duel %s: to: %w", d.TrackID, err)
		}
		if !d.to.After(d.from) || len(d.Stages) == 0 {
			return nil, fmt.Errorf("duel %s: empty period or no stages", d.TrackID)
		}
		for j := range d.Stages {
			s := &d.Stages[j]
			if s.Stage != j+1 || s.NPC.Name == "" || s.NPC.CharacterID <= 0 || s.Ksv == "" || s.NPCTimeMs <= 0 {
				return nil, fmt.Errorf("duel %s stage %d: invalid", d.TrackID, j+1)
			}
			if len(s.Difficulties) != MaxDifficulty+1 || s.Difficulties[0].AdvantageMs != 0 {
				return nil, fmt.Errorf("duel %s stage %d: %d difficulty levels", d.TrackID, j+1, len(s.Difficulties))
			}
			if err := data.validReward(s.Reward); err != nil {
				return nil, fmt.Errorf("duel %s stage %d: %w", d.TrackID, j+1, err)
			}
			for _, level := range s.Difficulties {
				if err := data.validReward(&level.Reward); err != nil {
					return nil, fmt.Errorf("duel %s stage %d: %w", d.TrackID, j+1, err)
				}
			}
		}
	}
	for track, sets := range data.Training {
		for i, set := range sets {
			switch set.Type {
			case GoalFinish, GoalBooster, GoalCrash, GoalRecord:
			default:
				return nil, fmt.Errorf("training %s set %d: type %q", track, i, set.Type)
			}
			if len(set.Stages) == 0 {
				return nil, fmt.Errorf("training %s set %d: no stages", track, i)
			}
			for j, stage := range set.Stages {
				if stage.Count <= 0 {
					return nil, fmt.Errorf("training %s set %d stage %d: count", track, i, j+1)
				}
				if err := data.validReward(&stage.Reward); err != nil {
					return nil, fmt.Errorf("training %s set %d stage %d: %w", track, i, j+1, err)
				}
			}
		}
	}
	return &data, nil
}

func (d *Data) validReward(r *Reward) error {
	if r == nil {
		return nil
	}
	switch r.Type {
	case RewardStock:
		if _, ok := d.RewardStocks[strconv.Itoa(r.Value)]; !ok {
			return fmt.Errorf("reward stock %d is unknown", r.Value)
		}
	case RewardLucci, RewardRP, RewardEmblem:
		if r.Value <= 0 {
			return fmt.Errorf("reward %s %d", r.Type, r.Value)
		}
	default:
		return fmt.Errorf("reward type %q", r.Type)
	}
	return nil
}

// Stock returns the items of a stock reward.
func (d *Data) Stock(r Reward) (Stock, bool) {
	if r.Type != RewardStock {
		return Stock{}, false
	}
	stock, ok := d.RewardStocks[strconv.Itoa(r.Value)]
	return stock, ok
}

// ActiveDuel is the duel event running at now, if any (the latest-starting
// one when periods overlap).
func (d *Data) ActiveDuel(now time.Time) (*Duel, bool) {
	var found *Duel
	for i := range d.Duels {
		duel := &d.Duels[i]
		if duel.Active(now) && (found == nil || duel.from.After(found.from)) {
			found = duel
		}
	}
	return found, found != nil
}

// DuelByKey finds an event by Key (the mission rows' key).
func (d *Data) DuelByKey(key string) (*Duel, bool) {
	for i := range d.Duels {
		if d.Duels[i].Key() == key {
			return &d.Duels[i], true
		}
	}
	return nil, false
}

// Goals returns a track's training goal sets (nil: none).
func (d *Data) Goals(trackID string) []GoalSet { return d.Training[trackID] }

// RecordGoalMs is the track's 达成赛道纪录 time (0: none).
func (d *Data) RecordGoalMs(trackID string) int64 {
	for _, set := range d.Training[trackID] {
		if set.Type == GoalRecord && len(set.Stages) > 0 {
			return int64(set.Stages[0].Requirement)
		}
	}
	return 0
}

// DifficultyLevel is the 难度设定 a racer may pick after losses consecutive
// defeats at a stage: one level per Point losses, up to MaxDifficulty.
func DifficultyLevel(stage DuelStage, losses int) int {
	level := 0
	for i := 1; i < len(stage.Difficulties) && i <= MaxDifficulty; i++ {
		point := stage.Difficulties[i].Point
		if point <= 0 || losses < point*i {
			break
		}
		level = i
	}
	return level
}
