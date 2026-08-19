package websocket

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"time"

	"rust-rush/server/internal/game"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 512 * 1024
)

// allowedOrigins comes from the ALLOWED_ORIGINS env var (comma-separated,
// e.g. "https://rust-rush.jaime.build"). Empty (the dev default) allows all
// origins; in production the client is served same-origin by this server, so
// a single entry matching the public URL is enough.
var allowedOrigins = func() map[string]bool {
	origins := make(map[string]bool)
	for _, o := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			origins[o] = true
		}
	}
	return origins
}()

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		if len(allowedOrigins) == 0 {
			return true // no ALLOWED_ORIGINS configured — dev mode, allow all
		}
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true // non-browser client (curl, tests)
		}
		return allowedOrigins[origin]
	},
}

// Client represents a WebSocket client
type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan []byte
	id     string
	roomID string
}

// readPump pumps messages from the WebSocket connection to the hub
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, messageBytes, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("error: %v", err)
			}
			break
		}

		// Parse the message
		var msg Message
		if err := json.Unmarshal(messageBytes, &msg); err != nil {
			log.Printf("Failed to parse message: %v", err)
			continue
		}

		// Handle the message
		c.handleMessage(&msg)
	}
}

// handleMessage processes different message types
func (c *Client) handleMessage(msg *Message) {
	log.Printf("Client %s received message type: %s", c.id, msg.Type)

	switch msg.Type {
	case MessageTypeJoinRoom:
		if msg.RoomID != "" {
			c.hub.setClientRoom(c, msg.RoomID)

			// Check-and-create is atomic so two clients joining at once can't
			// create duplicate rooms (each with its own 60 FPS game loop).
			room, created := c.hub.gameManager.GetOrCreateShootingRoom(msg.RoomID)
			if created {
				room.SetSpawnGoal(game.Position{X: 0, Y: 7}, game.Position{X: 19, Y: 7})
				go c.hub.gameManager.StartGameLoop(msg.RoomID)
				log.Printf("Created new shooting room: %s", msg.RoomID)
			}

			c.hub.gameManager.AddPlayer(msg.RoomID, c.id)

			// Send confirmation with current game state
			snapshot := room.GetSnapshot()

			response := Message{
				Type:   MessageTypeJoinRoom,
				RoomID: msg.RoomID,
				Payload: map[string]interface{}{
					"status":   "joined",
					"clientId": c.id,
					"state":    snapshot,
				},
			}
			c.sendJSON(response)

			log.Printf("Client %s joined shooting room %s", c.id, msg.RoomID)
		}

	case MessageTypeLeaveRoom:
		if c.roomID != "" {
			c.hub.gameManager.RemovePlayer(c.roomID, c.id)
			c.hub.setClientRoom(c, "")
		}

	case MessageTypePlaceTower:
		// Use room_id from message if provided, otherwise use client's stored roomID
		roomID := msg.RoomID
		if roomID == "" {
			roomID = c.roomID
		}

		if roomID == "" {
			log.Printf("Client %s tried to place tower but is not in a room", c.id)
			return
		}

		// Extract tower placement data
		x, xOk := msg.Payload["x"].(float64)
		y, yOk := msg.Payload["y"].(float64)
		towerType, typeOk := msg.Payload["tower_type"].(string)

		if !xOk || !yOk || !typeOk {
			log.Printf("Invalid tower placement data: %v", msg.Payload)
			return
		}

		room, exists := c.hub.gameManager.GetShootingRoom(roomID)
		if !exists {
			log.Printf("Room %s does not exist", roomID)
			return
		}

		// Add tower to game state (validates placement, deducts gold)
		tower, err := room.AddTower(x, y, towerType)
		if err != nil {
			status := "invalid_placement"
			if errors.Is(err, game.ErrInsufficientGold) {
				status = "insufficient_funds"
			} else if errors.Is(err, game.ErrPathBlocked) {
				status = "path_blocked"
			}
			log.Printf("Client %s tower placement rejected (%s at %.0f,%.0f): %v", c.id, towerType, x, y, err)
			response := Message{
				Type: MessageTypePlaceTower,
				Payload: map[string]interface{}{
					"status": status,
				},
			}
			c.sendJSON(response)
			return
		}

		log.Printf("Placed %s tower at (%.1f, %.1f) in room %s", towerType, x, y, roomID)

		// Broadcast updated state immediately
		c.hub.BroadcastGameState(roomID)

		// Send acknowledgment
		response := Message{
			Type: MessageTypePlaceTower,
			Payload: map[string]interface{}{
				"status": "placed",
				"tower":  tower,
			},
		}
		c.sendJSON(response)

	case MessageTypeCheckPlacement:
		roomID := msg.RoomID
		if roomID == "" {
			roomID = c.roomID
		}
		if roomID == "" {
			return
		}
		room, exists := c.hub.gameManager.GetShootingRoom(roomID)
		if !exists {
			return
		}
		x, xOk := msg.Payload["x"].(float64)
		y, yOk := msg.Payload["y"].(float64)
		if !xOk || !yOk {
			log.Printf("Invalid check_placement data: %v", msg.Payload)
			return
		}
		// Echo x/y back: these fly one per hovered cell, so a reply can
		// land after the cursor has moved on and the client needs to know
		// which cell it describes. Success is deliberately not logged — one
		// line per cell crossed would drown the log.
		c.sendJSON(Message{
			Type: MessageTypeCheckPlacement,
			Payload: map[string]interface{}{
				"x":           x,
				"y":           y,
				"blocks_path": room.WouldBlockPath(x, y),
			},
		})

	case MessageTypeRemoveTower:
		roomID := msg.RoomID
		if roomID == "" {
			roomID = c.roomID
		}
		if roomID == "" {
			return
		}
		room, exists := c.hub.gameManager.GetShootingRoom(roomID)
		if !exists {
			return
		}
		towerID, ok := msg.Payload["tower_id"].(float64)
		if !ok {
			log.Printf("Invalid tower_id in remove_tower: %v", msg.Payload)
			return
		}
		refund, removed := room.RemoveTower(int(towerID))
		if removed {
			log.Printf("Sold tower %d for $%d in room %s", int(towerID), refund, roomID)
			c.hub.BroadcastGameState(roomID)
			c.sendJSON(Message{
				Type: MessageTypeRemoveTower,
				Payload: map[string]interface{}{
					"status": "sold",
					"refund": refund,
				},
			})
		}

	case MessageTypeUpgradeTower:
		roomID := msg.RoomID
		if roomID == "" {
			roomID = c.roomID
		}
		if roomID == "" {
			return
		}
		room, exists := c.hub.gameManager.GetShootingRoom(roomID)
		if !exists {
			return
		}
		towerID, ok := msg.Payload["tower_id"].(float64)
		if !ok {
			log.Printf("Invalid tower_id in upgrade_tower: %v", msg.Payload)
			return
		}
		tower, upgraded := room.UpgradeTower(int(towerID))
		if upgraded {
			log.Printf("Upgraded tower %d to level %d in room %s", int(towerID), tower.Level, roomID)
			c.hub.BroadcastGameState(roomID)
			c.sendJSON(Message{
				Type: MessageTypeUpgradeTower,
				Payload: map[string]interface{}{
					"status": "upgraded",
					"tower":  tower,
				},
			})
		} else {
			c.sendJSON(Message{
				Type: MessageTypeUpgradeTower,
				Payload: map[string]interface{}{
					"status": "failed",
				},
			})
		}

	case MessageTypeEvolveTower:
		roomID := msg.RoomID
		if roomID == "" {
			roomID = c.roomID
		}
		if roomID == "" {
			return
		}
		room, exists := c.hub.gameManager.GetShootingRoom(roomID)
		if !exists {
			return
		}
		towerID, idOk := msg.Payload["tower_id"].(float64)
		evolution, evoOk := msg.Payload["evolution"].(string)
		if !idOk || !evoOk {
			log.Printf("Invalid evolve_tower payload: %v", msg.Payload)
			return
		}
		tower, err := room.EvolveTower(int(towerID), evolution)
		if err != nil {
			status := "failed"
			switch {
			case errors.Is(err, game.ErrNotMaxLevel):
				status = "not_max_level"
			case errors.Is(err, game.ErrAlreadyEvolved):
				status = "already_evolved"
			case errors.Is(err, game.ErrInsufficientGold):
				status = "insufficient_funds"
			case errors.Is(err, game.ErrInvalidEvolution):
				status = "invalid_evolution"
			}
			log.Printf("Client %s evolution rejected (tower %d → %s): %v", c.id, int(towerID), evolution, err)
			c.sendJSON(Message{
				Type: MessageTypeEvolveTower,
				Payload: map[string]interface{}{
					"status": status,
				},
			})
			return
		}
		log.Printf("⚡ Evolved tower %d into %s in room %s", int(towerID), evolution, roomID)
		c.hub.BroadcastGameState(roomID)
		c.sendJSON(Message{
			Type: MessageTypeEvolveTower,
			Payload: map[string]interface{}{
				"status": "evolved",
				"tower":  tower,
			},
		})

	case MessageTypeSpawnEnemy:
		// Use room_id from message if provided, otherwise use client's stored roomID
		roomID := msg.RoomID
		if roomID == "" {
			roomID = c.roomID
		}

		if roomID == "" {
			log.Printf("Client %s tried to spawn enemy but is not in a room", c.id)
			return
		}

		room, exists := c.hub.gameManager.GetShootingRoom(roomID)
		if !exists {
			log.Printf("Room %s does not exist", roomID)
			return
		}

		// Extract enemy type
		enemyType := "basic"
		if et, ok := msg.Payload["enemy_type"].(string); ok {
			enemyType = et
		}

		// The server computes the path itself, exactly like wave spawns —
		// client-supplied paths were trusted verbatim (and the old no-path
		// fallback was a straight spawn→goal line through the maze).
		path := room.FindPathFromSpawn()
		if path == nil {
			log.Printf("Debug spawn skipped in room %s — path blocked", roomID)
			return
		}

		enemy := room.AddEnemy(enemyType, path, 1) // wave 1 = unscaled stats for debug spawns
		log.Printf("Spawned %s enemy with ID %d in room %s", enemyType, enemy.ID, roomID)

		// Broadcast updated state
		c.hub.BroadcastGameState(roomID)

		// Send acknowledgment
		response := Message{
			Type: MessageTypeSpawnEnemy,
			Payload: map[string]interface{}{
				"status": "spawned",
				"enemy":  enemy,
			},
		}
		c.sendJSON(response)

	case MessageTypeSetSpeed:
		roomID := msg.RoomID
		if roomID == "" {
			roomID = c.roomID
		}
		if roomID == "" {
			return
		}
		room, exists := c.hub.gameManager.GetShootingRoom(roomID)
		if !exists {
			return
		}
		// New form: {"speed": 1|2|3}. The legacy {"fast_forward": bool} form
		// (the old binary FF toggle) still works as 1x/3x.
		if speed, ok := msg.Payload["speed"].(float64); ok {
			if room.SetSpeedMultiplier(speed) {
				log.Printf("⏩ Speed set to %.0fx in room %s", speed, roomID)
				c.hub.BroadcastGameState(roomID)
			} else {
				log.Printf("Invalid speed %v from client %s — ignored", speed, c.id)
			}
			return
		}
		ff, _ := msg.Payload["fast_forward"].(bool)
		room.SetFastForward(ff)
		log.Printf("⏩ Fast forward: %v in room %s", ff, roomID)

	case MessageTypeStartWave:
		roomID := msg.RoomID
		if roomID == "" {
			roomID = c.roomID
		}

		if roomID == "" {
			log.Printf("Client %s tried to start wave but is not in a room", c.id)
			return
		}

		room, exists := c.hub.gameManager.GetShootingRoom(roomID)
		if !exists {
			return
		}

		// Only allow starting a wave in waiting phase
		if room.GetPhase() != game.PhaseWaiting {
			log.Printf("Client %s tried to start wave but game is not in waiting phase", c.id)
			return
		}

		log.Printf("🌊 Client %s starting wave in room %s", c.id, roomID)
		go c.hub.gameManager.SpawnWave(roomID)

	case MessageTypeNewGame:
		roomID := msg.RoomID
		if roomID == "" {
			roomID = c.roomID
		}

		if roomID == "" {
			return
		}

		room, exists := c.hub.gameManager.GetShootingRoom(roomID)
		if !exists {
			return
		}

		// Optional fields: map_id selects the map (unknown/missing keeps the
		// room's current map), difficulty ("normal"|"harder") and endless
		// configure the run — both default to normal/false when absent, so
		// pre-progression clients keep exactly the old behavior.
		difficulty, _ := msg.Payload["difficulty"].(string)
		endless, _ := msg.Payload["endless"].(bool)
		if mapID, ok := msg.Payload["map_id"].(string); ok && mapID != "" {
			if !room.ResetToMapWithOptions(mapID, difficulty, endless) {
				log.Printf("⚠️ Unknown map_id %q from client %s — kept current map", mapID, c.id)
			} else {
				log.Printf("🗺️ Room %s switched to map %s", roomID, mapID)
			}
		} else {
			room.ResetToMapWithOptions("", difficulty, endless)
		}
		log.Printf("🔄 New game started in room %s (difficulty=%s endless=%v)", roomID, room.GetSnapshot().Difficulty, endless)
		c.hub.BroadcastGameState(roomID)

	case MessageTypeContinueEndless:
		roomID := msg.RoomID
		if roomID == "" {
			roomID = c.roomID
		}
		if roomID == "" {
			return
		}
		room, exists := c.hub.gameManager.GetShootingRoom(roomID)
		if !exists {
			return
		}
		if room.ContinueEndless() {
			log.Printf("♾️ Room %s continuing past the win wave in Endless", roomID)
			c.hub.BroadcastGameState(roomID)
		} else {
			log.Printf("Client %s sent continue_endless outside the victory phase — ignored", c.id)
		}

	case MessageTypePauseGame:
		roomID := msg.RoomID
		if roomID == "" {
			roomID = c.roomID
		}
		if roomID == "" {
			return
		}
		room, exists := c.hub.gameManager.GetShootingRoom(roomID)
		if !exists {
			return
		}
		paused, _ := msg.Payload["paused"].(bool)
		room.SetPaused(paused)
		if paused {
			log.Printf("⏸ Game paused in room %s by client %s", roomID, c.id)
		} else {
			log.Printf("▶ Game resumed in room %s by client %s", roomID, c.id)
		}
		// Broadcast immediately so every client's pause button flips at once
		// (the 60 Hz loop would also carry it, but this removes the lag).
		c.hub.BroadcastGameState(roomID)

	default:
		log.Printf("Unknown message type: %s", msg.Type)
	}
}

// sendJSON sends a JSON message to the client
func (c *Client) sendJSON(msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Failed to marshal message: %v", err)
		return
	}

	select {
	case c.send <- data:
	default:
		log.Printf("Client %s send buffer full", c.id)
	}
}

// writePump pumps messages from the hub to the WebSocket connection
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// ServeWs handles WebSocket requests from clients
func ServeWs(hub *Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}

	client := &Client{
		hub:  hub,
		conn: conn,
		send: make(chan []byte, 256),
		id:   generateClientID(),
	}

	client.hub.register <- client

	// Start goroutines for reading and writing
	go client.writePump()
	go client.readPump()
}

// clientIDCounter disambiguates connections; the old timestamp-only format
// ("...05999" — the bare 999 is a literal, not fractional seconds) gave every
// connection in the same wall-clock second an identical ID.
var clientIDCounter atomic.Uint64

func generateClientID() string {
	return fmt.Sprintf("client-%s-%d", time.Now().Format("20060102150405"), clientIDCounter.Add(1))
}
