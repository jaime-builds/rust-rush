// Tower placement, selling and upgrades.

package game

import (
	"errors"
	"math"
)

// Placement failure reasons, distinguished so the client ack can say why.
var (
	ErrInsufficientGold = errors.New("insufficient gold")
	ErrInvalidPlacement = errors.New("invalid placement")
	// ErrPathBlocked: the cell is otherwise legal, but walling it would
	// leave no spawn→goal route at all. Rejected because a sealed lane is
	// a farming exploit — enemies freeze in place soaking free tower fire
	// without ever leaking, then the player reopens the lane to collect.
	ErrPathBlocked = errors.New("path blocked")
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
	if gs.isObstacle(cx, cy) {
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
	// Sealing the lane is rejected. Checked before any gold moves, so a
	// rejection leaves the room exactly as it was.
	if gs.SpawnPoint != nil && gs.GoalPoint != nil &&
		!gs.pathExistsWithExtraBlock(*gs.SpawnPoint, *gs.GoalPoint, cx, cy) {
		return Tower{}, ErrPathBlocked
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

	// Initialize special fields for slow, splash, and tesla towers
	if towerType == "slow" {
		tower.SlowDuration = defaultSlowDuration
		tower.SlowMultiplier = defaultSlowMultiplier
	}
	if towerType == "splash" {
		tower.AOERadius = defaultAOERadius
		tower.AOEDamage = defaultAOEDamagePct
	}
	if towerType == "tesla" {
		tower.ChainCount = defaultChainCount
		tower.ChainRadius = defaultChainRadius
	}

	gs.Gold -= cost
	gs.Towers = append(gs.Towers, tower)
	gs.nextTowerID++
	gs.RecalculateEnemyPaths()
	if len(gs.Towers) >= fortressTowers {
		gs.emitLocked(Event{Kind: EventTowerCount, TowerCount: len(gs.Towers)})
	}

	return tower, nil
}

// RemoveTower removes a tower by ID and refunds 70% of its cost.
func (gs *GameStateWithShooting) RemoveTower(towerID int) (int, bool) {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	for i, tower := range gs.Towers {
		if tower.ID == towerID {
			refund := sellValue(tower.TotalSpent) // integer math: 180 → 126, not 125
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
		if tower.Level >= maxTowerLevel || tower.Evolved {
			return Tower{}, false
		}

		cost := getTowerCost(tower.TowerType)
		if gs.Gold < cost {
			return Tower{}, false
		}

		gs.Gold -= cost
		tower.TotalSpent += cost
		tower.Level++

		applyLevelStats(tower)

		return *tower, true
	}
	return Tower{}, false
}

// applyLevelStats sets a base tower's stats for its current Level: +20%
// damage and +10% range per level above 1, plus each type's special curve.
// UpgradeTower uses it after bumping the level; the snapshot uses it on a
// copy to preview the next level, so the preview can never drift from what
// an upgrade actually does.
func applyLevelStats(t *Tower) {
	// Core stat scaling: +20% damage, +10% range per level above 1
	base := getTowerStats(t.TowerType)
	levelMult := math.Pow(1.20, float64(t.Level-1))
	t.Damage = math.Round(base.Damage*levelMult*10) / 10
	t.Range = math.Round(base.Range*math.Pow(1.10, float64(t.Level-1))*100) / 100

	// Slow tower: longer duration and stronger slow each level
	// L1: 2.0s / 0.40x  L2: 2.5s / 0.35x  L3: 3.0s / 0.30x  L4: 3.5s / 0.25x
	if t.TowerType == "slow" {
		t.SlowDuration = defaultSlowDuration + float64(t.Level-1)*0.5
		t.SlowMultiplier = defaultSlowMultiplier - float64(t.Level-1)*0.05
	}

	// Splash tower: wider radius and higher AOE damage % each level
	// L1: 1.5 / 60%  L2: 1.8 / 70%  L3: 2.1 / 80%  L4: 2.4 / 90%
	if t.TowerType == "splash" {
		t.AOERadius = defaultAOERadius + float64(t.Level-1)*0.3
		t.AOEDamage = defaultAOEDamagePct + float64(t.Level-1)*0.10
	}

	// Tesla: the chain itself grows each level — one more arc target and
	// a wider jump radius, on top of the standard damage/range curve.
	// L1: 2 / 1.5u  L2: 3 / 1.7u  L3: 4 / 1.9u  L4: 5 / 2.1u
	if t.TowerType == "tesla" {
		t.ChainCount = defaultChainCount + (t.Level - 1)
		t.ChainRadius = defaultChainRadius + float64(t.Level-1)*0.2
	}
}
