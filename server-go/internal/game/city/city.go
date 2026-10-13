// Package city is the game node's open-world zone 卡丁城 (CITY.md): a few
// persistent "line" instances that hello'd players enter with city-join
// and drive around in, with no countdown, finish, settlement or rewards.
// Each line has its own lock, uint16 member ids, a 100 m interest grid
// that fans motion frames out to nearby members, a day/night clock and a
// weather state machine. The room and race protocol is untouched: a
// connection is in the city or in a room, never both (lobby/city.go).
//
// Locking: a line's methods run under its own mutex only. The lobby is
// consulted (Profiles) before that lock is taken and never under it, and
// the lobby never calls into this package, so the two locks never nest.
// Delivery to connections (lobby.Client Text/Binary/Close) never blocks.
package city

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"math/rand/v2"
	"net/http"
	"slices"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"kartsim/internal/game/lobby"
	"kartsim/internal/shared/apierr"
)

// Options configure the Service (KART_CITY*, CITY.md 6). Zero values take
// the documented defaults, except the weather percentages (0 = never).
type Options struct {
	// Disabled answers every city-join CITY_DISABLED (KART_CITY=false).
	Disabled bool
	Lines    int // KART_CITY_LINES (2)
	// LinePlayers caps each line (KART_CITY_LINE_PLAYERS, 60).
	LinePlayers int
	// InterestRadius (m) bounds who receives a member's motion frames and
	// emotes (KART_CITY_INTEREST_RADIUS, 160); ChatRadius (m) the "near"
	// chat channel (KART_CITY_CHAT_RADIUS, 60).
	InterestRadius, ChatRadius float64
	// AFKTimeout marks a member without motion frames afk, and kicks it
	// after as long again (KART_CITY_AFK_MINUTES, 10 min).
	AFKTimeout time.Duration
	// MaxSpeed (m/s) is the plausibility limit between two frames
	// (KART_CITY_MAX_SPEED, 150).
	MaxSpeed float64
	// DayLength is one day of the city clock (KART_CITY_DAY_MINUTES, 48 min).
	DayLength time.Duration
	// WeatherOff keeps the weather clear (KART_CITY_WEATHER=false);
	// RainPercent and SnowPercent are the odds of a rain or snow segment
	// after a clear one (KART_CITY_RAIN_PERCENT 20, KART_CITY_SNOW_PERCENT 10).
	WeatherOff               bool
	RainPercent, SnowPercent int
	// Clock is the node clock (serverTick) and timer source; nil uses the
	// lobby's system clock.
	Clock lobby.Clock
	// Profiles is the lobby: who a connection is and whether it is in a
	// room. Required.
	Profiles Profiles
	// Map is the city map (nil: the embedded city-map.json).
	Map *Map
	// Random supplies the weather rolls, uniform in [0, 1) (nil: math/rand).
	Random func() float64
	Logger *slog.Logger
}

// Profiles is the lobby as the city sees it.
type Profiles interface {
	// Profile returns a connection's identity, false before hello. It is
	// called without any city lock held.
	Profile(c *lobby.Client) (lobby.Profile, bool)
	// CityEquipment checks the equipment of a city-equipment request like a
	// room's equipment command (valid, owned) and makes it the session's;
	// it returns it compacted. It is called without any city lock held.
	CityEquipment(ctx context.Context, c *lobby.Client, in lobby.Request) (json.RawMessage, error)
}

// Member states (city-state).
const (
	StateDriving = "driving"
	StateParked  = "parked"
	StateAFK     = "afk"
)

// Kick reasons (city-kicked). AFK is not in CITY.md's list; it is the
// reason of the kick the AFK rule ends with.
const (
	KickAdmin    = "ADMIN"
	KickCheat    = "CHEAT"
	KickShutdown = "SHUTDOWN"
	KickAFK      = "AFK"
)

// Close code and reason of the connection an AFK kick ends.
const (
	afkCloseCode   = 1000
	afkCloseReason = "city afk"
)

// Chat channels (city-chat).
const (
	ChannelNear     = "near"
	ChannelDistrict = "district"
	ChannelCity     = "city"
)

// Limits of the chat and emote commands (per member, node ms): chat 1/s
// burst 5 then muted 10 s like the My Room hub; emotes 2/s; respawns 2/s.
const (
	chatRate, chatBurst       = 1.0, 5
	chatMuteMs                = 10_000
	emoteRate, emoteBurst     = 2.0, 4
	respawnRate, respawnBurst = 2.0, 4
	maxChatRunes              = 60
	maxEmote                  = 16
	// Garage changes (city-equipment): one per two seconds, burst 3; the
	// lobby also bounds the data service checks they cause.
	equipRate, equipBurst = 0.5, 3
	// clockBroadcastMs is how often city-clock goes out unprompted.
	clockBroadcastMs = 30_000
	// maxCoordinate bounds a plausible pose coordinate (m).
	maxCoordinate = 100_000.0
)

// commands are the requests this package handles (ws routes them here).
var commands = map[string]bool{"city-join": true, "city-leave": true, "city-chat": true, "city-emote": true,
	"city-state": true, "city-respawn": true, "city-equipment": true}

// Handles reports whether a request type is a city command.
func Handles(typ string) bool { return commands[typ] }

// Service owns the node's lines.
type Service struct {
	opts     Options
	clock    lobby.Clock
	profiles Profiles
	cityMap  *Map
	log      *slog.Logger
	lines    []*instance
	closed   atomic.Bool

	// mutes are admin and flood mutes by player ID (node ms until), kept
	// at the service so leaving a line does not lift them; a leaf lock.
	muteMu sync.Mutex
	mutes  map[string]int64
}

// New builds the lines; nothing ticks until Start.
func New(opts Options) (*Service, error) {
	if opts.Profiles == nil {
		return nil, fmt.Errorf("city: Options.Profiles is required")
	}
	if opts.Lines <= 0 {
		opts.Lines = 2
	}
	if opts.LinePlayers <= 0 {
		opts.LinePlayers = 60
	}
	if opts.InterestRadius <= 0 {
		opts.InterestRadius = 160
	}
	if opts.ChatRadius <= 0 {
		opts.ChatRadius = 60
	}
	if opts.AFKTimeout <= 0 {
		opts.AFKTimeout = 10 * time.Minute
	}
	if opts.MaxSpeed <= 0 {
		opts.MaxSpeed = 150
	}
	if opts.DayLength <= 0 {
		opts.DayLength = 48 * time.Minute
	}
	if opts.Clock == nil {
		opts.Clock = lobby.SystemClock()
	}
	if opts.Random == nil {
		opts.Random = rand.Float64
	}
	if opts.Logger == nil {
		opts.Logger = slog.Default()
	}
	if opts.Map == nil {
		m, err := Default()
		if err != nil {
			return nil, err
		}
		opts.Map = m
	}
	s := &Service{opts: opts, clock: opts.Clock, profiles: opts.Profiles, cityMap: opts.Map, log: opts.Logger,
		mutes: map[string]int64{}}
	now := s.clock.Now()
	for line := 1; line <= opts.Lines; line++ {
		s.lines = append(s.lines, newInstance(s, line, now))
	}
	return s, nil
}

// Start arms each line's housekeeping timer (1 Hz).
func (s *Service) Start() {
	for _, inst := range s.lines {
		s.clock.AfterFunc(time.Second, inst.tick)
	}
}

// Close stops the housekeeping timers; it is called at shutdown after the
// connections are closed.
func (s *Service) Close() { s.closed.Store(true) }

// Lines reports how many lines the service runs.
func (s *Service) Lines() int { return len(s.lines) }

// Handle runs one city command for c (ws routes the types Handles
// accepts). Rejections are *apierr.Error.
func (s *Service) Handle(ctx context.Context, c *lobby.Client, in lobby.Request) (lobby.Reply, error) {
	typ := in.Type()
	profile, ok := s.profiles.Profile(c)
	if !ok {
		return lobby.Reply{}, fail(http.StatusBadRequest, "HELLO_REQUIRED")
	}
	if profile.Kicked {
		return lobby.Reply{}, fail(http.StatusForbidden, "CHEAT_DETECTED")
	}
	if typ == "city-join" {
		return s.join(c, profile, in)
	}
	inst := s.lineOf(c)
	if inst == nil {
		return lobby.Reply{}, errNotInCity()
	}
	if typ == "city-equipment" {
		return s.equip(ctx, c, inst, in)
	}
	return inst.handle(c, typ, in)
}

// equip is city-equipment: the member changed karts, character or
// accessories in the garage. The lobby checks the equipment without the
// line's lock; then everyone else on the line gets city-equipment and
// reloads the member's kart. The reply carries the same fields.
func (s *Service) equip(ctx context.Context, c *lobby.Client, inst *instance, in lobby.Request) (lobby.Reply, error) {
	if err := inst.allowEquip(c); err != nil {
		return lobby.Reply{}, err
	}
	equipment, err := s.profiles.CityEquipment(ctx, c, in)
	if err != nil {
		return lobby.Reply{}, err
	}
	return inst.applyEquipment(c, equipment)
}

// lineOf is the line c is in, nil outside the city.
func (s *Service) lineOf(c *lobby.Client) *instance {
	line := c.CityLine()
	if line < 1 || line > len(s.lines) {
		return nil
	}
	return s.lines[line-1]
}

// join is city-join: the requested line, or the most populated open line
// with room (players gather on one line until it fills; a social city is no
// fun when everyone is spread out). A member of another line switches lines.
func (s *Service) join(c *lobby.Client, profile lobby.Profile, in lobby.Request) (lobby.Reply, error) {
	if s.opts.Disabled {
		return lobby.Reply{}, fail(http.StatusServiceUnavailable, "CITY_DISABLED")
	}
	if profile.InRoom {
		return lobby.Reply{}, fail(http.StatusBadRequest, "IN_ROOM")
	}
	var candidates []*instance
	if in.HasNonNull("line") {
		line, err := in.Integer("line", 1, len(s.lines))
		if err != nil {
			return lobby.Reply{}, err
		}
		candidates = []*instance{s.lines[line-1]}
	} else {
		type load struct {
			inst  *instance
			count int
		}
		var loads []load
		for _, inst := range s.lines {
			if count, open := inst.occupancy(); open && count < s.opts.LinePlayers {
				loads = append(loads, load{inst, count})
			}
		}
		slices.SortStableFunc(loads, func(a, b load) int { return b.count - a.count })
		for _, l := range loads {
			candidates = append(candidates, l.inst)
		}
		if len(candidates) == 0 {
			return lobby.Reply{}, fail(http.StatusServiceUnavailable, "CITY_FULL")
		}
	}
	if current := s.lineOf(c); current != nil {
		if len(candidates) == 1 && candidates[0] == current {
			// Already there: answer with a fresh snapshot.
			return current.snapshotOf(c)
		}
		current.leave(c, "")
	}
	for _, inst := range candidates {
		reply, ok := inst.join(c, profile)
		if ok {
			return reply, nil
		}
	}
	if in.HasNonNull("line") {
		return lobby.Reply{}, fail(http.StatusServiceUnavailable, "CITY_LINE_FULL")
	}
	return lobby.Reply{}, fail(http.StatusServiceUnavailable, "CITY_FULL")
}

// RelayMotion handles a city motion frame (0xC1) from c: dropped unless c
// is in the city (ws calls it for every binary frame that starts with the
// city marker).
func (s *Service) RelayMotion(c *lobby.Client, frame []byte) {
	if inst := s.lineOf(c); inst != nil {
		inst.relay(c, frame)
	}
}

// Disconnect takes a closed connection out of its line (a disconnect is a
// city-leave).
func (s *Service) Disconnect(c *lobby.Client) {
	if inst := s.lineOf(c); inst != nil {
		inst.leave(c, "")
	}
}

// muted reports until when playerID is muted (0: not muted) at now.
func (s *Service) muted(playerID string, now int64) int64 {
	s.muteMu.Lock()
	defer s.muteMu.Unlock()
	until := s.mutes[playerID]
	if until != 0 && until <= now {
		delete(s.mutes, playerID)
		return 0
	}
	return until
}

func (s *Service) mute(playerID string, until int64) {
	s.muteMu.Lock()
	defer s.muteMu.Unlock()
	if until <= 0 {
		delete(s.mutes, playerID)
		return
	}
	s.mutes[playerID] = until
}

// Pose is a member's world position (x east, y up, z south, m) and heading
// (around y, 0 = north, clockwise, degrees).
type Pose struct {
	X, Y, Z float64
	Heading float64
}

func (p Pose) object() lobby.Object {
	return lobby.Object{lobby.F("x", p.X), lobby.F("y", p.Y), lobby.F("z", p.Z), lobby.F("heading", p.Heading)}
}

// horizontal is the distance between two poses on the ground plane.
func horizontal(a, b Pose) float64 { return math.Hypot(a.X-b.X, a.Z-b.Z) }

// member is one connection in a line.
type member struct {
	c         *lobby.Client
	id        uint16
	playerID  string
	name      string
	equipment json.RawMessage
	state     string
	pose      Pose
	// posed: a motion frame or respawn pose set the pose (the spawn point
	// before that); only posed members are in the radar packet.
	posed bool
	cell  cellKey
	// lastMotion is when the last frame was accepted (or the member joined,
	// changed state or respawned); afkSince when it was marked afk.
	lastMotion int64
	afkSince   int64
	// skipCheck: the next frame is not checked against the last pose (a
	// fresh join or a declared respawn).
	skipCheck bool
	// Plausibility violations in the current window (CITY.md 3.2).
	violations     int
	violationStart int64

	chat, emotes, respawns, equips limiter
}

func (m *member) object() lobby.Object {
	return lobby.Object{lobby.F("id", int(m.id)), lobby.F("playerId", m.playerID), lobby.F("name", m.name),
		lobby.F("equipment", m.equipment), lobby.F("state", m.state), lobby.F("pose", m.pose.object())}
}

// instance is one line.
type instance struct {
	svc  *Service
	line int
	id   string
	name string

	mu       sync.Mutex
	members  map[*lobby.Client]*member
	byID     map[uint16]*member
	nextID   uint16
	freeIDs  []uint16 // released ids, reused oldest first
	grid     grid
	spawnAt  int
	chatSeq  int
	clock    cityClock
	lastTick int64 // the last clock broadcast
	// closed: an admin closed the line; joins are refused.
	closed bool
}

func newInstance(s *Service, line int, now int64) *instance {
	return &instance{svc: s, line: line, id: "city-" + strconv.Itoa(line), name: "卡丁城 线路 " + strconv.Itoa(line),
		members: map[*lobby.Client]*member{}, byID: map[uint16]*member{}, grid: newGrid(),
		clock: newCityClock(now, s.opts.DayLength.Milliseconds(), !s.opts.WeatherOff, s.opts.RainPercent,
			s.opts.SnowPercent, s.opts.Random),
		lastTick: now}
}

// occupancy reports the member count and whether the line is open.
func (inst *instance) occupancy() (int, bool) {
	inst.mu.Lock()
	defer inst.mu.Unlock()
	return len(inst.members), !inst.closed
}

// allocateID hands out the oldest released id, else the next never-used
// one (1–65535).
func (inst *instance) allocateID() (uint16, bool) {
	if len(inst.freeIDs) > 0 {
		id := inst.freeIDs[0]
		inst.freeIDs = inst.freeIDs[1:]
		return id, true
	}
	if inst.nextID == math.MaxUint16 {
		return 0, false
	}
	inst.nextID++
	return inst.nextID, true
}

// join adds c to the line; false when it is full or closed.
func (inst *instance) join(c *lobby.Client, profile lobby.Profile) (lobby.Reply, bool) {
	inst.mu.Lock()
	defer inst.mu.Unlock()
	if inst.closed || len(inst.members) >= inst.svc.opts.LinePlayers {
		return lobby.Reply{}, false
	}
	if _, present := inst.members[c]; present {
		return lobby.Reply{}, false
	}
	id, ok := inst.allocateID()
	if !ok {
		return lobby.Reply{}, false
	}
	now := inst.svc.clock.Now()
	spawn := inst.svc.cityMap.Spawns[inst.spawnAt%len(inst.svc.cityMap.Spawns)]
	inst.spawnAt++
	m := &member{c: c, id: id, playerID: profile.PlayerID, name: profile.Name, equipment: profile.Equipment,
		state: StateDriving, pose: Pose{X: spawn.X, Y: spawn.Y, Z: spawn.Z, Heading: spawn.Heading},
		lastMotion: now, skipCheck: true,
		chat: newLimiter(chatRate, chatBurst), emotes: newLimiter(emoteRate, emoteBurst),
		respawns: newLimiter(respawnRate, respawnBurst), equips: newLimiter(equipRate, equipBurst)}
	m.cell = inst.grid.insert(m)
	inst.members[c] = m
	inst.byID[id] = m
	c.SetCityLine(inst.line)
	inst.broadcast(lobby.Encode(lobby.Object{lobby.F("type", "city-joined"), lobby.F("instanceId", inst.id),
		lobby.F("member", m.object())}), m)
	return inst.snapshotLocked(m, spawn), true
}

// snapshotOf is the snapshot a member that joins its own line again gets.
func (inst *instance) snapshotOf(c *lobby.Client) (lobby.Reply, error) {
	inst.mu.Lock()
	defer inst.mu.Unlock()
	m := inst.members[c]
	if m == nil {
		return lobby.Reply{}, errNotInCity()
	}
	spawn := Spawn{ID: "", X: m.pose.X, Y: m.pose.Y, Z: m.pose.Z, Heading: m.pose.Heading}
	return inst.snapshotLocked(m, spawn), nil
}

func (inst *instance) snapshotLocked(you *member, spawn Spawn) lobby.Reply {
	sorted := slices.SortedFunc(mapValues(inst.members), func(a, b *member) int { return int(a.id) - int(b.id) })
	members := make([]lobby.Object, 0, len(sorted))
	for _, m := range sorted {
		members = append(members, m.object())
	}
	return lobby.NewReply(lobby.Object{
		lobby.F("type", "city"),
		lobby.F("instanceId", inst.id),
		lobby.F("line", inst.line),
		lobby.F("name", inst.name),
		lobby.F("capacity", inst.svc.opts.LinePlayers),
		lobby.F("clock", inst.clock.snapshot(inst.svc.clock.Now())),
		lobby.F("you", lobby.Object{lobby.F("id", int(you.id)), lobby.F("spawn", lobby.Object{
			lobby.F("id", spawn.ID), lobby.F("x", spawn.X), lobby.F("y", spawn.Y), lobby.F("z", spawn.Z),
			lobby.F("heading", spawn.Heading)})}),
		lobby.F("members", members),
	})
}

// leave removes c from the line, with a city-kicked event first when
// reason is set; false when c was not a member.
func (inst *instance) leave(c *lobby.Client, reason string) bool {
	inst.mu.Lock()
	defer inst.mu.Unlock()
	m := inst.members[c]
	if m == nil {
		return false
	}
	inst.removeLocked(m, reason)
	return true
}

func (inst *instance) removeLocked(m *member, reason string) {
	if reason != "" {
		m.c.Text(lobby.Encode(lobby.Object{lobby.F("type", "city-kicked"), lobby.F("instanceId", inst.id),
			lobby.F("reason", reason)}))
	}
	inst.grid.remove(m)
	delete(inst.members, m.c)
	delete(inst.byID, m.id)
	inst.freeIDs = append(inst.freeIDs, m.id)
	m.c.SetCityLine(0)
	inst.broadcast(lobby.Encode(lobby.Object{lobby.F("type", "city-left"), lobby.F("instanceId", inst.id),
		lobby.F("id", int(m.id)), lobby.F("playerId", m.playerID)}), nil)
}

// broadcast sends payload to every member but except.
func (inst *instance) broadcast(payload []byte, except *member) {
	for _, m := range inst.members {
		if m != except {
			m.c.Text(payload)
		}
	}
}

// handle runs a command of a member.
func (inst *instance) handle(c *lobby.Client, typ string, in lobby.Request) (lobby.Reply, error) {
	inst.mu.Lock()
	defer inst.mu.Unlock()
	m := inst.members[c]
	if m == nil {
		return lobby.Reply{}, errNotInCity()
	}
	now := inst.svc.clock.Now()
	switch typ {
	case "city-leave":
		inst.removeLocked(m, "")
		return lobby.NewReply(lobby.Object{lobby.F("type", "city-left")}), nil
	case "city-chat":
		return inst.chat(m, in, now)
	case "city-emote":
		emote, err := in.Integer("emote", 1, maxEmote)
		if err != nil {
			return lobby.Reply{}, err
		}
		if !m.emotes.allow(now) {
			return lobby.Reply{}, errRateLimited()
		}
		inst.nearby(m, inst.svc.opts.InterestRadius, false, lobby.Encode(lobby.Object{lobby.F("type", "city-emote"),
			lobby.F("instanceId", inst.id), lobby.F("id", int(m.id)), lobby.F("emote", emote)}))
		return okReply(), nil
	case "city-state":
		state, err := in.Text("state", 1, 16)
		if err != nil {
			return lobby.Reply{}, err
		}
		if state != StateDriving && state != StateParked {
			return lobby.Reply{}, lobby.Invalid("state")
		}
		inst.setState(m, state, now)
		return okReply(), nil
	case "city-respawn":
		return inst.respawn(m, in, now)
	}
	return lobby.Reply{}, fail(http.StatusBadRequest, "UNSUPPORTED_COMMAND")
}

// allowEquip spends a member's garage token (NOT_IN_CITY outside the line).
func (inst *instance) allowEquip(c *lobby.Client) error {
	inst.mu.Lock()
	defer inst.mu.Unlock()
	m := inst.members[c]
	if m == nil {
		return errNotInCity()
	}
	if !m.equips.allow(inst.svc.clock.Now()) {
		return errRateLimited()
	}
	return nil
}

// applyEquipment stores a checked equipment and tells the rest of the line.
func (inst *instance) applyEquipment(c *lobby.Client, equipment json.RawMessage) (lobby.Reply, error) {
	inst.mu.Lock()
	defer inst.mu.Unlock()
	m := inst.members[c]
	if m == nil {
		// Left the line while the lobby was checking.
		return lobby.Reply{}, errNotInCity()
	}
	m.equipment = equipment
	fields := lobby.Object{lobby.F("type", "city-equipment"), lobby.F("instanceId", inst.id),
		lobby.F("id", int(m.id)), lobby.F("playerId", m.playerID), lobby.F("equipment", equipment)}
	inst.broadcast(lobby.Encode(fields), m)
	return lobby.NewReply(fields), nil
}

// setState changes a member's state and tells everyone (the member too,
// so a server-side afk shows on its own screen).
func (inst *instance) setState(m *member, state string, now int64) {
	m.state = state
	m.lastMotion = now
	if state == StateAFK {
		m.afkSince = now
	}
	inst.broadcast(lobby.Encode(lobby.Object{lobby.F("type", "city-state"), lobby.F("instanceId", inst.id),
		lobby.F("id", int(m.id)), lobby.F("state", state)}), nil)
}

func (inst *instance) chat(m *member, in lobby.Request, now int64) (lobby.Reply, error) {
	text, err := in.Text("text", 1, maxChatRunes)
	if err != nil {
		return lobby.Reply{}, err
	}
	if lobby.Blank(text) {
		return lobby.Reply{}, lobby.Invalid("text")
	}
	channel, err := in.Text("channel", 1, 16)
	if err != nil {
		return lobby.Reply{}, err
	}
	if channel != ChannelNear && channel != ChannelDistrict && channel != ChannelCity {
		return lobby.Reply{}, lobby.Invalid("channel")
	}
	if until := inst.svc.muted(m.playerID, now); until > 0 {
		return lobby.Reply{}, errMuted(until)
	}
	if !m.chat.allow(now) {
		until := now + chatMuteMs
		inst.svc.mute(m.playerID, until)
		return lobby.Reply{}, errMuted(until)
	}
	inst.chatSeq++
	payload := lobby.Encode(lobby.Object{lobby.F("type", "city-chat"), lobby.F("instanceId", inst.id),
		lobby.F("sequence", inst.chatSeq), lobby.F("id", int(m.id)), lobby.F("playerId", m.playerID),
		lobby.F("name", m.name), lobby.F("channel", channel), lobby.F("text", text)})
	// The sender gets the event too (it carries the sequence), so a client
	// renders every line, its own included, from one place.
	switch channel {
	case ChannelNear:
		inst.nearby(m, inst.svc.opts.ChatRadius, true, payload)
	case ChannelDistrict:
		district := inst.svc.cityMap.DistrictAt(m.pose.X, m.pose.Z)
		for _, other := range inst.members {
			if inst.svc.cityMap.DistrictAt(other.pose.X, other.pose.Z) == district {
				other.c.Text(payload)
			}
		}
	default:
		inst.broadcast(payload, nil)
	}
	return okReply(), nil
}

// nearby sends payload to the members within radius of m on the ground
// plane, m itself included when self is set.
func (inst *instance) nearby(m *member, radius float64, self bool, payload []byte) {
	for _, other := range inst.grid.within(m.pose, radius) {
		if other == m && !self {
			continue
		}
		other.c.Text(payload)
	}
}

func (inst *instance) respawn(m *member, in lobby.Request, now int64) (lobby.Reply, error) {
	var pose Pose
	switch {
	case in.HasNonNull("spawn"):
		id, err := in.Text("spawn", 1, 64)
		if err != nil {
			return lobby.Reply{}, err
		}
		spawn, ok := inst.svc.cityMap.Spawn(id)
		if !ok {
			return lobby.Reply{}, lobby.Invalid("spawn")
		}
		pose = Pose{X: spawn.X, Y: spawn.Y, Z: spawn.Z, Heading: spawn.Heading}
	case in.HasNonNull("pose"):
		fields, ok := in.Object("pose")
		if !ok {
			return lobby.Reply{}, lobby.Invalid("pose")
		}
		values := [4]float64{}
		for i, key := range []string{"x", "y", "z", "heading"} {
			value, ok := fields.Number(key)
			if !ok || math.IsNaN(value) || math.IsInf(value, 0) || math.Abs(value) > maxCoordinate {
				return lobby.Reply{}, lobby.Invalid("pose")
			}
			values[i] = value
		}
		pose = Pose{X: values[0], Y: values[1], Z: values[2], Heading: normalizeHeading(values[3])}
	default:
		return lobby.Reply{}, lobby.Invalid("spawn")
	}
	if !m.respawns.allow(now) {
		return lobby.Reply{}, errRateLimited()
	}
	// Those who were predicting the member near its old pose reset, and
	// those near the new pose see it appear.
	recipients := map[*member]struct{}{}
	for _, other := range inst.grid.within(m.pose, inst.svc.opts.InterestRadius) {
		recipients[other] = struct{}{}
	}
	inst.place(m, pose, now)
	m.skipCheck = true
	for _, other := range inst.grid.within(m.pose, inst.svc.opts.InterestRadius) {
		recipients[other] = struct{}{}
	}
	payload := lobby.Encode(lobby.Object{lobby.F("type", "city-respawn"), lobby.F("instanceId", inst.id),
		lobby.F("id", int(m.id)), lobby.F("pose", pose.object())})
	for other := range recipients {
		if other != m {
			other.c.Text(payload)
		}
	}
	return okReply(), nil
}

// place records a member's pose (and its grid cell).
func (inst *instance) place(m *member, pose Pose, now int64) {
	m.pose = pose
	m.posed = true
	m.lastMotion = now
	m.cell = inst.grid.move(m)
}

// kick takes m out with a city-kicked event; AFK kicks also close the
// connection.
func (inst *instance) kickLocked(m *member, reason string) {
	inst.svc.log.Info("city kick", "line", inst.line, "player", m.playerID, "name", m.name, "reason", reason)
	inst.removeLocked(m, reason)
	if reason == KickAFK {
		m.c.Close(afkCloseCode, afkCloseReason)
	}
}

// tick is the 1 Hz housekeeping: AFK, the weather machine and the clock
// broadcast, then the radar packet. It re-arms itself until Close.
func (inst *instance) tick() {
	if inst.svc.closed.Load() {
		return
	}
	inst.mu.Lock()
	now := inst.svc.clock.Now()
	afk := inst.svc.opts.AFKTimeout.Milliseconds()
	for _, m := range slices.Collect(mapValues(inst.members)) {
		switch {
		case m.state == StateParked:
		case m.state == StateAFK && now-m.afkSince >= afk:
			inst.kickLocked(m, KickAFK)
		case m.state == StateDriving && now-m.lastMotion >= afk:
			inst.setState(m, StateAFK, now)
		}
	}
	if inst.clock.advance(now) || now-inst.lastTick >= clockBroadcastMs {
		inst.broadcastClockLocked(now)
	}
	if len(inst.members) > 0 {
		packet := inst.radarPacket()
		for _, m := range inst.members {
			m.c.Binary(packet)
		}
	}
	inst.mu.Unlock()
	inst.svc.clock.AfterFunc(time.Second, inst.tick)
}

func (inst *instance) broadcastClockLocked(now int64) {
	inst.lastTick = now
	inst.broadcast(lobby.Encode(lobby.Object{lobby.F("type", "city-clock"), lobby.F("instanceId", inst.id),
		lobby.F("clock", inst.clock.snapshot(now))}), nil)
}

func mapValues[K comparable, V any](m map[K]V) func(yield func(V) bool) {
	return func(yield func(V) bool) {
		for _, v := range m {
			if !yield(v) {
				return
			}
		}
	}
}

func normalizeHeading(degrees float64) float64 {
	h := math.Mod(degrees, 360)
	if h < 0 {
		h += 360
	}
	return h
}

func okReply() lobby.Reply { return lobby.NewReply(lobby.Object{lobby.F("type", "ok")}) }

func fail(status int, code string) error { return apierr.New(status, code) }

func errNotInCity() error { return fail(http.StatusBadRequest, "NOT_IN_CITY") }

func errRateLimited() error { return fail(http.StatusTooManyRequests, "RATE_LIMITED") }

// errMuted is CHAT_MUTED with the node tick the mute ends at.
func errMuted(until int64) error {
	return apierr.New(http.StatusTooManyRequests, "CHAT_MUTED").With(map[string]any{"mutedUntil": until})
}

// limiter is a token bucket on the node clock (ms): rate tokens per second,
// at most burst (the ws and My Room limiters on time.Time).
type limiter struct {
	rate   float64
	burst  float64
	tokens float64
	last   int64
	primed bool
}

func newLimiter(rate float64, burst int) limiter {
	return limiter{rate: rate, burst: float64(burst), tokens: float64(burst)}
}

func (b *limiter) allow(now int64) bool {
	if b.primed {
		b.tokens = min(b.burst, b.tokens+float64(now-b.last)/1000*b.rate)
	}
	b.primed = true
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
