// Run events for signed-in players (achievements). Rooms report what
// happened; the accounts store decides what it unlocks. Guests' rooms emit
// nothing.

package game

import "log"

// Event kinds.
const (
	EventWaveReached = "wave_reached" // Wave, Endless, Untouched
	EventVictory     = "victory"      // MapID, Sequence, Difficulty, TowerCount
	EventTowerCount  = "tower_count"  // TowerCount (sent from 20 towers up)
	EventEvolved     = "evolved"      // Base (the base tower type)
	EventBossKilled  = "boss_killed"  // Count
)

// Event is one thing that happened in a signed-in player's run.
type Event struct {
	Kind       string
	Wave       int
	Endless    bool
	Untouched  bool // no enemy has leaked this run
	MapID      string
	Sequence   int
	Difficulty string
	TowerCount int
	Base       string
	Count      int
}

// fortressTowers is where tower_count events start (the Fortress
// achievement); below it nothing is sent.
const fortressTowers = 20

// EventHandler receives events on one goroutine, in order.
type EventHandler func(userID int64, roomID string, ev Event)

type eventJob struct {
	userID int64
	roomID string
	ev     Event
}

type eventSink struct {
	jobs chan eventJob
}

// SetEventHandler starts event delivery. Call before serving traffic.
func (m *Manager) SetEventHandler(h EventHandler) {
	sink := &eventSink{jobs: make(chan eventJob, 1024)}
	go func() {
		for j := range sink.jobs {
			h(j.userID, j.roomID, j.ev)
		}
	}()
	m.events.Store(sink)
}

// emitLocked queues an event for the room's owner. Lock-free on the manager
// side (rooms call it holding their own lock). Caller holds gs.mu.
func (gs *GameStateWithShooting) emitLocked(ev Event) {
	if gs.OwnerID == 0 || gs.mgr == nil {
		return
	}
	sink := gs.mgr.events.Load()
	if sink == nil {
		return
	}
	select {
	case sink.jobs <- eventJob{userID: gs.OwnerID, roomID: gs.RoomID, ev: ev}:
	default:
		log.Printf("⚠️ Event queue full, dropped %s for account %d", ev.Kind, gs.OwnerID)
	}
}
