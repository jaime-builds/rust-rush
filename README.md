# 🦀 Rust Rush - Tower Defense

A high-performance tower defense game built with Go, React, and WebSockets.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Go](https://img.shields.io/badge/go-1.21+-00ADD8.svg)
![React](https://img.shields.io/badge/react-18+-61DAFB.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.0+-3178C6.svg)

## 🎮 Features

### ✅ Fully Implemented (Alpha Complete!)

#### Core Gameplay
- **Interactive Tower Placement** — Click to place 4 tower types on a 20×15 grid
- **Tower Sell System** — Click any tower to select it, view stats, and sell for 70% refund of total spent
- **Tower Upgrades** — Upgrade towers up to level 4 for +20% damage and +10% range per level; slow and splash towers also improve their special effects
- **Gold Economy** — Towers cost gold, enemies reward gold on death (scaled by type)
- **Wave System** — Start waves manually or use Auto Wave with a 5-second countdown
- **Enemy Progression** — Waves scale from basic enemies up to fast, tank, and boss types
- **Smart Pathfinding** — Enemies use BFS to navigate around towers in real time
- **Dynamic Rerouting** — Enemies instantly reroute when towers are placed mid-wave
- **Health System** — Enemies deal 10 damage when reaching the goal; game ends at 0
- **Score System** — Points per kill scale with enemy type and wave number; wave completion bonus doubles if you finish at full health
- **Local High Score** — Best score persists in your browser and shows on the Game Over screen
- **Enemy Glossary** — In-game stat sheet with color legend, HP, speed, gold, and score per enemy type
- **Wave Preview** — See the exact enemy composition of the next (or current) wave at a glance
- **Game Over & New Game** — Full reset flow with a single click

#### Visual Effects
- **Projectile System** — Bullets with glowing trails fly toward enemies; splash projectiles render orange
- **Muzzle Flashes** — 100ms flash when towers fire
- **Explosion Effects** — Animated explosions on hit; AOE hits show full blast radius
- **Health Bars** — Real-time above each enemy
- **Tower Rotation** — Towers rotate to face their current target
- **Range Indicators** — Dashed circles show range when a tower is selected
- **Tower Upgrade Rings** — Gold rings around towers indicate upgrade level (1–3 rings for levels 2–4)
- **Slow Visual** — Slowed enemies render blue with a ring indicator

#### Game Flow
- **Auto Wave Toggle** — Automatically starts the next wave after a 5s countdown
- **"Send Now" Button** — Skip the countdown and start the wave early
- **Wave Status Bar** — Shows wave number, phase, and enemies remaining
- **Cursor Mode** — "None" button clears the tower preview from the cursor
- **Game Over Screen** — Shows waves survived with a Play Again button
- **Fast Forward** — 3x game speed toggle for testing (header button)

#### Technical
- **Server-Authoritative** — All game logic runs on the Go server
- **60 FPS Game Loop** — Smooth server-side updates at 60 frames per second
- **WebSocket Communication** — Real-time bidirectional state updates
- **Canvas Ref Pattern** — Animation loop reads from refs, never stale closures
- **Spawn Cancellation** — New Game instantly stops any running wave goroutine
- **Debug Panel** — Toggleable panel with tower stats, enemy health, and phase info

### Tower Types

| Tower    | Cost | Range | Damage | Fire Rate | Special                                              |
|----------|------|-------|--------|-----------|------------------------------------------------------|
| 🗼 Basic  | $50  | 3.0   | 15     | 1.0/sec   | Reliable all-rounder                                 |
| 🎯 Sniper | $100 | 6.0   | 50     | 0.5/sec   | Long-range, high single-target                       |
| 💥 Splash | $75  | 2.5   | 10     | 1.5/sec   | AOE: 60% damage in 1.5u radius, upgrades increase both |
| ❄️ Slow   | $60  | 3.5   | 8      | 0.8/sec   | 60% speed reduction, upgrades extend duration/strength |

### Tower Upgrades

| Level | Upgrade Cost | Damage | Range | Notes                          |
|-------|-------------|--------|-------|--------------------------------|
| 1     | —           | base   | base  | Starting stats                 |
| 2     | = base cost | +20%   | +10%  | 1 gold ring                   |
| 3     | = base cost | +44%   | +21%  | 2 gold rings                  |
| 4 MAX | = base cost | +73%   | +33%  | 3 gold rings, MAX badge       |

Sell at any level refunds 70% of total gold spent.

### Enemy Types

| Type     | Health | Speed | Gold | Score      | Appears  |
|----------|--------|-------|------|------------|----------|
| 🦀 Basic  | 100    | 2.0   | +10  | 10 × wave  | Wave 1+  |
| 💨 Fast   | 50     | 4.0   | +8   | 15 × wave  | Wave 4+  |
| 🛡️ Tank   | 300    | 1.0   | +25  | 30 × wave  | Wave 7+  |
| 💀 Boss   | 1000   | 0.5   | +100 | 100 × wave | Wave 11+ |

Both health and speed scale with wave number — enemies get meaningfully tougher past wave 5.

### Scoring

- **Kills**: base points (table above) × current wave number
- **Wave completion bonus**: 50 × wave — **doubled** if you finish the wave at full health
- **High score**: best run is saved locally in your browser

### Wave Progression

| Waves | Enemy Mix |
|-------|-----------|
| 1–3   | Basic only (5–9 enemies) |
| 4–6   | Basic + Fast |
| 7–10  | Basic + Fast + Tank |
| 11+   | Full mix + bosses every wave (one more boss every 3rd wave, max 6), counts scale quadratically |

### 🚧 Coming Next
- Sound effects
- Special stat display in upgrade panel (slow duration, splash radius)
- Special towers (freeze, tesla, mortar, laser)

## 🏗️ Architecture

### Server-Authoritative Design
```
┌──────────────────────────────────────────────────────────────┐
│                     CLIENT (React)                           │
│  - Renders game state from refs (no stale closures)          │
│  - Sends user inputs via WebSocket                           │
│  - 60 FPS animation loop                                     │
│  - NO game logic                                             │
└──────────────────────────┬───────────────────────────────────┘
                           │ WebSocket (60 msgs/sec)
┌──────────────────────────▼───────────────────────────────────┐
│                     SERVER (Go)                              │
│  - 60 FPS game loop                                          │
│  - Tower targeting, shooting, selling, upgrading             │
│  - Projectile physics & collision                            │
│  - Enemy movement & BFS pathfinding                          │
│  - Wave spawner goroutine (cancellable)                      │
│  - Authoritative state                                       │
└──────────────────────────────────────────────────────────────┘
```

## 🚀 Getting Started

### Prerequisites
- **Go** (1.21+): https://go.dev/dl/
- **Node.js** (18+): https://nodejs.org

### Quick Start (production — one terminal)

1. **Clone the repository**
```bash
git clone https://github.com/jaime-builds/rust-rush.git
cd rust-rush
```

2. **Build the client** (one-time, and after client changes)
```bash
cd client
npm install
npm run build
```
This outputs static files to `client/dist`.

3. **Run the server** — it serves the built client automatically
```bash
cd ../server
go mod download
go run main.go
```

4. **Open your browser** at http://localhost:8080 — that's it, one process on one port.

> Prefer a standalone binary? `cd server && go build -o rust-rush.exe .` and run it
> from either the repo root or `server/` — it finds `client/dist` from both.
> `STATIC_DIR` overrides the location if you move the build elsewhere.

### Development mode (hot reload)

1. **Start the Go server**
```bash
cd server
go run main.go
```
Server starts on `http://localhost:8080` (API-only if `client/dist` doesn't exist)

2. **Start the React client** (new terminal)
```bash
cd client
npm install
npm run dev
```
Client starts on `http://localhost:5173` with hot reload

3. **Open your browser** at http://localhost:5173

## 🎯 How to Play

1. **Place towers** — Select a tower type and click the grid
2. **Start Wave** — Click Start Wave or enable Auto Wave
3. **Earn gold** — Kill enemies to earn gold for more towers
4. **Upgrade towers** — Click a placed tower and hit Upgrade to boost its stats
5. **Sell towers** — Sell to reorganize; refund is 70% of everything spent
6. **Survive** — Don't let enemies reach G or your health hits 0

### Tips
- Block the path to force enemies on longer routes
- Snipers cover the whole board — place them early
- Use Slow towers to keep tanks and bosses in your kill zone longer
- Splash towers shine at choke points where enemies bunch up
- Upgrade your key towers rather than spreading gold thin
- A boss appears in every wave from 11 onward — and another joins the pack every 3rd wave

## 🛠️ Tech Stack

### Frontend
- React 18 with TypeScript
- HTML5 Canvas for rendering
- WebSocket for real-time communication
- Vite for development

### Backend
- Go 1.21+ for game server
- Gorilla WebSocket
- Server-side 60 FPS game loop
- Room-based architecture

### Algorithms
- BFS Pathfinding
- Delta-time movement (frame-rate independent)
- Circle-based collision detection
- Spawn cancellation via Go channels

## 📂 Project Structure
```
rust-rush/
├── server/
│   ├── main.go
│   └── internal/
│       ├── game/
│       │   ├── state.go      # Game state, towers, enemies, wave config
│       │   └── manager.go    # Game loop, wave spawner
│       └── websocket/
│           ├── hub.go        # WebSocket broadcast hub
│           └── client.go     # Client connection & message handlers
├── client/
│   └── src/
│       ├── App.tsx
│       ├── game/
│       │   └── GameCanvas.tsx
│       ├── hooks/
│       │   └── useWebSocket.ts
│       └── types/
│           └── game.ts
└── docs/
    └── TODO.md
```

## 🧪 Testing

### Start the server
```bash
cd server && go run main.go
```

### Manual Testing Checklist
- [x] Place all 4 tower types
- [x] Gold deducts on placement, blocks if insufficient
- [x] Click tower to select, view stats, sell for refund
- [x] Upgrade tower — stats increase, gold rings appear, sell price reflects total spent
- [x] Slow and splash tower upgrades improve special effects
- [x] Info panel updates immediately on upgrade (no reselect needed)
- [x] MAX badge appears at level 4, upgrade button disabled
- [x] Start Wave spawns enemies with delays
- [x] Wave counter increments on completion
- [x] Auto Wave countdown and Send Now button
- [x] Enemies reroute when towers placed mid-wave
- [x] Block path completely — enemies skip, wave still completes
- [x] Health decreases when enemies reach goal
- [x] Game Over screen appears at 0 health
- [x] New Game resets everything in one click
- [x] New Game mid-wave cancels spawn goroutine
- [x] Slow tower visibly slows enemies (blue tint)
- [x] Splash tower AOE damages nearby enemies
- [x] Enemy health and speed scale with wave number
- [x] Fast forward mode compresses to 3x speed across all game systems
- [x] Score increases on kills, jumps on wave completion (doubled at full health)
- [x] High score persists across browser sessions, "New High Score!" on beating it
- [x] Wave preview shows next wave composition, updates after each wave
- [x] Glossary panel opens/closes, colors match canvas enemies
- [x] Production build: `npm run build` + `go run main.go` serves the game on 8080

## 🐛 Known Issues

- Special upgrade stats (slow duration, splash radius) not shown in info panel
- No sound effects

## 🚀 Future Plans

### Short Term
- Special towers (freeze, tesla, mortar, laser)
- Special stat display in upgrade panel

### Medium Term
- Sound effects and background music
- Visual polish (animations, background theme)
- Online high score leaderboard
- Speed controls (1x, 2x, 3x)

### Long Term
- Multiplayer lobby
- User accounts
- Map editor
- Mobile version

## 📜 License

MIT License

## 🙏 Acknowledgments

- Gorilla WebSocket
- React + Vite
- Inspired by Bloons TD and Kingdom Rush

## 📧 Contact

**Jaime De La Paz**
- GitHub: [@jaime-builds](https://github.com/jaime-builds)
- Project: [https://github.com/jaime-builds/rust-rush](https://github.com/jaime-builds/rust-rush)

---

**Built with** 🐹 Go and ⚛️ React | **Status**: Phase 16 Complete ✅ | **Last Updated**: July 1, 2026
