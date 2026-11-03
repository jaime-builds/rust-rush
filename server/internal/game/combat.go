// Per-tick simulation: tower targeting and fire, projectiles, enemy movement and effects.

package game

import (
	"math"
)

func (gs *GameStateWithShooting) updateTowers(deltaTime float64) {
	// Amplifier pass first: a tower inside any amplifier's radius gets its
	// damage and fire rate buffed. Buffs do not stack — one amplifier's worth,
	// no matter how many overlap.
	var ampIdx []int
	for i := range gs.Towers {
		if gs.Towers[i].TowerType == "amplifier" {
			ampIdx = append(ampIdx, i)
		}
	}
	buffFor := func(t *Tower) (dmgMult, rateMult float64) {
		for _, ai := range ampIdx {
			amp := &gs.Towers[ai]
			if amp.ID == t.ID {
				continue
			}
			if distanceSquared(amp.Position, t.Position) <= amp.Range*amp.Range {
				es, _ := getEvolvedStats("amplifier")
				return es.AuraDamageMult, es.AuraRateMult
			}
		}
		return 1.0, 1.0
	}

	for i := range gs.Towers {
		tower := &gs.Towers[i]

		switch tower.TowerType {
		case "amplifier":
			// Pure support hardware: no target, no shots.
			tower.CurrentTarget = 0
			continue
		case "cryo_field":
			// Continuous slow aura instead of shots.
			tower.CurrentTarget = 0
			gs.applyCryoAura(tower)
			continue
		}

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

		dmgMult, rateMult := buffFor(tower)

		// Laser: continuous beam — damage applies every tick the beam holds a
		// target, no projectile, no cooldown. Damage stat is DPS.
		if tower.TowerType == "laser" {
			target.Health -= tower.Damage * dmgMult * deltaTime
			continue
		}

		if tower.Cooldown <= 0 {
			if tower.TowerType == "barrage" && tower.MultiShot > 1 {
				// Volley at up to MultiShot distinct nearest targets.
				for _, t := range gs.findNearestEnemies(tower.Position, tower.Range, tower.MultiShot) {
					gs.shootProjectile(tower, t, dmgMult)
				}
			} else {
				gs.shootProjectile(tower, target, dmgMult)
			}
			// += keeps the fraction of a step the cooldown overshot, so the
			// real fire rate matches FireRate instead of rounding up to the
			// next whole step every shot.
			tower.Cooldown += 1.0 / (tower.FireRate * rateMult)
			gs.MuzzleFlashes = append(gs.MuzzleFlashes, MuzzleFlash{
				ID:       gs.nextEffectID,
				Position: tower.Position,
				Duration: 0.1,
			})
			gs.nextEffectID++
		}
	}
}

// applyCryoAura slows every enemy in range continuously. It never overrides a
// stronger per-hit slow (a lower multiplier is a stronger slow); it re-applies
// each tick, so the debuff fades almost immediately after leaving the aura.
func (gs *GameStateWithShooting) applyCryoAura(tower *Tower) {
	es, _ := getEvolvedStats("cryo_field")
	rangeSq := tower.Range * tower.Range
	for i := range gs.Enemies {
		enemy := &gs.Enemies[i]
		if distanceSquared(tower.Position, enemy.Position) > rangeSq {
			continue
		}
		if enemy.SlowDuration > 0 && enemy.SlowMultiplier < es.AuraSlowMultiplier {
			continue // an active stasis/deep-freeze slow is stronger — keep it
		}
		enemy.SlowMultiplier = es.AuraSlowMultiplier
		if enemy.SlowDuration < 0.15 {
			enemy.SlowDuration = 0.15
		}
	}
}

// applySlow applies a per-hit slow without ever weakening one already in
// effect (a lower multiplier is a stronger slow): a level 1 Stasis hit must
// not replace a Deep Freeze slow. An equal slow refreshes to the longer
// duration; a stronger one replaces the old.
func applySlow(e *Enemy, multiplier, duration float64) {
	if e.SlowDuration > 0 && e.SlowMultiplier > 0 {
		if e.SlowMultiplier < multiplier {
			return // the active slow is stronger; keep it as it is
		}
		if e.SlowMultiplier == multiplier && e.SlowDuration > duration {
			return
		}
	}
	e.SlowMultiplier = multiplier
	e.SlowDuration = duration
}

// findNearestEnemy skips enemies already killed this tick: they are only
// removed in updateEnemies, and firing at them wasted shots and cooldowns.
func (gs *GameStateWithShooting) findNearestEnemy(pos Position, maxRange float64) *Enemy {
	var nearest *Enemy
	minDistSq := math.MaxFloat64
	maxRangeSq := maxRange * maxRange

	for i := range gs.Enemies {
		enemy := &gs.Enemies[i]
		if enemy.Health <= 0 {
			continue
		}
		distSq := distanceSquared(pos, enemy.Position)
		if distSq <= maxRangeSq && distSq < minDistSq {
			minDistSq = distSq
			nearest = enemy
		}
	}
	return nearest
}

// findNearestEnemies returns up to n distinct enemies in range, nearest first
// (barrage volleys). n is small (≤3), so repeated scans beat sorting.
func (gs *GameStateWithShooting) findNearestEnemies(pos Position, maxRange float64, n int) []*Enemy {
	maxRangeSq := maxRange * maxRange
	picked := make([]*Enemy, 0, n)
	taken := make(map[int]bool, n)
	for len(picked) < n {
		var nearest *Enemy
		minDistSq := math.MaxFloat64
		for i := range gs.Enemies {
			enemy := &gs.Enemies[i]
			if taken[enemy.ID] || enemy.Health <= 0 {
				continue
			}
			distSq := distanceSquared(pos, enemy.Position)
			if distSq <= maxRangeSq && distSq < minDistSq {
				minDistSq = distSq
				nearest = enemy
			}
		}
		if nearest == nil {
			break
		}
		picked = append(picked, nearest)
		taken[nearest.ID] = true
	}
	return picked
}

var projectileSpeedByType = map[string]float64{
	"sniper":      12.0,
	"piercer":     14.0,
	"executioner": 12.0,
	"tesla":       10.0,
	"breach":      9.0,
}

func (gs *GameStateWithShooting) shootProjectile(tower *Tower, target *Enemy, dmgMult float64) {
	speed := 8.0
	if s, ok := projectileSpeedByType[tower.TowerType]; ok {
		speed = s
	}

	proj := Projectile{
		ID:       gs.nextProjectileID,
		Position: tower.Position,
		TargetID: target.ID,
		Speed:    speed,
		Damage:   tower.Damage * dmgMult,
		TowerID:  tower.ID,
	}

	switch tower.TowerType {
	case "splash", "cluster", "siege":
		proj.IsAOE = true
		// Use tower's upgraded AOE fields if set, fall back to defaults
		if tower.AOERadius > 0 {
			proj.AOERadius = tower.AOERadius
		} else {
			proj.AOERadius = defaultAOERadius
		}
		if tower.AOEDamage > 0 {
			proj.AOEDamage = proj.Damage * tower.AOEDamage
		} else {
			proj.AOEDamage = proj.Damage * defaultAOEDamagePct
		}
	case "tesla":
		proj.chainCount = tower.ChainCount
		proj.chainRadius = tower.ChainRadius
		proj.chainDamage = proj.Damage * teslaChainDamagePct
	case "piercer":
		// Fixed straight line through the target, out to the tower's range
		// (plus a little, so edge-of-range targets are still fully crossed).
		dx := target.Position.X - tower.Position.X
		dy := target.Position.Y - tower.Position.Y
		dist := math.Sqrt(dx*dx + dy*dy)
		if dist == 0 {
			dist = 1
			dx = 1
		}
		proj.Pierce = true
		proj.dirX = dx / dist
		proj.dirY = dy / dist
		proj.rangeLeft = tower.Range + 0.5
	case "executioner":
		es, _ := getEvolvedStats("executioner")
		proj.execThreshold = es.ExecuteThreshold
		proj.execBonus = es.ExecuteBonus
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

		// Piercing shots fly a fixed line and damage everything they pass.
		if proj.Pierce {
			if gs.updatePierceProjectile(proj, deltaTime) {
				active = append(active, *proj)
			}
			continue
		}

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
			damage := proj.Damage
			// Execute: bonus damage against targets already near death.
			if proj.execThreshold > 0 && target.Health <= target.MaxHealth*proj.execThreshold {
				damage *= proj.execBonus
			}
			target.Health -= damage

			// Slow towers debuff on hit — read the parameters from the firing
			// tower itself so upgrades take effect (one lookup, not two).
			var firingTower *Tower
			for j := range gs.Towers {
				if gs.Towers[j].ID == proj.TowerID {
					firingTower = &gs.Towers[j]
					break
				}
			}
			if firingTower != nil && (firingTower.TowerType == "slow" || firingTower.TowerType == "deep_freeze") {
				slowDuration := defaultSlowDuration
				slowMultiplier := defaultSlowMultiplier
				if firingTower.SlowDuration > 0 {
					slowDuration = firingTower.SlowDuration
				}
				if firingTower.SlowMultiplier > 0 {
					slowMultiplier = firingTower.SlowMultiplier
				}
				applySlow(target, slowMultiplier, slowDuration)

				// Deep Freeze: chance to root the target outright.
				if firingTower.TowerType == "deep_freeze" {
					es, _ := getEvolvedStats("deep_freeze")
					if rootRoll() < es.RootChance {
						target.RootDuration = es.RootDuration
					}
				}
			}

			// Chain lightning: arc from the primary target to nearby enemies,
			// nearest-first, each arc jumping from the last enemy hit.
			if proj.chainCount > 0 {
				gs.applyChainLightning(proj, target)
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

// updatePierceProjectile advances a piercing shot along its fixed line,
// damaging each enemy it passes exactly once. Returns false once the shot has
// spent its range.
func (gs *GameStateWithShooting) updatePierceProjectile(proj *Projectile, deltaTime float64) bool {
	step := proj.Speed * deltaTime
	if step > proj.rangeLeft {
		step = proj.rangeLeft
	}
	proj.Position.X += proj.dirX * step
	proj.Position.Y += proj.dirY * step
	proj.rangeLeft -= step

	const hitRadiusSq = 0.5 * 0.5
	for j := range gs.Enemies {
		enemy := &gs.Enemies[j]
		if enemy.Health <= 0 {
			continue
		}
		if distanceSquared(proj.Position, enemy.Position) > hitRadiusSq {
			continue
		}
		alreadyHit := false
		for _, id := range proj.hitIDs {
			if id == enemy.ID {
				alreadyHit = true
				break
			}
		}
		if alreadyHit {
			continue
		}
		proj.hitIDs = append(proj.hitIDs, enemy.ID)
		enemy.Health -= proj.Damage
		gs.Explosions = append(gs.Explosions, Explosion{
			ID:       gs.nextEffectID,
			Position: enemy.Position,
			Duration: 0.25,
			Radius:   0.4,
		})
		gs.nextEffectID++
	}

	return proj.rangeLeft > 0
}

// applyChainLightning arcs from the primary target through up to chainCount
// additional enemies. Each arc jumps from the last enemy hit to the nearest
// un-hit enemy within chainRadius of it.
func (gs *GameStateWithShooting) applyChainLightning(proj *Projectile, primary *Enemy) {
	radiusSq := proj.chainRadius * proj.chainRadius
	hit := map[int]bool{primary.ID: true}
	from := primary

	for c := 0; c < proj.chainCount; c++ {
		var next *Enemy
		minDistSq := radiusSq
		for j := range gs.Enemies {
			enemy := &gs.Enemies[j]
			if hit[enemy.ID] || enemy.Health <= 0 {
				continue
			}
			distSq := distanceSquared(from.Position, enemy.Position)
			if distSq <= minDistSq {
				minDistSq = distSq
				next = enemy
			}
		}
		if next == nil {
			break
		}
		next.Health -= proj.chainDamage
		gs.Arcs = append(gs.Arcs, Arc{
			ID:       gs.nextEffectID,
			From:     from.Position,
			To:       next.Position,
			Duration: 0.18,
		})
		gs.nextEffectID++
		hit[next.ID] = true
		from = next
	}
}

func (gs *GameStateWithShooting) updateEnemies(deltaTime float64) {
	alive := gs.Enemies[:0] // in-place filter, same pattern as updateProjectiles

	for i := range gs.Enemies {
		enemy := &gs.Enemies[i]

		if enemy.Health <= 0 {
			reward := getEnemyGoldReward(enemy.EnemyType)
			if gs.Difficulty == DifficultyHarder {
				// −30%, rounded to nearest: 10→7, 8→6, 25→18, 100→70.
				reward = int(math.Round(float64(reward) * harderGoldMult))
			}
			gs.Gold += reward
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
		// Root (Deep Freeze) pins the enemy entirely and outranks any slow.
		if enemy.RootDuration > 0 {
			enemy.RootDuration -= deltaTime
			if enemy.RootDuration < 0 {
				enemy.RootDuration = 0
			}
			effectiveSpeed = 0
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

	activeArcs := gs.Arcs[:0]
	for i := range gs.Arcs {
		arc := &gs.Arcs[i]
		arc.Duration -= deltaTime
		if arc.Duration > 0 {
			activeArcs = append(activeArcs, *arc)
		}
	}
	gs.Arcs = activeArcs
}
