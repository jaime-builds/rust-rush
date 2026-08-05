// Entry point for the Rust Rush server: wires up the game manager, stats store, WebSocket hub, and HTTP routes, then listens.
package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"rust-rush/server/internal/admin"
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

// serveAdminPage returns index.html for the client-side /admin routes. The
// game itself is a single page, so http.FileServer alone is enough for it —
// but /admin/login and /admin/stats are routes the browser can be pointed at
// directly (deep link, refresh, the footer link), and no such files exist on
// disk. Without a build (Vite dev workflow) this 404s and the dev server
// handles the route instead.
func serveAdminPage(staticDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if staticDir == "" {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
	}
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

	// Single-operator admin login (ADMIN_USERNAME / ADMIN_PASSWORD). Needed
	// before route setup because it gates /stats and serves the admin pages.
	adminAuth := admin.New()
	if !adminAuth.Configured() {
		log.Println("⚠️ Admin login unconfigured (ADMIN_USERNAME / ADMIN_PASSWORD unset) — /stats stays closed")
	}
	staticDir := findStaticDir()
	adminPage := serveAdminPage(staticDir)

	// Setup routes
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		websocket.ServeWs(hub, w, r)
	})

	// Internal stats endpoint — not linked from the game UI, and now behind
	// the admin session cookie: 401 without one, which is the client's cue to
	// bounce to the login page.
	if statsStore != nil {
		http.HandleFunc("/stats", adminAuth.RequireSession(stats.Handler(statsStore, hub.ClientCount)))
	}

	// Admin auth API. These paths double as client-side routes, so a non-POST
	// request is a browser navigating to the page, not an API call.
	http.HandleFunc("/admin/login", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			adminPage(w, r)
			return
		}
		adminAuth.Login(w, r)
	})
	http.HandleFunc("/admin/logout", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		adminAuth.Logout(w, r)
	})
	// Everything else under /admin/ (notably /admin/stats) is a client route.
	http.HandleFunc("/admin/", adminPage)

	// Health check endpoint — public and unauthenticated on purpose: the
	// uptime monitor and the container HEALTHCHECK both poll it.
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// Serve the production client build if present (npm run build in client/).
	// Without it the server still runs API-only for the Vite dev workflow.
	if staticDir != "" {
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
