# 🚀 Rust Rush - Setup Guide

The live game is two components: a **Go server** (all game logic, WebSocket, static file serving) and a **React + TypeScript client** (rendering and input only). That's it — see [Legacy components](#-legacy-components) for the historical Rust/PostgreSQL artifacts still in the tree.

## 📋 Prerequisites

- **Go** 1.21+ → [go.dev/dl](https://go.dev/dl/)
- **Node.js** 18+ → [nodejs.org](https://nodejs.org/)

Verify installations:
```bash
go version
node --version
npm --version
```

---

## 🎮 Production mode (one terminal)

1. **Build the client** (once, and after client changes):
```bash
cd client
npm install
npm run build
```
This outputs static files to `client/dist`.

2. **Run the server** — it serves the built client automatically:
```bash
cd ../server
go run main.go
```

3. Open **http://localhost:8080** — one process, one port.

> Prefer a standalone binary? `cd server && go build -o rust-rush.exe .` and run it
> from either the repo root or `server/` — it finds `client/dist` from both.
> `STATIC_DIR` overrides the location if you move the build elsewhere.

## 🛠️ Development mode (hot reload)

Terminal 1 — Go server:
```bash
cd server
go run main.go
```
Starts on `http://localhost:8080` (API-only if `client/dist` doesn't exist).

Terminal 2 — React client with hot reload:
```bash
cd client
npm install
npm run dev
```
Open **http://localhost:5173**.

---

## 🧪 Verify everything works

### Server health
```bash
curl http://localhost:8080/health
```
Returns `OK`. This endpoint is public and unauthenticated on purpose — the uptime monitor and the container healthcheck both poll it.

### Admin stats page
Set both credential vars before starting the server (there are no defaults — leave them unset and the stats page stays locked):
```bash
ADMIN_USERNAME=youruser ADMIN_PASSWORD=yourpassword go run main.go
```
Then open **http://localhost:8080/admin/login** (or use the small "Admin" link in the game footer). Signing in redirects to `/admin/stats`.

`/stats` itself is gated by the same session cookie:
```bash
curl -i http://localhost:8080/stats                       # 401 unauthorized
curl -i -c jar -X POST -H 'Content-Type: application/json' \
  -d '{"username":"youruser","password":"yourpassword"}' \
  http://localhost:8080/admin/login                       # 204 + session cookie
curl -b jar http://localhost:8080/stats                   # 200 + JSON
```

> In dev mode the Vite server proxies `/stats` and the admin API to the Go server on 8080, so the session cookie stays same-origin. The Go server must be running alongside Vite for login to work.

### Server tests
```bash
cd server
go test ./...
```
Runs the game-logic behavior tests, pathfinding equivalence tests, hub concurrency tests, and an end-to-end WebSocket game flow test.

### Client lint + build
```bash
cd client
npm run lint
npm run build
```
`npm run build` should create `client/dist` without errors.

### In the browser
- **Rust Rush** header with a 20×15 grid
- Gold ($200), Health (100), Wave counters
- Place a tower by clicking the grid; Start Wave spawns enemies

---

## 🐛 Common issues

### "go: command not found"
Install Go from [go.dev](https://go.dev/dl/) and add it to PATH.

### "connection refused" on port 8080
Make sure the Go server is running: `cd server && go run main.go`

### React shows a blank page
1. Check the browser console for errors (F12)
2. Make sure `npm install` completed successfully
3. Try `npm run dev` again

### Game loads but says Disconnected
The client connects to `ws://localhost:8080/ws` in dev mode — the Go server must be running alongside Vite.

---

## 📁 Project structure

```
rust-rush/
├── server/               # Go game server — ALL game logic lives here
│   ├── main.go           # Entry point: WebSocket + static file serving
│   ├── e2e_test.go       # End-to-end WebSocket game flow test
│   └── internal/
│       ├── admin/        # Single-operator login + session gate for /stats
│       ├── game/         # Game state, waves, pathfinding, game loop
│       ├── stats/        # Private SQLite stats store + /stats handler
│       └── websocket/    # Hub, client connections, message handlers
└── client/               # React frontend — rendering and input only
    └── src/
        ├── App.tsx       # WebSocket wiring, state throttling, debug panel
        ├── main.tsx      # Mounts the game, or the admin UI for /admin/*
        ├── settings.ts   # Effect/audio preferences (localStorage-backed)
        ├── audio/
        │   └── sound.ts  # Procedural Web Audio engine (music + SFX)
        ├── game/
        │   └── GameCanvas.tsx  # Canvas rendering + game UI
        ├── hooks/
        │   └── useWebSocket.ts # Connection + subscription hook
        ├── types/
        │   ├── game.ts   # Shared types, tower costs, grid constants
        │   └── stats.ts  # /stats payload shape + admin route paths
        └── ui/
            ├── AdminApp.tsx      # /admin router + login/stats pages
            └── SettingsMenu.tsx  # Settings modal (4 toggles)
```

---

Check [TODO.md](./TODO.md) for the full roadmap.
