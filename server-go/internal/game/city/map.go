package city

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
)

// The city map (CITY.md 5): design/open-world/city-map.json copied into
// this package. The node needs its districts (the district chat channel)
// and its spawn points; the roads, water and buildings are the browser's
// business. TestEmbeddedMapMatchesDesign fails when the copy is stale.
//
//go:embed city-map.json
var embeddedMap []byte

// Outside is the district of a member that is in no district polygon.
const Outside = "outside"

// Map is the part of city-map.json the node uses.
type Map struct {
	Name      string
	Districts []District
	// Spawns are the spawn points in rotation order: the main one first,
	// then the others in file order.
	Spawns []Spawn
	// Rules are the map's gameplay numbers (for the admin page).
	Rules map[string]any
	// OffsetX and OffsetZ relate the design coordinates of the map (x east,
	// z south, y up, origin at the fountain; every JSON field, the radar
	// packet and the district polygons) to the physics frame the motion
	// payloads carry: the city track is built shifted into positive
	// coordinates, client x = design x + OffsetX and client y = OffsetZ -
	// design z (PLAN.md 3.1), with OffsetX = -extent[0][0] and OffsetZ =
	// extent[1][1] from meta.extent (0 without one).
	OffsetX, OffsetZ float64
}

// District is a named area: a polygon or a circle in world x/z meters.
type District struct {
	ID      string
	Name    string
	polygon [][2]float64
	circle  [3]float64 // x, z, radius; radius 0 when a polygon
}

// Spawn is a spawn point: a world position and heading (0 = north,
// clockwise, degrees).
type Spawn struct {
	ID      string
	X, Y, Z float64
	Heading float64
}

// mainSpawn is the spawn point new members get first.
const mainSpawn = "spawn-main"

type rawMap struct {
	Meta struct {
		Name   string      `json:"name"`
		Extent [][]float64 `json:"extent"`
	} `json:"meta"`
	Districts []struct {
		ID      string      `json:"id"`
		Name    string      `json:"name"`
		Polygon [][]float64 `json:"polygon"`
		Circle  []float64   `json:"circle"`
	} `json:"districts"`
	POIs []struct {
		ID      string    `json:"id"`
		Kind    string    `json:"kind"`
		At      []float64 `json:"at"`
		Y       float64   `json:"y"`
		Heading float64   `json:"heading"`
	} `json:"pois"`
	Rules map[string]any `json:"rules"`
}

// Default parses the embedded map.
func Default() (*Map, error) { return Load(embeddedMap) }

// Load parses a city-map.json.
func Load(data []byte) (*Map, error) {
	var raw rawMap
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("city-map.json: %w", err)
	}
	m := &Map{Name: raw.Meta.Name, Rules: raw.Rules}
	if extent := raw.Meta.Extent; len(extent) > 0 {
		if len(extent) != 2 || len(extent[0]) != 2 || len(extent[1]) != 2 {
			return nil, errors.New("city-map.json: meta.extent must be [[minX, minZ], [maxX, maxZ]]")
		}
		m.OffsetX, m.OffsetZ = -extent[0][0], extent[1][1]
	}
	for _, d := range raw.Districts {
		if d.ID == "" {
			return nil, errors.New("city-map.json: a district has no id")
		}
		district := District{ID: d.ID, Name: d.Name}
		switch {
		case len(d.Polygon) >= 3:
			for _, point := range d.Polygon {
				if len(point) != 2 {
					return nil, fmt.Errorf("city-map.json: district %s: a polygon point is not [x, z]", d.ID)
				}
				district.polygon = append(district.polygon, [2]float64{point[0], point[1]})
			}
		case len(d.Circle) == 3 && d.Circle[2] > 0:
			copy(district.circle[:], d.Circle)
		default:
			return nil, fmt.Errorf("city-map.json: district %s has neither a polygon nor a circle", d.ID)
		}
		m.Districts = append(m.Districts, district)
	}
	for _, poi := range raw.POIs {
		if poi.Kind != "spawn" {
			continue
		}
		if poi.ID == "" || len(poi.At) != 2 {
			return nil, fmt.Errorf("city-map.json: spawn %q needs an id and at: [x, z]", poi.ID)
		}
		m.Spawns = append(m.Spawns, Spawn{ID: poi.ID, X: poi.At[0], Y: poi.Y, Z: poi.At[1], Heading: poi.Heading})
	}
	if len(m.Spawns) == 0 {
		return nil, errors.New("city-map.json: no spawn point")
	}
	if i := slices.IndexFunc(m.Spawns, func(s Spawn) bool { return s.ID == mainSpawn }); i > 0 {
		main := m.Spawns[i]
		m.Spawns = slices.Insert(slices.Delete(m.Spawns, i, i+1), 0, main)
	}
	return m, nil
}

// Spawn finds a spawn point by id.
func (m *Map) Spawn(id string) (Spawn, bool) {
	for _, s := range m.Spawns {
		if s.ID == id {
			return s, true
		}
	}
	return Spawn{}, false
}

// DistrictAt is the district containing the world point x/z (the first in
// file order when they overlap), or Outside.
func (m *Map) DistrictAt(x, z float64) string {
	for _, d := range m.Districts {
		if d.contains(x, z) {
			return d.ID
		}
	}
	return Outside
}

func (d *District) contains(x, z float64) bool {
	if d.circle[2] > 0 {
		dx, dz := x-d.circle[0], z-d.circle[1]
		return dx*dx+dz*dz <= d.circle[2]*d.circle[2]
	}
	return pointInPolygon(x, z, d.polygon)
}

// pointInPolygon is the even-odd rule (a ray cast along +x), which also
// takes points on a vertical edge as inside.
func pointInPolygon(x, z float64, polygon [][2]float64) bool {
	inside := false
	for i, j := 0, len(polygon)-1; i < len(polygon); j, i = i, i+1 {
		xi, zi := polygon[i][0], polygon[i][1]
		xj, zj := polygon[j][0], polygon[j][1]
		if (zi > z) != (zj > z) {
			if x <= (xj-xi)*(z-zi)/(zj-zi)+xi {
				inside = !inside
			}
		}
	}
	return inside
}
