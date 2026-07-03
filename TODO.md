# 🦀 Rust Rush - TODO List

## ✅ Completed

### Phase 1: Project Setup
- [x] Initialize project structure
- [x] Set up Go WebSocket server
- [x] Create React + TypeScript frontend
- [x] ~~Configure PostgreSQL database~~ (legacy — schema exists in `database/` but nothing connects to it; state is in-memory. Revisit in Phase 23.)
- [x] Create development environment docs

### Phase 2: Pathfinding (BFS — the A* implementation only ever lived in the legacy Rust prototype)
- [x] Implement BFS pathfinding in Go
- [x] Path reconstruction
- [x] Integration with Enemy struct
- [x] Auto-recalculation on tower placement

### Phase 3: WebSocket Communication
- [x] Create useWebSocket custom hook
- [x] Auto-reconnect with exponential backoff
- [x] Message type system
- [x] Connection status display
- [x] Go server message handlers
- [x] Room-based multiplayer support

### Phase 4: Tower Visualization
- [x] Tower rendering on canvas
- [x] Different colors per tower type
- [x] Range preview on hover
- [x] Prevent double placement
- [x] Tower costs displayed
- [x] TypeScript type definitions

### Phase 5: Enemy Animation
- [x] 60 FPS animation loop with requestAnimationFrame
- [x] Smooth enemy movement along paths
- [x] Enemy rendering with health bars
- [x] Spawn (S) and Goal (G) markers
- [x] Delta-time based movement

### Phase 6: Dynamic Pathfinding
- [x] BFS pathfinding implementation
- [x] Enemies avoid towers
- [x] Path recalculation when towers placed
- [x] Smooth path transitions
- [x] Path blocking detection
- [x] Trapped enemies stop moving

### Phase 7: Tower Shooting Mechanics
- [x] Server-side game loop at 60 FPS
- [x] Detect enemies in tower range
- [x] Tower rotation toward target (real-time)
- [x] Projectile creation and movement
- [x] Projectile rendering with trails
- [x] Hit detection
- [x] Muzzle flash effects
- [x] Fire rate cooldown system
- [x] Different tower stats per type
- [x] Server-authoritative architecture

### Phase 8: Damage System
- [x] Apply damage to enemies on hit
- [x] Health reduction (real-time sync)
- [x] Enemy death detection
- [x] Explosion effects on hit
- [x] Remove dead enemies from game
- [x] Award gold for kills (scaled by enemy type)
- [x] Visual feedback for damage (health bars)

### Phase 9: Server-Side Enemy Movement
- [x] Enemy movement handled by server
- [x] Path following with waypoint progression
- [x] Health deduction when enemies reach goal (-10)
- [x] Client renders server state only
- [x] Smooth 60 FPS movement

### Phase 10: Real-Time Pathfinding
- [x] Server-side BFS pathfinding
- [x] Dynamic path recalculation on tower placement
- [x] All enemies reroute simultaneously
- [x] Trapped enemy detection
- [x] Works during active waves

### Phase 11: Wave System ✅ **NEW!**
- [x] Wave configuration with enemy progression
- [x] Start Wave button functional
- [x] Multiple enemy types per wave (basic, fast, tank, boss)
- [x] Configurable spawn delays (decrease with wave number)
- [x] Wave counter increments on completion
- [x] Wave completion detection (no enemies + none remaining)
- [x] Auto Wave toggle with 5s countdown
- [x] "Send Now" button to skip countdown
- [x] Start Wave disabled during active wave
- [x] Gold deduction on tower placement
- [x] Insufficient funds blocks placement
- [x] Tower buttons show affordability
- [x] Tower sell system (click to select, 70% refund)
- [x] Tower info panel (range, damage, fire rate)
- [x] Cursor/None mode to deselect tower type
- [x] Game Over screen with Play Again button
- [x] New Game resets cleanly in one click
- [x] New Game cancels active spawn goroutine
- [x] Fix frozen explosion sprites on wave end
- [x] Fix frozen projectile sprites on wave end
- [x] Fix wave freeze when path fully blocked
- [x] Canvas uses refs for stale-closure-free rendering

---

## 🚧 In Progress / Next Up

### Phase 12: Difficulty & Economy Balancing ✅
- [x] Enemy health scales with wave number (+10% compound per wave above wave 5)
- [x] Enemy speed scales with wave number (+3% compound per wave above wave 5, capped at +80%)
- [x] Enemy count ramp adjusted — quadratic growth past wave 10
- [x] Boss frequency increased (every 3rd wave from wave 11, was every 5th)
- [x] Boss spawn delay scales down at higher waves
- [x] Spawn delay floor lowered to 0.25s (was 0.4s)
- [x] Slow tower actually slows enemies (60% speed reduction for 2s, refreshable)
- [x] Slowed enemies render blue with ring indicator
- [x] Splash tower deals real AOE damage (1.5 unit radius, 60% damage to nearby enemies)
- [x] Splash projectiles render orange and larger to distinguish from basic
- [x] AOE explosions render at full splash radius so effect is visible
- [x] Playtesting target met: average player struggles around wave 20

### Phase 13: Tower Upgrades ✅ **NEW!**
- [x] Tower upgrade system (levels 1-4, 3 upgrades per tower)
- [x] +20% damage and +10% range compound per level
- [x] Slow tower upgrades: duration 2s→3.5s, multiplier 0.40→0.25 across levels
- [x] Splash tower upgrades: AOE radius 1.5→2.4, AOE damage 60%→90% across levels
- [x] Upgrade cost equals base tower cost per level
- [x] Sell refunds 70% of total spent (base + all upgrades)
- [x] Gold rings on canvas: 1 ring = level 2, 2 rings = level 3, 3 rings = level 4
- [x] Selection ring pushed outside upgrade rings so gold rings always visible
- [x] Tower body stays type color when selected (was incorrectly turning white)
- [x] Upgrade button in info panel (gold when affordable, gray when not, MAX label at level 4)
- [x] Info panel syncs immediately on upgrade without requiring reselect
- [x] Fast forward mode: 3x game speed (movement, shooting, spawning, effects)
- [x] FF button in header, orange when active, resets on New Game
- [x] Removed Clear All button (redundant with New Game + Sell)

### Phase 14: Health & Scoring ✅
- [x] Health reduction when enemy reaches goal ✅
- [x] Game over screen ✅
- [x] Score system (points per kill, scaled by enemy type and wave)
- [x] Wave completion bonus (full health = 2x multiplier)
- [x] Score display during game and on game over screen
- [x] High score tracking (local, persists in browser localStorage)

### Phase 15: Enemy Glossary & Wave Preview ✅
- [x] Enemy stat sheet (type, HP, speed, gold reward, score)
- [x] Wave preview panel showing upcoming enemy composition (server-provided)
- [x] Enemy visual legend (color → type mapping, shared with canvas renderer)

### Phase 16: Local Production Build ✅
- [x] Build React app to static files (`npm run build`)
- [x] Go server serves static files from `client/dist`
- [x] Single binary, single port (8080), no Vite dev server needed
- [x] One terminal to run the whole game locally
- [x] Update README with production run instructions

---

## 📋 Planned Features

### Phase 17: Special Towers
- [ ] Freeze tower (slows enemies)
- [ ] Tesla tower (chain lightning)
- [ ] Mortar tower (long range AOE)
- [ ] Laser tower (continuous beam)
- [ ] Support tower (buff nearby towers)

### Phase 18: Sound & Music
- [ ] Background music
- [ ] Tower placement sound
- [ ] Tower shooting sounds
- [ ] Enemy death sounds
- [ ] Wave start/end sounds
- [ ] UI click sounds
- [ ] Mute/volume controls

### Phase 19: Visual Polish (largely done July 3 — "NEON IRONLINE" overhaul)
- [ ] Tower placement animations
- [x] Particle effects for hits (spark bursts + additive shockwave rings)
- [ ] Enemy spawn animation (spawn gate has marching chevrons; per-unit animation still open)
- [ ] Screen shake on damage
- [x] Background theme (dark tech board: gradient, grid, bulkheads, vignette, animated portals)
- [x] Enemy type visual improvements (distinct heading-rotated silhouettes per type)

### Phase 20: UI Improvements
- [ ] Mini-map
- [ ] Hotkeys for tower selection (1-4)
- [ ] Speed controls (1x, 2x, 3x)
- [ ] Settings menu
- [ ] Tutorial/help screen

### Phase 21: Public Deployment
- [ ] Choose hosting platform (Railway, Render, or Fly.io — all have free tiers)
- [ ] Dockerize the Go server
- [ ] Configure environment variables (port, CORS origin)
- [ ] Update WebSocket URL to production endpoint
- [ ] Deploy and verify WebSocket connections work in production
- [ ] Custom domain (optional)
- [ ] Share public link

### Phase 22: Multiplayer Features
- [ ] Lobby system
- [ ] Cooperative mode (shared resources)
- [ ] Competitive mode
- [ ] Chat system

### Phase 23: Persistence & Progression
- [ ] User accounts
- [ ] High score leaderboard
- [ ] Achievements system
- [ ] Save/load game state

### Phase 24: Advanced Features
- [ ] Map editor
- [ ] Custom maps
- [ ] Different game modes (endless, timed)
- [ ] Difficulty settings

---

## 🐛 Bug Fixes Completed ✅

- [x] ~~Enemies going through towers~~ (Fixed - server-side pathfinding)
- [x] ~~Tower placement restarting enemy position~~ (Fixed - state sync)
- [x] ~~Enemy backtracking on path recalculation~~ (Fixed - waypoint detection)
- [x] ~~Clear button not clearing enemies~~ (Fixed - clear_all message; both button and message were later removed in Phase 13)
- [x] ~~Towers not rotating~~ (Fixed - server calculates rotation)
- [x] ~~Dead enemies not disappearing~~ (Fixed - server removes on death)
- [x] ~~Only first tower shooting~~ (Fixed - all towers update)
- [x] ~~Enemies not re-pathing mid-wave~~ (Fixed - dynamic recalculation)
- [x] ~~Gold not deducting on tower placement~~ (Fixed - Phase 11)
- [x] ~~Frozen explosion/projectile sprites after wave~~ (Fixed - Phase 11)
- [x] ~~Wave freezes when path blocked~~ (Fixed - skip blocked spawns)
- [x] ~~Wave carries over after New Game~~ (Fixed - cancel channel)
- [x] ~~New Game required two clicks~~ (Fixed - client resets immediately)
- [x] ~~Stale enemy rendering after wave clear~~ (Fixed - canvas ref pattern)
- [x] ~~Trapped enemies leaked -10 health and vanished~~ (Fixed July 2 — they now stop and wait, resume when a path reopens; regression-tested)
- [x] ~~Wave started against a fully blocked path soft-locked the game~~ (Fixed July 2 — blocked spawns are skipped so the wave completes; regression-tested)
- [x] ~~Hub broadcast raced the clients map (potential server crash) and could double-close a client channel~~ (Fixed July 2 — mutex + single close site; stress-tested)
- [x] ~~Snapshots never carried fast_forward/speed_multiplier~~ (Fixed July 2 — caught by the new end-to-end test; FF button now server-derived and reload-safe)
- [x] ~~Same-second connections got identical client IDs~~ (Fixed July 2 — counter-suffixed IDs)
- [x] ~~Concurrent joins could create duplicate rooms with doubled game loops~~ (Fixed July 2 — atomic get-or-create)

---

## 🔧 Technical Debt

- [x] Optimize pathfinding for large grids ✅ (July 2 — integer-indexed BFS with parent reconstruction: 47× faster, 294× fewer allocations, byte-identical paths)
- [x] Reduce WebSocket message size ✅ (July 2 — enemy paths no longer serialized (~27% of snapshot payload); envelope wrapping no longer re-parses the snapshot (~7.7× less JSON CPU))
- [ ] Add error boundaries in React
- [ ] Add server-side validation for tower placement (bounds, occupied cells, spawn/goal cells — server currently checks gold only)
- [ ] Rate limiting for actions
- [ ] Connection recovery on network loss
- [ ] State synchronization on reconnect
- [ ] Single-source gameplay constants (tower costs/ranges, enemy glossary are hand-mirrored in the client — consider a server-sent config on join)
- [ ] Delete or clearly quarantine `game-engine/` (legacy Rust prototype with diverged stats) and `database/` (unused schema)

---

## 🎯 Milestone Goals

### MVP ✅ COMPLETE
- [x] Tower placement, pathfinding, rendering, shooting, damage, gold/health

### Alpha Release ✅ COMPLETE
- [x] 4 tower types
- [x] Wave system with multiple enemy types
- [x] Tower sell
- [x] Game over / new game flow
- [x] Auto wave

### Beta Release (Next Target)
- [x] Score system ✅
- [x] Tower upgrades ✅
- [ ] Sound effects
- [x] Enemy glossary / wave preview ✅
- [x] High score tracking ✅
- [x] Local production build (one terminal) ✅

### Full Release
- [ ] Public deployment (shareable link)
- [ ] Multiplayer
- [ ] User accounts
- [ ] Leaderboards
- [ ] Achievements
- [ ] Mobile responsive
- [ ] Tutorial

---

## 💡 Ideas Parking Lot

- Mobile app (React Native?)
- Steam release
- Mod support
- Level editor
- Seasonal events
- Speed run mode
- Challenge maps

---

## 🎉 Recent Achievements (April 21, 2026)

### Phase 11 — Wave System & Core Gameplay Loop

1. **Wave System**
   - Enemy progression: basics (1-3) → fast (4-6) → tanks (7-10) → boss (11+)
   - Configurable spawn delays that decrease with wave number
   - Wave completion detection and counter
   - Auto Wave toggle with 5s countdown and "Send Now" shortcut

2. **Economy**
   - Gold deducts on tower placement
   - Gold rewards scaled by enemy type
   - Tower sell at 70% refund with info panel

3. **Game Flow**
   - Game Over screen with Play Again
   - New Game resets server and client instantly
   - New Game cancels active wave spawn goroutine cleanly

4. **Bug Fixes**
   - Frozen explosion/projectile sprites after wave end
   - Wave freeze on blocked path
   - Stale canvas rendering via ref pattern

### Performance (Wave 55 stress test)
- 60 FPS maintained ✅
- 100+ towers without lag ✅
- 18+ simultaneous enemies ✅
- Stable across 55+ waves ✅

### Known Issues to Address Next
- No tower upgrade UI for special stats (slow duration, splash radius not shown in panel)
- No sound

---

## 🎉 Recent Achievements (April 22, 2026)

### Phase 12 — Difficulty & Economy Balancing

1. **Enemy Scaling**
   - Health: +10% compound per wave above wave 5
   - Speed: +3% compound per wave above wave 5, capped at +80% of base
   - Count: quadratic growth past wave 10
   - Boss frequency: every 3rd wave from wave 11 (was every 5th)
   - Spawn delay floors at 0.25s (was 0.4s)

2. **Slow Tower**
   - 60% speed debuff for 2 seconds, refreshes on re-hit
   - Slowed enemies render blue with ring indicator

3. **Splash Tower**
   - True AOE: full damage to target, 60% to enemies within 1.5 units
   - Orange projectiles, AOE explosion scales to full radius

### Playtesting Results
- Wave 20 reached with 40 health and 66 enemies incoming ✅
- Economy stays tight at wave 20 ✅
- All 4 tower types now have distinct roles ✅

### Phase 13 — Tower Upgrades

1. **Upgrade System**
   - 4 levels per tower (3 upgrades), cost = base tower price per upgrade
   - +20% damage and +10% range compound per level
   - Slow upgrades: duration 2s→3.5s, slow strength 0.40→0.25 multiplier
   - Splash upgrades: AOE radius 1.5→2.4 units, AOE damage 60%→90%
   - Sell refunds 70% of total spent including upgrades

2. **Visuals**
   - Gold rings radiate outward from tower body (1/2/3 rings for levels 2/3/4)
   - Selection ring pushed outside outermost upgrade ring
   - Tower body stays type color when selected
   - MAX badge replaces upgrade button at level 4

3. **Quality of Life**
   - Fast forward mode (3x speed) for testing high waves quickly
   - Removed Clear All button
   - Fixed upgrade panel not updating until tower was reselected

---

## 🎉 Recent Achievements (July 1, 2026)

### Phase 14 — Score System

1. **Scoring**
   - Kill points = base points × wave number (basic 10, fast 15, tank 30, boss 100)
   - Wave completion bonus = 50 × wave, doubled when finishing at full health
   - Score is server-authoritative, rides the existing game_state broadcast

2. **High Score**
   - Best score persists in browser localStorage
   - Game Over screen shows final score and "New High Score!" when beaten
   - ⭐ Score and 🏆 Best always visible in the info bar

### Phase 15 — Enemy Glossary & Wave Preview

1. **Wave Preview** — server includes next/current wave composition in every
   snapshot; client shows it as a strip with color dots + counts
2. **Glossary** — toggleable panel with per-enemy color legend, HP, speed,
   gold, score, and first-appearance wave; colors shared with the canvas renderer

### Phase 16 — Local Production Build

- `npm run build` → `client/dist`, Go server serves it on port 8080
- One terminal runs the whole game; WS URL derived from page location in prod
- Works via `go run main.go` (from `server/`) or a built binary from the repo root
- Fixed pre-existing tsc errors that had broken `npm run build`

---

## 🎉 Recent Achievements (July 2, 2026)

### Documentation Audit + Code Quality/Performance Pass

1. **Audit** — every TODO checkbox and README claim verified against code
   (details in SESSION-LOG.md). Most held up; the confirmed-wrong ones are
   fixed and regression-tested, the stale docs (SETUP.md, project structure,
   Postgres/A* claims) are corrected.

2. **Correctness fixes** (all previously latent, all now tested)
   - Trapped enemies stop instead of leaking damage and vanishing
   - Fully-blocked wave start completes instead of soft-locking
   - Hub clients map race + double-close panic paths eliminated
   - start_wave / join_room TOCTOU races closed (atomic phase gate, atomic room create)
   - Snapshots now carry fast_forward; FF button survives page reload
   - Unique client IDs; spawn-cancel captured before phase flip

3. **Server performance**
   - Broadcast envelope no longer unmarshals+remarshals every snapshot (~7.7× less JSON work/tick)
   - Enemy paths dropped from the wire (~27% smaller snapshots)
   - BFS rewritten: 2.6µs vs 122µs per search, byte-identical paths (equivalence-tested)
   - Stat tables hoisted, squared-distance comparisons, in-place slice filtering

4. **Client performance**
   - Removed the 60/sec console.log of every snapshot (retained objects, burned CPU)
   - React commits throttled to 10 Hz with trailing edge + instant phase flushes;
     canvas keeps reading every snapshot at 60 FPS via a live ref
   - WebSocket hook delivers via subscription (no more 2 App renders per message);
     StrictMode socket leak fixed
   - Grid drawn in 1 stroke instead of 37; AOE explosion animation clamp
   - ESLint config restored (lint was inoperable); all hook-deps warnings fixed

5. **Dead code removed** — legacy room system, clear_all remnants,
   `server/cmd/main.go` (+ godotenv dep), duplicated client BFS,
   root package.json/lock, structure.txt

6. **New test suite** — 22 tests: behavior, pathfinding equivalence,
   hub concurrency, and a full end-to-end WebSocket game flow (`go test ./...`)

---

## 🎉 Recent Achievements (July 3, 2026)

### Visual Overhaul — "NEON IRONLINE" + The Switchback map

1. **Map**: three permanent bulkheads (server-authoritative obstacles) turn the
   straight 20-cell lane into a 44-cell S-route with three chokepoints.
   Pathfinding, placement validation (new: bounds/occupied/wall/portal/type
   checks server-side), and the client renderer all share one obstacle list.
   ⚠️ Balance note: the longer route makes waves meaningfully easier at the
   same wave numbers — difficulty retune is a candidate follow-up.
2. **Rendering**: full canvas rewrite — shape-first design (towers = static
   geometric hardware with rotating turrets; enemies = heading-rotated craft),
   pre-rendered static board, glow sprites instead of per-frame shadowBlur,
   Path2D geometry cache, per-type projectiles, directional muzzle flashes,
   additive explosions, animated portals, target reticles, upgrade pips,
   stasis cages, damage-gated health bars.
3. **UI**: monospace HUD shell — chamfered buttons, corner-bracket panels,
   LABEL/value stat bar, tower buttons with live SVG silhouettes, enemy
   glossary/wave-preview with shape glyphs, CRT scanline film.
4. **Fixed along the way**: canvas clicks now use the click's own coordinates
   (the old hover-ref lagged one render — automation/fast clicks placed on the
   wrong cell); enemy names got codenames (Dart/Needle/Bastion/Dreadnought).
5. **Verified**: full Go test suite (26 tests incl. new map/validation tests,
   path-equivalence re-proven over the bulkhead map), eslint + tsc clean, and
   screenshot-driven browser verification of idle/placement/invalid-hover/
   selection/combat/upgrade/glossary states via Playwright + Edge.

---

**Last Updated**: July 3, 2026
**Status**: Phase 16 Complete ✅ + quality pass + visual overhaul 🎨 | Next: sound, special towers, deployment (Phases 17+) 🚧
