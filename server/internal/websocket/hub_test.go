package websocket

import (
	"sync"
	"testing"

	"rust-rush/server/internal/game"
)

// Exercises the hub's clients map from all three goroutine families at once
// (register/unregister via Run, game-loop-style fan-out, readPump-style
// direct broadcasts). Run under -race: the pre-fix hub had unsynchronized
// concurrent map access and could double-close client.send.
func TestHubConcurrentBroadcastAndChurn(t *testing.T) {
	manager := game.NewManager()
	manager.GetOrCreateShootingRoom("race-room")
	hub := NewHub(manager)
	go hub.Run()

	var wg sync.WaitGroup
	stop := make(chan struct{})

	// Broadcaster A: simulates the 60 FPS game-loop fan-out.
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
				hub.BroadcastToRoom("race-room", []byte(`{"t":1}`))
			}
		}
	}()

	// Broadcaster B: simulates action acks issued from readPump goroutines.
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
				hub.BroadcastGameState("race-room")
			}
		}
	}()

	// Churn clients with tiny send buffers so the buffer-full broadcast path
	// runs constantly; half unregister immediately, half at test end.
	lateUnregister := make([]*Client, 0, 25)
	for i := 0; i < 50; i++ {
		c := &Client{hub: hub, send: make(chan []byte, 1), id: generateClientID()}
		hub.register <- c
		hub.setClientRoom(c, "race-room")
		if i%2 == 0 {
			hub.unregister <- c
		} else {
			lateUnregister = append(lateUnregister, c)
		}
	}

	close(stop)
	wg.Wait()
	for _, c := range lateUnregister {
		hub.unregister <- c
	}
}

// The old timestamp-format ID gave all same-second connections the same ID.
func TestGenerateClientIDUnique(t *testing.T) {
	const n = 1000
	ids := make(chan string, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ids <- generateClientID()
		}()
	}
	wg.Wait()
	close(ids)

	seen := make(map[string]bool, n)
	for id := range ids {
		if seen[id] {
			t.Fatalf("duplicate client ID: %s", id)
		}
		seen[id] = true
	}
}
