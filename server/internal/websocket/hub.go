package websocket

import (
	"encoding/json"
	"log"
	"sync"

	"rust-rush/server/internal/game"
)

// Message types
const (
	MessageTypeJoinRoom     = "join_room"
	MessageTypeLeaveRoom    = "leave_room"
	MessageTypeGameState    = "game_state"
	MessageTypePlaceTower   = "place_tower"
	MessageTypeRemoveTower  = "remove_tower"
	MessageTypeUpgradeTower = "upgrade_tower"
	MessageTypeEvolveTower  = "evolve_tower"
	MessageTypeSetSpeed     = "set_speed"
	MessageTypeStartWave    = "start_wave"
	MessageTypePauseGame    = "pause_game"
	MessageTypeSpawnEnemy   = "spawn_enemy"
	MessageTypeNewGame      = "new_game"
)

// Message represents a WebSocket message
type Message struct {
	Type    string                 `json:"type"`
	RoomID  string                 `json:"room_id,omitempty"`
	Payload map[string]interface{} `json:"payload,omitempty"`
}

// Hub maintains active clients and broadcasts messages.
//
// clients (and each client's roomID) are accessed from several goroutines:
// the Run loop, the game-broadcast listener, and every client's readPump via
// BroadcastGameState — all map access must hold mu. client.send is closed
// ONLY by the unregister path in Run; broadcast paths drop frames on a full
// buffer instead of closing, so a slow client just skips snapshots until its
// connection dies (ping timeout) and readPump unregisters it.
type Hub struct {
	mu          sync.RWMutex
	clients     map[*Client]bool
	register    chan *Client
	unregister  chan *Client
	gameManager *game.Manager
}

// NewHub creates a new Hub
func NewHub(gameManager *game.Manager) *Hub {
	return &Hub{
		clients:     make(map[*Client]bool),
		register:    make(chan *Client),
		unregister:  make(chan *Client),
		gameManager: gameManager,
	}
}

// Run starts the hub and listens for broadcasts from the game manager
func (h *Hub) Run() {
	// Start listening to game manager broadcasts
	go h.listenToGameBroadcasts()

	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			total := len(h.clients)
			h.mu.Unlock()
			log.Printf("Client registered: %s. Total clients: %d", client.id, total)

		case client := <-h.unregister:
			h.mu.Lock()
			_, ok := h.clients[client]
			var roomID string
			if ok {
				roomID = client.roomID
				delete(h.clients, client)
				close(client.send)
			}
			total := len(h.clients)
			h.mu.Unlock()
			if ok {
				if roomID != "" {
					h.gameManager.RemovePlayer(roomID, client.id)
				}
				log.Printf("Client unregistered: %s. Total clients: %d", client.id, total)
			}
		}
	}
}

// setClientRoom updates a client's room under the hub lock, since broadcast
// paths read roomID concurrently.
func (h *Hub) setClientRoom(client *Client, roomID string) {
	h.mu.Lock()
	client.roomID = roomID
	h.mu.Unlock()
}

// listenToGameBroadcasts forwards game-loop snapshots to room members. The
// snapshot bytes are embedded verbatim via json.RawMessage — re-parsing the
// full state 60×/sec just to wrap it in an envelope was the single largest
// per-tick cost on the server.
func (h *Hub) listenToGameBroadcasts() {
	broadcastChan := h.gameManager.GetBroadcastChannel()

	for msg := range broadcastChan {
		wrappedMsg := Message{
			Type:   MessageTypeGameState,
			RoomID: msg.RoomID,
			Payload: map[string]interface{}{
				"state": json.RawMessage(msg.Data),
			},
		}

		data, err := json.Marshal(wrappedMsg)
		if err != nil {
			log.Printf("Failed to marshal wrapped game state: %v", err)
			continue
		}

		h.BroadcastToRoom(msg.RoomID, data)
	}
}

// BroadcastToRoom sends a message to all clients in a specific room. Clients
// with a full send buffer skip this frame rather than being disconnected.
func (h *Hub) BroadcastToRoom(roomID string, message []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.clients {
		if client.roomID == roomID {
			select {
			case client.send <- message:
			default:
			}
		}
	}
}

// BroadcastGameState broadcasts the current game state to all clients in a room
func (h *Hub) BroadcastGameState(roomID string) {
	room, exists := h.gameManager.GetShootingRoom(roomID)
	if !exists {
		return
	}

	msg := Message{
		Type:   MessageTypeGameState,
		RoomID: roomID,
		Payload: map[string]interface{}{
			"state": room.GetSnapshot(),
		},
	}

	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Failed to marshal game state: %v", err)
		return
	}

	h.BroadcastToRoom(roomID, data)
}
