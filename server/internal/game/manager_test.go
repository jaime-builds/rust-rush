package game

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Concurrent joins must never create duplicate rooms (which would each start
// their own 60 FPS game loop, doubling game speed permanently).
func TestGetOrCreateShootingRoomConcurrent(t *testing.T) {
	m := NewManager()
	var created atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, c := m.GetOrCreateShootingRoom("same"); c {
				created.Add(1)
			}
		}()
	}
	wg.Wait()
	if created.Load() != 1 {
		t.Errorf("created reported true %d times, want exactly 1", created.Load())
	}
}

// Documented behavior (TODO Phase 11 / README testing checklist): "Block path
// completely — enemies skip, wave still completes." This must hold even when
// the path is already blocked BEFORE the first spawn.
func TestSpawnWaveFullyBlockedAtStartCompletes(t *testing.T) {
	m := NewManager()
	room, _ := m.GetOrCreateShootingRoom("blocked")
	room.SetSpawnGoal(Position{X: 0, Y: 7}, Position{X: 19, Y: 7})
	wallColumn(t, room, 10)
	room.SetFastForward(true) // 3x: wave 1 is 5 spawns × 2s delay → ~3.3s test time

	m.SpawnWave("blocked") // synchronous: returns when all spawns are processed

	snap := room.GetSnapshot()
	if snap.EnemiesRemaining != 0 {
		t.Fatalf("EnemiesRemaining = %d after fully blocked wave, want 0 (soft-lock)", snap.EnemiesRemaining)
	}
	if len(snap.Enemies) != 0 {
		t.Fatalf("enemies spawned through a full wall: %d", len(snap.Enemies))
	}

	room.Update(1.0 / 60.0) // completion check runs in the game loop
	snap = room.GetSnapshot()
	if snap.Phase != PhaseWaiting || snap.Wave != 2 {
		t.Errorf("wave did not complete: phase=%s wave=%d, want waiting/2", snap.Phase, snap.Wave)
	}
}

// StartWave is the atomic waiting→active gate: a second concurrent start must
// be rejected so two start_wave messages cannot double-spawn.
func TestStartWaveRejectsDoubleStart(t *testing.T) {
	gs := newTestGame()
	if !gs.StartWave(5) {
		t.Fatal("first StartWave rejected in waiting phase")
	}
	if gs.StartWave(5) {
		t.Error("second StartWave accepted while already active")
	}
	if gs.GetSnapshot().EnemiesRemaining != 5 {
		t.Errorf("EnemiesRemaining = %d, want 5", gs.GetSnapshot().EnemiesRemaining)
	}
}

// A Reset racing wave startup must still cancel the spawner: the cancel
// channel is captured before the phase flips.
func TestSpawnWaveCancelledByReset(t *testing.T) {
	m := NewManager()
	room, _ := m.GetOrCreateShootingRoom("reset-race")
	room.SetSpawnGoal(Position{X: 0, Y: 7}, Position{X: 19, Y: 7})

	done := make(chan struct{})
	go func() {
		m.SpawnWave("reset-race")
		close(done)
	}()

	time.Sleep(50 * time.Millisecond) // let the spawner start its first delay
	room.Reset()

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("SpawnWave did not exit after Reset")
	}
}
