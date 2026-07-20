# 🦀 Rust Rush - Tower Defense

A high-performance tower defense game built with Go, React, and WebSockets.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Go](https://img.shields.io/badge/go-1.21+-00ADD8.svg)
![React](https://img.shields.io/badge/react-18+-61DAFB.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.0+-3178C6.svg)

## 🎮 Features

### ✅ Fully Implemented (Beta Complete!)

#### Core Gameplay
- **Interactive Tower Placement** — Click to place 5 tower types on a 20×15 grid
- **Tower Evolution** — Every MAX-level tower can permanently evolve into one of two terminal forms (10 in total)
- **Tower Sell System** — Click any tower to select it, view stats, and sell for 70% refund of total spent
- **Tower Upgrades** — Upgrade towers up to level 4 for +20% damage and +10% range per level; slow and splash towers also improve their special effects
- **Gold Economy** — Towers cost gold, enemies reward gold on death (scaled by type); Harder difficulty cuts gold per kill by 30%
- **Wave System** — Start waves manually or use Auto Wave with a 5-second countdown
- **Enemy Progression** — Waves scale from basic enemies up to fast, tank, and boss types
- **Smart Pathfinding** — Enemies use BFS to navigate around towers in real time
- **Dynamic Rerouting** — Enemies instantly reroute when towers are placed mid-wave
- **Health System** — Enemies deal 10 damage when reaching the goal; game ends at 0
- **Score System** — Points per kill scale with enemy type and wave number; wave completion bonus doubles if you finish at full health
- **Local High Score** — Best score persists in your browser and shows on the Game Over / Zone Secured screens
- **Enemy Glossary** — In-game stat sheet with color legend, HP, speed, gold, and score per enemy type
- **Wave Preview** — See the exact enemy composition of the next (or current) wave at a glance
- **Game Over & New Game** — Full reset flow with a single click
- **Pause** — Freezes the entire simulation (enemies, projectiles, cooldowns, timers) in place; resumes with no catch-up
- **Speed Control** — Real 1x / 2x / 3x game speed, composes with Pause

#### Map Progression & Unlocks
- **6 selectable maps** — The Clearway, The Switchback, The Needle, The Gauntlet, The Pylon Field, The Crucible — each with a distinct obstacle layout and a different open/buildable footprint
- **Win conditions** — every map has a target wave to survive to; reaching it ends the run with a **ZONE SECURED** victory screen instead of Signal Lost
- **Sequential unlocks** — maps unlock **one at a time**, in a fixed order (Clearway → Switchback → Needle → Gauntlet → Pylon Field → Crucible), determined by a measured relative-difficulty simulation rather than a guess. Progress persists locally across sessions.
- **Escalating targets** — win waves step up in three tiers: 25 (Clearway) → 35 (three maps) → 50 (two maps)
- **Endless mode** — from the victory screen, continue the same run seamlessly past the win wave with no reset
- **Harder difficulty** — unlocked per-map after beating it: −30% gold per kill, bosses at ×1.5 health (speed unchanged)

#### Sound
- **Procedurally synthesized audio** — Web Audio API only, no sample files; a generative ambient pad (drone + sparse pentatonic arpeggio) for music, plus 4 SFX (explosion, evolve confirm, wave start, game over)
- **Single mute control** in the settings menu — silences music and all SFX together, persists across sessions

#### Visuals — "NEON IRONLINE" theme
- **Shape language** — towers are static geometric hardware (octagon/diamond/chamfered-square/hexagon plates with rotating turrets, cool accents); enemies are heading-rotated hostile craft (dart/needle/bastion/dreadnought, warm accents). The distinction survives grayscale.
- **Tower placement materialize** — a quick scale-up-from-nothing pop when a tower is placed
- **Boss beam-down** — bosses (and only bosses) get a light-streak spawn effect; regular enemies keep the existing spawn-gate chevrons, since dense waves make a per-unit animation too expensive
- **Screen shake & low-health pulse** — a small shake on goal leaks, and a faint ambient red pulse while health is critical — both individually toggleable in settings
- **Spawn & goal gates** — animated portals (rotating cores, pulse rings, marching chevrons); the goal gate flips to alarm-red when health is low
- **Per-type projectiles** — cyan pulse bolts, violet rail tracers, gold mortar shells with echo trails, spinning stasis shards, chain-lightning arcs, a continuous laser beam
- **Muzzle flashes** — directional 3-ray flash at the actual muzzle tip (100ms)
- **Explosions** — additive shockwave rings with sparks; AOE blasts expand to the full splash radius
- **Health bars** — appear once a unit is damaged (boss always), 3-step color with segment ticks on heavies
- **Target reticles** — each tower paints corner ticks on its current victim in its own accent color
- **Tower rotation** — turrets track their targets; turret size and barrel length grow with level
- **Range indicators** — animated dashed circles when a tower is selected or being placed
- **Upgrade pips / evolved marker** — 4 pip slots track level; evolved towers swap to a diamond-and-tick marker
- **Stasis visual** — slowed enemies get a rotating hex cage + frost crystals (shape, not tint); rooted enemies get a solid ice block
- **60 FPS discipline** — static board pre-rendered once per map; glow via pre-built sprites (no per-frame shadowBlur); Path2D geometry cache

#### Game Flow
- **Map select screen** — auto-opens on a fresh board; shows all 6 maps in sequence order, locked ones dimmed with a padlock; beaten maps offer Normal/Harder and Survival/Endless toggles
- **Auto Wave Toggle** — automatically starts the next wave after a 5s countdown
- **"Send Now" Button** — skip the countdown and start the wave early
- **Wave Status Bar** — shows wave number, phase, and enemies remaining
- **Hotkeys** — 1-5 select the five base towers, Escape deselects
- **Cursor Mode** — "None" button clears the tower preview from the cursor
- **Settings menu** — screen shake, low-health pulse, boss beam-down, and sound, all independently toggleable and persisted
- **Error boundaries** — a render crash in the game view or settings menu shows an inline fault panel with a RETRY button instead of blanking the whole page

#### Technical
- **Server-Authoritative** — All game logic runs on the Go server
- **60 FPS Game Loop** — Smooth server-side updates at 60 frames per second
- **WebSocket Communication** — Real-time bidirectional state updates
- **Canvas Ref Pattern** — Animation loop reads from refs, never stale closures
- **Spawn Cancellation** — New Game instantly stops any running wave goroutine
- **Private stats** — SQLite-backed, no accounts or player names; one row per completed game (wave, score, duration) plus an internal `/stats` endpoint (concurrent players, totals, wave distribution, top scores) — not linked from the game itself
- **Debug Panel** — Toggleable panel with tower stats, enemy health, and phase info

### Tower Types

| Tower                | Cost | Range | Damage | Fire Rate | Special                                              |
|----------------------|------|-------|--------|-----------|------------------------------------------------------|
| Basic — "Pulse"      | $50  | 3.0   | 15     | 1.0/sec   | Reliable all-rounder                                 |
| Sniper — "Railgun"   | $100 | 6.0   | 50     | 0.5/sec   | Long-range, high single-target                       |
| Splash — "Mortar"    | $75  | 2.5   | 10     | 1.5/sec   | AOE: 60% damage in 1.5u radius, upgrades increase both |
| Slow — "Stasis"      | $60  | 3.5   | 8      | 0.8/sec   | 60% speed reduction, upgrades extend duration/strength |
| Tesla                | $150 | 4.0   | 20     | 0.8/sec   | Chain lightning: arcs to 2 nearby enemies at 50% damage; upgrades add arcs and reach (up to 5 at MK4) |

### Tower Upgrades

| Level | Upgrade Cost | Damage | Range | Notes                          |
|-------|-------------|--------|-------|--------------------------------|
| 1     | —           | base   | base  | Starting stats                 |
| 2     | = base cost | +20%   | +10%  | 1 gold ring                   |
| 3     | = base cost | +44%   | +21%  | 2 gold rings                  |
| 4 MAX | = base cost | +73%   | +33%  | 3 gold rings, MAX badge       |

Sell at any level refunds 70% of total gold spent.

### Tower Evolution

At level 4 (MAX), every tower can **evolve** into one of two permanent terminal
forms. Evolving costs **2× everything spent on the tower so far**, and that cost
is added to the tower's value (selling still refunds 70% of the total). The
choice is permanent — no undo, no further upgrades, no re-evolving — so the UI
asks for confirmation, one of only two irreversible actions in the game (the
other being which map's progression chain you're playing).

| Base    | Evolution     | Identity |
|---------|---------------|----------|
| Pulse   | Breach        | Close-range shredder — 55 dmg at 1.4/s, shorter reach |
| Pulse   | Barrage       | 3-shot volley at separate targets |
| Railgun | Piercer       | The rail shot punches through everything along its line |
| Railgun | Executioner   | Double damage below 20% health |
| Mortar  | Cluster       | 3.5u blast at full splash damage |
| Mortar  | Siege         | 60 dmg direct hits, pinpoint splash |
| Stasis  | Cryo Field    | Constant 40%-speed slow field, fires nothing |
| Stasis  | Deep Freeze   | Severe slow + 25% chance to root for 1.5s |
| Tesla   | Laser         | Continuous beam, 60 damage/sec, no travel time |
| Tesla   | Amplifier     | No damage; nearby towers get +25% damage and fire rate |

Each evolved form has its own silhouette on the board, and the in-game
glossary (Tower Registry tab) lists every path with stats and costs.

### Enemy Types

| Type                  | Health | Speed | Gold | Score      | Appears  |
|-----------------------|--------|-------|------|------------|----------|
| Basic — "Dart"        | 100    | 2.0   | +10  | 10 × wave  | Wave 1+  |
| Fast — "Needle"       | 50     | 4.0   | +8   | 15 × wave  | Wave 4+  |
| Tank — "Bastion"      | 300    | 1.0   | +25  | 30 × wave  | Wave 7+  |
| Boss — "Dreadnought"  | 1000   | 0.5   | +100 | 100 × wave | Wave 11+ |

Both health and speed scale with wave number — enemies get meaningfully
tougher past wave 5. On **Harder** difficulty, bosses additionally get ×1.5
health (speed unchanged) and all gold rewards drop 30%.

### Scoring

- **Kills**: base points (table above) × current wave number
- **Wave completion bonus**: 50 × wave — **doubled** if you finish the wave at full health
- **High score**: best run is saved locally in your browser, tracked across both Signal Lost and Zone Secured endings

### The Maps

Six selectable maps, each a distinct permanent obstacle layout that walls
towers can't be built on, with enemies pathing around them in real time. The
layout is server-authoritative: pathfinding, placement validation, and the
client renderer all read the same obstacle list per map.

| # | Map | Win Wave | Layout |
|---|-----|----------|--------|
| 1 | The Clearway | 25 | Fully open board — no obstacles, shortest path (20 cells) |
| 2 | The Switchback | 35 | Three vertical bulkheads force an S-shaped route (44-cell path) |
| 3 | The Needle | 35 | Single column gap — every enemy funnels through one cell |
| 4 | The Gauntlet | 35 | Two horizontal walls squeeze a straight three-row canyon |
| 5 | The Pylon Field | 50 | Six scattered 2×2 pylons — no forced route, build your own maze |
| 6 | The Crucible | 50 | Central island — mid-wave tower placement can flip traffic between its north and south face |

Maps unlock **one at a time**, in the order above, by beating the previous
one's win wave. The order was determined by a measured simulation (a
fixed-budget bot played every map at six tower-count levels), not by
obstacle count — that instinct turned out to be backwards: the zero-obstacle
Clearway produced a wave-25+ high-score run, while the obstacle-heavy
Switchback measured as the *easiest* map, since its long path gives towers
far more time on target per enemy.

### Wave Progression

| Waves | Enemy Mix |
|-------|-----------|
| 1–3   | Basic only (5–9 enemies) |
| 4–6   | Basic + Fast |
| 7–10  | Basic + Fast + Tank |
| 11+   | Full mix + bosses every wave (one more boss every 3rd wave, max 6), counts scale quadratically |

### 🚧 Coming Next
- Public deployment (self-hosted, on-server work not tracked in this repo)
- Small internal stats dashboard (the `/stats` endpoint already exists)
- Special stat display in upgrade panel (slow duration, splash radius)

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
│  - Tower targeting, shooting, selling, upgrading              │
│  - Projectile physics & collision                            │
│  - Enemy movement & BFS pathfinding                          │
│  - Wave spawner goroutine (cancellable, pause-aware)          │
│  - Win/victory detection, difficulty modifiers                │
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

> Also available: a multi-stage `Dockerfile` at the repo root, ready for
> self-hosting (`STATS_DB`/`ALLOWED_ORIGINS`/`PORT` env vars, all with sane
> defaults). Actual deployment (Caddy, Cloudflare Tunnel, DNS) is on-server
> work not tracked in this repo.

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

1. **Pick a map** — the selection screen shows all 6 in unlock order; only the first is open at the start
2. **Place towers** — Select a tower type (or press 1-5) and click the grid
3. **Start Wave** — Click Start Wave or enable Auto Wave
4. **Earn gold** — Kill enemies to earn gold for more towers
5. **Upgrade towers** — Click a placed tower and hit Upgrade to boost its stats
6. **Sell towers** — Sell to reorganize; refund is 70% of everything spent
7. **Survive to the win wave** — Reach it for a Zone Secured victory, or keep going past it in Endless
8. **Beat a map to unlock the next one** — plus Harder difficulty and Endless mode on the map you just cleared

### Tips
- Chokepoints (Switchback's three gaps, the Needle's single cell, the Gauntlet's canyon) are natural kill zones — stack towers there
- The Clearway and Pylon Field have no forced route — your tower placement *is* the maze
- Block corridors to force even longer routes (fully walled-in enemies stop and wait — they don't leak damage)
- Railguns have by far the longest range (6 cells) — place them centrally to cover multiple corridors
- Use Slow towers to keep tanks and bosses in your kill zone longer
- Splash towers shine at choke points where enemies bunch up
- Upgrade your key towers rather than spreading gold thin
- A boss appears in every wave from 11 onward — and another joins the pack every 3rd wave
- Harder difficulty cuts your gold income — budget upgrades more carefully than a Normal run

## 🛠️ Tech Stack

### Frontend
- React 18 with TypeScript
- HTML5 Canvas for rendering
- WebSocket for real-time communication
- Web Audio API for procedural sound
- Vite for development

### Backend
- Go 1.21+ for game server
- Gorilla WebSocket
- Server-side 60 FPS game loop
- Room-based architecture
- SQLite (pure-Go `modernc.org/sqlite` driver — no cgo/C toolchain required) for private stats

### Algorithms
- BFS Pathfinding
- Delta-time movement (frame-rate independent)
- Circle-based collision detection
- Spawn cancellation via Go channels

## 📂 Project Structure
```
rust-rush/
├── README.md / TODO.md / SETUP.md   # Docs live at the repo root
├── Dockerfile                 # Multi-stage build, ready for self-hosting
├── server/
│   ├── main.go                # Entry point: WebSocket + static serving + /stats
│   ├── e2e_test.go            # End-to-end WebSocket game flow test
│   └── internal/
│       ├── game/
│       │   ├── state.go       # Game state, towers, enemies, wave config, win/victory
│       │   ├── manager.go     # Game loop, wave spawner
│       │   ├── map.go         # 6-map registry, sequence order, win waves
│       │   └── *_test.go      # Behavior, pathfinding equivalence, progression, map-sim tests
│       ├── stats/
│       │   └── stats.go       # Private SQLite stats store
│       └── websocket/
│           ├── hub.go         # WebSocket broadcast hub
│           └── client.go      # Client connection & message handlers
└── client/
    └── src/
        ├── App.tsx            # WS wiring, UI state throttling, debug panel
        ├── settings.ts        # Effect preferences (localStorage-backed)
        ├── audio/
        │   └── sound.ts       # Procedural Web Audio engine (music + SFX)
        ├── game/
        │   └── GameCanvas.tsx # Rendering, input, map select, victory/game-over overlays
        ├── hooks/
        │   └── useWebSocket.ts
        ├── types/
        │   └── game.ts        # Shared types, tower costs, map data, grid constants
        └── ui/
            ├── SettingsMenu.tsx  # Settings modal (4 toggles: shake/pulse/beam-down/sound)
            └── ErrorBoundary.tsx # Wraps the game view and settings menu
```

## 🧪 Testing

### Automated tests
```bash
cd server && go test ./...
```
Covers game-logic behavior (scoring, upgrades, scaling, slow/splash, trapped
enemies, blocked waves), pathfinding equivalence against the reference BFS,
hub concurrency, map progression (win/victory/Endless/Harder), and an
end-to-end WebSocket game flow.

A separate, env-gated map-difficulty simulation (not run by default) backs
the map unlock ordering:
```bash
MAP_SIM=1 go test ./internal/game -run TestMapDifficultySimulation -v
```

```bash
cd client && npm run lint
```

### Start the server
```bash
cd server && go run main.go
```

### Manual Testing Checklist
- [x] Place all 5 tower types
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
- [x] Speed control (1x/2x/3x) and Pause freeze/resume the whole simulation correctly
- [x] Score increases on kills, jumps on wave completion (doubled at full health)
- [x] High score persists across browser sessions, "New High Score!" on beating it
- [x] Wave preview shows next wave composition, updates after each wave
- [x] Glossary panel opens/closes, colors match canvas enemies
- [x] Production build: `npm run build` + `go run main.go` serves the game on 8080
- [x] Tesla chain lightning arcs to nearby enemies at 50% damage
- [x] Evolution gated to MK4, costs 2× total spent, requires confirmation
- [x] All 10 evolved forms function and render distinct silhouettes
- [x] Evolved towers can't upgrade or re-evolve; sell still refunds 70%
- [x] Glossary Tower Registry lists all towers and evolution paths
- [x] Sound plays (music + 4 SFX), mute silences everything, persists across reload
- [x] Tower placement materialize, boss-only beam-down, screen shake on leaks, low-health pulse all render correctly and respect their settings toggles
- [x] Map select shows all 6 maps in sequence order; only unlocked ones are selectable
- [x] Beating a map's win wave shows Zone Secured, not Signal Lost
- [x] Continue (Endless) resumes the same run seamlessly past the win wave
- [x] Dying in an Endless continuation shows Signal Lost, not a second victory
- [x] Beating a map unlocks exactly the next map in sequence, and stays unlocked after reload
- [x] Harder difficulty reduces gold per kill and increases boss health, leaves boss speed and non-boss enemies untouched
- [x] REDEPLOY after a Harder loss redeploys as Harder, not silently reset to Normal

## 🐛 Known Issues

- Special upgrade stats (slow duration, splash radius) not shown in the tower info panel
- No small stats dashboard yet (the `/stats` JSON endpoint exists but isn't surfaced in any UI)

## 🚀 Future Plans

### Short Term
- Actual public deployment (self-hosted, on-server work)
- Special stat display in upgrade panel
- Small internal stats dashboard

### Medium Term
- Different game modes beyond Endless
- Map editor / user-created custom maps

### Long Term
- Multiplayer lobby
- User accounts and a real leaderboard
- Achievements
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

**Built with** 🐹 Go and ⚛️ React | **Status**: Beta Complete ✅ — sound, visual polish, speed/pause controls, settings menu, and full map progression & unlocks all shipped | **Last Updated**: July 16, 2026
