package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"rust-rush/server/internal/game"
	"rust-rush/server/internal/stats"
	"rust-rush/server/internal/websocket"
)

// findStaticDir returns the first existing client build directory, so the
// server works whether it's started from server/ (go run main.go) or the
// repo root (built binary). STATIC_DIR overrides the search.
func findStaticDir() string {
	candidates := []string{os.Getenv("STATIC_DIR"), "../client/dist", "./client/dist"}
	for _, dir := range candidates {
		if dir == "" {
			continue
		}
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir
		}
	}
	return ""
}

func main() {
	log.Println("Starting Rust Rush server...")

	// Create game manager
	gameManager := game.NewManager()

	// Private stats: one SQLite row per completed game, written on the
	// game_over transition. STATS_DB overrides the path (production mounts a
	// volume, e.g. /data/stats.db); default is a file next to the server.
	statsPath := os.Getenv("STATS_DB")
	if statsPath == "" {
		statsPath = "stats.db"
	}
	statsStore, err := stats.Open(statsPath)
	if err != nil {
		// Stats are a nice-to-have — the game must not die without them.
		log.Printf("⚠️ Stats disabled — could not open %s: %v", statsPath, err)
	} else {
		defer statsStore.Close()
		log.Printf("Stats database: %s", statsPath)
		gameManager.SetGameOverHook(func(roomID string, wave, score int, duration float64) {
			rec := stats.GameRecord{EndedAt: time.Now(), Wave: wave, Score: score, Duration: duration}
			if err := statsStore.RecordGame(rec); err != nil {
				log.Printf("⚠️ Failed to record game (room %s): %v", roomID, err)
			} else {
				log.Printf("📈 Recorded game: room=%s wave=%d score=%d duration=%.0fs", roomID, wave, score, duration)
			}
		})
	}

	// Create WebSocket hub
	hub := websocket.NewHub(gameManager)
	go hub.Run()

	// Setup routes
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		websocket.ServeWs(hub, w, r)
	})

	// Internal stats endpoint — deliberately not linked from the game UI.
	if statsStore != nil {
		http.HandleFunc("/stats", stats.Handler(statsStore, hub.ClientCount))
	}

	// Health check endpoint
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// Serve the production client build if present (npm run build in client/).
	// Without it the server still runs API-only for the Vite dev workflow.
	if staticDir := findStaticDir(); staticDir != "" {
		log.Printf("Serving client from %s — open http://localhost:8080", staticDir)
		http.Handle("/", http.FileServer(http.Dir(staticDir)))
	} else {
		log.Println("No client build found (client/dist) — API-only mode, use the Vite dev server for the UI")
	}

	// Start server — PORT env overrides the default (same image runs locally
	// and behind the tunnel).
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	addr := ":" + port
	log.Printf("Server listening on port %s", addr)
	log.Printf("WebSocket endpoint: ws://localhost%s/ws", addr)

	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatal("ListenAndServe: ", err)
	}
}
