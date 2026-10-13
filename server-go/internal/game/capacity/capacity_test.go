package capacity

import (
	"bufio"
	"strings"
	"testing"
)

func TestSuggestTakesTheScarcestResource(t *testing.T) {
	cases := []struct {
		name      string
		hw        Hardware
		in        Inputs
		players   int
		limitedBy string
		memLimit  int
	}{
		// 4 vCPU, 8 GB: CPU allows 160, memory (8192-1228-160)/2.5 = 2721.
		{"cpu", Hardware{UsableCPUs: 4, TotalMemoryMB: 8192}, Inputs{}, 160, "cpu", 8192 - 1228},
		// 2 vCPU, 512 MB: memory (512-256-160)/2.5 = 38.
		{"memory", Hardware{UsableCPUs: 2, TotalMemoryMB: 512}, Inputs{}, 38, "memory", 256},
		// A 10 Mbps uplink carries 10*0.85/0.25 = 34 racers.
		{"uplink", Hardware{UsableCPUs: 8, TotalMemoryMB: 16384}, Inputs{UplinkMbps: 10}, 34, "uplink", 16384 - 2048},
		// A container limit counts, not the host memory: (1024-256-160)/2.5.
		{"container", Hardware{UsableCPUs: 16, TotalMemoryMB: 65536, LimitMemoryMB: 1024}, Inputs{}, 243, "memory", 768},
		// Unknown memory: CPU alone, no memory limit.
		{"no memory", Hardware{UsableCPUs: 1}, Inputs{PlayersPerCore: 25}, 25, "cpu", 0},
		// Never below one room nor above the data service's limit.
		{"floor", Hardware{UsableCPUs: 1, TotalMemoryMB: 300}, Inputs{}, MinPlayers, "memory", 64},
		{"ceiling", Hardware{UsableCPUs: 512, TotalMemoryMB: 1 << 20}, Inputs{}, MaxPlayers, "cpu", (1 << 20) - 2048},
		{"reserve", Hardware{UsableCPUs: 4, TotalMemoryMB: 1024}, Inputs{ReserveMB: 600}, 105, "memory", 424},
	}
	for _, c := range cases {
		p := Suggest(c.hw, c.in)
		if p.MaxPlayers != c.players || p.LimitedBy != c.limitedBy || p.MemoryLimitMB != c.memLimit {
			t.Errorf("%s: %+v, want %d players limited by %s, memory limit %d", c.name, p, c.players, c.limitedBy, c.memLimit)
		}
	}
}

func TestDerivedLimits(t *testing.T) {
	for _, c := range []struct{ players, rooms, conns, lines int }{
		{8, 4, 28, 1},
		{160, 80, 180, 2},
		{400, 200, 440, 4},
		{10_000, 5000, 11_000, 32},
	} {
		p := Plan{MaxPlayers: c.players}
		p.Derive()
		if p.MaxRooms != c.rooms || p.MaxConnections != c.conns || p.CityLines != c.lines {
			t.Errorf("%d players: %+v", c.players, p)
		}
	}
}

func TestParsers(t *testing.T) {
	total, available := parseMeminfo(bufio.NewScanner(strings.NewReader(
		"MemTotal:        8024196 kB\nMemFree:          301000 kB\nMemAvailable:    5120000 kB\n")))
	if total != 8024196<<10 || available != 5120000<<10 {
		t.Fatalf("meminfo %d %d", total, available)
	}
	if parseCgroupLimit("max\n") != 0 || parseCgroupLimit("9223372036854771712\n") != 0 ||
		parseCgroupLimit("1073741824\n") != 1<<30 {
		t.Fatal("cgroup limits")
	}
	if cgroupV2Path("12:cpu:/x\n0::/system.slice/kart-node.service\n") != "/system.slice/kart-node.service" ||
		cgroupV2Path("4:memory:/docker/abc\n") != "" {
		t.Fatal("cgroup path")
	}
}

func TestDetectFindsTheMachine(t *testing.T) {
	h := Detect()
	if h.UsableCPUs < 1 || h.LogicalCPUs < h.UsableCPUs || h.OS == "" {
		t.Fatalf("%+v", h)
	}
	t.Log(h.Describe())
}
