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
	"rust-rush/server/internal/netutil"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 512 * 1024

	// sendBuffer is each client's outgoing queue. State frames may fill only
	// half of it; the other half stays free for replies (placement answers,
	// rejections), so a slow connection loses old frames before it loses
	// an answer to a click.
	sendBuffer = 64
	// stuckFrames: a client that has refused this many state frames in a row
	// (about 10 s at 60 Hz) isn't reading; drop the connection.
	stuckFrames = 600

	// Per-connection message limits (sustained rate = burst). Hover checks
	// fire once per grid cell the cursor crosses, so they get their own,
	// larger allowance.
	messagesPerSecond = 30
	checksPerSecond   = 60
)

// debugSpawnEnabled gates the spawn_enemy debug message. Off unless the
// server runs with DEBUG_SPAWN=1, so production players can't flood rooms or
// farm scores with free enemies. The join reply tells the client whether to
// show the DEBUG panel at all.
var debugSpawnEnabled = os.Getenv("DEBUG_SPAWN") == "1"

// parseOrigins reads ALLOWED_ORIGINS (comma-separated, e.g.
// "https://rust-rush.jaime.build").
func parseOrigins(raw string) map[string]bool {
	origins := make(map[string]bool)
	for _, o := range strings.Split(raw, ",") {
		if o = strings.TrimSpace(o); o != "" {
			origins[o] = true
		}
	}
	return origins
}

var allowedOrigins = parseOrigins(os.Getenv("ALLOWED_ORIGINS"))

// originAllowed is the cross-site WebSocket guard. An empty allowlist (the
// dev default) allows all origins; in production the client is served
// same-origin, so one entry matching the public URL is enough. A missing
// Origin header is a non-browser client (curl, tests): browsers always send
// it on WebSocket handshakes, so it can't be used to ride a visitor's page.
func originAllowed(allowed map[string]bool, origin string) bool {
	if len(allowed) == 0 || origin == "" {
		return true
	}
	return allowed[origin]
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return originAllowed(allowedOrigins, r.Header.Get("Origin"))
	},
}

// Client represents a WebSocket client
type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
	id   string
	// roomID is the room the server assigned; guarded by hub.mu (use
	// hub.roomOf to read it from handlers).
	roomID string
	// userID and username identify a signed-in player (0, "" = guest),
	// read from the session cookie at the handshake and fixed for the life
	// of the connection: logging in or out reconnects.
	userID   int64
	username string
	// ip and reserved: the connection slot taken in hub.reserve, released
	// on unregister.
	ip       string
	reserved bool
	// dropped counts consecutive state frames refused for a full buffer.
	dropped atomic.Int32
	// Rate limit state, touched only by readPump.
	msgBucket   *netutil.TokenBucket
	checkBucket *netutil.TokenBucket
	limited     int
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

		var msg Message
		if err := json.Unmarshal(messageBytes, &msg); err != nil {
			log.Printf("Failed to parse message: %v", err)
			continue
		}

		if !c.allow(msg.Type, time.Now()) {
			continue
		}
		c.handleMessage(&msg)
	}
}

// allow applies the per-connection rate limit. Over-limit messages are
// dropped, not queued; one log line per 100 drops keeps a flood visible
// without letting it fill the log.
func (c *Client) allow(msgType string, now time.Time) bool {
	if c.msgBucket == nil {
		c.msgBucket = netutil.NewTokenBucket(messagesPerSecond, messagesPerSecond)
		c.checkBucket = netutil.NewTokenBucket(checksPerSecond, checksPerSecond)
	}
	bucket := c.msgBucket
	if msgType == MessageTypeCheckPlacement {
		bucket = c.checkBucket
	}
	if bucket.Allow(now) {
		return true
	}
	if c.limited%100 == 0 {
		log.Printf("Client %s over the message rate limit (%d dropped)", c.id, c.limited+1)
	}
	c.limited++
	return false
}

// currentRoom returns the client's server-assigned room. Every action
// handler goes through here, so a client can only ever touch its own room.
func (c *Client) currentRoom() (string, *game.GameStateWithShooting, bool) {
	roomID := c.hub.roomOf(c)
	if roomID == "" {
		return "", nil, false
	}
	room, ok := c.hub.gameManager.GetShootingRoom(roomID)
	return roomID, room, ok
}

// reply sends a typed reply with the given payload to this client only.
func (c *Client) reply(msgType string, payload map[string]interface{}) {
	c.sendJSON(Message{Type: msgType, Payload: payload})
}

// handleMessage processes different message types. Successful actions are
// logged; the message itself isn't (check_placement alone fires once per
// hovered cell).
func (c *Client) handleMessage(msg *Message) {
	if msg.Type == MessageTypeJoinRoom {
		c.handleJoin(msg)
		return
	}
	if msg.Type == MessageTypeLeaveRoom {
		if prev := c.hub.setClientRoom(c, ""); prev != "" {
			c.hub.gameManager.RemovePlayer(prev, c.id)
		}
		return
	}

	roomID, room, ok := c.currentRoom()
	if !ok {
		return // not in a room (or it was closed): nothing to act on
	}

	switch msg.Type {
	case MessageTypePlaceTower:
		x, xOk := msg.Payload["x"].(float64)
		y, yOk := msg.Payload["y"].(float64)
		towerType, typeOk := msg.Payload["tower_type"].(string)
		if !xOk || !yOk || !typeOk {
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
			c.reply(MessageTypePlaceTower, map[string]interface{}{"status": status})
			return
		}
		c.hub.BroadcastGameState(roomID)
		c.reply(MessageTypePlaceTower, map[string]interface{}{"status": "placed", "tower": tower})

	case MessageTypeCheckPlacement:
		x, xOk := msg.Payload["x"].(float64)
		y, yOk := msg.Payload["y"].(float64)
		if !xOk || !yOk {
			return
		}
		// Echo x/y back: these fly one per hovered cell, so a reply can
		// land after the cursor has moved on and the client needs to know
		// which cell it describes.
		c.reply(MessageTypeCheckPlacement, map[string]interface{}{
			"x":           x,
			"y":           y,
			"blocks_path": room.WouldBlockPath(x, y),
		})

	case MessageTypeRemoveTower:
		towerID, ok := msg.Payload["tower_id"].(float64)
		if !ok {
			return
		}
		if refund, removed := room.RemoveTower(int(towerID)); removed {
			c.hub.BroadcastGameState(roomID)
			c.reply(MessageTypeRemoveTower, map[string]interface{}{"status": "sold", "refund": refund})
		}

	case MessageTypeUpgradeTower:
		towerID, ok := msg.Payload["tower_id"].(float64)
		if !ok {
			return
		}
		if tower, upgraded := room.UpgradeTower(int(towerID)); upgraded {
			c.hub.BroadcastGameState(roomID)
			c.reply(MessageTypeUpgradeTower, map[string]interface{}{"status": "upgraded", "tower": tower})
		} else {
			c.reply(MessageTypeUpgradeTower, map[string]interface{}{"status": "failed"})
		}

	case MessageTypeEvolveTower:
		towerID, idOk := msg.Payload["tower_id"].(float64)
		evolution, evoOk := msg.Payload["evolution"].(string)
		if !idOk || !evoOk {
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
			c.reply(MessageTypeEvolveTower, map[string]interface{}{"status": status})
			return
		}
		c.hub.BroadcastGameState(roomID)
		c.reply(MessageTypeEvolveTower, map[string]interface{}{"status": "evolved", "tower": tower})

	case MessageTypeSpawnEnemy:
		if !debugSpawnEnabled {
			return
		}
		enemyType := "basic"
		if et, ok := msg.Payload["enemy_type"].(string); ok {
			enemyType = et
		}
		// The server computes the path itself, exactly like wave spawns.
		path := room.FindPathFromSpawn()
		if path == nil {
			return
		}
		enemy := room.AddEnemy(enemyType, path, 1) // wave 1 = unscaled stats for debug spawns
		c.hub.BroadcastGameState(roomID)
		c.reply(MessageTypeSpawnEnemy, map[string]interface{}{"status": "spawned", "enemy": enemy})

	case MessageTypeSetSpeed:
		// New form: {"speed": 1|2|3}. The legacy {"fast_forward": bool} form
		// (the old binary FF toggle) still works as 1x/3x.
		if speed, ok := msg.Payload["speed"].(float64); ok {
			if room.SetSpeedMultiplier(speed) {
				c.hub.BroadcastGameState(roomID)
			}
			return
		}
		ff, _ := msg.Payload["fast_forward"].(bool)
		room.SetFastForward(ff)

	case MessageTypeStartWave:
		if room.GetPhase() != game.PhaseWaiting {
			c.reply(MessageTypeStartWave, map[string]interface{}{"status": "rejected"})
			return
		}
		go c.hub.gameManager.SpawnWave(roomID)

	case MessageTypeLoadSave:
		err := c.hub.gameManager.LoadSave(roomID, c.userID)
		status := "loaded"
		switch {
		case err == nil:
			c.hub.BroadcastGameState(roomID)
		case errors.Is(err, game.ErrNoSave):
			status = "no_save"
		case errors.Is(err, game.ErrRoomNotNew):
			status = "not_fresh"
		default:
			status = "failed"
			log.Printf("Client %s load_save: %v", c.id, err)
		}
		c.reply(MessageTypeLoadSave, map[string]interface{}{"status": status})

	case MessageTypeNewGame:
		// Optional fields: map_id selects the map (unknown/missing keeps the
		// room's current map), difficulty ("normal"|"harder") and endless
		// configure the run — both default to normal/false when absent.
		difficulty, _ := msg.Payload["difficulty"].(string)
		endless, _ := msg.Payload["endless"].(bool)
		mapID, _ := msg.Payload["map_id"].(string)
		// A fresh run replaces the account's saved one.
		if owner := room.Owner(); owner != 0 {
			c.hub.gameManager.DiscardSave(owner)
		}
		if !room.ResetToMapWithOptions(mapID, difficulty, endless) && mapID != "" {
			log.Printf("Unknown map_id %q from client %s — kept current map", mapID, c.id)
		}
		c.hub.BroadcastGameState(roomID)

	case MessageTypeContinueEndless:
		if room.ContinueEndless() {
			c.hub.BroadcastGameState(roomID)
		}

	case MessageTypePauseGame:
		paused, _ := msg.Payload["paused"].(bool)
		room.SetPaused(paused)
		// Broadcast immediately so the pause button flips at once (the
		// 60 Hz loop would also carry it, but this removes the lag).
		c.hub.BroadcastGameState(roomID)

	default:
		log.Printf("Unknown message type from client %s: %q", c.id, msg.Type)
	}
}

// handleJoin puts the client in a room. Rooms are private and server-made:
// a client can't name a room, only resume one with the code the server gave
// it at its last join (kept by that browser tab). An unknown or expired code
// silently gets a fresh room.
//
// Ownership: a room created by a signed-in player belongs to that account,
// and an account has one live room: every tab and device it opens joins
// that same game. A guest room resumed by a signed-in player is claimed by
// them (logging in mid-run keeps the run) unless they already have a live
// room. A room owned by an account can only be resumed by that account, so
// logging out (or a shared code) never hands someone else's run over.
func (c *Client) handleJoin(msg *Message) {
	manager := c.hub.gameManager

	var room *game.GameStateWithShooting
	if code, _ := msg.Payload["resume"].(string); code != "" {
		if r, ok := manager.GetShootingRoom(code); ok {
			switch owner := r.Owner(); {
			case owner == c.userID:
				room = r
			case owner == 0 && c.userID != 0:
				room = manager.ClaimRoom(r, c.userID)
			}
		}
	}
	if room == nil && c.userID != 0 {
		if r, ok := manager.RoomOfUser(c.userID); ok {
			room = r
		}
	}
	if room == nil {
		// Already in a room (a repeat join from the same connection): stay.
		if _, current, ok := c.currentRoom(); ok {
			room = current
		}
	}
	if room == nil {
		created, err := manager.CreateRoom()
		if err != nil {
			log.Printf("Client %s refused a room: %v", c.id, err)
			c.reply(MessageTypeJoinRoom, map[string]interface{}{"status": "server_full"})
			return
		}
		room = manager.ClaimRoom(created, c.userID)
		if room != created {
			manager.DeleteRoom(created.RoomID) // lost a race to another tab
		}
	}

	roomID := room.RoomID
	if prev := c.hub.setClientRoom(c, roomID); prev != "" && prev != roomID {
		manager.RemovePlayer(prev, c.id)
	}
	manager.AddPlayer(roomID, c.id)

	c.sendJSON(Message{
		Type:   MessageTypeJoinRoom,
		RoomID: roomID,
		Payload: map[string]interface{}{
			"status":      "joined",
			"clientId":    c.id,
			"room_code":   roomID,
			"debug_spawn": debugSpawnEnabled,
			"user":        c.usernameOrNil(),
			"save":        c.saveSummaryOrNil(),
			"state":       room.GetSnapshot(),
		},
	})
}

// saveSummaryOrNil is the join reply's "save" field: the signed-in
// player's saved run (map, wave, when), or null.
func (c *Client) saveSummaryOrNil() interface{} {
	if c.userID == 0 {
		return nil
	}
	if s, ok := c.hub.gameManager.SavedRunSummary(c.userID); ok {
		return s
	}
	return nil
}

// usernameOrNil is the join reply's "user" field: the signed-in name, or
// JSON null for a guest.
func (c *Client) usernameOrNil() interface{} {
	if c.userID == 0 {
		return nil
	}
	return c.username
}

// sendJSON sends a reply to this client. Replies may use the whole buffer;
// state frames only half (see offerFrame).
func (c *Client) sendJSON(msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Failed to marshal message: %v", err)
		return
	}

	select {
	case c.send <- data:
	default:
		log.Printf("Client %s send buffer full, reply dropped", c.id)
	}
}

// offerFrame queues a state frame unless the buffer is already half full.
// Frames are superseded 60 times a second, so dropping one costs nothing; the
// free half keeps room for replies. A client that refuses stuckFrames in a
// row isn't reading at all, and its connection is closed (readPump then
// unregisters it). Called under the hub's read lock from several
// goroutines; close and the counter are both safe for that.
func (c *Client) offerFrame(frame []byte) {
	if len(c.send) < cap(c.send)/2 {
		select {
		case c.send <- frame:
			c.dropped.Store(0)
			return
		default:
		}
	}
	if c.dropped.Add(1) == stuckFrames && c.conn != nil {
		log.Printf("Client %s stopped reading, disconnecting", c.id)
		c.conn.Close()
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

// ServeWs handles WebSocket requests from clients. The connection caps are
// checked before the upgrade, so a refused connection costs nothing.
func ServeWs(hub *Hub, w http.ResponseWriter, r *http.Request) {
	ip := netutil.ClientIP(r)
	if ok, reason := hub.reserve(ip); !ok {
		log.Printf("WebSocket refused for %s: %s", ip, reason)
		http.Error(w, reason, http.StatusServiceUnavailable)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		hub.mu.Lock()
		hub.releaseLocked(ip)
		hub.mu.Unlock()
		log.Println(err)
		return
	}

	userID, username := hub.whoIs(r)
	client := &Client{
		hub:      hub,
		conn:     conn,
		send:     make(chan []byte, sendBuffer),
		id:       generateClientID(),
		userID:   userID,
		username: username,
		ip:       ip,
		reserved: true,
	}

	client.hub.register <- client

	go client.writePump()
	go client.readPump()
}

// clientIDCounter disambiguates connections; the old timestamp-only format
// gave every connection in the same wall-clock second an identical ID.
var clientIDCounter atomic.Uint64

func generateClientID() string {
	return fmt.Sprintf("client-%s-%d", time.Now().Format("20060102150405"), clientIDCounter.Add(1))
}
