package game

import (
	"encoding/json"
	"log"
	"sync"
	"time"
)

// Manager handles multiple game rooms
type Manager struct {
	shootingRooms map[string]*GameStateWithShooting
	mu            sync.RWMutex
	broadcast     chan BroadcastMessage
}

// BroadcastMessage contains room ID and data to broadcast
type BroadcastMessage struct {
	RoomID string
	Data   []byte
}

// NewManager creates a new game manager
func NewManager() *Manager {
	return &Manager{
		shootingRooms: make(map[string]*GameStateWithShooting),
		broadcast:     make(chan BroadcastMessage, 256),
	}
}

// GetOrCreateShootingRoom returns the room for roomID, creating it if absent.
// Check and create happen under one lock so concurrent joins cannot create
// duplicate rooms (each with its own game loop). created reports whether this
// call made the room — only the creator should start the game loop.
func (m *Manager) GetOrCreateShootingRoom(roomID string) (room *GameStateWithShooting, created bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if room, exists := m.shootingRooms[roomID]; exists {
		return room, false
	}
	room = NewGameStateWithShooting(roomID)
	m.shootingRooms[roomID] = room
	return room, true
}

// GetShootingRoom retrieves a shooting game room by ID
func (m *Manager) GetShootingRoom(roomID string) (*GameStateWithShooting, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	room, exists := m.shootingRooms[roomID]
	return room, exists
}

// AddPlayer adds a player to a room
func (m *Manager) AddPlayer(roomID, playerID string) bool {
	m.mu.RLock()
	room, exists := m.shootingRooms[roomID]
	m.mu.RUnlock()

	if !exists {
		return false
	}

	room.mu.Lock()
	room.Players = append(room.Players, playerID)
	room.mu.Unlock()
	return true
}

// RemovePlayer removes a player from a room
func (m *Manager) RemovePlayer(roomID, playerID string) {
	m.mu.RLock()
	room, exists := m.shootingRooms[roomID]
	m.mu.RUnlock()

	if !exists {
		return
	}

	room.mu.Lock()
	for i, id := range room.Players {
		if id == playerID {
			room.Players = append(room.Players[:i], room.Players[i+1:]...)
			break
		}
	}
	room.mu.Unlock()
}

// StartGameLoop starts the 60 FPS game loop for a room
func (m *Manager) StartGameLoop(roomID string) {
	log.Printf("🎮 Starting game loop for room: %s", roomID)

	ticker := time.NewTicker(time.Second / 60)
	defer ticker.Stop()

	frameCount := 0
	lastLog := time.Now()

	for range ticker.C {
		m.mu.RLock()
		room, exists := m.shootingRooms[roomID]
		m.mu.RUnlock()

		if !exists {
			log.Printf("⚠️ Room %s deleted, stopping game loop", roomID)
			return
		}

		room.Update(1.0 / 60.0 * room.GetSpeedMultiplier())

		snapshot := room.GetSnapshot()

		frameCount++
		if frameCount%600 == 0 {
			elapsed := time.Since(lastLog)
			fps := float64(600) / elapsed.Seconds()
			log.Printf("📊 Room %s - FPS: %.1f | Phase: %s | Wave: %d | Towers: %d | Enemies: %d | Projectiles: %d",
				roomID, fps, snapshot.Phase, snapshot.Wave, len(snapshot.Towers), len(snapshot.Enemies), len(snapshot.Projectiles))
			lastLog = time.Now()
		}

		data, err := json.Marshal(snapshot)
		if err != nil {
			log.Printf("❌ Failed to marshal game state: %v", err)
			continue
		}

		select {
		case m.broadcast <- BroadcastMessage{
			RoomID: roomID,
			Data:   data,
		}:
		default:
			if frameCount%300 == 0 {
				log.Printf("⚠️ Broadcast channel full for room %s", roomID)
			}
		}
	}
}

// SpawnWave spawns enemies for the current wave with delays between spawns.
func (m *Manager) SpawnWave(roomID string) {
	m.mu.RLock()
	room, exists := m.shootingRooms[roomID]
	m.mu.RUnlock()

	if !exists {
		return
	}

	snapshot := room.GetSnapshot()
	waveNum := snapshot.Wave
	config := GetWaveConfig(waveNum)

	total := 0
	for _, group := range config.Enemies {
		total += group.Count
	}

	// Capture the cancel channel for THIS wave before flipping the phase, so
	// a Reset that lands mid-setup still cancels this spawner.
	cancel := room.GetSpawnCancel()

	if !room.StartWave(total) {
		log.Printf("⚠️ Wave %d not started in room %s — game not in waiting phase", waveNum, roomID)
		return
	}
	log.Printf("🌊 Starting wave %d — %d enemies total", waveNum, total)

	// No early bail when the path is blocked at wave start: each iteration
	// re-checks and skips blocked spawns while still decrementing the
	// remaining counter, so a fully walled-off wave completes instead of
	// soft-locking the game in the active phase.
	for _, group := range config.Enemies {
		for i := 0; i < group.Count; i++ {
			// Check if cancelled (new game started)
			select {
			case <-cancel:
				log.Printf("🛑 Wave %d spawn cancelled (new game)", waveNum)
				return
			default:
			}

			if room.GetPhase() == PhaseGameOver {
				return
			}

			if path := room.FindPathFromSpawn(); path != nil {
				room.AddEnemy(group.EnemyType, path, waveNum)
			} else {
				log.Printf("⚠️ Path blocked, skipping enemy %d/%d in wave %d", i+1, group.Count, waveNum)
			}

			room.DecrementEnemiesRemaining()

			spawnDelay := group.SpawnDelay / room.GetSpeedMultiplier()

			// Wait before next spawn, but bail early if cancelled
			select {
			case <-cancel:
				log.Printf("🛑 Wave %d spawn cancelled during delay (new game)", waveNum)
				return
			case <-time.After(time.Duration(spawnDelay * float64(time.Second))):
			}
		}
	}

	log.Printf("✅ Wave %d spawn complete", waveNum)
}

// GetBroadcastChannel returns the broadcast channel for the hub to read from
func (m *Manager) GetBroadcastChannel() <-chan BroadcastMessage {
	return m.broadcast
}
