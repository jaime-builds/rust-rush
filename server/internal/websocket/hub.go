package websocket

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"rust-rush/server/internal/game"

	"github.com/gorilla/websocket"
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
	// continue_endless: from the victory phase, keep the current run going
	// past the win wave (flips the room to Endless; nothing resets).
	MessageTypeContinueEndless = "continue_endless"
	// check_placement: read-only hover query — "would a tower on this cell
	// seal the spawn→goal lane?". Answered to the asking client only, so
	// the placement ghost can warn before the click. Advisory: AddTower
	// re-checks and is the actual gate.
	MessageTypeCheckPlacement = "check_placement"
	// load_save: continue the signed-in player's saved run in this (fresh)
	// room. Replies with the outcome; the state follows as usual.
	MessageTypeLoadSave = "load_save"
)

// Connection limits (Jaime's defaults, 2026-11-03).
const (
	DefaultMaxConnections = 100
	DefaultMaxPerIP       = 5
)

// Message represents a WebSocket message. RoomID is only ever set by the
// server (on replies and state frames); a room_id sent by a client is
// ignored — every handler acts on the room the server assigned at join.
type Message struct {
	Type    string                 `json:"type"`
	RoomID  string                 `json:"room_id,omitempty"`
	Payload map[string]interface{} `json:"payload,omitempty"`
}

// Hub tracks connected clients, which room each is in, and per-IP counts.
//
// All maps and each client's roomID are guarded by mu. client.send is closed
// ONLY by the unregister path in Run; broadcast paths drop frames on a full
// buffer instead of closing (see Client.offerFrame).
type Hub struct {
	mu          sync.RWMutex
	clients     map[*Client]bool
	rooms       map[string]map[*Client]struct{}
	perIP       map[string]int
	reserved    int // connections admitted by reserve, released on unregister
	maxConns    int
	maxPerIP    int
	register    chan *Client
	unregister  chan *Client
	gameManager *game.Manager
	// identify resolves a WebSocket handshake to an account (0, "" for a
	// guest). Set by main when accounts are enabled.
	identify func(r *http.Request) (userID int64, username string)
}

// SetIdentify installs the account lookup used at each handshake.
func (h *Hub) SetIdentify(f func(r *http.Request) (int64, string)) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.identify = f
}

func (h *Hub) whoIs(r *http.Request) (int64, string) {
	h.mu.RLock()
	f := h.identify
	h.mu.RUnlock()
	if f == nil {
		return 0, ""
	}
	return f(r)
}

// DisconnectUser closes every open connection of an account (it was
// deleted). The tabs reconnect as guests.
func (h *Hub) DisconnectUser(userID int64) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.clients {
		if client.userID == userID && client.conn != nil {
			client.conn.Close()
		}
	}
}

// NewHub creates a Hub and makes it the game manager's snapshot sink.
func NewHub(gameManager *game.Manager) *Hub {
	h := &Hub{
		clients:     make(map[*Client]bool),
		rooms:       make(map[string]map[*Client]struct{}),
		perIP:       make(map[string]int),
		maxConns:    DefaultMaxConnections,
		maxPerIP:    DefaultMaxPerIP,
		register:    make(chan *Client),
		unregister:  make(chan *Client),
		gameManager: gameManager,
	}
	gameManager.SetSnapshotSink(h.broadcastSnapshot)
	return h
}

// SetLimits overrides the connection caps (tests). Call before serving.
func (h *Hub) SetLimits(maxConns, maxPerIP int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.maxConns = maxConns
	h.maxPerIP = maxPerIP
}

// reserve admits one more connection from ip, or reports which cap it hit.
// Called synchronously before the WebSocket upgrade so a refused connection
// costs nothing; released by the unregister path.
func (h *Hub) reserve(ip string) (ok bool, reason string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.reserved >= h.maxConns {
		return false, "server_full"
	}
	if h.perIP[ip] >= h.maxPerIP {
		return false, "too_many_connections"
	}
	h.reserved++
	h.perIP[ip]++
	return true, ""
}

// releaseLocked undoes reserve. Caller holds mu.
func (h *Hub) releaseLocked(ip string) {
	h.reserved--
	if h.perIP[ip]--; h.perIP[ip] <= 0 {
		delete(h.perIP, ip)
	}
}

// Run processes registrations and unregistrations.
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			_, ok := h.clients[client]
			var roomID string
			if ok {
				roomID = client.roomID
				h.leaveRoomLocked(client)
				delete(h.clients, client)
				close(client.send)
				if client.reserved {
					h.releaseLocked(client.ip)
				}
			}
			h.mu.Unlock()
			if ok && roomID != "" {
				h.gameManager.RemovePlayer(roomID, client.id)
			}
		}
	}
}

// ClientCount returns the number of open connections.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// PlayerCount returns how many connections are in a game — the
// "concurrent players" stat. Open tabs that never joined don't count.
func (h *Hub) PlayerCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	n := 0
	for _, members := range h.rooms {
		n += len(members)
	}
	return n
}

// setClientRoom moves a client to roomID ("" = no room) under the hub lock,
// since broadcast paths read the room index concurrently. It returns the
// room the client was in before, so the caller can drop it from that
// room's player list.
func (h *Hub) setClientRoom(client *Client, roomID string) (previous string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	previous = client.roomID
	h.leaveRoomLocked(client)
	client.roomID = roomID
	if roomID != "" {
		members := h.rooms[roomID]
		if members == nil {
			members = make(map[*Client]struct{})
			h.rooms[roomID] = members
		}
		members[client] = struct{}{}
	}
	return previous
}

// leaveRoomLocked removes the client from its room's index. Caller holds mu.
func (h *Hub) leaveRoomLocked(client *Client) {
	if client.roomID == "" {
		return
	}
	if members := h.rooms[client.roomID]; members != nil {
		delete(members, client)
		if len(members) == 0 {
			delete(h.rooms, client.roomID)
		}
	}
	client.roomID = ""
}

// roomOf returns the client's current room ID under the lock.
func (h *Hub) roomOf(client *Client) string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return client.roomID
}

// stateFrame wraps marshalled snapshot bytes in the game_state envelope. The
// snapshot is spliced in verbatim: re-encoding it through json.Marshal (even
// as a RawMessage, which gets re-validated) was a measurable per-tick cost.
func stateFrame(roomID string, snapshot []byte) []byte {
	id, _ := json.Marshal(roomID) // a string never fails to marshal
	frame := make([]byte, 0, len(snapshot)+len(id)+64)
	frame = append(frame, `{"type":"game_state","room_id":`...)
	frame = append(frame, id...)
	frame = append(frame, `,"payload":{"state":`...)
	frame = append(frame, snapshot...)
	frame = append(frame, `}}`...)
	return frame
}

// broadcastSnapshot is the game manager's per-tick sink: it runs on the
// room's own loop goroutine, builds the frame once, and offers it to that
// room's members only.
func (h *Hub) broadcastSnapshot(roomID string, snapshot []byte) {
	h.BroadcastToRoom(roomID, stateFrame(roomID, snapshot))
}

// BroadcastToRoom sends a state frame to every client in a room. A client
// whose buffer is full skips the frame (see Client.offerFrame).
func (h *Hub) BroadcastToRoom(roomID string, message []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.rooms[roomID] {
		client.offerFrame(message)
	}
}

// BroadcastGameState sends the room's current state to its members right
// away (after an action), instead of waiting for the next tick.
func (h *Hub) BroadcastGameState(roomID string) {
	room, exists := h.gameManager.GetShootingRoom(roomID)
	if !exists {
		return
	}
	data, err := json.Marshal(room.GetSnapshot())
	if err != nil {
		log.Printf("Failed to marshal game state: %v", err)
		return
	}
	h.BroadcastToRoom(roomID, stateFrame(roomID, data))
}

// CloseAll sends every open connection a "service restart" close frame and
// closes it (graceful shutdown). The client treats that like any other drop
// and reconnects, resuming its room if the server comes back within the
// grace period (it won't across a restart: rooms live in memory).
func (h *Hub) CloseAll() {
	h.mu.RLock()
	defer h.mu.RUnlock()
	deadline := time.Now().Add(time.Second)
	msg := websocket.FormatCloseMessage(websocket.CloseServiceRestart, "server restarting")
	for client := range h.clients {
		if client.conn == nil {
			continue
		}
		client.conn.WriteControl(websocket.CloseMessage, msg, deadline)
		client.conn.Close()
	}
}

// MessageTypeAchievement tells a signed-in player's open tabs that an
// achievement just unlocked (payload: id, name, description).
const MessageTypeAchievement = "achievement"

// SendToUser sends a message to every open connection of an account.
func (h *Hub) SendToUser(userID int64, msg Message) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.clients {
		if client.userID == userID {
			client.sendJSON(msg)
		}
	}
}
