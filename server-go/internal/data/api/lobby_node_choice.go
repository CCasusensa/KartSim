package api

import (
	"cmp"
	"fmt"
	"slices"
	"strings"

	"kartsim/internal/data/cache"
	"kartsim/internal/game/lobby"
	"kartsim/internal/shared/contract"
)

// How the global lobby picks a game node (GLOBAL_LOBBY.md 4) and the record
// of each pick the console shows (服务器节点 → 最近分配).

const (
	// unknownLatency is assumed for a node a counted player did not reach.
	unknownLatency = 250
	// recentChoices is how many node picks the console keeps.
	recentChoices = 100
)

// Why a node could not take the players.
const (
	excludedProtocol = "protocol"
	excludedFull     = "full"
)

// choiceKind is what a node was picked for.
const (
	choiceRace = "race"
	choiceCity = "city"
)

// nodeChoice is one node pick: who asked, what each player measured, how
// each node scored and which one won ("" when none could take them).
type nodeChoice struct {
	At       int64          `json:"at"`
	Kind     string         `json:"kind"`
	RoomID   string         `json:"roomId,omitempty"`
	RoomName string         `json:"roomName,omitempty"`
	NodeID   string         `json:"nodeId"`
	NodeName string         `json:"nodeName"`
	Error    string         `json:"error,omitempty"`
	Players  []choicePlayer `json:"players"`
	Nodes    []choiceNode   `json:"nodes"`
}

// choicePlayer is a player's latency report (node ID → ms; nil: none yet)
// and whether it counted in the scores.
type choicePlayer struct {
	Name    string         `json:"name"`
	Counted bool           `json:"counted"`
	Latency map[string]int `json:"latency"`
}

// choiceNode is a node at the time of the pick: its score as a candidate,
// or why it was not one.
type choiceNode struct {
	NodeID   string `json:"nodeId"`
	Name     string `json:"name"`
	Players  int    `json:"players"`
	Capacity int    `json:"capacity"`
	Score    *int   `json:"score"`
	Excluded string `json:"excluded,omitempty"`
}

// nodePick is the outcome of pickNode.
type nodePick struct {
	node  cache.Node
	found bool
	// scores is each candidate's score (node ID → worst counted ms).
	scores map[string]int
	// excluded is why a node was not a candidate (node ID → reason).
	excluded map[string]string
	// counted is, per player, whether its latency counted.
	counted []bool
}

// pickNode chooses the game node for players (one latency report each,
// node ID → ms, nil when it has none). The candidates are the nodes of
// this protocol with room for them all. A candidate's score is the worst
// round trip among the counted players: those who measured at least one
// candidate; a candidate a counted player did not reach scores
// unknownLatency for it. Players without such a measurement do not count,
// and when nobody counts every candidate scores 0. The lowest score wins,
// then the least loaded, then the node ID.
func pickNode(nodes []cache.Node, latency []map[string]int) nodePick {
	pick := nodePick{scores: map[string]int{}, excluded: map[string]string{}, counted: make([]bool, len(latency))}
	var candidates []cache.Node
	for _, node := range nodes {
		switch {
		case node.ProtocolVersion != contract.ProtocolVersion:
			pick.excluded[node.NodeID] = excludedProtocol
		case node.Players+len(latency) > node.Capacity:
			pick.excluded[node.NodeID] = excludedFull
		default:
			candidates = append(candidates, node)
		}
	}
	for i, report := range latency {
		pick.counted[i] = slices.ContainsFunc(candidates, func(node cache.Node) bool {
			_, measured := report[node.NodeID]
			return measured
		})
	}
	for _, node := range candidates {
		worst := 0
		for i, report := range latency {
			if !pick.counted[i] {
				continue
			}
			ms, measured := report[node.NodeID]
			if !measured {
				ms = unknownLatency
			}
			worst = max(worst, ms)
		}
		pick.scores[node.NodeID] = worst
	}
	if len(candidates) == 0 {
		return pick
	}
	load := func(n cache.Node) float64 { return float64(n.Players) / float64(max(n.Capacity, 1)) }
	pick.node = slices.MinFunc(candidates, func(a, b cache.Node) int {
		return cmp.Or(cmp.Compare(pick.scores[a.NodeID], pick.scores[b.NodeID]), cmp.Compare(load(a), load(b)),
			cmp.Compare(a.NodeID, b.NodeID))
	})
	pick.found = true
	return pick
}

// describe fills the record of a pick: the players' counting, every node
// (candidates by score, then the excluded) and the winner, or
// NO_GAME_SERVER.
func (choice *nodeChoice) describe(nodes []cache.Node, pick nodePick) {
	for i := range choice.Players {
		choice.Players[i].Counted = i < len(pick.counted) && pick.counted[i]
	}
	choice.Nodes = make([]choiceNode, 0, len(nodes))
	for _, node := range nodes {
		row := choiceNode{NodeID: node.NodeID, Name: node.Name, Players: node.Players, Capacity: node.Capacity,
			Excluded: pick.excluded[node.NodeID]}
		if score, ok := pick.scores[node.NodeID]; ok {
			row.Score = &score
		}
		choice.Nodes = append(choice.Nodes, row)
	}
	slices.SortStableFunc(choice.Nodes, func(a, b choiceNode) int {
		switch {
		case a.Score == nil || b.Score == nil:
			return cmp.Compare(boolRank(a.Score == nil), boolRank(b.Score == nil))
		default:
			return cmp.Compare(*a.Score, *b.Score)
		}
	})
	if pick.found {
		choice.NodeID, choice.NodeName = pick.node.NodeID, pick.node.Name
	} else {
		choice.Error = lobby.RaceErrorNoServer
	}
}

func boolRank(b bool) int {
	if b {
		return 1
	}
	return 0
}

// logLatency is the players' reports for the log: "alice{gz:12 bj:40}
// bob{未测速}"; an uncounted report is marked 不计.
func (choice *nodeChoice) logLatency() string {
	parts := make([]string, 0, len(choice.Players))
	for _, p := range choice.Players {
		switch {
		case p.Latency == nil:
			parts = append(parts, p.Name+"{未测速}")
		case !p.Counted:
			parts = append(parts, p.Name+"{不计 "+formatLatency(p.Latency)+"}")
		default:
			parts = append(parts, p.Name+"{"+formatLatency(p.Latency)+"}")
		}
	}
	return strings.Join(parts, " ")
}

// logScores is the nodes for the log: "gz=38 bj=52 old=protocol".
func (choice *nodeChoice) logScores() string {
	parts := make([]string, 0, len(choice.Nodes))
	for _, n := range choice.Nodes {
		if n.Score != nil {
			parts = append(parts, fmt.Sprintf("%s=%d", n.NodeID, *n.Score))
		} else {
			parts = append(parts, n.NodeID+"="+n.Excluded)
		}
	}
	return strings.Join(parts, " ")
}

func formatLatency(latency map[string]int) string {
	ids := make([]string, 0, len(latency))
	for id := range latency {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = fmt.Sprintf("%s:%d", id, latency[id])
	}
	return strings.Join(parts, " ")
}

// remember keeps a pick for the console, newest last.
func (h *lobbyHome) remember(choice nodeChoice) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.choices = append(h.choices, choice)
	if len(h.choices) > recentChoices {
		h.choices = slices.Delete(h.choices, 0, len(h.choices)-recentChoices)
	}
}

// recent lists the kept picks, newest first.
func (h *lobbyHome) recent() []nodeChoice {
	h.mu.Lock()
	defer h.mu.Unlock()
	recent := slices.Clone(h.choices)
	slices.Reverse(recent)
	if recent == nil {
		recent = []nodeChoice{}
	}
	return recent
}
