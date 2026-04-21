package game

import (
	"fmt"
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
		extra := wave - 11
		basicCount := 10 + extra*2
		fastCount := 4 + extra
		tankCount := 2 + extra/2
		bossCount := wave / 5
		delay := math.Max(0.8-float64(extra)*0.05, 0.4)
		enemies := []WaveEnemy{
			{EnemyType: "basic", Count: basicCount, SpawnDelay: delay},
			{EnemyType: "fast", Count: fastCount, SpawnDelay: delay * 0.6},
			{EnemyType: "tank", Count: tankCount, SpawnDelay: delay * 1.5},
		}
		if bossCount > 0 {
			enemies = append(enemies, WaveEnemy{EnemyType: "boss", Count: bossCount, SpawnDelay: 3.0})
		}
		return WaveConfig{Wave: wave, Enemies: enemies}
	}
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
}

// Enemy represents a hostile unit
type Enemy struct {
	ID        int        `json:"id"`
	Position  Position   `json:"position"`
	EnemyType string     `json:"enemy_type"`
	Health    float64    `json:"health"`
	MaxHealth float64    `json:"max_health"`
	Speed     float64    `json:"speed"`
	Path      []Position `json:"path,omitempty"`
	PathIndex int        `json:"path_index"`
}

// Projectile represents a bullet/missile
type Projectile struct {
	ID       int      `json:"id"`
	Position Position `json:"position"`
	TargetID int      `json:"target_id"`
	Speed    float64  `json:"speed"`
	Damage   float64  `json:"damage"`
	TowerID  int      `json:"tower_id"`
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
	Wave             int           `json:"wave"`
	Phase            GamePhase     `json:"phase"`
	EnemiesRemaining int           `json:"enemies_remaining"`
	GameTime         float64       `json:"game_time"`
	SpawnPoint       *Position     `json:"spawn_point,omitempty"`
	GoalPoint        *Position     `json:"goal_point,omitempty"`
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
		Wave:             1,
		Phase:            PhaseWaiting,
		EnemiesRemaining: 0,
		GameTime:         0,
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
	gs.Wave = 1
	gs.Phase = PhaseWaiting
	gs.EnemiesRemaining = 0
	gs.GameTime = 0
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

	if gs.Phase == PhaseActive && len(gs.Enemies) == 0 && gs.EnemiesRemaining == 0 {
		gs.Projectiles = make([]Projectile, 0)
		gs.Phase = PhaseWaiting
		gs.Wave++
	}

	if gs.Health <= 0 {
		gs.Health = 0
		gs.Phase = PhaseGameOver
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
	minDist := math.MaxFloat64

	for i := range gs.Enemies {
		enemy := &gs.Enemies[i]
		dist := distance(pos, enemy.Position)
		if dist <= maxRange && dist < minDist {
			minDist = dist
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
	gs.Projectiles = append(gs.Projectiles, Projectile{
		ID:       gs.nextProjectileID,
		Position: tower.Position,
		TargetID: target.ID,
		Speed:    speed,
		Damage:   tower.Damage,
		TowerID:  tower.ID,
	})
	gs.nextProjectileID++
}

func (gs *GameStateWithShooting) updateProjectiles(deltaTime float64) {
	active := make([]Projectile, 0)

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
			gs.Explosions = append(gs.Explosions, Explosion{
				ID:       gs.nextEffectID,
				Position: proj.Position,
				Duration: 0.3,
				Radius:   0.5,
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
	alive := make([]Enemy, 0)

	for i := range gs.Enemies {
		enemy := &gs.Enemies[i]

		if enemy.Health <= 0 {
			gs.Gold += getEnemyGoldReward(enemy.EnemyType)
			continue
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
				moveDistance := enemy.Speed * deltaTime
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
		} else {
			gs.Health -= 10
		}
	}

	gs.Enemies = alive
}

func (gs *GameStateWithShooting) updateEffects(deltaTime float64) {
	activeFlashes := make([]MuzzleFlash, 0)
	for i := range gs.MuzzleFlashes {
		flash := &gs.MuzzleFlashes[i]
		flash.Duration -= deltaTime
		if flash.Duration > 0 {
			activeFlashes = append(activeFlashes, *flash)
		}
	}
	gs.MuzzleFlashes = activeFlashes

	activeExplosions := make([]Explosion, 0)
	for i := range gs.Explosions {
		explosion := &gs.Explosions[i]
		explosion.Duration -= deltaTime
		if explosion.Duration > 0 {
			activeExplosions = append(activeExplosions, *explosion)
		}
	}
	gs.Explosions = activeExplosions
}

// AddTower adds a tower, deducting gold. Returns false if insufficient funds.
func (gs *GameStateWithShooting) AddTower(x, y float64, towerType string) (Tower, bool) {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	stats := getTowerStats(towerType)
	cost := getTowerCost(towerType)

	if gs.Gold < cost {
		return Tower{}, false
	}

	tower := Tower{
		ID:        gs.nextTowerID,
		Position:  Position{X: x, Y: y},
		TowerType: towerType,
		Level:     1,
		Range:     stats.Range,
		Damage:    stats.Damage,
		FireRate:  stats.FireRate,
		Cooldown:  0,
		Rotation:  0,
	}

	gs.Gold -= cost
	gs.Towers = append(gs.Towers, tower)
	gs.nextTowerID++
	gs.RecalculateEnemyPaths()

	return tower, true
}

// RemoveTower removes a tower by ID and refunds 70% of its cost.
func (gs *GameStateWithShooting) RemoveTower(towerID int) (int, bool) {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	for i, tower := range gs.Towers {
		if tower.ID == towerID {
			cost := getTowerCost(tower.TowerType)
			refund := int(float64(cost) * 0.7)
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

// AddEnemy adds an enemy to the game
func (gs *GameStateWithShooting) AddEnemy(enemyType string, path []Position) Enemy {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	stats := getEnemyStats(enemyType)
	enemy := Enemy{
		ID:        gs.nextEnemyID,
		Position:  path[0],
		EnemyType: enemyType,
		Health:    stats.Health,
		MaxHealth: stats.Health,
		Speed:     stats.Speed,
		Path:      path,
		PathIndex: 0,
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

func (gs *GameStateWithShooting) StartWave(totalEnemies int) {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	gs.Phase = PhaseActive
	gs.EnemiesRemaining = totalEnemies
}

// GetSpawnCancel returns the cancel channel for the current spawn goroutine
func (gs *GameStateWithShooting) GetSpawnCancel() <-chan struct{} {
	gs.mu.RLock()
	defer gs.mu.RUnlock()
	return gs.spawnCancel
}

func (gs *GameStateWithShooting) RemoveAllTowers() {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	gs.Towers = make([]Tower, 0)
	gs.Projectiles = make([]Projectile, 0)
}

func (gs *GameStateWithShooting) RemoveAllEnemies() {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	gs.Enemies = make([]Enemy, 0)
	gs.Projectiles = make([]Projectile, 0)
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
		Wave:             gs.Wave,
		Phase:            gs.Phase,
		EnemiesRemaining: gs.EnemiesRemaining,
		GameTime:         gs.GameTime,
		SpawnPoint:       gs.SpawnPoint,
		GoalPoint:        gs.GoalPoint,
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

type towerStats struct {
	Range    float64
	Damage   float64
	FireRate float64
}

func getTowerStats(towerType string) towerStats {
	stats := map[string]towerStats{
		"basic":  {Range: 3.0, Damage: 15.0, FireRate: 1.0},
		"sniper": {Range: 6.0, Damage: 50.0, FireRate: 0.5},
		"splash": {Range: 2.5, Damage: 10.0, FireRate: 1.5},
		"slow":   {Range: 3.5, Damage: 8.0, FireRate: 0.8},
	}
	if s, ok := stats[towerType]; ok {
		return s
	}
	return stats["basic"]
}

func getTowerCost(towerType string) int {
	costs := map[string]int{
		"basic":  50,
		"sniper": 100,
		"splash": 75,
		"slow":   60,
	}
	if c, ok := costs[towerType]; ok {
		return c
	}
	return 50
}

type enemyStats struct {
	Health float64
	Speed  float64
}

func getEnemyStats(enemyType string) enemyStats {
	stats := map[string]enemyStats{
		"basic":  {Health: 100.0, Speed: 2.0},
		"fast":   {Health: 50.0, Speed: 4.0},
		"tank":   {Health: 300.0, Speed: 1.0},
		"flying": {Health: 80.0, Speed: 3.0},
		"boss":   {Health: 1000.0, Speed: 0.5},
	}
	if s, ok := stats[enemyType]; ok {
		return s
	}
	return stats["basic"]
}

func getEnemyGoldReward(enemyType string) int {
	rewards := map[string]int{
		"basic":  10,
		"fast":   8,
		"tank":   25,
		"flying": 15,
		"boss":   100,
	}
	if r, ok := rewards[enemyType]; ok {
		return r
	}
	return 10
}

func distance(a, b Position) float64 {
	dx := a.X - b.X
	dy := a.Y - b.Y
	return math.Sqrt(dx*dx + dy*dy)
}

func (gs *GameStateWithShooting) findPath(start, goal Position) []Position {
	const gridWidth = 20
	const gridHeight = 15

	blocked := make(map[string]bool)
	for _, tower := range gs.Towers {
		tx := int(math.Round(tower.Position.X))
		ty := int(math.Round(tower.Position.Y))
		blocked[fmt.Sprintf("%d,%d", tx, ty)] = true
	}

	type queueItem struct {
		pos  Position
		path []Position
	}

	startKey := fmt.Sprintf("%d,%d", int(math.Round(start.X)), int(math.Round(start.Y)))
	goalKey := fmt.Sprintf("%d,%d", int(math.Round(goal.X)), int(math.Round(goal.Y)))

	queue := []queueItem{{pos: start, path: []Position{start}}}
	visited := make(map[string]bool)
	visited[startKey] = true

	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]

		px := int(math.Round(current.pos.X))
		py := int(math.Round(current.pos.Y))

		if fmt.Sprintf("%d,%d", px, py) == goalKey {
			return current.path
		}

		neighbors := []Position{
			{X: float64(px + 1), Y: float64(py)},
			{X: float64(px - 1), Y: float64(py)},
			{X: float64(px), Y: float64(py + 1)},
			{X: float64(px), Y: float64(py - 1)},
		}

		for _, next := range neighbors {
			nx := int(math.Round(next.X))
			ny := int(math.Round(next.Y))
			key := fmt.Sprintf("%d,%d", nx, ny)

			if nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight {
				continue
			}
			if blocked[key] || visited[key] {
				continue
			}

			visited[key] = true
			newPath := make([]Position, len(current.path))
			copy(newPath, current.path)
			newPath = append(newPath, next)
			queue = append(queue, queueItem{pos: next, path: newPath})
		}
	}

	return nil
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
