package city

import (
	"encoding/binary"
	"encoding/json"
	"io"
	"log/slog"
	"math"
	"slices"
	"strconv"
	"sync"
	"testing"
	"time"

	"kartsim/internal/game/lobby"
	"kartsim/internal/shared/apierr"
)

// fakeClock is a manual node clock: timers fire only inside Advance, in
// due order (the lobby tests' clock).
type fakeClock struct {
	mu     sync.Mutex
	now    int64
	seq    int
	timers []fakeTimer
}

type fakeTimer struct {
	at  int64
	seq int
	f   func()
}

func (c *fakeClock) Now() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) AfterFunc(d time.Duration, f func()) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.seq++
	c.timers = append(c.timers, fakeTimer{at: c.now + d.Milliseconds(), seq: c.seq, f: f})
}

// Advance moves time forward by d, running every timer that falls due.
func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	target := c.now + d.Milliseconds()
	c.mu.Unlock()
	for {
		c.mu.Lock()
		next := -1
		for i, t := range c.timers {
			if t.at <= target && (next < 0 || t.at < c.timers[next].at ||
				(t.at == c.timers[next].at && t.seq < c.timers[next].seq)) {
				next = i
			}
		}
		if next < 0 {
			c.now = target
			c.mu.Unlock()
			return
		}
		timer := c.timers[next]
		c.timers = slices.Delete(c.timers, next, next+1)
		c.now = timer.at
		c.mu.Unlock()
		timer.f()
	}
}

// sink records what one connection receives.
type sink struct {
	mu     sync.Mutex
	texts  [][]byte
	frames [][]byte
	closed []string
}

func (s *sink) Text(payload []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.texts = append(s.texts, payload)
}

func (s *sink) Binary(frame []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.frames = append(s.frames, append([]byte(nil), frame...))
}

func (s *sink) Close(code int, reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = append(s.closed, strconv.Itoa(code)+" "+reason)
}

// events decodes the JSON messages received so far and forgets them.
func (s *sink) events(t *testing.T) []map[string]any {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	events := make([]map[string]any, len(s.texts))
	for i, text := range s.texts {
		if err := json.Unmarshal(text, &events[i]); err != nil {
			t.Fatalf("decode %s: %v", text, err)
		}
	}
	s.texts = nil
	return events
}

// ofType filters events by type.
func ofType(events []map[string]any, typ string) []map[string]any {
	var found []map[string]any
	for _, e := range events {
		if e["type"] == typ {
			found = append(found, e)
		}
	}
	return found
}

// takeFrames returns the binary frames received so far and forgets them.
func (s *sink) takeFrames() [][]byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	frames := s.frames
	s.frames = nil
	return frames
}

// takeMotion is takeFrames without the radar packets.
func (s *sink) takeMotion() [][]byte {
	var motion [][]byte
	for _, frame := range s.takeFrames() {
		if frame[0] == FrameMotion {
			motion = append(motion, frame)
		}
	}
	return motion
}

// profiles is a fake lobby: the identity of each client.
type profiles struct {
	mu sync.Mutex
	by map[*lobby.Client]lobby.Profile
}

func (p *profiles) Profile(c *lobby.Client) (lobby.Profile, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	profile, ok := p.by[c]
	return profile, ok
}

func (p *profiles) set(c *lobby.Client, profile lobby.Profile) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.by[c] = profile
}

// harness is a Service with a fake clock and fake lobby.
type harness struct {
	t     *testing.T
	svc   *Service
	clock *fakeClock
	lobby *profiles
	n     int
}

type peer struct {
	c    *lobby.Client
	sink *sink
	id   int
}

func newHarness(t *testing.T, opts Options) *harness {
	t.Helper()
	h := &harness{t: t, clock: &fakeClock{}, lobby: &profiles{by: map[*lobby.Client]lobby.Profile{}}}
	opts.Clock = h.clock
	opts.Profiles = h.lobby
	opts.Logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	if opts.Random == nil {
		opts.Random = func() float64 { return 0 }
	}
	svc, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	svc.Start()
	h.svc = svc
	return h
}

// player makes a hello'd client.
func (h *harness) player(name string) *peer {
	h.n++
	s := &sink{}
	c := lobby.NewClient(s)
	h.lobby.set(c, lobby.Profile{PlayerID: "player-" + strconv.Itoa(h.n), Name: name,
		Equipment: json.RawMessage(`{"itemIds":{"1":2}}`)})
	return &peer{c: c, sink: s}
}

func request(fields string) lobby.Request {
	req, err := lobby.ParseRequest([]byte(fields))
	if err != nil {
		panic(err)
	}
	return req
}

// call runs a command and returns its decoded reply or error.
func (h *harness) call(p *peer, fields string) (map[string]any, error) {
	h.t.Helper()
	reply, err := h.svc.Handle(p.c, request(fields))
	if err != nil {
		return nil, err
	}
	var body map[string]any
	if err := json.Unmarshal(reply.Encode(""), &body); err != nil {
		h.t.Fatal(err)
	}
	return body, nil
}

// must runs a command that must succeed.
func (h *harness) must(p *peer, fields string) map[string]any {
	h.t.Helper()
	body, err := h.call(p, fields)
	if err != nil {
		h.t.Fatalf("%s: %v", fields, err)
	}
	return body
}

// refused runs a command that must fail with code.
func (h *harness) refused(p *peer, fields, code string) {
	h.t.Helper()
	_, err := h.call(p, fields)
	rejected, ok := apierr.As(err)
	if !ok || rejected.Code != code {
		h.t.Fatalf("%s: got %v, want %s", fields, err, code)
	}
}

// join enters a line and records the member id.
func (h *harness) join(p *peer, fields string) map[string]any {
	h.t.Helper()
	snapshot := h.must(p, fields)
	you := snapshot["you"].(map[string]any)
	p.id = int(you["id"].(float64))
	return snapshot
}

// at places a member with a declared respawn pose.
func (h *harness) at(p *peer, x, y, z, heading float64) {
	h.t.Helper()
	h.must(p, `{"type":"city-respawn","pose":{"x":`+strconv.FormatFloat(x, 'f', -1, 64)+`,"y":`+
		strconv.FormatFloat(y, 'f', -1, 64)+`,"z":`+strconv.FormatFloat(z, 'f', -1, 64)+`,"heading":`+
		strconv.FormatFloat(heading, 'f', -1, 64)+`}}`)
}

// motionFrame is a city frame of kind 2 (an 80-byte kinematic payload)
// whose sender sits at world x/y/z facing heading.
func motionFrame(sequence uint32, x, y, z, heading float64) []byte {
	frame := make([]byte, headerLength+80)
	frame[0] = FrameMotion
	frame[kindOffset] = 2
	binary.LittleEndian.PutUint32(frame[sequenceOffset:], sequence)
	payload := frame[headerLength:]
	put := func(offset int, value float64) {
		binary.LittleEndian.PutUint32(payload[offset:], math.Float32bits(float32(value)))
	}
	// Wire space is (x, -z, y) of the browser's y-up world.
	put(kinematicPositionOffset, x)
	put(kinematicPositionOffset+4, -z)
	put(kinematicPositionOffset+8, y)
	// A rotation about the browser's y (up) axis: forward (2(wz - xy), ·,
	// 1 - 2(x² + z²)) = (sin h, ·, -cos h) for w = sin(h/2), z = cos(h/2).
	// The frames in these tests only need some quaternion with that
	// heading; headingOf is checked separately against known vectors.
	half := heading * math.Pi / 360
	put(kinematicQuaternionOffset, math.Sin(half))    // w
	put(kinematicQuaternionOffset+4, 0)               // x
	put(kinematicQuaternionOffset+8, 0)               // y
	put(kinematicQuaternionOffset+12, math.Cos(half)) // z
	return frame
}

func senderID(frame []byte) int { return int(binary.LittleEndian.Uint16(frame[idOffset:])) }
