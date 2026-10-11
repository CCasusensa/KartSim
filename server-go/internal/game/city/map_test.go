package city

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The embedded map is a copy of design/open-world/city-map.json (CITY.md
// 5): copy it again instead of editing it by hand.
func TestEmbeddedMapMatchesDesign(t *testing.T) {
	source := filepath.Join("..", "..", "..", "..", "design", "open-world", "city-map.json")
	design, err := os.ReadFile(source)
	if err != nil {
		if os.IsNotExist(err) {
			t.Skipf("%s is not in this checkout", source)
		}
		t.Fatal(err)
	}
	if !bytes.Equal(design, embeddedMap) {
		t.Fatalf("internal/game/city/city-map.json differs from %s; copy the design file over it", source)
	}
}

func TestDefaultMap(t *testing.T) {
	m, err := Default()
	if err != nil {
		t.Fatal(err)
	}
	if m.Name != "卡丁城" || len(m.Districts) != 7 || len(m.Spawns) != 7 {
		t.Fatalf("name %q, %d districts, %d spawns", m.Name, len(m.Districts), len(m.Spawns))
	}
	// Rotation order: the main spawn first, then the district spawns the
	// city builder generated, as listed.
	var order []string
	for _, spawn := range m.Spawns {
		order = append(order, spawn.ID)
		if spawn.Heading < 0 || spawn.Heading >= 360 {
			t.Fatalf("spawn %s heading %v", spawn.ID, spawn.Heading)
		}
	}
	if strings.Join(order, ",") != "spawn-main,spawn-city,spawn-ice,spawn-beach,spawn-village,spawn-desert,spawn-forest" || m.Spawns[0].X != 75 || m.Spawns[0].Z != 129.9 {
		t.Fatalf("spawns %+v", m.Spawns)
	}
	// The map spans ±1200 m: the physics frame is shifted by that.
	if m.OffsetX != 1200 || m.OffsetZ != 1200 {
		t.Fatalf("offsets %v %v", m.OffsetX, m.OffsetZ)
	}
	if spawn, ok := m.Spawn("spawn-forest"); !ok || spawn.X != -206.9 || spawn.Z != -306.7 || spawn.Heading != 236 {
		t.Fatalf("spawn-forest %+v %v", spawn, ok)
	}
	if _, ok := m.Spawn("spawn-moon"); ok {
		t.Fatal("spawn-moon exists")
	}
	for _, tc := range []struct {
		x, z float64
		want string
	}{
		{0, 0, "plaza"},            // the fountain
		{0, 120, "plaza"},          // inside the plaza disc (r 125)
		{0, 150, "village"},        // the 城镇小屋 sector (south, 240°–300°)
		{0, -370, "city"},          // 摩天城区 (north)
		{320.4, -185, "ice"},       // 冰河乐园 (north-east)
		{320.4, 185, "beach"},      // 阳光海滩 (south-east)
		{-320.4, 185, "desert"},    // 金字塔沙漠 (south-west)
		{-320.4, -185, "forest"},   // 森林公园 (north-west)
		{0, 700, Outside},          // beyond the ring expressway
		{1150, -1150, Outside},     // a corner outside every district
		{-5000, 0, Outside},        // off the map
	} {
		if got := m.DistrictAt(tc.x, tc.z); got != tc.want {
			t.Errorf("DistrictAt(%v, %v) = %s, want %s", tc.x, tc.z, got, tc.want)
		}
	}
	if m.Rules["instancePlayers"] != 60.0 {
		t.Fatalf("rules %v", m.Rules)
	}
}

func TestPointInPolygon(t *testing.T) {
	square := [][2]float64{{0, 0}, {10, 0}, {10, 10}, {0, 10}}
	for _, tc := range []struct {
		x, z float64
		want bool
	}{
		{5, 5, true}, {0.5, 9.5, true}, {10.5, 5, false}, {5, -1, false}, {-1, 5, false}, {5, 11, false},
	} {
		if got := pointInPolygon(tc.x, tc.z, square); got != tc.want {
			t.Errorf("(%v, %v) in square = %v", tc.x, tc.z, got)
		}
	}
	// A concave L shape: the notch is outside.
	l := [][2]float64{{0, 0}, {10, 0}, {10, 4}, {4, 4}, {4, 10}, {0, 10}}
	if !pointInPolygon(2, 8, l) || pointInPolygon(8, 8, l) || !pointInPolygon(8, 2, l) {
		t.Error("concave polygon")
	}
}

func TestLoadRefusesBrokenMaps(t *testing.T) {
	for name, data := range map[string]string{
		"not json":         `{`,
		"no spawn":         `{"districts":[],"pois":[]}`,
		"bad district":     `{"districts":[{"id":"x","polygon":[[0,0],[1,1]]}],"pois":[{"id":"s","kind":"spawn","at":[0,0]}]}`,
		"bad spawn":        `{"districts":[],"pois":[{"id":"s","kind":"spawn","at":[0]}]}`,
		"unnamed district": `{"districts":[{"circle":[0,0,1]}],"pois":[{"id":"s","kind":"spawn","at":[0,0]}]}`,
	} {
		if _, err := Load([]byte(data)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	m, err := Load([]byte(`{"districts":[{"id":"a","circle":[0,0,5]}],"pois":[{"id":"s2","kind":"spawn","at":[1,2],"heading":45},
		{"id":"spawn-main","kind":"spawn","at":[3,4]},{"id":"shop","kind":"function","at":[9,9]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Spawns) != 2 || m.Spawns[0].ID != "spawn-main" || m.Spawns[1].Heading != 45 ||
		m.OffsetX != 0 || m.OffsetZ != 0 {
		t.Fatalf("spawns %+v, offsets %v %v", m.Spawns, m.OffsetX, m.OffsetZ)
	}
	if _, err := Load([]byte(`{"meta":{"extent":[[0,0]]},"districts":[],"pois":[{"id":"s","kind":"spawn","at":[0,0]}]}`)); err == nil {
		t.Error("a one-point extent was accepted")
	}
}
