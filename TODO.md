# 🦀 Rust Rush - TODO List

## ✅ Completed

### Phase 1: Project Setup
- [x] Initialize project structure
- [x] Set up Go WebSocket server
- [x] Create React + TypeScript frontend
- [x] Configure PostgreSQL database
- [x] Create development environment docs

### Phase 2: A* Pathfinding
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

### Phase 12: Difficulty & Economy Balancing ✅ **NEW!**
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

### Phase 13: Tower Sell & Upgrades
- [x] Sell tower (70% refund) ✅
- [ ] Tower upgrade system (levels 1-3)
- [ ] Increased damage/range per level
- [ ] Visual indicator for tower level
- [ ] Upgrade cost scaling
- [ ] Upgrade UI in tower info panel

### Phase 14: Health & Scoring
- [x] Health reduction when enemy reaches goal ✅
- [x] Game over screen ✅
- [ ] Score system (points per kill, scaled by enemy type and wave)
- [ ] Wave completion bonus (full health = multiplier)
- [ ] Score display during game and on game over screen
- [ ] High score tracking (local)

### Phase 15: Enemy Glossary & Wave Preview
- [ ] Enemy stat sheet (type, HP, speed, gold reward)
- [ ] Wave preview panel showing upcoming enemy composition
- [ ] Enemy visual legend (color → type mapping)

---

## 📋 Planned Features

### Phase 16: Special Towers
- [ ] Freeze tower (slows enemies)
- [ ] Tesla tower (chain lightning)
- [ ] Mortar tower (long range AOE)
- [ ] Laser tower (continuous beam)
- [ ] Support tower (buff nearby towers)

### Phase 17: Sound & Music
- [ ] Background music
- [ ] Tower placement sound
- [ ] Tower shooting sounds
- [ ] Enemy death sounds
- [ ] Wave start/end sounds
- [ ] UI click sounds
- [ ] Mute/volume controls

### Phase 18: Visual Polish
- [ ] Tower placement animations
- [ ] Particle effects for hits
- [ ] Enemy spawn animation
- [ ] Screen shake on damage
- [ ] Background theme (grass, path)
- [ ] Enemy type visual improvements

### Phase 19: UI Improvements
- [ ] Mini-map
- [ ] Hotkeys for tower selection (1-4)
- [ ] Speed controls (1x, 2x, 3x)
- [ ] Settings menu
- [ ] Tutorial/help screen

### Phase 20: Multiplayer Features
- [ ] Lobby system
- [ ] Cooperative mode (shared resources)
- [ ] Competitive mode
- [ ] Chat system

### Phase 21: Persistence & Progression
- [ ] User accounts
- [ ] High score leaderboard
- [ ] Achievements system
- [ ] Save/load game state

### Phase 22: Advanced Features
- [ ] Map editor
- [ ] Custom maps
- [ ] Different game modes (endless, timed)
- [ ] Difficulty settings

---

## 🐛 Bug Fixes Completed ✅

- [x] ~~Enemies going through towers~~ (Fixed - server-side pathfinding)
- [x] ~~Tower placement restarting enemy position~~ (Fixed - state sync)
- [x] ~~Enemy backtracking on path recalculation~~ (Fixed - waypoint detection)
- [x] ~~Clear button not clearing enemies~~ (Fixed - clear_all message)
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

---

## 🔧 Technical Debt

- [ ] Optimize pathfinding for large grids
- [ ] Reduce WebSocket message size
- [ ] Add error boundaries in React
- [ ] Add server-side validation for tower placement
- [ ] Rate limiting for actions
- [ ] Connection recovery on network loss
- [ ] State synchronization on reconnect

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
- [ ] Difficulty balancing
- [ ] Score system
- [ ] Tower upgrades
- [ ] Sound effects
- [ ] Enemy glossary / wave preview
- [ ] High score tracking

### Full Release
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
- Tower upgrades not yet implemented (Phase 13)
- No score system yet (Phase 14)
- No sound

---

## 🎉 Recent Achievements (April 22, 2026)

### Phase 12 — Difficulty & Economy Balancing

1. **Enemy Scaling**
   - Health: +10% compound per wave above wave 5 (wave 10 = 1.6x, wave 20 = 2.6x base)
   - Speed: +3% compound per wave above wave 5, capped at +80% of base
   - Count: quadratic growth past wave 10 so late waves feel like a flood
   - Boss frequency: every 3rd wave from wave 11 (was every 5th)
   - Spawn delay floors at 0.25s (was 0.4s)

2. **Slow Tower**
   - Now applies a real 60% speed debuff for 2 seconds on hit
   - Hitting a slowed enemy refreshes the duration rather than stacking
   - Slowed enemies render blue with a light ring — visually readable at a glance

3. **Splash Tower**
   - Now deals true AOE damage: full damage to primary target, 60% to all enemies within 1.5 units
   - Splash projectiles render orange (matching tower color) and slightly larger
   - AOE explosions scale to the full splash radius so the effect is visible

### Playtesting Results
- Wave 20 reached with 40 health remaining and 66 enemies incoming ✅
- Economy stays tight at wave 20 ($165 gold) ✅
- 120 towers placed — density costs health rather than guaranteeing a win ✅
- All 4 tower types now have distinct, meaningful roles ✅

---

**Last Updated**: April 22, 2026
**Status**: Phase 12 Complete ✅ | Moving to Phase 13 (Tower Upgrades) 🚧
