package websocket

import (
	"encoding/json"
	"log"
	"net/http"
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

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins in development
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
			c.roomID = msg.RoomID

			// Create a shooting room if it doesn't exist
			_, exists := c.hub.gameManager.GetShootingRoom(msg.RoomID)
			if !exists {
				room := c.hub.gameManager.CreateShootingRoom(msg.RoomID)

				// Start game loop for this room
				go c.hub.gameManager.StartGameLoop(msg.RoomID)

				log.Printf("Created new shooting room: %s", msg.RoomID)

				// Set spawn and goal points
				room.SpawnPoint = &game.Position{X: 0, Y: 7}
				room.GoalPoint = &game.Position{X: 19, Y: 7}
			}

			c.hub.gameManager.AddPlayer(msg.RoomID, c.id)

			// Send confirmation with current game state
			room, _ := c.hub.gameManager.GetShootingRoom(msg.RoomID)
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
			c.roomID = ""
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

		// Add tower to game state (deducts gold)
		tower, ok := room.AddTower(x, y, towerType)
		if !ok {
			log.Printf("Client %s cannot afford %s tower", c.id, towerType)
			response := Message{
				Type: MessageTypePlaceTower,
				Payload: map[string]interface{}{
					"status": "insufficient_funds",
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

		// Extract enemy type and path
		enemyType := "basic"
		if et, ok := msg.Payload["enemy_type"].(string); ok {
			enemyType = et
		}

		// Get path from payload
		var path []game.Position
		if pathData, ok := msg.Payload["path"].([]interface{}); ok {
			for _, p := range pathData {
				if posMap, ok := p.(map[string]interface{}); ok {
					x, xOk := posMap["x"].(float64)
					y, yOk := posMap["y"].(float64)
					if xOk && yOk {
						path = append(path, game.Position{X: x, Y: y})
					}
				}
			}
		}

		// If no path provided, use a default path
		if len(path) == 0 {
			if room.SpawnPoint != nil && room.GoalPoint != nil {
				path = []game.Position{
					*room.SpawnPoint,
					*room.GoalPoint,
				}
			}
		}

		if len(path) > 0 {
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
		}

	case MessageTypeClearAll:
		// Use room_id from message if provided, otherwise use client's stored roomID
		roomID := msg.RoomID
		if roomID == "" {
			roomID = c.roomID
		}

		if roomID == "" {
			log.Printf("Client %s tried to clear all but is not in a room", c.id)
			return
		}

		room, exists := c.hub.gameManager.GetShootingRoom(roomID)
		if !exists {
			log.Printf("Room %s does not exist", roomID)
			return
		}

		// Clear towers and enemies
		room.RemoveAllTowers()
		room.RemoveAllEnemies()

		log.Printf("Cleared all towers and enemies in room %s", roomID)

		// Broadcast updated state
		c.hub.BroadcastGameState(roomID)

		// Send acknowledgment
		response := Message{
			Type: MessageTypeClearAll,
			Payload: map[string]interface{}{
				"status": "cleared",
			},
		}
		c.sendJSON(response)

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

		room.Reset()
		log.Printf("🔄 New game started in room %s", roomID)
		c.hub.BroadcastGameState(roomID)

	case MessageTypePauseGame:
		log.Printf("Pause game request from client %s", c.id)
		// TODO: Pause game logic

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

func generateClientID() string {
	return "client-" + time.Now().Format("20060102150405999")
}
