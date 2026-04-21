package game

import (
	"encoding/json"
	"log"
	"sync"
	"time"
)

// GameState represents the current state of a game room (legacy)
type GameState struct {
	RoomID   string          `json:"room_id"`
	Players  []string        `json:"players"`
	GameData json.RawMessage `json:"game_data"`
}

// Manager handles multiple game rooms
type Manager struct {
	rooms         map[string]*GameState
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
		rooms:         make(map[string]*GameState),
		shootingRooms: make(map[string]*GameStateWithShooting),
		broadcast:     make(chan BroadcastMessage, 256),
	}
}

// CreateRoom creates a new game room
func (m *Manager) CreateRoom(roomID string) *GameState {
	m.mu.Lock()
	defer m.mu.Unlock()

	state := &GameState{
		RoomID:  roomID,
		Players: make([]string, 0),
	}

	m.rooms[roomID] = state
	return state
}

// CreateShootingRoom creates a new game room with shooting mechanics
func (m *Manager) CreateShootingRoom(roomID string) *GameStateWithShooting {
	m.mu.Lock()
	defer m.mu.Unlock()

	state := NewGameStateWithShooting(roomID)
	m.shootingRooms[roomID] = state

	return state
}

// GetRoom retrieves a game room by ID
func (m *Manager) GetRoom(roomID string) (*GameState, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	room, exists := m.rooms[roomID]
	return room, exists
}

// GetShootingRoom retrieves a shooting game room by ID
func (m *Manager) GetShootingRoom(roomID string) (*GameStateWithShooting, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	room, exists := m.shootingRooms[roomID]
	return room, exists
}

// DeleteRoom removes a game room
func (m *Manager) DeleteRoom(roomID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	delete(m.rooms, roomID)
	delete(m.shootingRooms, roomID)
}

// AddPlayer adds a player to a room
func (m *Manager) AddPlayer(roomID, playerID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	if room, exists := m.shootingRooms[roomID]; exists {
		room.mu.Lock()
		room.Players = append(room.Players, playerID)
		room.mu.Unlock()
		return true
	}

	room, exists := m.rooms[roomID]
	if !exists {
		return false
	}

	room.Players = append(room.Players, playerID)
	return true
}

// RemovePlayer removes a player from a room
func (m *Manager) RemovePlayer(roomID, playerID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if room, exists := m.shootingRooms[roomID]; exists {
		room.mu.Lock()
		for i, id := range room.Players {
			if id == playerID {
				room.Players = append(room.Players[:i], room.Players[i+1:]...)
				break
			}
		}
		room.mu.Unlock()
		return
	}

	room, exists := m.rooms[roomID]
	if !exists {
		return
	}

	for i, id := range room.Players {
		if id == playerID {
			room.Players = append(room.Players[:i], room.Players[i+1:]...)
			break
		}
	}
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

		room.Update(1.0 / 60.0)

		snapshot := room.GetSnapshot()

		frameCount++
		if frameCount%60 == 0 {
			elapsed := time.Since(lastLog)
			fps := float64(60) / elapsed.Seconds()
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

	log.Printf("🌊 Starting wave %d — %d enemies total", waveNum, total)
	room.StartWave(total)

	// Capture the cancel channel for THIS wave
	cancel := room.GetSpawnCancel()

	path := room.FindPathFromSpawn()
	if path == nil {
		log.Printf("⚠️ No path found for wave spawn in room %s", roomID)
		return
	}

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

			currentPath := room.FindPathFromSpawn()
			if currentPath != nil {
				path = currentPath
				room.AddEnemy(group.EnemyType, path)
				log.Printf("👾 Spawned %s enemy (%d/%d) in wave %d", group.EnemyType, i+1, group.Count, waveNum)
			} else {
				log.Printf("⚠️ Path blocked, skipping enemy %d/%d in wave %d", i+1, group.Count, waveNum)
			}

			room.DecrementEnemiesRemaining()

			// Wait before next spawn, but bail early if cancelled
			select {
			case <-cancel:
				log.Printf("🛑 Wave %d spawn cancelled during delay (new game)", waveNum)
				return
			case <-time.After(time.Duration(group.SpawnDelay * float64(time.Second))):
			}
		}
	}

	log.Printf("✅ Wave %d spawn complete", waveNum)
}

// GetBroadcastChannel returns the broadcast channel for the hub to read from
func (m *Manager) GetBroadcastChannel() <-chan BroadcastMessage {
	return m.broadcast
}
