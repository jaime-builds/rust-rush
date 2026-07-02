package main

import (
	"log"
	"net/http"
	"os"

	"rust-rush/server/internal/game"
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

	// Create WebSocket hub
	hub := websocket.NewHub(gameManager)
	go hub.Run()

	// Setup routes
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		websocket.ServeWs(hub, w, r)
	})

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

	// Start server
	port := ":8080"
	log.Printf("Server listening on port %s", port)
	log.Printf("WebSocket endpoint: ws://localhost%s/ws", port)

	if err := http.ListenAndServe(port, nil); err != nil {
		log.Fatal("ListenAndServe: ", err)
	}
}
