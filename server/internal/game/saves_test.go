package game

import (
	"sync"
	"testing"
	"time"
)

// memSaves is an in-memory SaveStore.
type memSaves struct {
	mu   sync.Mutex
	runs map[int64]SavedRun
}

func newMemSaves() *memSaves { return &memSaves{runs: map[int64]SavedRun{}} }

func (s *memSaves) SaveRun(id int64, r SavedRun) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.runs[id] = r
	return nil
}
func (s *memSaves) LoadRun(id int64) (SavedRun, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.runs[id]
	return r, ok, nil
}
func (s *memSaves) DeleteRun(id int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.runs, id)
	return nil
}
func (s *memSaves) get(id int64) (SavedRun, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.runs[id]
	return r, ok
}

func ownedRoom(t *testing.T, m *Manager, id string, user int64) *GameStateWithShooting {
	t.Helper()
	room, _ := m.GetOrCreateShootingRoom(id)
	room.SetSpawnGoal(Position{X: 0, Y: 7}, Position{X: 19, Y: 7})
	if got := m.ClaimRoom(room, user); got != room {
		t.Fatalf("claim returned another room")
	}
	return room
}

// A wave break saves the run; an untouched board doesn't.
func TestCheckpointAtWaveBreak(t *testing.T) {
	m := NewManager()
	store := newMemSaves()
	m.SetSaveStore(store)
	room := ownedRoom(t, m, "r", 5)

	room.Update(simStep) // waiting, nothing built: no save
	m.FlushSaves()
	if _, ok := store.get(5); ok {
		t.Fatal("an untouched board was saved")
	}

	room.AddTower(5, 5, "basic")
	room.BeginWave()
	room.mu.Lock()
	room.EnemiesRemaining = 0 // wave fully spawned and cleared
	room.mu.Unlock()
	room.Update(simStep) // active -> waiting, wave 2
	m.FlushSaves()
	run, ok := store.get(5)
	if !ok || run.Wave != 2 || run.Phase != PhaseWaiting || len(run.Towers) != 1 {
		t.Fatalf("wave-break save = %+v (ok %v)", run, ok)
	}
}

// Closing a room mid-wave saves it; loading into a fresh room restores the
// run paused, and the wave's spawner picks up where it stopped.
func TestMidWaveSaveAndResume(t *testing.T) {
	m := NewManager()
	store := newMemSaves()
	m.SetSaveStore(store)
	room := ownedRoom(t, m, "first", 9)
	room.SetFastForward(true)

	wave, cfg, cancel, _ := room.BeginWave()
	total := 0
	for _, g := range cfg.Enemies {
		total += g.Count
	}
	if !room.SpawnForWave(cancel, cfg.Enemies[0].EnemyType, wave) || !room.SpawnForWave(cancel, cfg.Enemies[0].EnemyType, wave) {
		t.Fatal("spawns refused")
	}
	tick(room, 1)
	m.DeleteRoom("first") // the player left; the grace period ran out
	m.FlushSaves()
	run, ok := store.get(9)
	if !ok || run.Phase != PhaseActive || run.SpawnedThisWave != 2 || len(run.Enemies) != 2 || run.EnemiesRemaining != total-2 {
		t.Fatalf("mid-wave save = phase %s spawned %d enemies %d remaining %d (ok %v)",
			run.Phase, run.SpawnedThisWave, len(run.Enemies), run.EnemiesRemaining, ok)
	}
	if run.Enemies[0].Path == nil {
		t.Error("saved enemies lost their routes")
	}

	fresh := ownedRoom(t, m, "second", 9)
	if err := m.LoadSave("second", 9); err != nil {
		t.Fatalf("LoadSave: %v", err)
	}
	snap := fresh.GetSnapshot()
	if !snap.Paused || snap.Phase != PhaseActive || len(snap.Enemies) != 2 {
		t.Fatalf("restored: paused=%v phase=%s enemies=%d", snap.Paused, snap.Phase, len(snap.Enemies))
	}
	fresh.SetPaused(false)
	if !waitUntil(30*time.Second, func() bool {
		fresh.mu.RLock()
		defer fresh.mu.RUnlock()
		return fresh.spawnedThisWave == total
	}) {
		t.Fatalf("resumed spawner stopped at %d of %d", fresh.spawnedThisWave, total)
	}
	fresh.cancelSpawns()
}

// The save can only replace an untouched board, and can't be loaded by
// someone else.
func TestLoadSaveRules(t *testing.T) {
	m := NewManager()
	store := newMemSaves()
	m.SetSaveStore(store)
	store.SaveRun(3, SavedRun{Version: SaveVersion, MapID: DefaultMapID, Difficulty: DifficultyNormal,
		Wave: 4, Health: 80, Gold: 500, Phase: PhaseWaiting, NextTowerID: 1, NextEnemyID: 1})

	busy := ownedRoom(t, m, "busy", 3)
	busy.AddTower(5, 5, "basic")
	if err := m.LoadSave("busy", 3); err != ErrRoomNotNew {
		t.Errorf("load into a board in progress: %v, want ErrRoomNotNew", err)
	}
	other, _ := m.GetOrCreateShootingRoom("other")
	m.ClaimRoom(other, 4)
	if err := m.LoadSave("other", 3); err != ErrNotYourRoom {
		t.Errorf("load into someone else's room: %v", err)
	}
	if err := m.LoadSave("other", 4); err != ErrNoSave {
		t.Errorf("load with no save: %v", err)
	}
}

// A finished run deletes its save; so does a new game (via DiscardSave).
func TestRunEndDeletesSave(t *testing.T) {
	m := NewManager()
	store := newMemSaves()
	m.SetSaveStore(store)
	room := ownedRoom(t, m, "r", 6)
	store.SaveRun(6, SavedRun{Version: SaveVersion})
	room.mu.Lock()
	room.Phase = PhaseActive
	room.Health = 0
	room.mu.Unlock()
	room.Update(simStep) // game over
	m.FlushSaves()
	if _, ok := store.get(6); ok {
		t.Error("save survived game over")
	}
	store.SaveRun(6, SavedRun{Version: SaveVersion})
	m.DiscardSave(6)
	m.FlushSaves()
	if _, ok := store.get(6); ok {
		t.Error("save survived DiscardSave")
	}
}

// One live room per account: a second claim returns the first room.
func TestOneRoomPerAccount(t *testing.T) {
	m := NewManager()
	a, _ := m.GetOrCreateShootingRoom("a")
	b, _ := m.GetOrCreateShootingRoom("b")
	if got := m.ClaimRoom(a, 1); got != a {
		t.Fatal("first claim")
	}
	if got := m.ClaimRoom(b, 1); got != a || b.Owner() != 0 {
		t.Errorf("second claim got %s (b owner %d), want room a and b untouched", got.RoomID, b.Owner())
	}
	if r, ok := m.RoomOfUser(1); !ok || r != a {
		t.Error("RoomOfUser")
	}
	m.DeleteRoom("a")
	if _, ok := m.RoomOfUser(1); ok {
		t.Error("deleted room still listed for the account")
	}
	if got := m.ClaimRoom(b, 1); got != b {
		t.Error("claim after the old room closed")
	}
}

// Rooms owned by an account report wave, victory, evolve, tower and boss
// events; guest rooms report nothing.
func TestRoomEvents(t *testing.T) {
	m := NewManager()
	got := make(chan Event, 32)
	m.SetEventHandler(func(_ int64, _ string, ev Event) { got <- ev })
	room := ownedRoom(t, m, "r", 2)
	room.Gold = 1e6

	tw, _ := room.AddTower(5, 5, "basic")
	for i := 0; i < 3; i++ {
		room.UpgradeTower(tw.ID)
	}
	if _, err := room.EvolveTower(tw.ID, "breach"); err != nil {
		t.Fatalf("evolve: %v", err)
	}
	room.mu.Lock()
	room.Phase = PhaseActive
	room.Enemies = append(room.Enemies, Enemy{ID: 99, EnemyType: "boss", Health: 0, SpawnWave: 1})
	room.mu.Unlock()
	room.Update(simStep) // boss dies; wave completes (nothing left)

	kinds := map[string]Event{}
	deadline := time.After(time.Second)
	for len(kinds) < 3 {
		select {
		case ev := <-got:
			kinds[ev.Kind] = ev
		case <-deadline:
			t.Fatalf("events so far: %+v", kinds)
		}
	}
	if kinds[EventEvolved].Base != "basic" || kinds[EventBossKilled].Count != 1 || kinds[EventWaveReached].Wave != 2 || !kinds[EventWaveReached].Untouched {
		t.Errorf("events: %+v", kinds)
	}

	guest, _ := m.GetOrCreateShootingRoom("guest")
	guest.SetSpawnGoal(Position{X: 0, Y: 7}, Position{X: 19, Y: 7})
	guest.Gold = 1e6
	g, _ := guest.AddTower(5, 5, "basic")
	for i := 0; i < 3; i++ {
		guest.UpgradeTower(g.ID)
	}
	guest.EvolveTower(g.ID, "breach")
	select {
	case ev := <-got:
		t.Errorf("guest room emitted %+v", ev)
	case <-time.After(100 * time.Millisecond):
	}
}
