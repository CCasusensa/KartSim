package city

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
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
	var raw rawMap
	if err := json.Unmarshal(embeddedMap, &raw); err != nil {
		t.Fatal(err)
	}
	if m.Name == "" || m.Name != raw.Meta.Name || len(m.Districts) != len(raw.Districts) {
		t.Fatalf("name %q, %d districts; source %q, %d districts", m.Name, len(m.Districts), raw.Meta.Name, len(raw.Districts))
	}
	// Compare every stored spawn field, keeping the main spawn first and all
	// remaining spawn POIs in file order. Non-spawn POIs must be omitted.
	var wantSpawns []Spawn
	for _, main := range []bool{true, false} {
		for _, poi := range raw.POIs {
			if poi.Kind == "spawn" && (poi.ID == "spawn-main") == main {
				wantSpawns = append(wantSpawns, Spawn{ID: poi.ID, X: poi.At[0], Y: poi.Y, Z: poi.At[1], Heading: poi.Heading})
			}
		}
	}
	if len(wantSpawns) < 2 || !reflect.DeepEqual(m.Spawns, wantSpawns) {
		t.Fatalf("spawns %+v, want %+v", m.Spawns, wantSpawns)
	}
	for _, want := range wantSpawns {
		if got, ok := m.Spawn(want.ID); !ok || got != want {
			t.Errorf("Spawn(%q) = %+v, %v; want %+v", want.ID, got, ok, want)
		}
		if want.Heading < 0 || want.Heading >= 360 {
			t.Errorf("spawn %s heading %v", want.ID, want.Heading)
		}
	}
	if _, ok := m.Spawn("__missing_spawn__"); ok {
		t.Fatal("unknown spawn exists")
	}
	if len(raw.Meta.Extent) != 2 || m.OffsetX != -raw.Meta.Extent[0][0] || m.OffsetZ != raw.Meta.Extent[1][1] {
		t.Fatalf("offsets %v %v, extent %v", m.OffsetX, m.OffsetZ, raw.Meta.Extent)
	}
	for i, want := range raw.Districts {
		got := m.Districts[i]
		if got.ID != want.ID || got.Name != want.Name || len(got.polygon) != len(want.Polygon) {
			t.Fatalf("district %d = %+v, want %+v", i, got, want)
		}
		for j, point := range want.Polygon {
			if got.polygon[j] != [2]float64{point[0], point[1]} {
				t.Errorf("district %s point %d = %v, want %v", want.ID, j, got.polygon[j], point)
			}
		}
		if len(want.Circle) == 3 && got.circle != [3]float64{want.Circle[0], want.Circle[1], want.Circle[2]} {
			t.Errorf("district %s circle %v, want %v", want.ID, got.circle, want.Circle)
		}
	}
	if !reflect.DeepEqual(m.Rules, raw.Rules) {
		t.Fatalf("rules %v, want %v", m.Rules, raw.Rules)
	}
}

func TestLoadRectangularMap(t *testing.T) {
	// Unequal, asymmetric bounds catch swapped axes and half-size offsets
	// even if the currently embedded map happens to be square or centered.
	m, err := Load([]byte(`{"meta":{"name":"Rectangular fixture","extent":[[-900,-1500],[700,2300]]},
		"districts":[{"id":"plaza","name":"Plaza","polygon":[[-400,-600],[400,-600],[400,0],[-400,0]]},
		{"id":"harbor","name":"Harbor","circle":[800,700,100]}],
		"pois":[{"id":"second","kind":"spawn","at":[100,200],"y":37.25,"heading":135},
		{"id":"shop","kind":"function","at":[0,0]},
		{"id":"spawn-main","kind":"spawn","at":[-200,-300],"y":9.5,"heading":270}],
		"rules":{"instancePlayers":60}}`))
	if err != nil {
		t.Fatal(err)
	}
	want := []Spawn{{ID: "spawn-main", X: -200, Y: 9.5, Z: -300, Heading: 270},
		{ID: "second", X: 100, Y: 37.25, Z: 200, Heading: 135}}
	if m.Name != "Rectangular fixture" || m.OffsetX != 900 || m.OffsetZ != 2300 || !reflect.DeepEqual(m.Spawns, want) {
		t.Fatalf("map %+v, spawns %+v", m, m.Spawns)
	}
	for _, tc := range []struct {
		x, z float64
		want string
	}{{-200, -300, "plaza"}, {800, 700, "harbor"}, {899, 700, "harbor"}, {901, 700, Outside}, {-500, -300, Outside}} {
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
	m, err := Load([]byte(`{"districts":[{"id":"a","circle":[0,0,5]}],"pois":[{"id":"s2","kind":"spawn","at":[1,2],"y":137.25,"heading":45},
		{"id":"spawn-main","kind":"spawn","at":[3,4]},{"id":"shop","kind":"function","at":[9,9]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Spawns) != 2 || m.Spawns[0].ID != "spawn-main" || m.Spawns[1].Heading != 45 || m.Spawns[1].Y != 137.25 ||
		m.OffsetX != 0 || m.OffsetZ != 0 {
		t.Fatalf("spawns %+v, offsets %v %v", m.Spawns, m.OffsetX, m.OffsetZ)
	}
	if _, err := Load([]byte(`{"meta":{"extent":[[0,0]]},"districts":[],"pois":[{"id":"s","kind":"spawn","at":[0,0]}]}`)); err == nil {
		t.Error("a one-point extent was accepted")
	}
}
