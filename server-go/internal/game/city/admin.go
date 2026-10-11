package city

import (
	"errors"
	"slices"
	"time"
)

// The admin side (CITY.md 4): Go methods for the admin console's future
// city page. Each works on one line by number (1-based).

// LineStatus describes a line.
type LineStatus struct {
	Line       int     `json:"line"`
	InstanceID string  `json:"instanceId"`
	Name       string  `json:"name"`
	Members    int     `json:"members"`
	Capacity   int     `json:"capacity"`
	Closed     bool    `json:"closed"`
	TimeOfDay  float64 `json:"timeOfDay"`
	Weather    string  `json:"weather"`
}

// MemberStatus describes a member of a line.
type MemberStatus struct {
	ID         int    `json:"id"`
	PlayerID   string `json:"playerId"`
	Name       string `json:"name"`
	State      string `json:"state"`
	Pose       Pose   `json:"pose"`
	District   string `json:"district"`
	MutedUntil int64  `json:"mutedUntil,omitempty"`
}

var errNoSuchLine = errors.New("没有这条线路")

func (s *Service) instance(line int) (*instance, error) {
	if line < 1 || line > len(s.lines) {
		return nil, errNoSuchLine
	}
	return s.lines[line-1], nil
}

// Status lists the lines.
func (s *Service) Status() []LineStatus {
	now := s.clock.Now()
	status := make([]LineStatus, 0, len(s.lines))
	for _, inst := range s.lines {
		inst.mu.Lock()
		status = append(status, LineStatus{Line: inst.line, InstanceID: inst.id, Name: inst.name,
			Members: len(inst.members), Capacity: s.opts.LinePlayers, Closed: inst.closed,
			TimeOfDay: inst.clock.timeOfDay(now), Weather: inst.clock.weather})
		inst.mu.Unlock()
	}
	return status
}

// Members lists a line's members by id.
func (s *Service) Members(line int) ([]MemberStatus, error) {
	inst, err := s.instance(line)
	if err != nil {
		return nil, err
	}
	now := s.clock.Now()
	inst.mu.Lock()
	members := make([]MemberStatus, 0, len(inst.members))
	for _, m := range inst.members {
		members = append(members, MemberStatus{ID: int(m.id), PlayerID: m.playerID, Name: m.name, State: m.state,
			Pose: m.pose, District: s.cityMap.DistrictAt(m.pose.X, m.pose.Z)})
	}
	inst.mu.Unlock()
	for i := range members {
		members[i].MutedUntil = s.muted(members[i].PlayerID, now)
	}
	slices.SortFunc(members, func(a, b MemberStatus) int { return a.ID - b.ID })
	return members, nil
}

// Kick removes a player from a line with city-kicked ADMIN; false when it
// is not there.
func (s *Service) Kick(line int, playerID string) (bool, error) {
	inst, err := s.instance(line)
	if err != nil {
		return false, err
	}
	inst.mu.Lock()
	defer inst.mu.Unlock()
	for _, m := range inst.members {
		if m.playerID == playerID {
			inst.kickLocked(m, KickAdmin)
			return true, nil
		}
	}
	return false, nil
}

// Mute silences a player's city chat for d (0 lifts the mute); it holds
// across lines and rejoins while the node runs.
func (s *Service) Mute(playerID string, d time.Duration) {
	if d <= 0 {
		s.mute(playerID, 0)
		return
	}
	s.mute(playerID, s.clock.Now()+d.Milliseconds())
}

// SetWeather forces a line's weather (clear, rain or snow) for d (0: one
// segment); line 0 means every line. Members get city-clock at once.
func (s *Service) SetWeather(line int, weather string, d time.Duration) error {
	lines := s.lines
	if line != 0 {
		inst, err := s.instance(line)
		if err != nil {
			return err
		}
		lines = []*instance{inst}
	}
	now := s.clock.Now()
	for _, inst := range lines {
		inst.mu.Lock()
		err := inst.clock.force(now, weather, d.Milliseconds())
		if err == nil {
			inst.broadcastClockLocked(now)
		}
		inst.mu.Unlock()
		if err != nil {
			return err
		}
	}
	return nil
}

// SetTimeOfDay sets a line's clock (0 midnight, 0.5 noon); line 0 means
// every line. Members get city-clock at once.
func (s *Service) SetTimeOfDay(line int, timeOfDay float64) error {
	if timeOfDay < 0 || timeOfDay >= 1 {
		return errors.New("时刻必须在 [0, 1) 内")
	}
	lines := s.lines
	if line != 0 {
		inst, err := s.instance(line)
		if err != nil {
			return err
		}
		lines = []*instance{inst}
	}
	now := s.clock.Now()
	for _, inst := range lines {
		inst.mu.Lock()
		inst.clock.setTimeOfDay(now, timeOfDay)
		inst.broadcastClockLocked(now)
		inst.mu.Unlock()
	}
	return nil
}

// CloseLine kicks every member of a line (SHUTDOWN) and refuses joins
// until OpenLine.
func (s *Service) CloseLine(line int) error {
	inst, err := s.instance(line)
	if err != nil {
		return err
	}
	inst.mu.Lock()
	defer inst.mu.Unlock()
	inst.closed = true
	// In id order, so the ids are released (and reused) in that order.
	for _, m := range slices.SortedFunc(mapValues(inst.members), func(a, b *member) int { return int(a.id) - int(b.id) }) {
		inst.kickLocked(m, KickShutdown)
	}
	return nil
}

// OpenLine accepts joins again after CloseLine.
func (s *Service) OpenLine(line int) error {
	inst, err := s.instance(line)
	if err != nil {
		return err
	}
	inst.mu.Lock()
	defer inst.mu.Unlock()
	inst.closed = false
	return nil
}
