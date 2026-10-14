package lobby

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"kartsim/internal/shared/contract"
)

// The city zone (internal/game/city, CITY.md) runs beside the lobby: a
// connection is in the city or in a room, never both. This file is the
// lobby's side of that contract. The city service keeps its own locks and
// never calls the lobby while holding one, and the lobby never calls the
// city; the two meet only through the atomic line number on the Client and
// the lock-free delivery methods below.

// CityLine reports the city line the connection is in, 0 outside the city.
func (c *Client) CityLine() int { return int(c.city.Load()) }

// SetCityLine records that the connection joined line (or left the city with
// 0). Only the city service calls it, on the connection's own goroutine or
// from the city's housekeeping; the lobby refuses create and join while it
// is set (IN_CITY) and reports "city:<line>" as the player's room in the
// heartbeat.
func (c *Client) SetCityLine(line int) { c.city.Store(int32(line)) }

// cityRoom is the heartbeat's room field of a city member.
func cityRoom(line int) string { return contract.CityRoomPrefix + strconv.Itoa(line) }

// errInCity answers create and join while the connection is in the city
// (CITY.md 1): it must city-leave first.
func errInCity() error { return fail(http.StatusBadRequest, "IN_CITY") }

// Text delivers a JSON message to the connection (the city service's
// events and replies pushed outside a command). It never blocks.
func (c *Client) Text(payload []byte) { c.sink.Text(payload) }

// Binary delivers a motion frame to the connection. It never blocks.
func (c *Client) Binary(frame []byte) { c.sink.Binary(frame) }

// Close asks the connection to close with a WebSocket code and reason once
// the messages queued before it are written (Closer). It reports false
// when the connection cannot be closed this way (a test sink).
func (c *Client) Close(code int, reason string) bool {
	closer, ok := c.sink.(Closer)
	if !ok {
		return false
	}
	closer.Close(code, reason)
	return true
}

// Profile is what the city zone needs to know about a hello'd connection.
type Profile struct {
	PlayerID  string
	Name      string
	AccountID string
	// Equipment is the equipment checked at hello (or the last one the
	// player brought to a room), compacted JSON; nil when none was given.
	Equipment json.RawMessage
	// InRoom: the connection is in a room, so it cannot enter the city.
	InRoom bool
	// Kicked: the anti-cheat kicked the session; its connection is closing.
	Kicked bool
}

// Profile returns c's profile under the lobby lock; ok is false before
// hello. The city service calls it before taking its own lock.
func (l *Lobby) Profile(c *Client) (Profile, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if c.playerID == "" {
		return Profile{}, false
	}
	return Profile{PlayerID: c.playerID, Name: c.name, AccountID: c.accountID,
		Equipment: append(json.RawMessage(nil), c.equipment...), InRoom: c.roomID != "", Kicked: c.kicked}, true
}

// CityEquipment is the lobby's half of city-equipment (CITY.md 2): a city
// member changed karts, character or accessories in the garage. The
// equipment must be valid and owned, exactly as a room's equipment
// command; it then becomes the session's equipment (a room the player
// creates or joins later starts from it) and is returned compacted. The
// city service calls it without holding a line lock.
func (l *Lobby) CityEquipment(ctx context.Context, c *Client, in Request) (json.RawMessage, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	var applied json.RawMessage
	_, err := l.runVerified(ctx, c, func(check *ownershipCheck) (obj, error) {
		switch {
		case c.playerID == "":
			return nil, fail(http.StatusBadRequest, "HELLO_REQUIRED")
		case c.kicked:
			return nil, errCheatDetected()
		case c.roomID != "":
			return nil, fail(http.StatusBadRequest, "IN_ROOM")
		}
		raw, present := in.get("equipment")
		if !validEquipment(raw, present) {
			return nil, fail(http.StatusBadRequest, "INVALID_EQUIPMENT")
		}
		equipment := compactJSON(raw)
		if err := l.owns(check, c, c.accountID, equipment); err != nil {
			return nil, err
		}
		c.equipment = equipment
		applied = equipment
		return nil, nil
	})
	if err != nil {
		return nil, err
	}
	return append(json.RawMessage(nil), applied...), nil
}
