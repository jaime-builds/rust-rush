package websocket

import (
	"encoding/json"
	"testing"

	"rust-rush/server/internal/game"
)

// newCheckClient wires a client to a fresh room with a buffered send channel,
// so handleMessage can be driven directly without a real socket.
func newCheckClient(t *testing.T, roomID string) (*Client, *game.GameStateWithShooting) {
	t.Helper()
	manager := game.NewManager()
	room, _ := manager.GetOrCreateShootingRoom(roomID)
	room.SetSpawnGoal(game.Position{X: 0, Y: 7}, game.Position{X: 19, Y: 7})
	hub := NewHub(manager)
	return &Client{hub: hub, id: "test-client", roomID: roomID, send: make(chan []byte, 4)}, room
}

// checkPlacement sends one check_placement and returns the queued reply.
func checkPlacement(t *testing.T, c *Client, roomID string, x, y float64) Message {
	t.Helper()
	c.handleMessage(&Message{
		Type:    MessageTypeCheckPlacement,
		RoomID:  roomID,
		Payload: map[string]interface{}{"x": x, "y": y},
	})
	select {
	case raw := <-c.send:
		var out Message
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatalf("unmarshal response: %v", err)
		}
		return out
	default:
		t.Fatalf("no response for check_placement(%v,%v)", x, y)
		return Message{}
	}
}

// check_placement answers the asking client only, echoes the queried cell so
// an out-of-order reply can be matched to it, and never mutates the room.
func TestCheckPlacementRoundTrip(t *testing.T) {
	c, room := newCheckClient(t, "check-room")

	// Open board: a lone tower cannot seal a 20x15 grid.
	resp := checkPlacement(t, c, "check-room", 5, 5)
	if resp.Type != MessageTypeCheckPlacement {
		t.Errorf("response type = %q, want %q", resp.Type, MessageTypeCheckPlacement)
	}
	if resp.Payload["x"] != 5.0 || resp.Payload["y"] != 5.0 {
		t.Errorf("response did not echo the queried cell: %v", resp.Payload)
	}
	if resp.Payload["blocks_path"] != false {
		t.Errorf("blocks_path = %v on an open board, want false", resp.Payload["blocks_path"])
	}
	if got := len(room.GetSnapshot().Towers); got != 0 {
		t.Errorf("check_placement placed %d towers; it must be read-only", got)
	}

	// The goal at (19,7) sits on the right edge, so exactly three cells
	// reach it: (18,7), (19,6), (19,8). Wall two of them (2 x $50, within
	// the $200 starting purse) and the third becomes the sealing cell.
	for _, cell := range [][2]float64{{18, 7}, {19, 6}} {
		if _, err := room.AddTower(cell[0], cell[1], "basic"); err != nil {
			t.Fatalf("wall placement at (%v,%v) rejected: %v", cell[0], cell[1], err)
		}
	}
	if room.FindPathFromSpawn() == nil {
		t.Fatal("two towers already sealed the goal; the setup is wrong")
	}

	resp = checkPlacement(t, c, "check-room", 19, 8)
	if resp.Payload["blocks_path"] != true {
		t.Errorf("blocks_path = %v on the sealing cell, want true", resp.Payload["blocks_path"])
	}
	if resp.Payload["x"] != 19.0 || resp.Payload["y"] != 8.0 {
		t.Errorf("response did not echo the queried cell: %v", resp.Payload)
	}
	if got := len(room.GetSnapshot().Towers); got != 2 {
		t.Errorf("board has %d towers after the previews, want 2", got)
	}

	// And AddTower - the actual gate - refuses that same cell.
	if _, err := room.AddTower(19, 8, "basic"); err == nil {
		t.Error("AddTower accepted the cell check_placement flagged as sealing")
	}
}

// A malformed payload or an unknown room is dropped rather than answered:
// the client must never receive a reply it could read as "safe".
func TestCheckPlacementIgnoresBadRequests(t *testing.T) {
	c, _ := newCheckClient(t, "check-room-2")

	cases := []struct {
		name    string
		roomID  string
		payload map[string]interface{}
	}{
		{"non-numeric x", "check-room-2", map[string]interface{}{"x": "five", "y": 5.0}},
		{"missing y", "check-room-2", map[string]interface{}{"x": 5.0}},
		{"unknown room", "no-such-room", map[string]interface{}{"x": 5.0, "y": 5.0}},
	}
	for _, tc := range cases {
		c.handleMessage(&Message{Type: MessageTypeCheckPlacement, RoomID: tc.roomID, Payload: tc.payload})
		select {
		case raw := <-c.send:
			t.Errorf("%s was answered: %s", tc.name, raw)
		default:
		}
	}
}
