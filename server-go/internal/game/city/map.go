package city

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"math"
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
	// Stations are the gas stations (FUEL.md 1) in file order.
	Stations []Station
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

// Station is a gas station (a "fuel" POI): a member refuels while it is
// stopped inside Zone (design x/z), and a towed or empty kart is put at Park.
type Station struct {
	ID, Name string
	X, Z     float64
	zone     [][2]float64
	Park     Spawn
}

// stationSlack is how far outside its zone polygon a kart still counts as
// at a station (m): the kart's pose is its centre, the zone is drawn
// around the pumps.
const stationSlack = 1.5

// Contains reports whether the design point x/z is at the station.
func (s *Station) Contains(x, z float64) bool {
	if pointInPolygon(x, z, s.zone) {
		return true
	}
	for i, j := 0, len(s.zone)-1; i < len(s.zone); j, i = i, i+1 {
		if segmentDistance(x, z, s.zone[j], s.zone[i]) <= stationSlack {
			return true
		}
	}
	return false
}

// segmentDistance is the distance from x/z to the segment a–b.
func segmentDistance(x, z float64, a, b [2]float64) float64 {
	dx, dz := b[0]-a[0], b[1]-a[1]
	t := 0.0
	if length := dx*dx + dz*dz; length > 0 {
		t = min(1, max(0, ((x-a[0])*dx+(z-a[1])*dz)/length))
	}
	px, pz := a[0]+t*dx-x, a[1]+t*dz-z
	return math.Sqrt(px*px + pz*pz)
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
		ID      string      `json:"id"`
		Name    string      `json:"name"`
		Kind    string      `json:"kind"`
		At      []float64   `json:"at"`
		Y       float64     `json:"y"`
		Heading float64     `json:"heading"`
		Zone    [][]float64 `json:"zone"`
		Park    *rawPose    `json:"park"`
	} `json:"pois"`
	Rules map[string]any `json:"rules"`
}

// rawPose is a gas station's park pose.
type rawPose struct {
	At      []float64 `json:"at"`
	Y       float64   `json:"y"`
	Heading float64   `json:"heading"`
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
		if poi.Kind == "fuel" {
			station, err := parseStation(poi.ID, poi.Name, poi.At, poi.Zone, poi.Park)
			if err != nil {
				return nil, err
			}
			m.Stations = append(m.Stations, station)
			continue
		}
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

func parseStation(id, name string, at []float64, zone [][]float64, park *rawPose) (Station, error) {
	if id == "" || len(at) != 2 || len(zone) < 3 || park == nil || len(park.At) != 2 {
		return Station{}, fmt.Errorf("city-map.json: gas station %q needs an id, at, a zone and a park pose", id)
	}
	station := Station{ID: id, Name: name, X: at[0], Z: at[1],
		Park: Spawn{ID: id, X: park.At[0], Y: park.Y, Z: park.At[1], Heading: normalizeHeading(park.Heading)}}
	for _, point := range zone {
		if len(point) != 2 {
			return Station{}, fmt.Errorf("city-map.json: gas station %s: a zone point is not [x, z]", id)
		}
		station.zone = append(station.zone, [2]float64{point[0], point[1]})
	}
	if !station.Contains(station.Park.X, station.Park.Z) {
		return Station{}, fmt.Errorf("city-map.json: gas station %s parks outside its zone", id)
	}
	return station, nil
}

// StationAt is the gas station at the design point x/z, nil when none.
func (m *Map) StationAt(x, z float64) *Station {
	for i := range m.Stations {
		if m.Stations[i].Contains(x, z) {
			return &m.Stations[i]
		}
	}
	return nil
}

// NearestStation is the gas station closest to x/z on the ground plane,
// nil on a map without any.
func (m *Map) NearestStation(x, z float64) *Station {
	var best *Station
	bestDistance := math.Inf(1)
	for i := range m.Stations {
		s := &m.Stations[i]
		if d := math.Hypot(s.X-x, s.Z-z); d < bestDistance {
			best, bestDistance = s, d
		}
	}
	return best
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
