package city

import (
	"fmt"
	"testing"
)

func TestChatRadiusBoundaryAndLineIsolation(t *testing.T) {
	for _, tc := range []struct {
		name   string
		option float64
		radius float64
	}{
		{name: "default-60m", radius: 60},
		{name: "configured-25m", option: 25, radius: 25},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Keep the motion radius smaller than chat to prove that chat uses
			// its own range. Negative coordinates cross a spatial-grid boundary.
			h := newHarness(t, Options{Lines: 2, ChatRadius: tc.option, InterestRadius: 10})
			t.Cleanup(h.svc.Close)
			type recipient struct {
				name string
				line int
				pose Pose
				near bool
				peer *peer
			}
			recipients := []recipient{
				{name: "Sender", line: 1, pose: Pose{X: -1, Y: 7, Z: -1}, near: true},
				{name: "Inside", line: 1, pose: Pose{X: tc.radius - 1.001, Y: 7, Z: -1}, near: true},
				{name: "ExactEast", line: 1, pose: Pose{X: tc.radius - 1, Y: 7, Z: -1}, near: true},
				{name: "ExactNorth", line: 1, pose: Pose{X: -1, Y: 7, Z: -1 - tc.radius}, near: true},
				{name: "ExactDiagonal", line: 1, pose: Pose{X: -1 + tc.radius*.6, Y: 7, Z: -1 + tc.radius*.8}, near: true},
				{name: "Outside", line: 1, pose: Pose{X: tc.radius - .999, Y: 7, Z: -1}},
				{name: "Above", line: 1, pose: Pose{X: -1, Y: 107, Z: -1}, near: true},
				{name: "Far", line: 1, pose: Pose{X: 1999, Y: 7, Z: -1}},
				{name: "OtherLine", line: 2, pose: Pose{X: -1, Y: 7, Z: -1}},
			}
			for i := range recipients {
				r := &recipients[i]
				r.peer = h.player(r.name)
				h.join(r.peer, fmt.Sprintf(`{"type":"city-join","line":%d}`, r.line))
				h.at(r.peer, r.pose.X, r.pose.Y, r.pose.Z, 0)
			}
			for _, r := range recipients {
				r.peer.sink.events(t)
			}

			sender := recipients[0].peer
			for sequence, channel := range []string{ChannelNear, ChannelCity} {
				h.must(sender, fmt.Sprintf(`{"type":"city-chat","text":"hello %s","channel":%q}`, channel, channel))
				for _, r := range recipients {
					events := ofType(r.peer.sink.events(t), "city-chat")
					want := r.line == 1 && (channel == ChannelCity || r.near)
					if !want {
						if len(events) != 0 {
							t.Fatalf("%s received %s outside its audience: %v", r.name, channel, events)
						}
						continue
					}
					if len(events) != 1 || events[0]["channel"] != channel ||
						events[0]["instanceId"] != "city-1" || events[0]["sequence"] != float64(sequence+1) ||
						events[0]["id"] != float64(sender.id) || events[0]["text"] != "hello "+channel {
						t.Fatalf("%s received %s: %v", r.name, channel, events)
					}
				}
			}

			// Switching lines removes the old subscription even when the next
			// near message is at the same coordinates as the receiver.
			otherLine := recipients[len(recipients)-1].peer
			h.join(otherLine, `{"type":"city-join","line":1}`)
			h.at(otherLine, -1, 7, -1, 0)
			for _, r := range recipients {
				r.peer.sink.events(t)
			}
			h.must(sender, `{"type":"city-chat","text":"after switch","channel":"near"}`)
			if events := ofType(otherLine.sink.events(t), "city-chat"); len(events) != 1 {
				t.Fatalf("new line missed chat after switch: %v", events)
			}
			h.join(otherLine, `{"type":"city-join","line":2}`)
			otherLine.sink.events(t)
			h.must(sender, `{"type":"city-chat","text":"old line","channel":"city"}`)
			if events := ofType(otherLine.sink.events(t), "city-chat"); len(events) != 0 {
				t.Fatalf("old line still sent chat after switch: %v", events)
			}
		})
	}
}

func TestChatRejectsInvalidChannelsWithoutBroadcastOrRateConsumption(t *testing.T) {
	h := newHarness(t, Options{Lines: 1})
	t.Cleanup(h.svc.Close)
	alice, bob := h.player("Alice"), h.player("Bob")
	for _, p := range []*peer{alice, bob} {
		h.join(p, `{"type":"city-join"}`)
		h.at(p, 0, 0, 0, 0)
	}
	for _, p := range []*peer{alice, bob} {
		p.sink.events(t)
	}
	for _, field := range []string{
		``, `,"channel":null`, `,"channel":false`, `,"channel":1`,
		`,"channel":[]`, `,"channel":{}`, `,"channel":""`,
		`,"channel":"all"`, `,"channel":"CITY"`, `,"channel":"near "`,
		`,"channel":"city\n"`,
	} {
		h.refused(alice, `{"type":"city-chat","text":"invalid"`+field+`}`, "INVALID_CHANNEL")
	}
	for _, p := range []*peer{alice, bob} {
		if events := ofType(p.sink.events(t), "city-chat"); len(events) != 0 {
			t.Fatalf("invalid channel was broadcast: %v", events)
		}
	}

	// Rejected commands neither consume the five-message burst nor assign a
	// sequence. Switching between the two public channels cannot bypass it.
	for i := 0; i < 5; i++ {
		channel := ChannelCity
		if i%2 == 1 {
			channel = ChannelNear
		}
		h.must(alice, fmt.Sprintf(`{"type":"city-chat","text":"valid","channel":%q}`, channel))
	}
	h.refused(alice, `{"type":"city-chat","text":"sixth","channel":"near"}`, "CHAT_MUTED")
	for _, p := range []*peer{alice, bob} {
		events := ofType(p.sink.events(t), "city-chat")
		if len(events) != 5 {
			t.Fatalf("valid chat count %d, want 5: %v", len(events), events)
		}
		for i, event := range events {
			if event["sequence"] != float64(i+1) || event["text"] != "valid" {
				t.Fatalf("invalid command changed sequence or broadcast: %v", event)
			}
		}
	}
}
