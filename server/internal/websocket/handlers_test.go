package websocket

import (
	"encoding/json"
	"testing"
	"time"

	"rust-rush/server/internal/game"
)

// newHubClient returns a hub over a fresh manager and a socket-less client on
// it. Replies land in the client's buffered send channel.
func newHubClient(t *testing.T) (*Hub, *Client) {
	t.Helper()
	hub := NewHub(game.NewManager())
	return hub, newClientOn(hub, "c1")
}

func newClientOn(hub *Hub, id string) *Client {
	return &Client{hub: hub, id: id, send: make(chan []byte, sendBuffer)}
}

// nextReply pops the next queued message of the given type, skipping state
// frames, or fails.
func nextReply(t *testing.T, c *Client, msgType string) Message {
	t.Helper()
	for {
		select {
		case raw := <-c.send:
			var m Message
			if err := json.Unmarshal(raw, &m); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if m.Type == msgType {
				return m
			}
		default:
			t.Fatalf("no %s reply queued", msgType)
			return Message{}
		}
	}
}

// noReply asserts that no message of msgType is queued.
func noReply(t *testing.T, c *Client, msgType string) {
	t.Helper()
	for {
		select {
		case raw := <-c.send:
			var m Message
			_ = json.Unmarshal(raw, &m)
			if m.Type == msgType {
				t.Fatalf("unexpected %s reply: %s", msgType, raw)
			}
		default:
			return
		}
	}
}

// join sends join_room (optionally resuming a code) and returns the code.
func join(t *testing.T, c *Client, resume string) string {
	t.Helper()
	msg := &Message{Type: MessageTypeJoinRoom, RoomID: "game-1"}
	if resume != "" {
		msg.Payload = map[string]interface{}{"resume": resume}
	}
	c.handleMessage(msg)
	reply := nextReply(t, c, MessageTypeJoinRoom)
	if reply.Payload["status"] != "joined" {
		t.Fatalf("join status = %v, want joined", reply.Payload["status"])
	}
	code, _ := reply.Payload["room_code"].(string)
	if len(code) != 32 {
		t.Fatalf("room_code = %q, want a 32-char server-issued code", code)
	}
	return code
}

func closeRoom(hub *Hub, code string) { hub.gameManager.DeleteRoom(code) }

// Every visitor gets a private room, whatever room_id the client sends.
func TestJoinCreatesPrivateRooms(t *testing.T) {
	hub, a := newHubClient(t)
	b := newClientOn(hub, "c2")
	codeA := join(t, a, "")
	codeB := join(t, b, "")
	defer closeRoom(hub, codeA)
	defer closeRoom(hub, codeB)

	if codeA == codeB {
		t.Fatal("two visitors were put in the same room")
	}
	if n := hub.gameManager.RoomCount(); n != 2 {
		t.Errorf("RoomCount = %d, want 2", n)
	}
	if _, exists := hub.gameManager.GetShootingRoom("game-1"); exists {
		t.Error("the client-named room game-1 was created")
	}
}

// The code from a join brings a new connection back into the same room; an
// unknown code gets a fresh room instead of an error.
func TestJoinResumesWithCode(t *testing.T) {
	hub, a := newHubClient(t)
	code := join(t, a, "")
	defer closeRoom(hub, code)

	room, _ := hub.gameManager.GetShootingRoom(code)
	if _, err := room.AddTower(5, 5, "basic"); err != nil {
		t.Fatalf("AddTower: %v", err)
	}

	again := newClientOn(hub, "c1-reconnected")
	if got := join(t, again, code); got != code {
		t.Fatalf("resume joined %s, want %s", got, code)
	}
	if n := len(room.GetSnapshot().Towers); n != 1 {
		t.Errorf("resumed room has %d towers, want the 1 placed before", n)
	}

	stranger := newClientOn(hub, "c3")
	other := join(t, stranger, "0123456789abcdef0123456789abcdef")
	defer closeRoom(hub, other)
	if other == code {
		t.Error("an unknown resume code landed in an existing room")
	}
}

// RR-12: repeat joins don't grow the player list, and switching rooms leaves
// the old one.
func TestRepeatJoinKeepsOnePlayerEntry(t *testing.T) {
	hub, a := newHubClient(t)
	code := join(t, a, "")
	defer closeRoom(hub, code)
	for i := 0; i < 3; i++ {
		if got := join(t, a, ""); got != code {
			t.Fatalf("repeat join moved the client to %s", got)
		}
	}
	room, _ := hub.gameManager.GetShootingRoom(code)
	if n := len(room.GetSnapshot().Players); n != 1 {
		t.Fatalf("players = %d after repeat joins, want 1", n)
	}

	b := newClientOn(hub, "c2")
	codeB := join(t, b, "")
	defer closeRoom(hub, codeB)
	join(t, a, codeB) // a moves into b's room
	if n := len(room.GetSnapshot().Players); n != 0 {
		t.Errorf("old room still lists %d players after the switch", n)
	}
	roomB, _ := hub.gameManager.GetShootingRoom(codeB)
	if n := len(roomB.GetSnapshot().Players); n != 2 {
		t.Errorf("new room lists %d players, want 2", n)
	}
}

// RR-02: a room_id in an action message is ignored; actions hit only the
// room the server assigned.
func TestClientRoomIDIsIgnored(t *testing.T) {
	hub, a := newHubClient(t)
	b := newClientOn(hub, "c2")
	codeA := join(t, a, "")
	codeB := join(t, b, "")
	defer closeRoom(hub, codeA)
	defer closeRoom(hub, codeB)

	a.handleMessage(&Message{Type: MessageTypePlaceTower, RoomID: codeB,
		Payload: map[string]interface{}{"x": 5.0, "y": 5.0, "tower_type": "basic"}})
	a.handleMessage(&Message{Type: MessageTypePauseGame, RoomID: codeB,
		Payload: map[string]interface{}{"paused": true}})

	roomA, _ := hub.gameManager.GetShootingRoom(codeA)
	roomB, _ := hub.gameManager.GetShootingRoom(codeB)
	if n := len(roomB.GetSnapshot().Towers); n != 0 || roomB.IsPaused() {
		t.Errorf("room B was changed by a client in room A (towers=%d paused=%v)", n, roomB.IsPaused())
	}
	if n := len(roomA.GetSnapshot().Towers); n != 1 || !roomA.IsPaused() {
		t.Errorf("room A missed its own actions (towers=%d paused=%v)", n, roomA.IsPaused())
	}
}

// RR-01: the room cap refuses new rooms with a server_full reply.
func TestJoinRefusedAtRoomCap(t *testing.T) {
	hub, a := newHubClient(t)
	hub.gameManager.SetLimits(1, time.Minute)
	code := join(t, a, "")
	defer closeRoom(hub, code)

	b := newClientOn(hub, "c2")
	b.handleMessage(&Message{Type: MessageTypeJoinRoom})
	if got := nextReply(t, b, MessageTypeJoinRoom).Payload["status"]; got != "server_full" {
		t.Errorf("join at the cap: status = %v, want server_full", got)
	}
	if n := hub.gameManager.RoomCount(); n != 1 {
		t.Errorf("RoomCount = %d, want 1", n)
	}
}

// leave_room takes the client out; later actions are ignored.
func TestLeaveRoom(t *testing.T) {
	hub, a := newHubClient(t)
	code := join(t, a, "")
	defer closeRoom(hub, code)
	room, _ := hub.gameManager.GetShootingRoom(code)

	a.handleMessage(&Message{Type: MessageTypeLeaveRoom})
	if n := len(room.GetSnapshot().Players); n != 0 {
		t.Errorf("players = %d after leave, want 0", n)
	}
	a.handleMessage(&Message{Type: MessageTypePlaceTower,
		Payload: map[string]interface{}{"x": 5.0, "y": 5.0, "tower_type": "basic"}})
	if n := len(room.GetSnapshot().Towers); n != 0 {
		t.Error("a client that left could still place towers")
	}
	if hub.PlayerCount() != 0 {
		t.Errorf("PlayerCount = %d after leave, want 0", hub.PlayerCount())
	}
}

// RR-03: spawn_enemy does nothing unless DEBUG_SPAWN is on, and the join
// reply says which, so the client can hide the panel.
func TestSpawnEnemyGatedByDebugFlag(t *testing.T) {
	saved := debugSpawnEnabled
	defer func() { debugSpawnEnabled = saved }()

	for _, enabled := range []bool{false, true} {
		debugSpawnEnabled = enabled
		hub, a := newHubClient(t)
		a.handleMessage(&Message{Type: MessageTypeJoinRoom})
		reply := nextReply(t, a, MessageTypeJoinRoom)
		code := reply.Payload["room_code"].(string)
		if reply.Payload["debug_spawn"] != enabled {
			t.Errorf("debug_spawn = %v, want %v", reply.Payload["debug_spawn"], enabled)
		}
		a.handleMessage(&Message{Type: MessageTypeSpawnEnemy,
			Payload: map[string]interface{}{"enemy_type": "boss"}})
		room, _ := hub.gameManager.GetShootingRoom(code)
		want := 0
		if enabled {
			want = 1
		}
		if n := len(room.GetSnapshot().Enemies); n != want {
			t.Errorf("debug=%v: %d enemies after spawn_enemy, want %d", enabled, n, want)
		}
		closeRoom(hub, code)
	}
}

// pause_game, evolve_tower, continue_endless and start_wave over the
// handler, not just the game API.
func TestActionHandlers(t *testing.T) {
	hub, a := newHubClient(t)
	code := join(t, a, "")
	defer closeRoom(hub, code)
	room, _ := hub.gameManager.GetShootingRoom(code)

	a.handleMessage(&Message{Type: MessageTypePauseGame, Payload: map[string]interface{}{"paused": true}})
	if !room.IsPaused() {
		t.Error("pause_game didn't pause")
	}
	a.handleMessage(&Message{Type: MessageTypePauseGame, Payload: map[string]interface{}{"paused": false}})
	if room.IsPaused() {
		t.Error("pause_game didn't resume")
	}

	tower, err := room.AddTower(5, 5, "basic")
	if err != nil {
		t.Fatalf("AddTower: %v", err)
	}
	a.handleMessage(&Message{Type: MessageTypeEvolveTower,
		Payload: map[string]interface{}{"tower_id": float64(tower.ID), "evolution": "breach"}})
	if got := nextReply(t, a, MessageTypeEvolveTower).Payload["status"]; got != "not_max_level" {
		t.Errorf("evolve on a level 1 tower: status = %v, want not_max_level", got)
	}

	a.handleMessage(&Message{Type: MessageTypeContinueEndless})
	if snap := room.GetSnapshot(); snap.Endless || snap.Phase != game.PhaseWaiting {
		t.Errorf("continue_endless outside victory changed the run: endless=%v phase=%s", snap.Endless, snap.Phase)
	}

	room.SetFastForward(true)
	a.handleMessage(&Message{Type: MessageTypeStartWave})
	deadline := time.Now().Add(2 * time.Second)
	for room.GetPhase() != game.PhaseActive && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if room.GetPhase() != game.PhaseActive {
		t.Fatal("start_wave didn't start the wave")
	}
	a.handleMessage(&Message{Type: MessageTypeStartWave})
	if got := nextReply(t, a, MessageTypeStartWave).Payload["status"]; got != "rejected" {
		t.Errorf("second start_wave: status = %v, want rejected", got)
	}
}

// The origin check is the only cross-site guard on /ws.
func TestOriginAllowed(t *testing.T) {
	prod := parseOrigins(" https://rust-rush.jaime.build , ")
	cases := []struct {
		name    string
		allowed map[string]bool
		origin  string
		want    bool
	}{
		{"listed origin", prod, "https://rust-rush.jaime.build", true},
		{"unlisted origin", prod, "https://evil.example", false},
		{"trailing slash is a different origin", prod, "https://rust-rush.jaime.build/", false},
		{"http scheme is a different origin", prod, "http://rust-rush.jaime.build", false},
		{"no Origin header (non-browser)", prod, "", true},
		{"dev: empty allowlist allows all", parseOrigins(""), "https://evil.example", true},
	}
	for _, tc := range cases {
		if got := originAllowed(tc.allowed, tc.origin); got != tc.want {
			t.Errorf("%s: originAllowed(%q) = %v, want %v", tc.name, tc.origin, got, tc.want)
		}
	}
}

// FS-09: 30 messages a second per connection, hover checks on their own 60.
func TestRateLimit(t *testing.T) {
	c := &Client{id: "flood"}
	now := time.Now()
	allowed := 0
	for i := 0; i < 100; i++ {
		if c.allow(MessageTypePauseGame, now) {
			allowed++
		}
	}
	if allowed != messagesPerSecond {
		t.Errorf("burst allowed %d messages, want %d", allowed, messagesPerSecond)
	}
	checks := 0
	for i := 0; i < 100; i++ {
		if c.allow(MessageTypeCheckPlacement, now) {
			checks++
		}
	}
	if checks != checksPerSecond {
		t.Errorf("hover checks allowed %d, want %d (separate bucket)", checks, checksPerSecond)
	}
	if !c.allow(MessageTypePauseGame, now.Add(100*time.Millisecond)) {
		t.Error("bucket did not refill after 100 ms")
	}
}

// FS-13: state frames fill at most half the buffer, so a reply still fits.
func TestFramesLeaveRoomForReplies(t *testing.T) {
	c := &Client{id: "slow", send: make(chan []byte, 8)}
	for i := 0; i < 20; i++ {
		c.offerFrame([]byte(`{"type":"game_state"}`))
	}
	if n := len(c.send); n != 4 {
		t.Fatalf("queued %d frames, want 4 (half the buffer)", n)
	}
	c.reply(MessageTypePlaceTower, map[string]interface{}{"status": "placed"})
	if n := len(c.send); n != 5 {
		t.Errorf("reply was not queued behind the frames (len=%d)", n)
	}
	if c.dropped.Load() != 16 {
		t.Errorf("dropped = %d, want 16", c.dropped.Load())
	}
}

// RR-01: connection caps, total and per IP, released on unregister.
func TestHubConnectionCaps(t *testing.T) {
	hub := NewHub(game.NewManager())
	hub.SetLimits(3, 2)
	go hub.Run()

	if ok, _ := hub.reserve("1.1.1.1"); !ok {
		t.Fatal("first connection refused")
	}
	if ok, _ := hub.reserve("1.1.1.1"); !ok {
		t.Fatal("second connection from one IP refused")
	}
	if ok, reason := hub.reserve("1.1.1.1"); ok || reason != "too_many_connections" {
		t.Errorf("third from one IP: ok=%v reason=%q, want too_many_connections", ok, reason)
	}
	if ok, _ := hub.reserve("2.2.2.2"); !ok {
		t.Fatal("other IP refused under the total cap")
	}
	if ok, reason := hub.reserve("3.3.3.3"); ok || reason != "server_full" {
		t.Errorf("over the total: ok=%v reason=%q, want server_full", ok, reason)
	}

	// A registered client releases its slot on unregister.
	c := &Client{hub: hub, id: "x", ip: "2.2.2.2", reserved: true, send: make(chan []byte, 1)}
	hub.register <- c
	hub.unregister <- c
	deadline := time.Now().Add(time.Second)
	for {
		if ok, _ := hub.reserve("3.3.3.3"); ok {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("slot not released after unregister")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// FS-15: concurrent players counts joined connections, not open sockets.
func TestPlayerCountOnlyCountsJoined(t *testing.T) {
	hub, a := newHubClient(t)
	go hub.Run()
	idle := newClientOn(hub, "idle")
	hub.register <- a
	hub.register <- idle
	code := join(t, a, "")
	defer closeRoom(hub, code)

	if got := hub.PlayerCount(); got != 1 {
		t.Errorf("PlayerCount = %d, want 1 (the idle socket never joined)", got)
	}
}
