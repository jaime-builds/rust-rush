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
Returns `OK`.

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
│       ├── game/         # Game state, waves, pathfinding, game loop
│       └── websocket/    # Hub, client connections, message handlers
├── client/               # React frontend — rendering and input only
│   └── src/
│       ├── App.tsx       # WebSocket wiring, state throttling, debug panel
│       ├── game/
│       │   └── GameCanvas.tsx  # Canvas rendering + game UI
│       ├── hooks/
│       │   └── useWebSocket.ts # Connection + subscription hook
│       └── types/
│           └── game.ts   # Shared types, tower costs, grid constants
├── game-engine/          # LEGACY — see below
└── database/             # LEGACY — see below
```

## 🗄️ Legacy components

Two directories are early-phase artifacts that the live game does **not** use:

- **`game-engine/`** — a Rust/macroquad prototype from Phase 1-2. The Go server superseded it; its gameplay constants have long diverged from the real ones in `server/internal/game/state.go`. Do not treat it as a spec.
- **`database/`** — a PostgreSQL schema from Phase 1. No code connects to a database; state is in-memory. Kept only for a possible future persistence phase (see TODO.md Phase 23).

Neither is needed to build, run, or develop the game.

---

Check [TODO.md](./TODO.md) for the full roadmap.
