package game

import (
	"errors"
	"math"
	"sync"
)

// GamePhase represents the current phase of the game
type GamePhase string

const (
	PhaseWaiting  GamePhase = "waiting"
	PhaseActive   GamePhase = "active"
	PhaseGameOver GamePhase = "game_over"
)

// WaveEnemy defines one enemy entry in a wave definition
type WaveEnemy struct {
	EnemyType  string
	Count      int
	SpawnDelay float64
}

// WaveConfig defines what enemies spawn in a given wave
type WaveConfig struct {
	Wave    int
	Enemies []WaveEnemy
}

// GetWaveConfig returns the enemy configuration for a given wave number
func GetWaveConfig(wave int) WaveConfig {
	switch {
	case wave <= 3:
		count := 5 + (wave-1)*2
		delay := 2.0 - float64(wave-1)*0.2
		return WaveConfig{Wave: wave, Enemies: []WaveEnemy{
			{EnemyType: "basic", Count: count, SpawnDelay: delay},
		}}
	case wave <= 6:
		basicCount := 6 + (wave-4)*2
		fastCount := 2 + (wave - 4)
		delay := 1.5 - float64(wave-4)*0.1
		return WaveConfig{Wave: wave, Enemies: []WaveEnemy{
			{EnemyType: "basic", Count: basicCount, SpawnDelay: delay},
			{EnemyType: "fast", Count: fastCount, SpawnDelay: delay * 0.7},
		}}
	case wave <= 10:
		basicCount := 8 + (wave-7)*2
		fastCount := 3 + (wave - 7)
		tankCount := 1 + (wave-7)/2
		delay := 1.2 - float64(wave-7)*0.05
		return WaveConfig{Wave: wave, Enemies: []WaveEnemy{
			{EnemyType: "basic", Count: basicCount, SpawnDelay: delay},
			{EnemyType: "fast", Count: fastCount, SpawnDelay: delay * 0.6},
			{EnemyType: "tank", Count: tankCount, SpawnDelay: delay * 1.5},
		}}
	default:
		// Past wave 10: counts grow faster using a quadratic bump on top of linear.
		extra := wave - 10

		basicCount := 10 + extra*2 + (extra*extra)/8
		fastCount := 3 + extra + (extra*extra)/12
		tankCount := 1 + extra/2 + (extra*extra)/20

		// Boss every 3rd wave from wave 11 onward (was every 5th), capped at 6
		bossCount := 0
		if wave >= 11 {
			bossCount = 1 + (wave-11)/3
			if bossCount > 6 {
				bossCount = 6
			}
		}

		// Spawn delay floors at 0.25s (was 0.4s)
		delay := math.Max(1.0-float64(extra)*0.04, 0.25)

		enemies := []WaveEnemy{
			{EnemyType: "basic", Count: basicCount, SpawnDelay: delay},
			{EnemyType: "fast", Count: fastCount, SpawnDelay: delay * 0.6},
			{EnemyType: "tank", Count: tankCount, SpawnDelay: delay * 1.4},
		}
		if bossCount > 0 {
			bossDelay := math.Max(2.5-float64(extra)*0.05, 1.5)
			enemies = append(enemies, WaveEnemy{EnemyType: "boss", Count: bossCount, SpawnDelay: bossDelay})
		}
		return WaveConfig{Wave: wave, Enemies: enemies}
	}
}

// ScaledEnemyStats returns health and speed for an enemy type scaled to the current wave.
// Base stats are unchanged so the info panel still shows correct base values.
//
// Health: +10% compound per wave above 5.
// Speed:  +3% compound per wave above 5, capped at +80% of base.
func ScaledEnemyStats(enemyType string, wave int) (health float64, speed float64) {
	base := getEnemyStats(enemyType)

	// Health scaling starts at wave 5 so early waves feel fair.
	// +10% compound per wave above 5 (was +15% from wave 1 — too steep).
	healthWaves := math.Max(0, float64(wave-5))
	healthMult := math.Pow(1.10, healthWaves)
	health = base.Health * healthMult

	speedMult := 1.0
	if wave > 5 {
		speedMult = math.Min(math.Pow(1.03, float64(wave-5)), 1.80)
	}
	speed = base.Speed * speedMult

	return health, speed
}

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
}

// Enemy represents a hostile unit
type Enemy struct {
	ID            int        `json:"id"`
	Position      Position   `json:"position"`
	EnemyType     string     `json:"enemy_type"`
	Health        float64    `json:"health"`
	MaxHealth     float64    `json:"max_health"`
	Speed         float64    `json:"speed"`
	SlowDuration  float64    `json:"slow_duration"`
	SlowMultiplier float64   `json:"slow_multiplier"`
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
	Gold             int           `json:"gold"`
	Health           int           `json:"health"`
	Score            int           `json:"score"`
	Wave             int           `json:"wave"`
	Phase            GamePhase     `json:"phase"`
	EnemiesRemaining int           `json:"enemies_remaining"`
	GameTime         float64       `json:"game_time"`
	FastForward      bool          `json:"fast_forward"`
	SpeedMultiplier  float64       `json:"speed_multiplier"`
	SpawnPoint       *Position     `json:"spawn_point,omitempty"`
	GoalPoint        *Position     `json:"goal_point,omitempty"`
	// Obstacles is the static map layout (permanent walls). Shared package
	// slice — never mutated after init.
	Obstacles []Position `json:"obstacles,omitempty"`
	// WavePreview describes the composition of wave `Wave` — the upcoming wave
	// during the waiting phase, the in-flight wave during the active phase.
	// Only populated on snapshots.
	WavePreview      []WavePreviewEntry `json:"wave_preview,omitempty"`
	mu               sync.RWMutex
	nextTowerID      int
	nextEnemyID      int
	nextProjectileID int
	nextEffectID     int
	spawnCancel      chan struct{} // closed to cancel active spawn goroutine
}

func NewGameStateWithShooting(roomID string) *GameStateWithShooting {
	return &GameStateWithShooting{
		RoomID:           roomID,
		Players:          make([]string, 0),
		Towers:           make([]Tower, 0),
		Enemies:          make([]Enemy, 0),
		Projectiles:      make([]Projectile, 0),
		MuzzleFlashes:    make([]MuzzleFlash, 0),
		Explosions:       make([]Explosion, 0),
		Gold:             200,
		Health:           100,
		Score:            0,
		Wave:             1,
		Phase:            PhaseWaiting,
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

	// Cancel any active spawn goroutine
	close(gs.spawnCancel)
	gs.spawnCancel = make(chan struct{})

	gs.Towers = make([]Tower, 0)
	gs.Enemies = make([]Enemy, 0)
	gs.Projectiles = make([]Projectile, 0)
	gs.MuzzleFlashes = make([]MuzzleFlash, 0)
	gs.Explosions = make([]Explosion, 0)
	gs.Gold = 200
	gs.Health = 100
	gs.Score = 0
	gs.Wave = 1
	gs.Phase = PhaseWaiting
	gs.EnemiesRemaining = 0
	gs.GameTime = 0
	gs.FastForward = false
	gs.SpeedMultiplier = 1.0
	gs.nextTowerID = 1
	gs.nextEnemyID = 1
	gs.nextProjectileID = 1
	gs.nextEffectID = 1
}

func (gs *GameStateWithShooting) Update(deltaTime float64) {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	if gs.Phase == PhaseGameOver || gs.Phase == PhaseWaiting {
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
	}
}

func (gs *GameStateWithShooting) updateTowers(deltaTime float64) {
	for i := range gs.Towers {
		tower := &gs.Towers[i]

		if tower.Cooldown > 0 {
			tower.Cooldown -= deltaTime
		}

		target := gs.findNearestEnemy(tower.Position, tower.Range)
		if target == nil {
			tower.CurrentTarget = 0
			continue
		}

		tower.CurrentTarget = target.ID
		dx := target.Position.X - tower.Position.X
		dy := target.Position.Y - tower.Position.Y
		tower.Rotation = math.Atan2(dy, dx)

		if tower.Cooldown <= 0 {
			gs.shootProjectile(tower, target)
			tower.Cooldown = 1.0 / tower.FireRate
			gs.MuzzleFlashes = append(gs.MuzzleFlashes, MuzzleFlash{
				ID:       gs.nextEffectID,
				Position: tower.Position,
				Duration: 0.1,
			})
			gs.nextEffectID++
		}
	}
}

func (gs *GameStateWithShooting) findNearestEnemy(pos Position, maxRange float64) *Enemy {
	var nearest *Enemy
	minDistSq := math.MaxFloat64
	maxRangeSq := maxRange * maxRange

	for i := range gs.Enemies {
		enemy := &gs.Enemies[i]
		distSq := distanceSquared(pos, enemy.Position)
		if distSq <= maxRangeSq && distSq < minDistSq {
			minDistSq = distSq
			nearest = enemy
		}
	}
	return nearest
}

func (gs *GameStateWithShooting) shootProjectile(tower *Tower, target *Enemy) {
	speed := 8.0
	if tower.TowerType == "sniper" {
		speed = 12.0
	}

	proj := Projectile{
		ID:       gs.nextProjectileID,
		Position: tower.Position,
		TargetID: target.ID,
		Speed:    speed,
		Damage:   tower.Damage,
		TowerID:  tower.ID,
	}

	if tower.TowerType == "splash" {
		proj.IsAOE = true
		// Use tower's upgraded AOE fields if set, fall back to defaults
		if tower.AOERadius > 0 {
			proj.AOERadius = tower.AOERadius
		} else {
			proj.AOERadius = defaultAOERadius
		}
		if tower.AOEDamage > 0 {
			proj.AOEDamage = tower.Damage * tower.AOEDamage
		} else {
			proj.AOEDamage = tower.Damage * defaultAOEDamagePct
		}
	}

	gs.Projectiles = append(gs.Projectiles, proj)
	gs.nextProjectileID++
}

func (gs *GameStateWithShooting) updateProjectiles(deltaTime float64) {
	// Filter in place: the write index never passes the read index, and
	// GetSnapshot deep-copies under the lock, so nothing aliases the tail.
	active := gs.Projectiles[:0]

	for i := range gs.Projectiles {
		proj := &gs.Projectiles[i]

		var target *Enemy
		for j := range gs.Enemies {
			if gs.Enemies[j].ID == proj.TargetID {
				target = &gs.Enemies[j]
				break
			}
		}

		if target == nil {
			continue
		}

		dx := target.Position.X - proj.Position.X
		dy := target.Position.Y - proj.Position.Y
		dist := math.Sqrt(dx*dx + dy*dy)

		if dist < 0.3 {
			target.Health -= proj.Damage

			// Slow towers debuff on hit — read the parameters from the firing
			// tower itself so upgrades take effect (one lookup, not two).
			var firingTower *Tower
			for j := range gs.Towers {
				if gs.Towers[j].ID == proj.TowerID {
					firingTower = &gs.Towers[j]
					break
				}
			}
			if firingTower != nil && firingTower.TowerType == "slow" {
				slowDuration := defaultSlowDuration
				slowMultiplier := defaultSlowMultiplier
				if firingTower.SlowDuration > 0 {
					slowDuration = firingTower.SlowDuration
				}
				if firingTower.SlowMultiplier > 0 {
					slowMultiplier = firingTower.SlowMultiplier
				}
				target.SlowDuration = slowDuration
				target.SlowMultiplier = slowMultiplier
			}

			// AOE splash: damage all enemies within radius, skipping the primary target
			if proj.IsAOE {
				aoeRadiusSq := proj.AOERadius * proj.AOERadius
				for j := range gs.Enemies {
					splashTarget := &gs.Enemies[j]
					if splashTarget.ID == proj.TargetID {
						continue // already took direct hit damage
					}
					if distanceSquared(proj.Position, splashTarget.Position) <= aoeRadiusSq {
						splashTarget.Health -= proj.AOEDamage
					}
				}
			}

			// Explosion visual — larger radius for AOE hits
			explosionRadius := 0.5
			explosionDuration := 0.3
			if proj.IsAOE {
				explosionRadius = proj.AOERadius
				explosionDuration = 0.4
			}
			gs.Explosions = append(gs.Explosions, Explosion{
				ID:       gs.nextEffectID,
				Position: proj.Position,
				Duration: explosionDuration,
				Radius:   explosionRadius,
			})
			gs.nextEffectID++
			continue
		}

		if dist > 0 {
			moveAmount := proj.Speed * deltaTime
			ratio := moveAmount / dist
			if ratio > 1.0 {
				ratio = 1.0
			}
			proj.Position.X += dx * ratio
			proj.Position.Y += dy * ratio
		}

		active = append(active, *proj)
	}

	gs.Projectiles = active
}

func (gs *GameStateWithShooting) updateEnemies(deltaTime float64) {
	alive := gs.Enemies[:0] // in-place filter, same pattern as updateProjectiles

	for i := range gs.Enemies {
		enemy := &gs.Enemies[i]

		if enemy.Health <= 0 {
			gs.Gold += getEnemyGoldReward(enemy.EnemyType)
			gs.Score += getEnemyScorePoints(enemy.EnemyType) * enemy.SpawnWave
			continue
		}

		// Tick slow debuff
		effectiveSpeed := enemy.Speed
		if enemy.SlowDuration > 0 {
			enemy.SlowDuration -= deltaTime
			if enemy.SlowDuration <= 0 {
				enemy.SlowDuration = 0
				enemy.SlowMultiplier = 0
			} else {
				effectiveSpeed = enemy.Speed * enemy.SlowMultiplier
			}
		}

		if enemy.Path != nil && len(enemy.Path) > 0 && enemy.PathIndex < len(enemy.Path) {
			target := enemy.Path[enemy.PathIndex]
			dx := target.X - enemy.Position.X
			dy := target.Y - enemy.Position.Y
			dist := math.Sqrt(dx*dx + dy*dy)

			if dist < 0.1 {
				enemy.PathIndex++
				if enemy.PathIndex < len(enemy.Path) {
					target = enemy.Path[enemy.PathIndex]
					dx = target.X - enemy.Position.X
					dy = target.Y - enemy.Position.Y
					dist = math.Sqrt(dx*dx + dy*dy)
				}
			}

			if dist > 0 && enemy.PathIndex < len(enemy.Path) {
				moveDistance := effectiveSpeed * deltaTime
				ratio := moveDistance / dist
				if ratio > 1.0 {
					ratio = 1.0
				}
				enemy.Position.X += dx * ratio
				enemy.Position.Y += dy * ratio
			}
		}

		if enemy.PathIndex < len(enemy.Path) {
			alive = append(alive, *enemy)
		} else if gs.GoalPoint != nil && distance(enemy.Position, *gs.GoalPoint) >= 0.5 {
			// Finished its path but nowhere near the goal: the enemy is trapped
			// (path recalculation found no route and parked it in place). It
			// stays on the field, idle, until a tower change re-paths it.
			alive = append(alive, *enemy)
		} else {
			gs.Health -= 10
		}
	}

	gs.Enemies = alive
}

func (gs *GameStateWithShooting) updateEffects(deltaTime float64) {
	activeFlashes := gs.MuzzleFlashes[:0]
	for i := range gs.MuzzleFlashes {
		flash := &gs.MuzzleFlashes[i]
		flash.Duration -= deltaTime
		if flash.Duration > 0 {
			activeFlashes = append(activeFlashes, *flash)
		}
	}
	gs.MuzzleFlashes = activeFlashes

	activeExplosions := gs.Explosions[:0]
	for i := range gs.Explosions {
		explosion := &gs.Explosions[i]
		explosion.Duration -= deltaTime
		if explosion.Duration > 0 {
			activeExplosions = append(activeExplosions, *explosion)
		}
	}
	gs.Explosions = activeExplosions
}

// Placement failure reasons, distinguished so the client ack can say why.
var (
	ErrInsufficientGold = errors.New("insufficient gold")
	ErrInvalidPlacement = errors.New("invalid placement")
)

// AddTower validates the placement (grid bounds, free cell, not a wall, not
// the spawn/goal, known type), deducts gold, and adds the tower. The client
// prevents invalid clicks too, but the server no longer trusts it to.
func (gs *GameStateWithShooting) AddTower(x, y float64, towerType string) (Tower, error) {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	cx, cy := int(math.Round(x)), int(math.Round(y))
	if cx < 0 || cx >= gridWidth || cy < 0 || cy >= gridHeight {
		return Tower{}, ErrInvalidPlacement
	}
	if isObstacle(cx, cy) {
		return Tower{}, ErrInvalidPlacement
	}
	if gs.SpawnPoint != nil && cx == int(gs.SpawnPoint.X) && cy == int(gs.SpawnPoint.Y) {
		return Tower{}, ErrInvalidPlacement
	}
	if gs.GoalPoint != nil && cx == int(gs.GoalPoint.X) && cy == int(gs.GoalPoint.Y) {
		return Tower{}, ErrInvalidPlacement
	}
	for _, t := range gs.Towers {
		if int(math.Round(t.Position.X)) == cx && int(math.Round(t.Position.Y)) == cy {
			return Tower{}, ErrInvalidPlacement
		}
	}
	if _, known := towerStatsByType[towerType]; !known {
		return Tower{}, ErrInvalidPlacement
	}

	stats := getTowerStats(towerType)
	cost := getTowerCost(towerType)

	if gs.Gold < cost {
		return Tower{}, ErrInsufficientGold
	}

	tower := Tower{
		ID:         gs.nextTowerID,
		Position:   Position{X: float64(cx), Y: float64(cy)}, // snapped to the cell
		TowerType:  towerType,
		Level:      1,
		Range:      stats.Range,
		Damage:     stats.Damage,
		FireRate:   stats.FireRate,
		Cooldown:   0,
		Rotation:   0,
		TotalSpent: cost,
	}

	// Initialize special fields for slow and splash towers
	if towerType == "slow" {
		tower.SlowDuration = defaultSlowDuration
		tower.SlowMultiplier = defaultSlowMultiplier
	}
	if towerType == "splash" {
		tower.AOERadius = defaultAOERadius
		tower.AOEDamage = defaultAOEDamagePct
	}

	gs.Gold -= cost
	gs.Towers = append(gs.Towers, tower)
	gs.nextTowerID++
	gs.RecalculateEnemyPaths()

	return tower, nil
}

// RemoveTower removes a tower by ID and refunds 70% of its cost.
func (gs *GameStateWithShooting) RemoveTower(towerID int) (int, bool) {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	for i, tower := range gs.Towers {
		if tower.ID == towerID {
			refund := int(float64(tower.TotalSpent) * 0.7)
			gs.Gold += refund
			gs.Towers = append(gs.Towers[:i], gs.Towers[i+1:]...)
			active := make([]Projectile, 0)
			for _, p := range gs.Projectiles {
				if p.TowerID != towerID {
					active = append(active, p)
				}
			}
			gs.Projectiles = active
			gs.RecalculateEnemyPaths()
			return refund, true
		}
	}
	return 0, false
}

// UpgradeTower upgrades a tower by one level (max level 4).
// Each upgrade costs the same as the original tower purchase price.
// Stats scale +20% damage and +10% range per level.
// Slow towers also improve slow duration and multiplier.
// Splash towers also improve AOE radius and damage percentage.
func (gs *GameStateWithShooting) UpgradeTower(towerID int) (Tower, bool) {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	for i := range gs.Towers {
		tower := &gs.Towers[i]
		if tower.ID != towerID {
			continue
		}
		if tower.Level >= 4 {
			return Tower{}, false
		}

		cost := getTowerCost(tower.TowerType)
		if gs.Gold < cost {
			return Tower{}, false
		}

		gs.Gold -= cost
		tower.TotalSpent += cost
		tower.Level++

		// Core stat scaling: +20% damage, +10% range per level above 1
		base := getTowerStats(tower.TowerType)
		levelMult := math.Pow(1.20, float64(tower.Level-1))
		tower.Damage = math.Round(base.Damage*levelMult*10) / 10
		tower.Range = math.Round(base.Range*math.Pow(1.10, float64(tower.Level-1))*100) / 100

		// Slow tower: longer duration and stronger slow each level
		// L1: 2.0s / 0.40x  L2: 2.5s / 0.35x  L3: 3.0s / 0.30x  L4: 3.5s / 0.25x
		if tower.TowerType == "slow" {
			tower.SlowDuration = defaultSlowDuration + float64(tower.Level-1)*0.5
			tower.SlowMultiplier = defaultSlowMultiplier - float64(tower.Level-1)*0.05
		}

		// Splash tower: wider radius and higher AOE damage % each level
		// L1: 1.5 / 60%  L2: 1.8 / 70%  L3: 2.1 / 80%  L4: 2.4 / 90%
		if tower.TowerType == "splash" {
			tower.AOERadius = defaultAOERadius + float64(tower.Level-1)*0.3
			tower.AOEDamage = defaultAOEDamagePct + float64(tower.Level-1)*0.10
		}

		return *tower, true
	}
	return Tower{}, false
}


func (gs *GameStateWithShooting) AddEnemy(enemyType string, path []Position, wave int) Enemy {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	health, speed := ScaledEnemyStats(enemyType, wave)
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
		Gold:             gs.Gold,
		Health:           gs.Health,
		Score:            gs.Score,
		Wave:             gs.Wave,
		Phase:            gs.Phase,
		EnemiesRemaining: gs.EnemiesRemaining,
		GameTime:         gs.GameTime,
		FastForward:      gs.FastForward,
		SpeedMultiplier:  gs.SpeedMultiplier,
		SpawnPoint:       gs.SpawnPoint,
		GoalPoint:        gs.GoalPoint,
		Obstacles:        mapObstacles,
		WavePreview:      buildWavePreview(gs.Wave),
	}

	copy(snapshot.Players, gs.Players)
	copy(snapshot.Towers, gs.Towers)
	copy(snapshot.Enemies, gs.Enemies)
	copy(snapshot.Projectiles, gs.Projectiles)
	copy(snapshot.MuzzleFlashes, gs.MuzzleFlashes)
	copy(snapshot.Explosions, gs.Explosions)

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

// Helper types and functions

// Slow and splash tower defaults — the single source for AddTower
// initialization, the projectile-hit fallbacks, and the upgrade formulas.
const (
	defaultSlowDuration   = 2.0
	defaultSlowMultiplier = 0.40
	defaultAOERadius      = 1.5
	defaultAOEDamagePct   = 0.60
)

type towerStats struct {
	Range    float64
	Damage   float64
	FireRate float64
}

// Stat tables are package-level so lookups don't rebuild a map per call.
// Values are mirrored in the client UI (client/src/types/game.ts TOWER_COSTS,
// GameCanvas.tsx TOWER_RANGES and ENEMY_GLOSSARY) — keep them in sync.
var (
	towerStatsByType = map[string]towerStats{
		"basic":  {Range: 3.0, Damage: 15.0, FireRate: 1.0},
		"sniper": {Range: 6.0, Damage: 50.0, FireRate: 0.5},
		"splash": {Range: 2.5, Damage: 10.0, FireRate: 1.5},
		"slow":   {Range: 3.5, Damage: 8.0, FireRate: 0.8},
	}
	towerCostByType = map[string]int{
		"basic":  50,
		"sniper": 100,
		"splash": 75,
		"slow":   60,
	}
	enemyStatsByType = map[string]enemyStats{
		"basic":  {Health: 100.0, Speed: 2.0},
		"fast":   {Health: 50.0, Speed: 4.0},
		"tank":   {Health: 300.0, Speed: 1.0},
		"flying": {Health: 80.0, Speed: 3.0}, // defined but never spawned by any wave
		"boss":   {Health: 1000.0, Speed: 0.5},
	}
)

func getTowerStats(towerType string) towerStats {
	if s, ok := towerStatsByType[towerType]; ok {
		return s
	}
	return towerStatsByType["basic"]
}

func getTowerCost(towerType string) int {
	if c, ok := towerCostByType[towerType]; ok {
		return c
	}
	return 50
}

type enemyStats struct {
	Health float64
	Speed  float64
}

func getEnemyStats(enemyType string) enemyStats {
	if s, ok := enemyStatsByType[enemyType]; ok {
		return s
	}
	return enemyStatsByType["basic"]
}

// buildWavePreview flattens the wave config into {enemy_type, count} entries for the client
func buildWavePreview(wave int) []WavePreviewEntry {
	config := GetWaveConfig(wave)
	preview := make([]WavePreviewEntry, 0, len(config.Enemies))
	for _, group := range config.Enemies {
		preview = append(preview, WavePreviewEntry{EnemyType: group.EnemyType, Count: group.Count})
	}
	return preview
}

// Score points per kill (multiplied by the enemy's spawn wave when awarded)
// and gold rewards. Values differ on purpose: score rewards difficulty (fast
// enemies are hard to hit), gold rewards farming.
var (
	enemyScoreByType = map[string]int{
		"basic":  10,
		"fast":   15,
		"tank":   30,
		"flying": 20,
		"boss":   100,
	}
	enemyGoldByType = map[string]int{
		"basic":  10,
		"fast":   8,
		"tank":   25,
		"flying": 15,
		"boss":   100,
	}
)

func getEnemyScorePoints(enemyType string) int {
	if p, ok := enemyScoreByType[enemyType]; ok {
		return p
	}
	return 10
}

func getEnemyGoldReward(enemyType string) int {
	if r, ok := enemyGoldByType[enemyType]; ok {
		return r
	}
	return 10
}

func distance(a, b Position) float64 {
	return math.Sqrt(distanceSquared(a, b))
}

// distanceSquared avoids the sqrt for pure range/nearest comparisons.
func distanceSquared(a, b Position) float64 {
	dx := a.X - b.X
	dy := a.Y - b.Y
	return dx*dx + dy*dy
}

const (
	gridWidth  = 20
	gridHeight = 15
)

// findPath runs a BFS over the grid with towers as blockers. Cells are flat
// integer indices with parent-pointer path reconstruction — the previous
// version built fmt.Sprintf map keys and copied the whole accumulated path
// per enqueued node (~1,500 allocations per search), which made mid-wave
// tower placement (one search per living enemy, under the game lock) stall
// the 60 FPS loop. Expansion order (+x, -x, +y, -y) is unchanged, so the
// returned paths are identical to the old implementation's.
func (gs *GameStateWithShooting) findPath(start, goal Position) []Position {
	sx, sy := int(math.Round(start.X)), int(math.Round(start.Y))
	gx, gy := int(math.Round(goal.X)), int(math.Round(goal.Y))
	if sx < 0 || sx >= gridWidth || sy < 0 || sy >= gridHeight ||
		gx < 0 || gx >= gridWidth || gy < 0 || gy >= gridHeight {
		return nil
	}
	if sx == gx && sy == gy {
		return []Position{start}
	}

	blocked := obstacleSet // copy: map walls block exactly like towers
	for _, tower := range gs.Towers {
		tx := int(math.Round(tower.Position.X))
		ty := int(math.Round(tower.Position.Y))
		if tx >= 0 && tx < gridWidth && ty >= 0 && ty < gridHeight {
			blocked[ty*gridWidth+tx] = true
		}
	}

	startIdx := sy*gridWidth + sx
	goalIdx := gy*gridWidth + gx

	var visited [gridWidth * gridHeight]bool
	var parent [gridWidth * gridHeight]int
	visited[startIdx] = true
	queue := make([]int, 1, gridWidth*gridHeight)
	queue[0] = startIdx

	found := false
	for head := 0; head < len(queue) && !found; head++ {
		cur := queue[head]
		cx, cy := cur%gridWidth, cur/gridWidth

		neighbors := [4][2]int{{cx + 1, cy}, {cx - 1, cy}, {cx, cy + 1}, {cx, cy - 1}}
		for _, n := range neighbors {
			nx, ny := n[0], n[1]
			if nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight {
				continue
			}
			ni := ny*gridWidth + nx
			if blocked[ni] || visited[ni] {
				continue
			}
			visited[ni] = true
			parent[ni] = cur
			if ni == goalIdx {
				found = true
				break
			}
			queue = append(queue, ni)
		}
	}
	if !found {
		return nil
	}

	// Walk parents goal→start, then reverse. path[0] keeps the caller's
	// original (unrounded) start position, matching the old behavior.
	rev := []int{goalIdx}
	for cur := parent[goalIdx]; cur != startIdx; cur = parent[cur] {
		rev = append(rev, cur)
	}
	path := make([]Position, 0, len(rev)+1)
	path = append(path, start)
	for i := len(rev) - 1; i >= 0; i-- {
		path = append(path, Position{X: float64(rev[i] % gridWidth), Y: float64(rev[i] / gridWidth)})
	}
	return path
}

func (gs *GameStateWithShooting) RecalculateEnemyPaths() {
	if gs.GoalPoint == nil {
		return
	}

	for i := range gs.Enemies {
		enemy := &gs.Enemies[i]
		currentPos := Position{
			X: math.Round(enemy.Position.X),
			Y: math.Round(enemy.Position.Y),
		}
		newPath := gs.findPath(currentPos, *gs.GoalPoint)
		if newPath != nil {
			enemy.Path = newPath
			enemy.PathIndex = 0
		} else {
			enemy.Path = []Position{currentPos}
			enemy.PathIndex = 0
		}
	}
}

func (gs *GameStateWithShooting) FindPathFromSpawn() []Position {
	gs.mu.RLock()
	defer gs.mu.RUnlock()

	if gs.SpawnPoint == nil || gs.GoalPoint == nil {
		return nil
	}
	return gs.findPath(*gs.SpawnPoint, *gs.GoalPoint)
}
