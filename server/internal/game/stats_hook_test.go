package game

import (
	"testing"
	"time"
)

// The stats writer hangs off OnGameOver — it must fire exactly once per
// game-over transition, with the final wave/score/duration, and never fire
// again while the game sits in the game_over phase.
func TestOnGameOverFiresOnce(t *testing.T) {
	gs := newTestGame()

	type record struct {
		wave, score int
		duration    float64
	}
	fired := make(chan record, 8) // buffered: the hook runs on its own goroutine

	gs.mu.Lock()
	gs.Health = 10
	gs.Wave = 7
	gs.Score = 3131
	gs.OnGameOver = func(wave, score int, duration float64) {
		fired <- record{wave, score, duration}
	}
	gs.mu.Unlock()

	// Enemy one short hop from the goal — leaks and drops health to 0.
	path := []Position{{X: 18, Y: 7}, {X: 19, Y: 7}}
	gs.AddEnemy("fast", path, 7)
	gs.StartWave(1)
	gs.DecrementEnemiesRemaining()

	tick(gs, 3)

	if gs.GetPhase() != PhaseGameOver {
		t.Fatalf("phase = %s, want game_over", gs.GetPhase())
	}

	var got record
	select {
	case got = <-fired:
	case <-time.After(2 * time.Second):
		t.Fatal("OnGameOver never fired")
	}
	if got.wave != 7 || got.score != 3131 {
		t.Errorf("hook got wave=%d score=%d, want wave=7 score=3131", got.wave, got.score)
	}
	if got.duration <= 0 {
		t.Errorf("hook got duration=%f, want > 0", got.duration)
	}

	// Keep ticking in the game_over phase: no second fire.
	tick(gs, 2)
	select {
	case extra := <-fired:
		t.Fatalf("OnGameOver fired again after game over: %+v", extra)
	case <-time.After(200 * time.Millisecond):
	}
}

// Manager wiring: rooms created after SetGameOverHook get the hook with
// their own room ID bound in.
func TestManagerGameOverHookWiring(t *testing.T) {
	m := NewManager()
	fired := make(chan string, 1)
	m.SetGameOverHook(func(roomID string, wave, score int, duration float64) {
		fired <- roomID
	})

	room, created := m.GetOrCreateShootingRoom("hook-room")
	if !created {
		t.Fatal("expected room to be created")
	}
	if room.OnGameOver == nil {
		t.Fatal("room created after SetGameOverHook has no OnGameOver")
	}

	room.OnGameOver(3, 100, 42.0)
	select {
	case roomID := <-fired:
		if roomID != "hook-room" {
			t.Errorf("hook roomID = %q, want hook-room", roomID)
		}
	case <-time.After(time.Second):
		t.Fatal("manager hook never fired")
	}
}
