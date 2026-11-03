// Autosave for signed-in players: one slot per account, always the latest
// state of their run. Written at every wave break, when the room closes
// (mid-wave included), and on server shutdown; deleted when the run ends or
// a new game replaces it. There is no manual save and no older copy, so a
// run can't be save-scummed.

package game

import (
	"errors"
	"log"
	"sync"
	"time"
)

// SaveVersion tags the saved format; a save from another version is ignored.
const SaveVersion = 1

// SavedEnemy is an enemy plus its server-internal route (which the
// snapshot JSON leaves out).
type SavedEnemy struct {
	Enemy     Enemy      `json:"enemy"`
	Path      []Position `json:"path"`
	PathIndex int        `json:"path_index"`
	SpawnWave int        `json:"spawn_wave"`
}

// SavedRun is everything needed to continue a run exactly where it was.
// Projectiles in flight and visual effects are not kept (under a second of
// travel); everything that affects the outcome is.
type SavedRun struct {
	Version          int       `json:"version"`
	SavedAt          time.Time `json:"saved_at"`
	MapID            string    `json:"map_id"`
	Difficulty       string    `json:"difficulty"`
	Endless          bool      `json:"endless"`
	Gold             int       `json:"gold"`
	Health           int       `json:"health"`
	Score            int       `json:"score"`
	Wave             int       `json:"wave"`
	Phase            GamePhase `json:"phase"`
	EnemiesRemaining int       `json:"enemies_remaining"`
	SpawnedThisWave  int       `json:"spawned_this_wave"`
	GameTime         float64   `json:"game_time"`
	SpeedMultiplier  float64   `json:"speed_multiplier"`
	TookDamage       bool      `json:"took_damage"`
	// RunRecorded: the run already has its stats row (a victory continued
	// into Endless), so its eventual end must not record another.
	RunRecorded      bool         `json:"run_recorded"`
	Towers           []Tower      `json:"towers"`
	Enemies          []SavedEnemy `json:"enemies"`
	NextTowerID      int          `json:"next_tower_id"`
	NextEnemyID      int          `json:"next_enemy_id"`
	NextProjectileID int          `json:"next_projectile_id"`
	NextEffectID     int          `json:"next_effect_id"`
}

// SaveSummary is what the map screen shows for a saved run.
type SaveSummary struct {
	MapID      string    `json:"map_id"`
	Wave       int       `json:"wave"`
	Difficulty string    `json:"difficulty"`
	Endless    bool      `json:"endless"`
	SavedAt    time.Time `json:"saved_at"`
}

// SaveStore persists saves (the accounts store implements it).
type SaveStore interface {
	SaveRun(userID int64, run SavedRun) error
	LoadRun(userID int64) (SavedRun, bool, error)
	DeleteRun(userID int64) error
}

var (
	ErrNoSave      = errors.New("no saved run")
	ErrRoomNotNew  = errors.New("a saved run can only be loaded into a fresh game")
	ErrNotYourRoom = errors.New("not your room")
	ErrBadSave     = errors.New("saved run is unreadable")
)

type saveJob struct {
	userID int64
	run    *SavedRun // nil = delete
}

// saver writes saves on one goroutine, in order, so a later save can never
// be overwritten by an earlier one that was slower to write.
type saver struct {
	store SaveStore
	jobs  chan saveJob
	wg    sync.WaitGroup
}

func newSaver(store SaveStore) *saver {
	s := &saver{store: store, jobs: make(chan saveJob, 512)}
	go func() {
		for job := range s.jobs {
			var err error
			if job.run == nil {
				err = s.store.DeleteRun(job.userID)
			} else {
				err = s.store.SaveRun(job.userID, *job.run)
			}
			if err != nil {
				log.Printf("⚠️ Save for account %d failed: %v", job.userID, err)
			}
			s.wg.Done()
		}
	}()
	return s
}

func (s *saver) enqueue(job saveJob) {
	s.wg.Add(1)
	select {
	case s.jobs <- job:
	default:
		s.wg.Done()
		log.Printf("⚠️ Save queue full, dropped a save for account %d", job.userID)
	}
}

// SetSaveStore turns autosave on. Call before serving traffic.
func (m *Manager) SetSaveStore(store SaveStore) {
	m.saves.Store(newSaver(store))
}

func (m *Manager) saverOrNil() *saver { return m.saves.Load() }

// queueSave and queueDiscard are called by rooms (any lock state: they only
// touch the channel).
func (m *Manager) queueSave(userID int64, run SavedRun) {
	if s := m.saverOrNil(); s != nil && userID > 0 {
		s.enqueue(saveJob{userID: userID, run: &run})
	}
}

func (m *Manager) queueDiscard(userID int64) {
	if s := m.saverOrNil(); s != nil && userID > 0 {
		s.enqueue(saveJob{userID: userID})
	}
}

// FlushSaves waits until every queued save is written (shutdown).
func (m *Manager) FlushSaves() {
	if s := m.saverOrNil(); s != nil {
		s.wg.Wait()
	}
}

// SaveAll checkpoints every signed-in player's running game (shutdown), so
// a deploy doesn't cost anyone their run. Call FlushSaves after.
func (m *Manager) SaveAll() {
	m.mu.RLock()
	rooms := make([]*GameStateWithShooting, 0, len(m.userRooms))
	for _, id := range m.userRooms {
		if r := m.shootingRooms[id]; r != nil {
			rooms = append(rooms, r)
		}
	}
	m.mu.RUnlock()
	for _, r := range rooms {
		r.checkpoint()
	}
}

// SavedRunSummary returns what the map screen offers to continue.
func (m *Manager) SavedRunSummary(userID int64) (SaveSummary, bool) {
	s := m.saverOrNil()
	if s == nil || userID == 0 {
		return SaveSummary{}, false
	}
	run, ok, err := s.store.LoadRun(userID)
	if err != nil || !ok || run.Version != SaveVersion {
		return SaveSummary{}, false
	}
	return SaveSummary{MapID: run.MapID, Wave: run.Wave, Difficulty: run.Difficulty, Endless: run.Endless, SavedAt: run.SavedAt}, true
}

// LoadSave restores the account's saved run into its room. The room must
// belong to the account and be a fresh game (wave 1, nothing built, no
// game time), so a save can only ever replace an untouched board. The run
// comes back paused. A wave that was in progress resumes its spawner where
// it stopped.
func (m *Manager) LoadSave(roomID string, userID int64) error {
	s := m.saverOrNil()
	if s == nil || userID == 0 {
		return ErrNoSave
	}
	room, ok := m.GetShootingRoom(roomID)
	if !ok || room.Owner() != userID {
		return ErrNotYourRoom
	}
	s.wg.Wait() // a save still in the queue is the newest state
	run, ok, err := s.store.LoadRun(userID)
	if err != nil {
		return err
	}
	if !ok || run.Version != SaveVersion {
		return ErrNoSave
	}
	resume, err := room.restore(run)
	if err != nil {
		return err
	}
	if resume {
		go m.resumeSpawner(roomID)
	}
	return nil
}

// DiscardSave drops the account's save (a new game replaces the run).
func (m *Manager) DiscardSave(userID int64) { m.queueDiscard(userID) }

// --- room side ----------------------------------------------------------------

// checkpoint queues a save of the room's current state, if a signed-in
// player owns it and the run is still going.
func (gs *GameStateWithShooting) checkpoint() {
	gs.mu.RLock()
	defer gs.mu.RUnlock()
	gs.checkpointLocked()
}

// checkpointLocked: caller holds gs.mu (read or write).
func (gs *GameStateWithShooting) checkpointLocked() {
	if gs.OwnerID == 0 || gs.mgr == nil {
		return
	}
	if gs.Phase != PhaseWaiting && gs.Phase != PhaseActive {
		return
	}
	if gs.Phase == PhaseWaiting && gs.Wave == 1 && len(gs.Towers) == 0 && gs.GameTime == 0 {
		return // an untouched board isn't worth a save (and mustn't replace one)
	}
	run := SavedRun{
		Version: SaveVersion, SavedAt: time.Now().UTC(),
		MapID: gs.MapID, Difficulty: gs.Difficulty, Endless: gs.Endless,
		Gold: gs.Gold, Health: gs.Health, Score: gs.Score, Wave: gs.Wave, Phase: gs.Phase,
		EnemiesRemaining: gs.EnemiesRemaining, SpawnedThisWave: gs.spawnedThisWave,
		GameTime: gs.GameTime, SpeedMultiplier: gs.SpeedMultiplier, TookDamage: gs.tookDamage,
		RunRecorded: gs.runRecorded,
		Towers:      append([]Tower(nil), gs.Towers...),
		Enemies:     make([]SavedEnemy, len(gs.Enemies)),
		NextTowerID: gs.nextTowerID, NextEnemyID: gs.nextEnemyID,
		NextProjectileID: gs.nextProjectileID, NextEffectID: gs.nextEffectID,
	}
	for i, e := range gs.Enemies {
		run.Enemies[i] = SavedEnemy{Enemy: e, Path: append([]Position(nil), e.Path...), PathIndex: e.PathIndex, SpawnWave: e.SpawnWave}
	}
	gs.mgr.queueSave(gs.OwnerID, run)
}

// isFreshLocked: the board is untouched. Caller holds gs.mu.
func (gs *GameStateWithShooting) isFreshLocked() bool {
	return gs.Phase == PhaseWaiting && gs.Wave == 1 && len(gs.Towers) == 0 && gs.GameTime == 0 && len(gs.Enemies) == 0
}

// restore replaces a fresh room's state with a saved run, paused. Returns
// whether a wave was in progress (the caller restarts its spawner).
func (gs *GameStateWithShooting) restore(run SavedRun) (resumeWave bool, err error) {
	m := GetMapDef(run.MapID)
	if m == nil || run.Wave < 1 || run.Health <= 0 ||
		(run.Phase != PhaseWaiting && run.Phase != PhaseActive) ||
		(run.Difficulty != DifficultyNormal && run.Difficulty != DifficultyHarder) {
		return false, ErrBadSave
	}
	gs.mu.Lock()
	defer gs.mu.Unlock()
	if !gs.isFreshLocked() {
		return false, ErrRoomNotNew
	}
	close(gs.spawnCancel)
	gs.spawnCancel = make(chan struct{})

	gs.mapDef, gs.MapID = m, m.ID
	gs.Difficulty, gs.Endless = run.Difficulty, run.Endless
	gs.Gold, gs.Health, gs.Score, gs.Wave, gs.Phase = run.Gold, run.Health, run.Score, run.Wave, run.Phase
	gs.EnemiesRemaining, gs.spawnedThisWave = run.EnemiesRemaining, run.SpawnedThisWave
	gs.GameTime, gs.tookDamage = run.GameTime, run.TookDamage
	gs.SpeedMultiplier = run.SpeedMultiplier
	if gs.SpeedMultiplier != 2 && gs.SpeedMultiplier != 3 {
		gs.SpeedMultiplier = 1
	}
	gs.FastForward = gs.SpeedMultiplier > 1
	gs.Paused = true
	gs.runRecorded = run.RunRecorded
	gs.Towers = append(make([]Tower, 0, len(run.Towers)), run.Towers...)
	gs.Enemies = make([]Enemy, 0, len(run.Enemies))
	for _, se := range run.Enemies {
		e := se.Enemy
		e.Path, e.PathIndex, e.SpawnWave = se.Path, se.PathIndex, se.SpawnWave
		gs.Enemies = append(gs.Enemies, e)
	}
	gs.Projectiles = make([]Projectile, 0)
	gs.MuzzleFlashes = make([]MuzzleFlash, 0)
	gs.Explosions = make([]Explosion, 0)
	gs.Arcs = make([]Arc, 0)
	gs.nextTowerID, gs.nextEnemyID = run.NextTowerID, run.NextEnemyID
	gs.nextProjectileID, gs.nextEffectID = run.NextProjectileID, run.NextEffectID
	// Route everyone again against the restored towers (cheap, and it
	// repairs any path a save might have caught mid-update).
	gs.RecalculateEnemyPaths()

	total := 0
	for _, g := range GetWaveConfig(gs.Wave).Enemies {
		total += g.Count
	}
	return gs.Phase == PhaseActive && gs.spawnedThisWave < total, nil
}

// resumeSpawner continues a restored wave's spawns from where they stopped.
func (m *Manager) resumeSpawner(roomID string) {
	room, ok := m.GetShootingRoom(roomID)
	if !ok {
		return
	}
	room.mu.RLock()
	wave, cancel, skip := room.Wave, room.spawnCancel, room.spawnedThisWave
	active := room.Phase == PhaseActive
	room.mu.RUnlock()
	if !active {
		return
	}
	m.runSpawner(room, wave, GetWaveConfig(wave), cancel, skip)
}
