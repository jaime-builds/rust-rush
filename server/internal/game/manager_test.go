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

	// Reset only once the spawner owns the wave, so the test always covers a
	// running spawner (a fixed sleep raced the goroutine on a loaded box).
	if !waitUntil(2*time.Second, func() bool { return room.GetPhase() == PhaseActive }) {
		t.Fatal("spawner never started the wave")
	}
	room.Reset()

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("SpawnWave did not exit after Reset")
	}
}

// waitUntil polls cond every 5 ms until it holds or timeout passes.
func waitUntil(timeout time.Duration, cond func() bool) bool {
	deadline := time.Now().Add(timeout)
	for !cond() {
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(5 * time.Millisecond)
	}
	return true
}

// RR-01: a room nobody is in closes after the grace period and its loop
// stops; a room with a player stays, and closes once they leave.
func TestRoomClosesAfterIdleGrace(t *testing.T) {
	m := NewManager()
	m.SetLimits(10, 100*time.Millisecond)

	abandoned, err := m.CreateRoom()
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	occupied, err := m.CreateRoom()
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	m.AddPlayer(occupied.RoomID, "p1")

	if !waitUntil(2*time.Second, func() bool {
		_, ok := m.GetShootingRoom(abandoned.RoomID)
		return !ok
	}) {
		t.Fatal("empty room still open after the grace period")
	}
	time.Sleep(200 * time.Millisecond) // well past the grace period
	if _, ok := m.GetShootingRoom(occupied.RoomID); !ok {
		t.Fatal("a room with a player was closed")
	}

	m.RemovePlayer(occupied.RoomID, "p1")
	if !waitUntil(2*time.Second, func() bool { return m.RoomCount() == 0 }) {
		t.Fatalf("room not closed after its last player left (RoomCount=%d)", m.RoomCount())
	}
}

// A player who comes back inside the grace period keeps the room.
func TestRejoinInsideGraceKeepsRoom(t *testing.T) {
	m := NewManager()
	m.SetLimits(10, 300*time.Millisecond)
	room, _ := m.CreateRoom()
	defer m.DeleteRoom(room.RoomID)

	m.AddPlayer(room.RoomID, "p1")
	m.RemovePlayer(room.RoomID, "p1")
	time.Sleep(100 * time.Millisecond)
	m.AddPlayer(room.RoomID, "p1-again")
	time.Sleep(400 * time.Millisecond)
	if _, ok := m.GetShootingRoom(room.RoomID); !ok {
		t.Fatal("room closed although the player rejoined inside the grace period")
	}
}

// RR-01: the room cap holds, and closing a room frees a slot.
func TestCreateRoomCap(t *testing.T) {
	m := NewManager()
	m.SetLimits(2, time.Minute)
	a, _ := m.CreateRoom()
	b, _ := m.CreateRoom()
	defer m.DeleteRoom(b.RoomID)
	if _, err := m.CreateRoom(); err != ErrTooManyRooms {
		t.Fatalf("third room: err = %v, want ErrTooManyRooms", err)
	}
	m.DeleteRoom(a.RoomID)
	c, err := m.CreateRoom()
	if err != nil {
		t.Fatalf("room after a close: %v", err)
	}
	defer m.DeleteRoom(c.RoomID)
	if a.RoomID == b.RoomID || len(a.RoomID) != 32 {
		t.Errorf("room codes not unique 128-bit hex: %q %q", a.RoomID, b.RoomID)
	}
}

// RR-12: AddPlayer is idempotent.
func TestAddPlayerIdempotent(t *testing.T) {
	m := NewManager()
	room, _ := m.GetOrCreateShootingRoom("r")
	for i := 0; i < 5; i++ {
		m.AddPlayer("r", "p1")
	}
	if n := len(room.GetSnapshot().Players); n != 1 {
		t.Errorf("players = %d after 5 adds of one ID, want 1", n)
	}
}

// FS-07: a spawner whose wave was cancelled by New Game can't add enemies
// to, or count down, the new run.
func TestStaleSpawnerCannotTouchNewRun(t *testing.T) {
	gs := newTestGame()
	gs.SetSpawnGoal(Position{X: 0, Y: 7}, Position{X: 19, Y: 7})

	wave, cfg, oldCancel, ok := gs.BeginWave()
	if !ok || wave != 1 || len(cfg.Enemies) == 0 {
		t.Fatalf("BeginWave = (%d, %v, ok=%v)", wave, cfg, ok)
	}
	if !gs.SpawnForWave(oldCancel, "basic", wave) {
		t.Fatal("current spawner refused")
	}

	gs.Reset() // New Game
	_, _, _, ok = gs.BeginWave()
	if !ok {
		t.Fatal("BeginWave refused on the fresh run")
	}
	before := gs.GetSnapshot().EnemiesRemaining

	if gs.SpawnForWave(oldCancel, "basic", wave) {
		t.Error("stale spawner was allowed to spawn")
	}
	snap := gs.GetSnapshot()
	if len(snap.Enemies) != 0 || snap.EnemiesRemaining != before {
		t.Errorf("stale spawner changed the new run: enemies=%d remaining=%d (want 0, %d)",
			len(snap.Enemies), snap.EnemiesRemaining, before)
	}
}

// BeginWave is the waiting→active gate: a second call is refused.
func TestBeginWaveRejectsDoubleStart(t *testing.T) {
	gs := newTestGame()
	if _, _, _, ok := gs.BeginWave(); !ok {
		t.Fatal("first BeginWave refused")
	}
	if _, _, _, ok := gs.BeginWave(); ok {
		t.Error("second BeginWave accepted while active")
	}
}
