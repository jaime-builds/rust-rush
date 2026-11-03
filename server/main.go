// Entry point for the Rust Rush server: wires up the game manager, stats store, WebSocket hub, and HTTP routes, then listens.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"rust-rush/server/internal/accounts"
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

// recordWithRetry writes one stats row, retrying once after a short pause
// (a busy SQLite file is the realistic failure).
func recordWithRetry(store *stats.Store, rec stats.GameRecord) error {
	err := store.RecordGame(rec)
	if err != nil {
		time.Sleep(250 * time.Millisecond)
		err = store.RecordGame(rec)
	}
	return err
}

func main() {
	log.Println("Starting Rust Rush server...")

	gameManager := game.NewManager()

	// Private stats: one SQLite row per completed game, written on the
	// game_over/victory transition. STATS_DB overrides the path (production
	// mounts a volume, e.g. /data/stats.db); default is a file next to the
	// server. pendingWrites lets shutdown wait for a write in flight.
	statsPath := os.Getenv("STATS_DB")
	if statsPath == "" {
		statsPath = "stats.db"
	}
	var pendingWrites sync.WaitGroup
	// Accounts (optional player logins, leaderboard, saves, achievements)
	// share the stats database file, so they exist only when it opens.
	var accountAPI *accounts.API
	statsStore, err := stats.Open(statsPath)
	if err != nil {
		// Stats are a nice-to-have — the game must not die without them.
		log.Printf("⚠️ Stats and accounts disabled — could not open %s: %v", statsPath, err)
	} else {
		log.Printf("Stats database: %s", statsPath)
		if store, err := accounts.Open(statsStore.DB()); err != nil {
			log.Printf("⚠️ Accounts disabled — %v", err)
		} else {
			accountAPI = accounts.NewAPI(store)
			gameManager.SetSaveStore(store)
		}
		gameManager.SetGameOverHook(func(roomID string, r game.RunResult) {
			pendingWrites.Add(1)
			defer pendingWrites.Done()
			rec := stats.GameRecord{
				EndedAt: time.Now(), Wave: r.Wave, Score: r.Score, Duration: r.Duration,
				UserID: r.OwnerID, MapID: r.MapID, Difficulty: r.Difficulty,
				Endless: r.Endless, Victory: r.Victory,
			}
			if r.Victory && r.OwnerID > 0 && accountAPI != nil {
				if m := game.GetMapDef(r.MapID); m != nil {
					if err := accountAPI.Store().AdvanceProgress(r.OwnerID, m.SequenceOrder); err != nil {
						log.Printf("⚠️ Failed to record map progress: %v", err)
					}
				}
			}
			if err := recordWithRetry(statsStore, rec); err != nil {
				log.Printf("⚠️ Failed to record game: %v", err)
			} else {
				log.Printf("📈 Recorded game: wave=%d score=%d duration=%.0fs", r.Wave, r.Score, r.Duration)
			}
		})
	}

	hub := websocket.NewHub(gameManager)
	go hub.Run()
	if accountAPI != nil {
		hub.SetIdentify(func(r *http.Request) (int64, string) {
			if u, ok := accountAPI.UserFromRequest(r); ok {
				return u.ID, u.Username
			}
			return 0, ""
		})
		accountAPI.OnLogout = hub.DisconnectUser
		// Achievements: rooms report run events; the accounts store awards
		// what they unlock, and the player's open tabs get a toast.
		store := accountAPI.Store()
		gameManager.SetEventHandler(func(userID int64, roomID string, ev game.Event) {
			for _, a := range store.HandleEvent(userID, ev) {
				hub.SendToUser(userID, websocket.Message{
					Type:    websocket.MessageTypeAchievement,
					Payload: map[string]interface{}{"id": a.ID, "name": a.Name, "description": a.Description},
				})
			}
		})
	}

	// Single-operator admin login (ADMIN_USERNAME / ADMIN_PASSWORD). Needed
	// before route setup because it gates /stats and serves the admin pages.
	adminAuth := admin.New()
	if !adminAuth.Configured() {
		log.Println("⚠️ Admin login unconfigured (ADMIN_USERNAME / ADMIN_PASSWORD unset) — /stats stays closed")
	}
	staticDir := findStaticDir()
	adminPage := serveAdminPage(staticDir)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		websocket.ServeWs(hub, w, r)
	})

	// Private stats JSON, behind the admin session cookie: 401 without one,
	// which is the client's cue to bounce to the login page. no-store keeps
	// it out of browser and Cloudflare caches.
	if statsStore != nil {
		statsHandler := adminAuth.RequireSession(stats.Handler(statsStore, hub.PlayerCount))
		mux.HandleFunc("/stats", readOnly(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			statsHandler(w, r)
		}))
	}

	// Player accounts and the public leaderboard.
	if accountAPI != nil {
		accountAPI.Register(mux)
		mux.HandleFunc("/api/leaderboard", accountAPI.LeaderboardHandler(func(id string) bool {
			return game.GetMapDef(id) != nil
		}))
	}

	// Player moderation for the admin page, behind the admin session.
	if accountAPI != nil {
		accountAPI.RegisterAdmin(mux, adminAuth.RequireSession)
	}

	// Admin auth API. These paths double as client-side routes, so a GET is a
	// browser navigating to the page, not an API call.
	mux.HandleFunc("/admin/login", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			adminAuth.Login(w, r)
			return
		}
		adminPage(w, r)
	})
	mux.HandleFunc("/admin/logout", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		adminAuth.Logout(w, r)
	})
	// Everything else under /admin/ (notably /admin/stats) is a client route.
	mux.HandleFunc("/admin/", adminPage)

	// Health check — public on purpose: the uptime monitor and the container
	// HEALTHCHECK both poll it.
	mux.HandleFunc("/health", readOnly(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write([]byte("OK"))
	}))

	// Serve the production client build if present (npm run build in client/).
	// Without it the server still runs API-only for the Vite dev workflow.
	if staticDir != "" {
		log.Printf("Serving client from %s — open http://localhost:8080", staticDir)
		mux.Handle("/", staticHandler(staticDir))
	} else {
		log.Println("No client build found (client/dist) — API-only mode, use the Vite dev server for the UI")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Timeouts: ReadHeaderTimeout stops slow-header connections on the LAN
	// port; IdleTimeout reaps idle keep-alives. No Read/WriteTimeout — they
	// would cut long-lived WebSockets, which set their own deadlines.
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           securityHeaders(mux),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    64 << 10,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("Server listening on port %s", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal("ListenAndServe: ", err)
		}
	}()

	<-ctx.Done()
	log.Println("Shutting down...")

	// Stop taking requests, tell every open game tab we're going (a close
	// frame, so the client reconnects at once instead of waiting on a
	// timeout), let a stats write in flight finish, then close the database.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("HTTP shutdown: %v", err)
	}
	hub.CloseAll()
	// Signed-in players keep their runs across a deploy: save every live
	// owned room, and wait for the writes before the database closes.
	gameManager.SaveAll()
	gameManager.FlushSaves()

	done := make(chan struct{})
	go func() {
		pendingWrites.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-shutdownCtx.Done():
		log.Println("⚠️ Gave up waiting for a stats write")
	}
	if statsStore != nil {
		statsStore.Close()
	}
	log.Println("Stopped")
}
