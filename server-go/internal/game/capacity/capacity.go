// Package capacity sizes a game node from the machine it runs on: the
// usable CPUs and memory (container limits included) and, when the operator
// knows it, the uplink bandwidth. kart-node uses it for the "auto" values of
// KART_MAX_PLAYERS and the limits derived from it (NODE.md "自动人数").
package capacity

import (
	"fmt"
	"math"
	"os"
	"runtime"
	"strings"
)

// Per-player costs behind the plan. They come from a load test of one node
// (NODE.md "自动人数"): 8-racer rooms, every racer sending a motion frame
// each 64 ms over WebRTC, anti-cheat plugin on. 400 racers used 3.3 cores
// of an Apple M2 Max and 790 MB RSS; a cloud vCPU (one hyperthread) counts
// as about half such a core, and the plan keeps 30 % CPU headroom.
const (
	// DefaultPlayersPerCore is how many racers one usable CPU carries.
	DefaultPlayersPerCore = 40
	// MemoryPerPlayerMB is the resident memory one WebRTC racer costs,
	// with garbage collector headroom.
	MemoryPerPlayerMB = 2.5
	// BaseMemoryMB is what an idle node holds: item race data, the
	// anti-cheat runtime, city lines and the Go runtime.
	BaseMemoryMB = 160
	// UplinkPerPlayerMbps is what one racer costs the node's uplink: seven
	// opponents × 15.6 frames/s × about 245 bytes (a 171-byte frame plus
	// DTLS/SCTP/UDP/IP headers).
	UplinkPerPlayerMbps = 0.25
	// UplinkUse is the share of the uplink the plan fills.
	UplinkUse = 0.85

	// MinPlayers is one full room; MaxPlayers is config.MaxPlayersLimit.
	MinPlayers = 8
	MaxPlayers = 10_000
	// CityLinePlayers is the default KART_CITY_LINE_PLAYERS; the plan has
	// one city line per this many players times two.
	CityLinePlayers = 60
)

// Hardware is what Detect found.
type Hardware struct {
	OS, Arch string
	// LogicalCPUs is runtime.NumCPU; UsableCPUs is GOMAXPROCS, which Go
	// lowers to a container's CPU quota.
	LogicalCPUs int
	UsableCPUs  int
	// TotalMemoryMB is the physical memory, LimitMemoryMB a container
	// (cgroup) limit below it (0: none), AvailableMemoryMB what the OS
	// reports as available now (0: unknown).
	TotalMemoryMB     int
	LimitMemoryMB     int
	AvailableMemoryMB int
	Hostname          string
}

// MemoryMB is the memory the node may use: the container limit when there
// is one, otherwise the physical memory (0: unknown).
func (h Hardware) MemoryMB() int {
	if h.LimitMemoryMB > 0 && (h.TotalMemoryMB == 0 || h.LimitMemoryMB < h.TotalMemoryMB) {
		return h.LimitMemoryMB
	}
	return h.TotalMemoryMB
}

// Detect reads the machine. Memory it cannot read stays 0.
func Detect() Hardware {
	h := Hardware{OS: runtime.GOOS, Arch: runtime.GOARCH, LogicalCPUs: runtime.NumCPU(),
		UsableCPUs: runtime.GOMAXPROCS(0)}
	h.Hostname, _ = os.Hostname()
	total, available := systemMemory()
	h.TotalMemoryMB, h.AvailableMemoryMB = int(total>>20), int(available>>20)
	if limit := containerMemoryLimit(); limit > 0 {
		h.LimitMemoryMB = int(limit >> 20)
	}
	return h
}

// Inputs are the operator's settings that shape the plan; zero values pick
// the defaults.
type Inputs struct {
	PlayersPerCore int     // racers per usable CPU (DefaultPlayersPerCore)
	UplinkMbps     float64 // the node's uplink; 0: unknown, not a limit
	ReserveMB      int     // memory left to the OS and other programs (DefaultReserveMB)
}

// DefaultReserveMB leaves 15 % of the memory to the system, at least 256 MB
// and at most 2 GB.
func DefaultReserveMB(memoryMB int) int {
	return min(max(memoryMB*15/100, 256), 2048)
}

// Plan is the sizing for one node.
type Plan struct {
	MaxPlayers     int
	MaxRooms       int
	MaxConnections int
	MemoryLimitMB  int // 0: memory unknown, no limit
	CityLines      int

	// The player counts each resource allows (0: not a limit), and the
	// resource that set MaxPlayers ("cpu", "memory", "uplink").
	CPUPlayers, MemoryPlayers, UplinkPlayers int
	LimitedBy                                string
}

// Suggest sizes a node for h.
func Suggest(h Hardware, in Inputs) Plan {
	perCore := in.PlayersPerCore
	if perCore <= 0 {
		perCore = DefaultPlayersPerCore
	}
	var p Plan
	p.CPUPlayers = max(h.UsableCPUs, 1) * perCore
	p.MaxPlayers, p.LimitedBy = p.CPUPlayers, "cpu"

	if memory := h.MemoryMB(); memory > 0 {
		reserve := in.ReserveMB
		if reserve <= 0 {
			reserve = DefaultReserveMB(memory)
		}
		usable := max(memory-reserve, 64)
		p.MemoryLimitMB = usable
		p.MemoryPlayers = max(int(float64(usable-BaseMemoryMB)/MemoryPerPlayerMB), 0)
		if p.MemoryPlayers < p.MaxPlayers {
			p.MaxPlayers, p.LimitedBy = p.MemoryPlayers, "memory"
		}
	}
	if in.UplinkMbps > 0 {
		p.UplinkPlayers = int(in.UplinkMbps * UplinkUse / UplinkPerPlayerMbps)
		if p.UplinkPlayers < p.MaxPlayers {
			p.MaxPlayers, p.LimitedBy = p.UplinkPlayers, "uplink"
		}
	}
	p.MaxPlayers = min(max(p.MaxPlayers, MinPlayers), MaxPlayers)
	p.Derive()
	return p
}

// Derive sets the limits that follow from MaxPlayers: half as many rooms
// (a room holds at least one racer, most hold two or more), 10 % (at least
// 20) more connections for those still saying hello, and one city line per
// 120 players.
func (p *Plan) Derive() {
	p.MaxRooms = max((p.MaxPlayers+1)/2, 4)
	p.MaxConnections = p.MaxPlayers + max(p.MaxPlayers/10, 20)
	p.CityLines = min(max(int(math.Ceil(float64(p.MaxPlayers)/(2*CityLinePlayers))), 1), 32)
}

// Describe is a one-line summary of h for logs.
func (h Hardware) Describe() string {
	parts := []string{fmt.Sprintf("%s/%s", h.OS, h.Arch),
		fmt.Sprintf("CPU %d 个可用（共 %d 个逻辑核心）", h.UsableCPUs, h.LogicalCPUs)}
	switch {
	case h.TotalMemoryMB == 0 && h.LimitMemoryMB == 0:
		parts = append(parts, "内存未知")
	case h.LimitMemoryMB > 0 && h.MemoryMB() == h.LimitMemoryMB:
		parts = append(parts, fmt.Sprintf("内存 %d MB（容器限制，物理 %d MB）", h.LimitMemoryMB, h.TotalMemoryMB))
	default:
		parts = append(parts, fmt.Sprintf("内存 %d MB", h.TotalMemoryMB))
	}
	if h.AvailableMemoryMB > 0 && h.MemoryMB() == h.TotalMemoryMB {
		// Inside a container the host's figure means little.
		parts = append(parts, fmt.Sprintf("当前可用 %d MB", h.AvailableMemoryMB))
	}
	return strings.Join(parts, "，")
}

// LimitName is the Chinese name of Plan.LimitedBy.
func LimitName(limitedBy string) string {
	switch limitedBy {
	case "cpu":
		return "CPU"
	case "memory":
		return "内存"
	case "uplink":
		return "上行带宽"
	}
	return limitedBy
}
