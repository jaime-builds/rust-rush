package game

import (
	"sync"
	"time"
)

// GamePhase represents the current phase of the game
type GamePhase string

const (
	PhaseWaiting  GamePhase = "waiting"
	PhaseActive   GamePhase = "active"
	PhaseGameOver GamePhase = "game_over"
	// PhaseVictory is the win state: a non-Endless run whose wave counter
	// reached the map's WinWave. A distinct phase (not a flag on game_over)
	// so every existing game_over consumer — loss overlay, loss sting, stats
	// copy — keeps meaning exactly "loss"; a consumer that doesn't know about
	// victory shows nothing rather than showing a loss screen on a win.
	PhaseVictory GamePhase = "victory"
)

// Difficulty variants. Harder is unlocked per-map by beating it (client-side
// gate); the server just applies the modifiers when asked.
const (
	DifficultyNormal = "normal"
	DifficultyHarder = "harder"
)

// Harder-difficulty modifiers (confirmed numbers from the Map Progression
// design doc): −30% gold per kill, ×1.5 boss health, boss speed deliberately
// unchanged.
const (
	harderGoldMult       = 0.7
	harderBossHealthMult = 1.5
)

// Position represents a 2D coordinate
type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Tower represents a defensive structure
type Tower struct {
	ID            int      `json:"id"`
	Position      Position `json:"position"`
	TowerType     string   `json:"tower_type"`
	Level         int      `json:"level"`
	Range         float64  `json:"range"`
	Damage        float64  `json:"damage"`
	FireRate      float64  `json:"fire_rate"`
	Cooldown      float64  `json:"cooldown"`
	Rotation      float64  `json:"rotation"`
	CurrentTarget int      `json:"current_target,omitempty"`
	TotalSpent    int      `json:"total_spent"`
	// Slow tower upgrade fields
	SlowDuration   float64 `json:"slow_duration_upgrade,omitempty"`
	SlowMultiplier float64 `json:"slow_multiplier_upgrade,omitempty"`
	// Splash tower upgrade fields
	AOERadius float64 `json:"aoe_radius_upgrade,omitempty"`
	AOEDamage float64 `json:"aoe_damage_pct_upgrade,omitempty"`
	// Tesla chain lightning fields (scale with level)
	ChainCount  int     `json:"chain_count,omitempty"`
	ChainRadius float64 `json:"chain_radius,omitempty"`
	// Evolution state: true once the tower has taken a terminal form (its
	// TowerType is then one of the ten evolved type strings).
	Evolved   bool `json:"evolved,omitempty"`
	MultiShot int  `json:"multi_shot,omitempty"`
	// Prices, filled on snapshots only (see withPrices) so the client shows
	// exactly what the server will charge or pay instead of re-deriving it
	// from hand-copied rules. UpgradeCost is 0 at max level or once evolved;
	// EvolveCost is set only when the tower can evolve.
	SellValue   int `json:"sell_value"`
	UpgradeCost int `json:"upgrade_cost,omitempty"`
	EvolveCost  int `json:"evolve_cost,omitempty"`
	// Next previews the stats after one more upgrade (snapshots only; nil at
	// max level or once evolved), for the upgrade panel.
	Next *TowerPreview `json:"next,omitempty"`
}

// TowerPreview is a tower's stats at its next level.
type TowerPreview struct {
	Level          int     `json:"level"`
	Range          float64 `json:"range"`
	Damage         float64 `json:"damage"`
	SlowDuration   float64 `json:"slow_duration_upgrade,omitempty"`
	SlowMultiplier float64 `json:"slow_multiplier_upgrade,omitempty"`
	AOERadius      float64 `json:"aoe_radius_upgrade,omitempty"`
	AOEDamage      float64 `json:"aoe_damage_pct_upgrade,omitempty"`
	ChainCount     int     `json:"chain_count,omitempty"`
	ChainRadius    float64 `json:"chain_radius,omitempty"`
}

// maxTowerLevel is the last upgrade level; evolution unlocks there.
const maxTowerLevel = 4

// sellValue is the refund RemoveTower pays: 70%, rounded down.
func sellValue(totalSpent int) int { return totalSpent * 7 / 10 }

// withPrices returns t with its sell, upgrade and evolve prices filled in.
func withPrices(t Tower) Tower {
	t.SellValue = sellValue(t.TotalSpent)
	t.UpgradeCost, t.EvolveCost = 0, 0
	t.Next = nil
	if !t.Evolved {
		if t.Level < maxTowerLevel {
			t.UpgradeCost = getTowerCost(t.TowerType)
			next := t
			next.Level++
			applyLevelStats(&next)
			t.Next = &TowerPreview{
				Level: next.Level, Range: next.Range, Damage: next.Damage,
				SlowDuration: next.SlowDuration, SlowMultiplier: next.SlowMultiplier,
				AOERadius: next.AOERadius, AOEDamage: next.AOEDamage,
				ChainCount: next.ChainCount, ChainRadius: next.ChainRadius,
			}
		} else {
			t.EvolveCost = EvolutionCost(t.TotalSpent)
		}
	}
	return t
}

// Enemy represents a hostile unit
type Enemy struct {
	ID             int      `json:"id"`
	Position       Position `json:"position"`
	EnemyType      string   `json:"enemy_type"`
	Health         float64  `json:"health"`
	MaxHealth      float64  `json:"max_health"`
	Speed          float64  `json:"speed"`
	SlowDuration   float64  `json:"slow_duration"`
	SlowMultiplier float64  `json:"slow_multiplier"`
	// RootDuration > 0 pins the enemy in place entirely (Deep Freeze).
	RootDuration float64 `json:"root_duration,omitempty"`
	// Path and PathIndex are server-internal: nothing in the client reads
	// them, and serializing every enemy's full waypoint list was ~27% of the
	// 60 Hz snapshot payload.
	Path      []Position `json:"-"`
	PathIndex int        `json:"-"`
	// SpawnWave is the wave this enemy spawned in — used for kill scoring so
	// debug-spawned enemies (wave-1 stats) don't score at the current wave.
	SpawnWave int `json:"-"`
}

// Projectile represents a bullet/missile
type Projectile struct {
	ID        int      `json:"id"`
	Position  Position `json:"position"`
	TargetID  int      `json:"target_id"`
	Speed     float64  `json:"speed"`
	Damage    float64  `json:"damage"`
	TowerID   int      `json:"tower_id"`
	IsAOE     bool     `json:"is_aoe"`
	AOERadius float64  `json:"aoe_radius"`
	AOEDamage float64  `json:"aoe_damage"`
	// Pierce (Piercer): the shot flies a fixed straight line and damages
	// every enemy it passes, each once. It ignores TargetID after launch.
	Pierce    bool `json:"pierce,omitempty"`
	dirX      float64
	dirY      float64
	rangeLeft float64
	hitIDs    []int
	// Chain lightning (Tesla): on hit, arc to up to chainCount enemies within
	// chainRadius, dealing chainDamage each. Baked at fire time.
	chainCount  int
	chainRadius float64
	chainDamage float64
	// Execute (Executioner): damage × execBonus when the target is below
	// execThreshold of max health at hit time.
	execThreshold float64
	execBonus     float64
}

// MuzzleFlash represents a visual effect when tower shoots
type MuzzleFlash struct {
	ID       int      `json:"id"`
	Position Position `json:"position"`
	Duration float64  `json:"duration"`
}

// Explosion represents a visual effect when projectile hits
type Explosion struct {
	ID       int      `json:"id"`
	Position Position `json:"position"`
	Duration float64  `json:"duration"`
	Radius   float64  `json:"radius"`
}

// Arc is a short-lived lightning-arc visual between two points (Tesla chain
// hits). Purely cosmetic — damage is applied when the arc is created.
type Arc struct {
	ID       int      `json:"id"`
	From     Position `json:"from"`
	To       Position `json:"to"`
	Duration float64  `json:"duration"`
}

// WavePreviewEntry summarizes one enemy group of a wave for the client UI
type WavePreviewEntry struct {
	EnemyType string `json:"enemy_type"`
	Count     int    `json:"count"`
}

// GameStateWithShooting is the main game state
type GameStateWithShooting struct {
	RoomID           string        `json:"room_id"`
	Players          []string      `json:"players"`
	Towers           []Tower       `json:"towers"`
	Enemies          []Enemy       `json:"enemies"`
	Projectiles      []Projectile  `json:"projectiles"`
	MuzzleFlashes    []MuzzleFlash `json:"muzzle_flashes"`
	Explosions       []Explosion   `json:"explosions"`
	Arcs             []Arc         `json:"arcs,omitempty"`
	Gold             int           `json:"gold"`
	Health           int           `json:"health"`
	Score            int           `json:"score"`
	Wave             int           `json:"wave"`
	Phase            GamePhase     `json:"phase"`
	EnemiesRemaining int           `json:"enemies_remaining"`
	GameTime         float64       `json:"game_time"`
	FastForward      bool          `json:"fast_forward"`
	SpeedMultiplier  float64       `json:"speed_multiplier"`
	// Paused gates Update() entirely (see the top of Update): enemies,
	// projectiles, cooldowns, and effects freeze exactly where they are. The
	// 60 FPS loop keeps ticking and broadcasting the frozen state, so
	// unpausing resumes from the same frame with no catch-up. Not a speed
	// value — it composes with SpeedMultiplier (pause at 3x, resume at 3x).
	Paused bool `json:"paused"`
	// Difficulty ("normal" | "harder") and Endless are run-level settings,
	// both chosen at new_game time. Harder: −30% gold/kill, ×1.5 boss health.
	// Endless: the WinWave check never fires — the run continues past the
	// win wave exactly as every run did before win states existed.
	Difficulty string    `json:"difficulty"`
	Endless    bool      `json:"endless"`
	SpawnPoint *Position `json:"spawn_point,omitempty"`
	GoalPoint  *Position `json:"goal_point,omitempty"`
	// Obstacles is the static map layout (permanent walls). Shared registry
	// slice — never mutated after init.
	Obstacles []Position `json:"obstacles,omitempty"`
	// MapID names the room's current map (see MapRegistry). Selected via the
	// new_game message; only populated on snapshots.
	MapID string `json:"map_id,omitempty"`
	// WavePreview describes the composition of wave `Wave` — the upcoming wave
	// during the waiting phase, the in-flight wave during the active phase.
	// Only populated on snapshots.
	WavePreview []WavePreviewEntry `json:"wave_preview,omitempty"`
	// OnGameOver, when set, fires exactly once per completed run — at the
	// FIRST terminal transition, either game over or victory (runRecorded
	// guards the pair, so a victory that continues into Endless and later
	// dies doesn't produce a second row). Called on its own goroutine so
	// slow consumers (the stats DB write) never stall the 60 FPS loop.
	// Set at room creation, before the game loop starts — never mutated after.
	OnGameOver func(RunResult) `json:"-"`
	// runRecorded: OnGameOver already fired for this run (see above).
	runRecorded bool
	// mapDef is the room's active map (obstacles + flat lookup grid). Only
	// swapped under the write lock (ResetToMap); registry defs are immutable.
	mapDef           *MapDef
	mu               sync.RWMutex
	nextTowerID      int
	nextEnemyID      int
	nextProjectileID int
	nextEffectID     int
	spawnCancel      chan struct{} // closed to cancel active spawn goroutine
	// emptySince is when the room last became empty (zero while it has
	// players). The manager's loop deletes rooms empty for longer than the
	// idle grace period. Guarded by mu.
	emptySince time.Time
	// OwnerID is the account that owns the room (0 = a guest). Set when a
	// signed-in player creates or claims the room; it tags the run for the
	// leaderboard, saves and achievements. Guarded by mu.
	OwnerID int64 `json:"-"`
	// mgr is the manager that owns the room (nil in bare test rooms); rooms
	// queue autosaves through it.
	mgr *Manager
	// spawnedThisWave counts the current wave's spawns, so a wave restored
	// from a save resumes its spawner where it stopped.
	spawnedThisWave int
	// tookDamage: an enemy leaked at some point this run (the Untouched
	// achievement needs a run that never did).
	tookDamage bool
}

// RunResult describes one finished run (game over, or victory: the first
// terminal transition). The stats row and the leaderboard come from it.
type RunResult struct {
	Wave       int
	Score      int
	Duration   float64
	MapID      string
	Difficulty string
	Endless    bool
	Victory    bool
	OwnerID    int64
}

// SetOwner records which account owns the room (0 = guest).
func (gs *GameStateWithShooting) SetOwner(userID int64) {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	gs.OwnerID = userID
}

// Owner returns the owning account (0 = guest).
func (gs *GameStateWithShooting) Owner() int64 {
	gs.mu.RLock()
	defer gs.mu.RUnlock()
	return gs.OwnerID
}

func NewGameStateWithShooting(roomID string) *GameStateWithShooting {
	defaultMap := GetMapDef(DefaultMapID)
	return &GameStateWithShooting{
		RoomID:           roomID,
		MapID:            defaultMap.ID,
		mapDef:           defaultMap,
		Players:          make([]string, 0),
		Towers:           make([]Tower, 0),
		Enemies:          make([]Enemy, 0),
		Projectiles:      make([]Projectile, 0),
		MuzzleFlashes:    make([]MuzzleFlash, 0),
		Explosions:       make([]Explosion, 0),
		Arcs:             make([]Arc, 0),
		Gold:             200,
		Health:           100,
		Score:            0,
		Wave:             1,
		Phase:            PhaseWaiting,
		Difficulty:       DifficultyNormal,
		EnemiesRemaining: 0,
		GameTime:         0,
		SpeedMultiplier:  1.0,
		nextTowerID:      1,
		nextEnemyID:      1,
		nextProjectileID: 1,
		nextEffectID:     1,
		spawnCancel:      make(chan struct{}),
	}
}

func (gs *GameStateWithShooting) Reset() {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	gs.resetLocked()
}

// ResetToMap resets the game AND switches the room to mapID — the new-game
// path when the player picked a map. An unknown ID keeps the current map
// (the reset still happens); returns whether the ID was recognized. Safe as
// one atomic step: the map swap and the field wipe share the write lock.
func (gs *GameStateWithShooting) ResetToMap(mapID string) bool {
	return gs.ResetToMapWithOptions(mapID, DifficultyNormal, false)
}

// ResetToMapWithOptions is ResetToMap plus the run-level settings from the
// new_game message. An unknown difficulty string falls back to normal, same
// spirit as the unknown-map fallback.
func (gs *GameStateWithShooting) ResetToMapWithOptions(mapID, difficulty string, endless bool) bool {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	m := GetMapDef(mapID)
	if m != nil {
		gs.mapDef = m
		gs.MapID = m.ID
	}
	gs.resetLocked()
	if difficulty == DifficultyHarder {
		gs.Difficulty = DifficultyHarder
	}
	gs.Endless = endless
	return m != nil
}

func (gs *GameStateWithShooting) resetLocked() {
	// Cancel any active spawn goroutine
	close(gs.spawnCancel)
	gs.spawnCancel = make(chan struct{})

	gs.Towers = make([]Tower, 0)
	gs.Enemies = make([]Enemy, 0)
	gs.Projectiles = make([]Projectile, 0)
	gs.MuzzleFlashes = make([]MuzzleFlash, 0)
	gs.Explosions = make([]Explosion, 0)
	gs.Arcs = make([]Arc, 0)
	gs.Gold = 200
	gs.Health = 100
	gs.Score = 0
	gs.Wave = 1
	gs.Phase = PhaseWaiting
	gs.EnemiesRemaining = 0
	gs.GameTime = 0
	gs.FastForward = false
	gs.SpeedMultiplier = 1.0
	gs.Paused = false
	gs.Difficulty = DifficultyNormal
	gs.Endless = false
	gs.runRecorded = false
	gs.spawnedThisWave = 0
	gs.tookDamage = false
	gs.nextTowerID = 1
	gs.nextEnemyID = 1
	gs.nextProjectileID = 1
	gs.nextEffectID = 1
}

func (gs *GameStateWithShooting) Update(deltaTime float64) {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	// Paused freezes everything — including effects, which normally keep
	// animating through waiting/game_over. GameTime doesn't advance either,
	// so unpausing resumes the exact frozen state.
	if gs.Paused {
		return
	}

	if gs.Phase == PhaseGameOver || gs.Phase == PhaseVictory || gs.Phase == PhaseWaiting {
		gs.updateEffects(deltaTime)
		return
	}

	gs.GameTime += deltaTime
	gs.updateTowers(deltaTime)
	gs.updateProjectiles(deltaTime)
	gs.updateEnemies(deltaTime)
	gs.updateEffects(deltaTime)

	// Game over check runs before wave completion: if the final leaked enemy
	// drops health to 0, the run is over — no completion bonus, no wave advance.
	if gs.Health <= 0 {
		gs.Health = 0
		gs.Phase = PhaseGameOver
		gs.fireRunCompleteLocked()
	}

	if gs.Phase == PhaseActive && len(gs.Enemies) == 0 && gs.EnemiesRemaining == 0 {
		gs.Projectiles = make([]Projectile, 0)
		gs.Phase = PhaseWaiting
		// Wave completion bonus, doubled for finishing at full health
		bonus := 50 * gs.Wave
		if gs.Health >= 100 {
			bonus *= 2
		}
		gs.Score += bonus
		gs.Wave++
		gs.emitLocked(Event{Kind: EventWaveReached, Wave: gs.Wave, Endless: gs.Endless, Untouched: !gs.tookDamage})

		// Win check, parallel to the game-over check above: the moment the
		// wave counter reaches the map's WinWave, a non-Endless run is won.
		// This is "reaching wave N", the same milestone the loss screen and
		// high-score run count — clear wave N−1 and the counter shows N —
		// not "clear wave N". Endless runs skip this entirely and keep
		// playing, exactly as every run did before win states existed.
		// Update early-returns in the victory phase, so this fires once.
		if !gs.Endless && gs.mapDef.WinWave > 0 && gs.Wave >= gs.mapDef.WinWave {
			gs.Phase = PhaseVictory
			gs.emitLocked(Event{Kind: EventVictory, MapID: gs.MapID, Sequence: gs.mapDef.SequenceOrder,
				Difficulty: gs.Difficulty, TowerCount: len(gs.Towers)})
			gs.fireRunCompleteLocked()
		}
		// Every wave break is an autosave point.
		if gs.Phase == PhaseWaiting {
			gs.checkpointLocked()
		}
	}
}

// fireRunCompleteLocked fires OnGameOver at most once per run (both terminal
// transitions — loss and victory — route through here; a victory continued
// into Endless that later dies must not produce a second stats row). Caller
// holds gs.mu.
func (gs *GameStateWithShooting) fireRunCompleteLocked() {
	// Every terminal transition drops the autosave, including the eventual
	// loss of a victory continued into Endless (which records no second
	// stats row): otherwise Continue could revive a run that already ended.
	// Queued after any earlier save, so one still being written can't
	// bring it back.
	if gs.OwnerID > 0 && gs.mgr != nil {
		gs.mgr.queueDiscard(gs.OwnerID)
	}
	if gs.runRecorded || gs.OnGameOver == nil {
		return
	}
	gs.runRecorded = true
	go gs.OnGameOver(RunResult{
		Wave: gs.Wave, Score: gs.Score, Duration: gs.GameTime,
		MapID: gs.MapID, Difficulty: gs.Difficulty, Endless: gs.Endless,
		Victory: gs.Phase == PhaseVictory, OwnerID: gs.OwnerID,
	})
}

func (gs *GameStateWithShooting) AddEnemy(enemyType string, path []Position, wave int) Enemy {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	return gs.addEnemyLocked(enemyType, path, wave)
}

// BeginWave is the atomic waiting→active gate for a wave spawner: under one
// lock it checks the phase, reads the wave number and its config, sets the
// spawn counter, and captures this wave's cancel channel. ok is false when
// the game isn't in the waiting phase.
func (gs *GameStateWithShooting) BeginWave() (wave int, config WaveConfig, cancel <-chan struct{}, ok bool) {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	if gs.Phase != PhaseWaiting {
		return 0, WaveConfig{}, nil, false
	}
	config = GetWaveConfig(gs.Wave)
	total := 0
	for _, group := range config.Enemies {
		total += group.Count
	}
	gs.Phase = PhaseActive
	gs.EnemiesRemaining = total
	gs.spawnedThisWave = 0
	return gs.Wave, config, gs.spawnCancel, true
}

// SpawnForWave spawns one enemy for the wave that owns cancel and counts it
// off EnemiesRemaining, all under one lock. A blocked path skips the enemy
// but still counts it, so a walled-off wave completes. Returns false (and
// does nothing) when cancel is no longer the room's current channel: a New
// Game or room close landed since the spawner last checked.
func (gs *GameStateWithShooting) SpawnForWave(cancel <-chan struct{}, enemyType string, wave int) bool {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	if (<-chan struct{})(gs.spawnCancel) != cancel {
		return false
	}
	if gs.SpawnPoint != nil && gs.GoalPoint != nil {
		if path := gs.findPath(*gs.SpawnPoint, *gs.GoalPoint); path != nil {
			gs.addEnemyLocked(enemyType, path, wave)
		}
	}
	if gs.EnemiesRemaining > 0 {
		gs.EnemiesRemaining--
	}
	gs.spawnedThisWave++
	return true
}

// cancelSpawns stops any running wave spawner (room close).
func (gs *GameStateWithShooting) cancelSpawns() {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	close(gs.spawnCancel)
	gs.spawnCancel = make(chan struct{})
}

// idleSince returns when the room became empty, or zero if it has players.
func (gs *GameStateWithShooting) idleSince() time.Time {
	gs.mu.RLock()
	defer gs.mu.RUnlock()
	return gs.emptySince
}

// hasPlayers reports whether anyone is in the room.
func (gs *GameStateWithShooting) hasPlayers() bool {
	gs.mu.RLock()
	defer gs.mu.RUnlock()
	return len(gs.Players) > 0
}

func (gs *GameStateWithShooting) addEnemyLocked(enemyType string, path []Position, wave int) Enemy {
	health, speed := ScaledEnemyStats(enemyType, wave)
	// Harder difficulty: bosses only, health only — speed deliberately
	// untouched (see the design doc: speed is a map-geometry lever, not a
	// difficulty-mode lever).
	if gs.Difficulty == DifficultyHarder && enemyType == "boss" {
		health *= harderBossHealthMult
	}
	enemy := Enemy{
		ID:        gs.nextEnemyID,
		Position:  path[0],
		EnemyType: enemyType,
		Health:    health,
		MaxHealth: health,
		Speed:     speed,
		Path:      path,
		PathIndex: 0,
		SpawnWave: wave,
	}

	gs.Enemies = append(gs.Enemies, enemy)
	gs.nextEnemyID++
	return enemy
}

func (gs *GameStateWithShooting) DecrementEnemiesRemaining() {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	if gs.EnemiesRemaining > 0 {
		gs.EnemiesRemaining--
	}
}

// ContinueEndless is the victory screen's CONTINUE (ENDLESS) path: from the
// victory phase only, flip the run to Endless and drop back to waiting so
// the next wave (the one after the win wave was reached) can start. Nothing
// else resets — towers, gold, score, and wave all carry over seamlessly.
// Returns false (no-op) from any other phase.
func (gs *GameStateWithShooting) ContinueEndless() bool {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	if gs.Phase != PhaseVictory {
		return false
	}
	gs.Endless = true
	gs.Phase = PhaseWaiting
	return true
}

// StartWave transitions waiting → active and sets the spawn counter. Returns
// false when the game is not in the waiting phase, so a second concurrent
// start_wave request cannot double-spawn a wave.
func (gs *GameStateWithShooting) StartWave(totalEnemies int) bool {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	if gs.Phase != PhaseWaiting {
		return false
	}
	gs.Phase = PhaseActive
	gs.EnemiesRemaining = totalEnemies
	return true
}

// GetSpawnCancel returns the cancel channel for the current spawn goroutine
func (gs *GameStateWithShooting) GetSpawnCancel() <-chan struct{} {
	gs.mu.RLock()
	defer gs.mu.RUnlock()
	return gs.spawnCancel
}

func (gs *GameStateWithShooting) SetFastForward(enabled bool) {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	gs.FastForward = enabled
	if enabled {
		gs.SpeedMultiplier = 3.0
	} else {
		gs.SpeedMultiplier = 1.0
	}
}

// SetSpeedMultiplier sets the game speed to 1x, 2x, or 3x (anything else is
// rejected — the client only offers those three). FastForward stays in sync
// as "faster than realtime" for older snapshot consumers.
func (gs *GameStateWithShooting) SetSpeedMultiplier(speed float64) bool {
	if speed != 1.0 && speed != 2.0 && speed != 3.0 {
		return false
	}
	gs.mu.Lock()
	defer gs.mu.Unlock()
	gs.SpeedMultiplier = speed
	gs.FastForward = speed > 1.0
	return true
}

// SetPaused freezes/unfreezes the simulation. The game loop keeps ticking
// and broadcasting; Update() itself is what's gated (and SpawnWave holds
// its spawns while paused).
func (gs *GameStateWithShooting) SetPaused(paused bool) {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	gs.Paused = paused
}

func (gs *GameStateWithShooting) IsPaused() bool {
	gs.mu.RLock()
	defer gs.mu.RUnlock()
	return gs.Paused
}

func (gs *GameStateWithShooting) GetSpeedMultiplier() float64 {
	gs.mu.RLock()
	defer gs.mu.RUnlock()
	if gs.SpeedMultiplier <= 0 {
		return 1.0
	}
	return gs.SpeedMultiplier
}

func (gs *GameStateWithShooting) IsFastForward() bool {
	gs.mu.RLock()
	defer gs.mu.RUnlock()
	return gs.FastForward
}

// SetSpawnGoal sets the spawn and goal cells under the game lock — the game
// loop and snapshot reads run concurrently as soon as the room exists.
func (gs *GameStateWithShooting) SetSpawnGoal(spawn, goal Position) {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	gs.SpawnPoint = &spawn
	gs.GoalPoint = &goal
}

func (gs *GameStateWithShooting) GetSnapshot() *GameStateWithShooting {
	gs.mu.RLock()
	defer gs.mu.RUnlock()

	snapshot := &GameStateWithShooting{
		RoomID:           gs.RoomID,
		Players:          make([]string, len(gs.Players)),
		Towers:           make([]Tower, len(gs.Towers)),
		Enemies:          make([]Enemy, len(gs.Enemies)),
		Projectiles:      make([]Projectile, len(gs.Projectiles)),
		MuzzleFlashes:    make([]MuzzleFlash, len(gs.MuzzleFlashes)),
		Explosions:       make([]Explosion, len(gs.Explosions)),
		Arcs:             make([]Arc, len(gs.Arcs)),
		Gold:             gs.Gold,
		Health:           gs.Health,
		Score:            gs.Score,
		Wave:             gs.Wave,
		Phase:            gs.Phase,
		EnemiesRemaining: gs.EnemiesRemaining,
		GameTime:         gs.GameTime,
		FastForward:      gs.FastForward,
		SpeedMultiplier:  gs.SpeedMultiplier,
		Paused:           gs.Paused,
		Difficulty:       gs.Difficulty,
		Endless:          gs.Endless,
		SpawnPoint:       gs.SpawnPoint,
		GoalPoint:        gs.GoalPoint,
		Obstacles:        gs.mapDef.Obstacles,
		MapID:            gs.MapID,
		WavePreview:      buildWavePreview(gs.Wave),
	}

	copy(snapshot.Players, gs.Players)
	for i, t := range gs.Towers {
		snapshot.Towers[i] = withPrices(t)
	}
	copy(snapshot.Enemies, gs.Enemies)
	copy(snapshot.Projectiles, gs.Projectiles)
	copy(snapshot.MuzzleFlashes, gs.MuzzleFlashes)
	copy(snapshot.Explosions, gs.Explosions)
	copy(snapshot.Arcs, gs.Arcs)

	return snapshot
}

func (gs *GameStateWithShooting) GetPhase() GamePhase {
	gs.mu.RLock()
	defer gs.mu.RUnlock()
	return gs.Phase
}

func (gs *GameStateWithShooting) GetSpawnGoal() (*Position, *Position) {
	gs.mu.RLock()
	defer gs.mu.RUnlock()
	return gs.SpawnPoint, gs.GoalPoint
}
