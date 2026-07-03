package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"rust-rush/server/internal/game"
	rrws "rust-rush/server/internal/websocket"

	"github.com/gorilla/websocket"
)

type e2eState struct {
	Towers []struct {
		ID    int     `json:"id"`
		Level int     `json:"level"`
		Range float64 `json:"range"`
	} `json:"towers"`
	Enemies          []json.RawMessage `json:"enemies"`
	Gold             int               `json:"gold"`
	Health           int               `json:"health"`
	Score            int               `json:"score"`
	Wave             int               `json:"wave"`
	Phase            string            `json:"phase"`
	EnemiesRemaining int               `json:"enemies_remaining"`
	FastForward      bool              `json:"fast_forward"`
	WavePreview      []struct {
		EnemyType string `json:"enemy_type"`
		Count     int    `json:"count"`
	} `json:"wave_preview"`
}

type e2eMsg struct {
	Type    string `json:"type"`
	Payload struct {
		Status string    `json:"status"`
		Refund int       `json:"refund"`
		State  *e2eState `json:"state"`
	} `json:"payload"`
	raw []byte
}

// waitFor reads messages until pred returns true or the deadline passes.
func waitFor(t *testing.T, conn *websocket.Conn, what string, timeout time.Duration, pred func(m e2eMsg) bool) e2eMsg {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		conn.SetReadDeadline(deadline)
		_, raw, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("waiting for %s: %v", what, err)
		}
		var m e2eMsg
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatalf("bad message while waiting for %s: %v", what, err)
		}
		m.raw = raw
		if pred(m) {
			return m
		}
	}
}

func send(t *testing.T, conn *websocket.Conn, v map[string]interface{}) {
	t.Helper()
	if err := conn.WriteJSON(v); err != nil {
		t.Fatalf("send %v: %v", v["type"], err)
	}
}

// TestEndToEndGameFlow boots the real server stack (manager + hub + ServeWs)
// and plays a short game over an actual WebSocket connection.
func TestEndToEndGameFlow(t *testing.T) {
	if testing.Short() {
		t.Skip("e2e test skipped in -short mode")
	}

	gameManager := game.NewManager()
	hub := rrws.NewHub(gameManager)
	go hub.Run()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rrws.ServeWs(hub, w, r)
	}))
	defer srv.Close()

	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	const room = "e2e"

	// Join: ack carries the initial snapshot.
	send(t, conn, map[string]interface{}{"type": "join_room", "room_id": room})
	join := waitFor(t, conn, "join ack", 5*time.Second, func(m e2eMsg) bool { return m.Type == "join_room" })
	if s := join.Payload.State; s == nil || s.Gold != 200 || s.Health != 100 || s.Phase != "waiting" || s.Wave != 1 {
		t.Fatalf("unexpected join state: %+v", join.Payload.State)
	}
	if len(join.Payload.State.WavePreview) == 0 {
		t.Error("join snapshot missing wave_preview")
	}

	// Place a basic ($50) and a sniper ($100) on open cells: gold 200 → 50.
	send(t, conn, map[string]interface{}{"type": "place_tower", "room_id": room,
		"payload": map[string]interface{}{"x": 10.0, "y": 7.0, "tower_type": "basic"}})
	send(t, conn, map[string]interface{}{"type": "place_tower", "room_id": room,
		"payload": map[string]interface{}{"x": 10.0, "y": 6.0, "tower_type": "sniper"}})
	waitFor(t, conn, "2 towers, gold 50", 5*time.Second, func(m e2eMsg) bool {
		s := m.Payload.State
		return m.Type == "game_state" && s != nil && len(s.Towers) == 2 && s.Gold == 50
	})

	// Third sniper is unaffordable: expect the insufficient_funds ack.
	send(t, conn, map[string]interface{}{"type": "place_tower", "room_id": room,
		"payload": map[string]interface{}{"x": 8.0, "y": 8.0, "tower_type": "sniper"}})
	waitFor(t, conn, "insufficient_funds ack", 5*time.Second, func(m e2eMsg) bool {
		return m.Type == "place_tower" && m.Payload.Status == "insufficient_funds"
	})

	// Building on the goal portal is rejected with invalid_placement.
	send(t, conn, map[string]interface{}{"type": "place_tower", "room_id": room,
		"payload": map[string]interface{}{"x": 19.0, "y": 7.0, "tower_type": "basic"}})
	waitFor(t, conn, "invalid_placement ack", 5*time.Second, func(m e2eMsg) bool {
		return m.Type == "place_tower" && m.Payload.Status == "invalid_placement"
	})

	// Fast forward on (3x) so the wave finishes quickly.
	send(t, conn, map[string]interface{}{"type": "set_speed", "room_id": room,
		"payload": map[string]interface{}{"fast_forward": true}})
	waitFor(t, conn, "fast_forward on", 5*time.Second, func(m e2eMsg) bool {
		return m.Type == "game_state" && m.Payload.State != nil && m.Payload.State.FastForward
	})

	// Start wave 1 (5 basic enemies). While enemies are alive, their JSON
	// must not carry the server-internal path waypoints.
	send(t, conn, map[string]interface{}{"type": "start_wave", "room_id": room})
	during := waitFor(t, conn, "active wave with enemies", 15*time.Second, func(m e2eMsg) bool {
		s := m.Payload.State
		return m.Type == "game_state" && s != nil && s.Phase == "active" && len(s.Enemies) > 0
	})
	if bytes.Contains(during.raw, []byte(`"path"`)) {
		t.Error("enemy JSON still contains the internal path field")
	}

	// Wave completes: back to waiting, wave 2, completion bonus scored.
	afterWave := waitFor(t, conn, "wave completion", 60*time.Second, func(m e2eMsg) bool {
		s := m.Payload.State
		return m.Type == "game_state" && s != nil && s.Phase == "waiting" && s.Wave == 2
	})
	if afterWave.Payload.State.Score < 50 {
		t.Errorf("score = %d after wave 1, want ≥ 50 (completion bonus)", afterWave.Payload.State.Score)
	}
	goldAfterWave := afterWave.Payload.State.Gold
	if goldAfterWave < 50 {
		t.Errorf("gold = %d after wave, want ≥ 50", goldAfterWave)
	}

	// Upgrade the basic tower (id 1, $50): level 2, range grows.
	send(t, conn, map[string]interface{}{"type": "upgrade_tower", "room_id": room,
		"payload": map[string]interface{}{"tower_id": 1.0}})
	waitFor(t, conn, "upgrade ack", 5*time.Second, func(m e2eMsg) bool {
		return m.Type == "upgrade_tower" && m.Payload.Status == "upgraded"
	})
	waitFor(t, conn, "tower level 2 in state", 5*time.Second, func(m e2eMsg) bool {
		s := m.Payload.State
		if m.Type != "game_state" || s == nil {
			return false
		}
		for _, tw := range s.Towers {
			if tw.ID == 1 && tw.Level == 2 && tw.Range > 3.0 {
				return true
			}
		}
		return false
	})

	// Sell it: refund 70% of the $100 total spent.
	send(t, conn, map[string]interface{}{"type": "remove_tower", "room_id": room,
		"payload": map[string]interface{}{"tower_id": 1.0}})
	sold := waitFor(t, conn, "sell ack", 5*time.Second, func(m e2eMsg) bool {
		return m.Type == "remove_tower" && m.Payload.Status == "sold"
	})
	if sold.Payload.Refund != 70 {
		t.Errorf("sell refund = %d, want 70", sold.Payload.Refund)
	}

	// New game: everything resets, including fast forward.
	send(t, conn, map[string]interface{}{"type": "new_game", "room_id": room})
	waitFor(t, conn, "reset state", 5*time.Second, func(m e2eMsg) bool {
		s := m.Payload.State
		return m.Type == "game_state" && s != nil &&
			s.Gold == 200 && s.Health == 100 && s.Score == 0 && s.Wave == 1 &&
			s.Phase == "waiting" && len(s.Towers) == 0 && len(s.Enemies) == 0 && !s.FastForward
	})
}
