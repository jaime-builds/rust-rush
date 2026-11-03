package game

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"sync"
	"sync/atomic"
	"time"
)

const (
	// DefaultMaxRooms caps how many rooms (each with its own 60 Hz loop) can
	// exist at once. Rooms are private, one per visitor, so this is also the
	// ceiling on concurrent games.
	DefaultMaxRooms = 50
	// DefaultRoomIdleGrace is how long a room with no players survives before
	// it is deleted and its loop stops. Long enough for a page refresh or a
	// short network drop to rejoin the same game.
	DefaultRoomIdleGrace = 60 * time.Second

	// simStep is the fixed simulation step. Speed 2x/3x runs more steps per
	// tick, never bigger ones, so a run plays out identically at any speed.
	simStep = 1.0 / 60.0
	// maxFrameTime caps how much real time one tick may catch up on. A long
	// stall (GC, host load) resumes slightly behind instead of fast-forwarding
	// through seconds of game in a single frame.
	maxFrameTime = 0.1
)

// ErrTooManyRooms is returned by CreateRoom when the room cap is reached.
var ErrTooManyRooms = errors.New("room limit reached")

// Manager owns every game room and its game loop.
type Manager struct {
	shootingRooms map[string]*GameStateWithShooting
	mu            sync.RWMutex
	// onGameOver is copied onto every room at creation (see SetGameOverHook).
	onGameOver func(roomID string, r RunResult)
	// sink receives each room's marshalled snapshot once per tick, called
	// directly from that room's loop goroutine. Rooms no longer share one
	// broadcast channel, so a busy room can't make the others drop frames.
	sink      func(roomID string, snapshot []byte)
	maxRooms  int
	idleGrace time.Duration
	// userRooms maps a signed-in account to its one live room: every tab
	// and device of that account joins the same game, so a run can't be
	// duplicated (and a save can't be loaded twice).
	userRooms map[int64]string
	// saves is read lock-free: rooms queue saves while holding their own
	// lock, and taking m.mu there could deadlock against ClaimRoom (which
	// holds m.mu and then takes a room lock).
	saves atomic.Pointer[saver]
	// events delivers run events (achievements); lock-free for the same
	// reason as saves.
	events atomic.Pointer[eventSink]
}

// NewManager creates a game manager with the default limits.
func NewManager() *Manager {
	return &Manager{
		shootingRooms: make(map[string]*GameStateWithShooting),
		maxRooms:      DefaultMaxRooms,
		idleGrace:     DefaultRoomIdleGrace,
		userRooms:     make(map[int64]string),
	}
}

// ClaimRoom makes room the account's live room and returns the room the
// account should be in: its existing live room if it already has one (the
// claim then does nothing), otherwise room itself, now owned by it.
func (m *Manager) ClaimRoom(room *GameStateWithShooting, userID int64) *GameStateWithShooting {
	if userID == 0 {
		return room
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if id, ok := m.userRooms[userID]; ok && id != room.RoomID {
		if existing := m.shootingRooms[id]; existing != nil {
			return existing
		}
	}
	room.SetOwner(userID)
	m.userRooms[userID] = room.RoomID
	return room
}

// RoomOfUser returns the account's live room, if any.
func (m *Manager) RoomOfUser(userID int64) (*GameStateWithShooting, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	id, ok := m.userRooms[userID]
	if !ok {
		return nil, false
	}
	room := m.shootingRooms[id]
	return room, room != nil
}

// SetLimits overrides the room cap and idle grace period (tests use short
// values). Call before serving traffic.
func (m *Manager) SetLimits(maxRooms int, idleGrace time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.maxRooms = maxRooms
	m.idleGrace = idleGrace
}

// SetSnapshotSink installs the per-tick snapshot receiver (the hub). Call
// before serving traffic.
func (m *Manager) SetSnapshotSink(sink func(roomID string, snapshot []byte)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sink = sink
}

// newRoomCode returns a 128-bit random hex string. It doubles as the room ID
// and the only way back into the room, so it must not be guessable.
func newRoomCode() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand failing means the OS entropy source is broken; there
		// is no safe fallback for a secret.
		panic("crypto/rand: " + err.Error())
	}
	return hex.EncodeToString(b[:])
}

// CreateRoom makes a new private room with a server-chosen code, starts its
// game loop, and returns it. Fails with ErrTooManyRooms at the cap.
func (m *Manager) CreateRoom() (*GameStateWithShooting, error) {
	m.mu.Lock()
	if len(m.shootingRooms) >= m.maxRooms {
		m.mu.Unlock()
		return nil, ErrTooManyRooms
	}
	code := newRoomCode()
	for m.shootingRooms[code] != nil { // astronomically unlikely
		code = newRoomCode()
	}
	room := m.newRoomLocked(code)
	m.mu.Unlock()

	room.SetSpawnGoal(Position{X: 0, Y: 7}, Position{X: 19, Y: 7})
	go m.StartGameLoop(code)
	return room, nil
}

// GetOrCreateShootingRoom returns the room for roomID, creating it if absent,
// WITHOUT starting a game loop and without the room cap. Only tests and
// in-process tools use it; client traffic goes through CreateRoom.
func (m *Manager) GetOrCreateShootingRoom(roomID string) (room *GameStateWithShooting, created bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if room, exists := m.shootingRooms[roomID]; exists {
		return room, false
	}
	return m.newRoomLocked(roomID), true
}

// newRoomLocked registers a fresh room. Caller holds m.mu.
func (m *Manager) newRoomLocked(roomID string) *GameStateWithShooting {
	room := NewGameStateWithShooting(roomID)
	if m.onGameOver != nil {
		hook := m.onGameOver
		room.OnGameOver = func(r RunResult) { hook(roomID, r) }
	}
	room.emptySince = time.Now()
	room.mgr = m
	m.shootingRooms[roomID] = room
	return room
}

// SetGameOverHook installs a callback fired once per completed game in any
// room (used by main to persist stats). Call before serving traffic — rooms
// created earlier won't have it.
func (m *Manager) SetGameOverHook(hook func(roomID string, r RunResult)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.onGameOver = hook
}

// GetShootingRoom retrieves a room by ID.
func (m *Manager) GetShootingRoom(roomID string) (*GameStateWithShooting, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	room, exists := m.shootingRooms[roomID]
	return room, exists
}

// RoomCount returns how many rooms exist.
func (m *Manager) RoomCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.shootingRooms)
}

// AddPlayer adds a player to a room. Adding an ID that is already present is
// a no-op, so repeat joins can't grow the list.
func (m *Manager) AddPlayer(roomID, playerID string) bool {
	room, exists := m.GetShootingRoom(roomID)
	if !exists {
		return false
	}

	room.mu.Lock()
	defer room.mu.Unlock()
	for _, id := range room.Players {
		if id == playerID {
			return true
		}
	}
	room.Players = append(room.Players, playerID)
	room.emptySince = time.Time{}
	return true
}

// RemovePlayer removes a player from a room. When the last player leaves, the
// idle clock starts; the game loop deletes the room once it runs out.
func (m *Manager) RemovePlayer(roomID, playerID string) {
	room, exists := m.GetShootingRoom(roomID)
	if !exists {
		return
	}

	room.mu.Lock()
	defer room.mu.Unlock()
	for i, id := range room.Players {
		if id == playerID {
			room.Players = append(room.Players[:i], room.Players[i+1:]...)
			break
		}
	}
	if len(room.Players) == 0 && room.emptySince.IsZero() {
		room.emptySince = time.Now()
	}
}

// DeleteRoom removes a room and cancels its spawner. Its game loop notices on
// the next tick and exits.
// A signed-in player's unfinished run is saved first, mid-wave included.
func (m *Manager) DeleteRoom(roomID string) {
	m.mu.RLock()
	room, exists := m.shootingRooms[roomID]
	m.mu.RUnlock()
	if exists {
		room.checkpoint()
	}
	m.mu.Lock()
	delete(m.shootingRooms, roomID)
	for user, id := range m.userRooms {
		if id == roomID {
			delete(m.userRooms, user)
		}
	}
	m.mu.Unlock()
	if exists {
		room.cancelSpawns()
	}
}

// reapIfIdle deletes the room when it has had no players for longer than the
// grace period. Returns true when the room was deleted.
func (m *Manager) reapIfIdle(roomID string, room *GameStateWithShooting, now time.Time) bool {
	m.mu.RLock()
	grace := m.idleGrace
	m.mu.RUnlock()
	if idle := room.idleSince(); idle.IsZero() || now.Sub(idle) < grace {
		return false
	}
	m.DeleteRoom(roomID)
	log.Printf("🧹 Room %s idle for %s, closed", shortID(roomID), grace)
	return true
}

// shortID trims a room code for log lines: enough to correlate, not enough to
// rejoin someone else's room from a leaked log.
func shortID(roomID string) string {
	if len(roomID) > 8 {
		return roomID[:8]
	}
	return roomID
}

// StartGameLoop runs a room at 60 ticks a second until the room is deleted.
// Each tick runs as many fixed simulation steps as the real time elapsed
// (times the speed multiplier) calls for, so the game neither slows down
// when ticks are late nor changes its rules at 2x/3x.
func (m *Manager) StartGameLoop(roomID string) {
	log.Printf("🎮 Starting game loop for room: %s", shortID(roomID))

	ticker := time.NewTicker(time.Second / 60)
	defer ticker.Stop()

	frameCount := 0
	lastLog := time.Now()
	last := time.Now()
	acc := 0.0

	for now := range ticker.C {
		room, exists := m.GetShootingRoom(roomID)
		if !exists {
			log.Printf("Room %s deleted, stopping game loop", shortID(roomID))
			return
		}
		if m.reapIfIdle(roomID, room, now) {
			return
		}

		acc = advance(room, acc, now.Sub(last).Seconds())
		last = now

		frameCount++
		if frameCount%600 == 0 {
			fps := float64(600) / time.Since(lastLog).Seconds()
			log.Printf("📊 Room %s - FPS: %.1f", shortID(roomID), fps)
			lastLog = time.Now()
		}

		// Nobody watching (grace period after the last player left): keep
		// simulating, skip the snapshot and marshal.
		if !room.hasPlayers() {
			continue
		}

		m.mu.RLock()
		sink := m.sink
		m.mu.RUnlock()
		if sink == nil {
			continue
		}

		data, err := json.Marshal(room.GetSnapshot())
		if err != nil {
			log.Printf("❌ Failed to marshal game state: %v", err)
			continue
		}
		sink(roomID, data)
	}
}

// advance runs the fixed simulation steps owed for elapsed real seconds at
// the room's speed, and returns the leftover fraction of a step to carry
// into the next tick. The tiny epsilon keeps float drift (3 × 1/60 summing
// to a hair under 0.05) from deferring a step to the next tick.
func advance(room *GameStateWithShooting, acc, elapsed float64) float64 {
	if elapsed > maxFrameTime {
		elapsed = maxFrameTime
	}
	if elapsed < 0 {
		elapsed = 0
	}
	acc += elapsed * room.GetSpeedMultiplier()
	for acc >= simStep-1e-9 {
		room.Update(simStep)
		acc -= simStep
	}
	if acc < 0 {
		acc = 0
	}
	return acc
}

// SpawnWave spawns enemies for the current wave with delays between spawns.
// The waiting→active flip, the wave number and the cancel channel come from
// one locked step (BeginWave), and each spawn re-checks that channel under
// the same lock that adds the enemy, so a New Game landing at any point can't
// leave a stale spawner feeding the new run.
func (m *Manager) SpawnWave(roomID string) {
	room, exists := m.GetShootingRoom(roomID)
	if !exists {
		return
	}

	waveNum, config, cancel, ok := room.BeginWave()
	if !ok {
		log.Printf("Wave not started in room %s — game not in waiting phase", shortID(roomID))
		return
	}
	m.runSpawner(room, waveNum, config, cancel, 0)
}

// runSpawner feeds a wave's enemies into the room with their delays. skip
// is how many were already spawned (a wave resumed from a save): those are
// passed over with no delay.
func (m *Manager) runSpawner(room *GameStateWithShooting, waveNum int, config WaveConfig, cancel <-chan struct{}, skip int) {
	index := 0

	// No early bail when the path is blocked at wave start: each spawn
	// re-checks and skips blocked spawns while still decrementing the
	// remaining counter, so a fully walled-off wave completes instead of
	// soft-locking the game in the active phase.
	for _, group := range config.Enemies {
		for i := 0; i < group.Count; i++ {
			index++
			if index <= skip {
				continue
			}
			select {
			case <-cancel:
				return
			default:
			}

			if p := room.GetPhase(); p == PhaseGameOver || p == PhaseVictory {
				return
			}

			// Hold spawns while paused — otherwise this goroutine's timers keep
			// firing and enemies pile up frozen on the spawn cell. Cheap poll,
			// still cancellable by New Game. (A pause landing mid-delay below
			// lets the remaining delay elapse first, then holds here — so no
			// enemy ever spawns into a paused game.)
			for room.IsPaused() {
				select {
				case <-cancel:
					return
				case <-time.After(100 * time.Millisecond):
				}
			}

			if !room.SpawnForWave(cancel, group.EnemyType, waveNum) {
				return // cancelled between the check above and the spawn
			}

			spawnDelay := group.SpawnDelay / room.GetSpeedMultiplier()

			select {
			case <-cancel:
				return
			case <-time.After(time.Duration(spawnDelay * float64(time.Second))):
			}
		}
	}
}
