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

### Phase 17: Tesla + Tower Evolution System ✅ **NEW!** (July 13 — superseded the original "5 new towers" plan per the Tower Evolution design doc)
- [x] Tesla base tower ($150, chain lightning; upgrades grow the chain: 2×/1.5u → 5×/2.1u)
- [x] Evolution mechanic: any MAX tower → one of two permanent terminal forms, cost 2× total_spent (added to total_spent so sell math is unchanged)
- [x] All 10 evolved forms: Breach/Barrage, Piercer/Executioner, Cluster/Siege, Cryo Field/Deep Freeze, Laser/Amplifier
- [x] New mechanics: multi-shot volley, piercing line shot, execute threshold, slow aura, root, continuous beam, damage/rate buff aura
- [x] Evolve UI with both options shown + confirmation step (first irreversible action in the game)
- [x] 10 distinct evolved silhouettes + arcs/beam/aura/root visuals (NEON IRONLINE style)
- [x] Tower glossary — Tower/Hostile Registry tabs, all stats + evolution paths
- [ ] Evolution cost balance review (2× multiplier is a first-draft number — Jaime's call)

### Phase 18: Sound & Music ✅ **NEW!** (July 14–15 overnight — see SESSION-LOG.md)
- [x] Procedurally synthesized audio via Web Audio API (oscillators/filters/envelopes) — no licensed/sourced sample packs, matches NEON IRONLINE's electronic aesthetic natively and needs no asset files
- [x] Background music — generative ambient synth pad loop (low drone + slow arpeggio), not a composed track; must be mutable
- [x] Explosion sound (tower hit/kill) — the only per-action combat SFX; deliberately skipping tower placement, shooting, and enemy death sounds per Jaime's "not overwhelming" direction
- [x] Evolve confirm sound
- [x] Wave start sound
- [x] Game over sound
- [x] Mute/volume controls — setting persists across sessions (localStorage, same pattern as high score); simple on/off mute (♪ button, now in the settings menu — see Phase 20), no slider

### Phase 19: Visual Polish ✅ (July 3 "NEON IRONLINE" overhaul; remaining items completed July 16 overnight — see SESSION-LOG.md)
- [x] Tower placement animation — ~180ms scale-up-from-nothing with a slight overshoot, no particles (unconditional, not toggleable — towers place one at a time)
- [x] Particle effects for hits (spark bursts + additive shockwave rings)
- [x] Enemy spawn animation — **boss enemies only**, a beam-down effect (narrowing vertical light streak + ground bloom, boss fades in under it, ~0.5s, no particle system). Basic/fast/tank enemies keep the existing spawn-gate chevrons only, no per-unit animation.
- [x] Screen shake — small/subtle (3.5px, 280ms, quadratic decay), triggers on health loss (goal leaks) only, not on tower hits
- [x] Faint red pulse — continuous slow ambient edge vignette while health is critical. ⚠️ Spec said "health < 5" but health only moves in −10 steps from 100, so literal <5 is unreachable while alive — implemented as < 50 (= fewer than 5 remaining leaks). One constant (`LOW_HEALTH_PULSE_THRESHOLD` in GameCanvas.tsx) if Jaime wants a different line.
- [x] Background theme (dark tech board: gradient, grid, bulkheads, vignette, animated portals)
- [x] Enemy type visual improvements (distinct heading-rotated silhouettes per type)

> Shake/red-pulse/beam-down are individually toggleable via `client/src/settings.ts` (all default ON), surfaced in the Phase 20 settings menu. Sound is toggled via the mute control (see Phase 20).

### Phase 20: UI Improvements ✅ (scoped July 16, completed July 16 overnight — see SESSION-LOG.md)
- [ ] ~~Mini-map~~ — **dropped July 16.** Board is fully visible on screen at 20×15; no use case identified.
- [x] Hotkeys — 1-5 select the five base towers (Pulse/Railgun/Mortar/Stasis/Tesla), Escape deselects to NONE. Guarded against focused text inputs; small key hints on the tower buttons.
- [x] Speed control — real 1x/2x/3x control + Pause replaces the binary FF toggle. Pause implemented for real server-side: the 60Hz loop keeps ticking but `Update()` early-returns while `Paused`, freezing enemies/projectiles/cooldowns/effects/game-clock exactly in place; `SpawnWave` holds its spawn timers while paused. `set_speed` accepts `{speed: 1|2|3}` (legacy `{fast_forward}` still works).
- [x] Settings menu — 4 toggles: screen shake, low-health red pulse, boss beam-down, and ♪ sound (music + SFX together, moved here from the header — header is now DEBUG + speed control + ⚙ SETTINGS). Persists via `rustRushSettings` (one JSON blob) + the existing `rustRushMuted` key. A separate 5th "Sound" toggle originally shipped alongside mute, duplicating it exactly (both gated the identical audio output) — caught and removed same day; mute is now the sole audio control.
- [ ] ~~Tutorial/help screen~~ — **dropped July 16.** Existing glossary covers it; not needed.

### Phase 21: Public Deployment ✅ shipped July 30, 2026
- [x] Self-host on NinjaUnraid (192.168.0.12) — not a hosting platform (Railway/Fly.io dropped free tiers, Render's free tier cold-starts after 15min idle — bad fit for a WebSocket game)
- [x] Dockerize the Go server, `pull_policy: never` pattern (matches ytplayer/ledgerview) — multi-stage `Dockerfile` at repo root, built + smoke-tested July 14–15; compose service example in the Dockerfile header
- [x] Caddy site block + Cloudflare Tunnel route — `rust-rush.jaime.build` (on-server work, not in repo)
- [x] Configure environment variables (port, CORS origin) — `PORT`, `STATS_DB`, `ALLOWED_ORIGINS` (+ existing `STATIC_DIR`), all with dev defaults
- [x] Update WebSocket URL to production endpoint (already derived from `window.location` in prod builds, per Phase 16)
- [x] Deploy and verify WebSocket connections work over the tunnel
- [x] Basic stats/metrics (private, no accounts/names): ✅ July 14–15
  - [x] SQLite file next to the server, one row per completed game (timestamp, wave reached, final score, duration), written on the `game_over` phase transition — pure-Go driver (`modernc.org/sqlite`), path via `STATS_DB`
  - [x] Concurrent player count from the existing hub client map (no new tracking needed)
  - [x] Internal `/stats` JSON endpoint (not linked publicly) — concurrent players, total games, wave distribution, top 10 scores
  - [ ] Small internal stats UI — later phase, not scoped yet
- [x] Share public link — live at `https://rust-rush.jaime.build`

### Phase 24: Advanced Features
- [x] 4-5 built-in map layouts with a map select screen (distinct from map editor/custom maps below — hand-designed/Fable-built, not user-created) — ✅ July 14–15: 6-map registry (Clearway/Switchback/Gauntlet/Crucible/Needle/Pylon Field), per-room selection via `new_game`, NEON select screen. Per-map difficulty variance (path lengths 20–44 cells) flagged, then **playtested and closed July 15–16**: wave 25 + new high score on Clearway (shortest path, expected hardest) — no rebalance needed.
- ~~Different game modes (endless, timed)~~ — folded into Phase 25 below (endless returns as a post-unlock option, timed dropped)
- ~~Difficulty settings~~ — folded into Phase 25 below (harder difficulty returns as a post-unlock option, not a freely-selectable preset)

> Map editor and user-created custom maps moved to **Future Enhancements** (see below) — deprioritized July 16.

### Phase 25: Map Progression & Unlocks — ✅ built, reviewed, fully playtested, and committed July 16

**The core idea:** each of the 6 maps gets a win condition (survive to a target wave), maps unlock **one at a time in a single fixed sequence** by beating the previous one, and beating a map unlocks post-game options (Endless, and/or a Harder difficulty) selectable on that map going forward.

- [x] Order all 6 maps into a single 1-6 sequence — **decided via measured simulation** (`map_difficulty_sim_test.go`, identical fixed-budget bot build on every map): Clearway (25) → Switchback (35) → Needle (35) → Gauntlet (35) → Pylon Field (50) → Crucible (50). Full reasoning in SESSION-LOG.md.
- [x] Win-wave targets confirmed: 25 / 35 / 35 / 35 / 50 / 50 — wired as `WinWave` on `MapDef`
- [x] Single fixed sequence — `SequenceOrder` on `MapDef`, `localStorage` "furthest map beaten" integer (`rustRushFurthestMapBeaten`), locked map cards render dimmed with a padlock in sequence order
- [x] Victory screen — "ZONE SECURED", green/gold, CONTINUE (ENDLESS) / MAP SELECT, new `victory` phase server-side
- [x] Harder difficulty — gold per kill −30%, boss health ×1.5, boss speed unchanged; NORMAL/HARDER + SURVIVAL/ENDLESS toggles on the map-select screen for beaten maps
- [x] Build — done, verified end-to-end (7 new Go tests + 30-check Playwright browser pass)
- [x] **Jaime's live playtest — full checklist, all confirmed:** fresh-state locks, ZONE SECURED display, CONTINUE (ENDLESS) seamless carry-over, Endless-then-death correctly shows SIGNAL LOST (not a second victory), map unlock progression, HARDER difficulty (lower gold, tougher bosses), unlock persistence across reload, REDEPLOY carrying HARDER forward
- [x] Sound/mute toggle redundancy caught during playtest and fixed same day (see Phase 20)
- [x] Committed and pushed July 16, along with the sound/mute fix and the README/TODO/vault documentation refresh

---

## 🔮 Future Enhancements

Deprioritized July 16, 2026 — moved out of the active roadmap so Phases 19/20/24 (remaining) and tech debt can get finished first. Not abandoned, just not next.

### Multiplayer Features (was Phase 22)
- [ ] Lobby system
- [ ] Cooperative mode (shared resources)
- [ ] Competitive mode
- [ ] Chat system

### Persistence & Progression (was Phase 23)
- [ ] User accounts
- [ ] High score leaderboard
- [ ] Achievements system
- [ ] Save/load game state

### Map Editor & Custom Maps (was part of Phase 24)
- [ ] Map editor
- [ ] Custom maps

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
- [x] ~~Sealing the lane mid-wave farmed free damage~~ (Fixed August 19 — walled-in enemies freeze without leaking (correct), but the player could seal the route, let towers shoot them for free, then reopen it. `AddTower` now rejects any placement that would leave no spawn→goal path (`ErrPathBlocked`), so the setup can't happen; a new `check_placement` query drives a live three-state placement ghost so the rejection is visible before the click. See SESSION-LOG.md)

---

## 🔧 Technical Debt

- [x] Optimize pathfinding for large grids ✅ (July 2 — integer-indexed BFS with parent reconstruction: 47× faster, 294× fewer allocations, byte-identical paths)
- [x] Reduce WebSocket message size ✅ (July 2 — enemy paths no longer serialized (~27% of snapshot payload); envelope wrapping no longer re-parses the snapshot (~7.7× less JSON CPU))
- [x] Add error boundaries in React ✅ (July 16 overnight — `ui/ErrorBoundary.tsx` wraps GameCanvas and the settings menu; a render crash shows an inline fault panel with RETRY instead of blanking the page)
- [x] Add server-side validation for tower placement ✅ (was already done in the July 3 session — bounds/occupied/wall/spawn/goal/type all checked in `AddTower`; this checkbox was stale)
- [ ] Rate limiting for actions — note: `check_placement` (August 19) is the first per-hover message; it self-limits to one request per newly hovered cell, but it is the obvious first candidate if this gets built
- [ ] Connection recovery on network loss
- [ ] State synchronization on reconnect
- [ ] Single-source gameplay constants (tower costs/ranges, enemy glossary are hand-mirrored in the client — consider a server-sent config on join). *Deliberately skipped July 16 overnight: touches the join flow, per-session risk rule.*
- [x] Delete `game-engine/` (legacy Rust prototype with diverged stats) and `database/` (unused schema) ✅ (July 16 overnight — both fully deleted, doc references in README/SETUP removed; left unstaged for review)

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
- [x] Sound effects ✅
- [x] Enemy glossary / wave preview ✅
- [x] High score tracking ✅
- [x] Local production build (one terminal) ✅

### Full Release
- [x] Public deployment (shareable link) ✅ July 30, 2026 — live at `rust-rush.jaime.build`
- [ ] Multiplayer *(moved to Future Enhancements — deprioritized July 16)*
- [ ] User accounts *(moved to Future Enhancements — deprioritized July 16)*
- [ ] Leaderboards *(moved to Future Enhancements — deprioritized July 16)*
- [ ] Achievements *(moved to Future Enhancements — deprioritized July 16)*
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

## 🎉 Recent Achievements (July 13, 2026)

### Phase 17 — Tesla + Tower Evolution System

1. **Tesla tower** — fifth base tower ($150): chain lightning arcs from the
   primary target to nearby enemies at 50% damage. Upgrades grow the chain
   itself (2 arcs/1.5u at MK1 → 5 arcs/2.1u at MK4) on top of the standard
   damage/range curve, so upgrading buys Tesla's multi-target identity.
2. **Evolution mechanic** — every MAX (MK4) tower can permanently evolve into
   one of two terminal forms for 2× its `total_spent`; the cost is added to
   `total_spent`, so the 70% sell refund needed zero special-casing. Both
   options shown before committing, with a confirmation step (the game's first
   irreversible action). Evolved towers can't upgrade, re-evolve, or revert.
3. **10 terminal forms** — Breach/Barrage (Pulse), Piercer/Executioner
   (Railgun), Cluster/Siege (Mortar), Cryo Field/Deep Freeze (Stasis),
   Laser/Amplifier (Tesla). Seven brand-new mechanics: multi-target volley,
   piercing line shots, execute thresholds, a continuous slow aura, roots,
   a no-projectile beam, and a tower-buffing aura.
4. **Visuals** — 10 fully distinct evolved silhouettes (shape is the
   discriminator), plus lightning arcs, laser beam, aura fields, ice-block
   root, per-family projectiles, and an evolved marker replacing level pips.
5. **Tower glossary** — the glossary panel now has Tower Registry / Hostile
   Registry tabs; the tower tab lists all 5 base towers (stats + upgrade
   notes) and all 10 evolutions (stat lines + descriptions + cost formula).
6. **Verified** — 14 new Go tests (40 total, all green), tsc/eslint/build
   clean, and Playwright-driven browser playtest covering every evolution
   path through the real UI, with screenshot review of silhouettes, arcs,
   beam, auras, cages, and roots.

⚠️ **Flagged for Jaime**: evolution costs (the 2× multiplier, especially
Tesla's $1,200) are design-doc first drafts. Income modeling says Tesla's
evolution lands around wave 14–18 in a normal run — attainable, but expect
only 1–2 evolutions per run by wave 20. See SESSION-LOG.md for the numbers.

---

**Last Updated**: July 30, 2026 (Phase 21 deployment shipped)
**Status**: Phase 21 (Public Deployment) ✅ fully shipped — live at `https://rust-rush.jaime.build`, WebSocket verified working through the Cloudflare Tunnel, Uptime Kuma monitoring active. This was the last item before Jaime's "temporarily done" milestone. **The project has now reached that milestone.**
