package game

import (
	"errors"
	"math"
	"testing"
)

// Helpers ----------------------------------------------------------------

// stationary builds a two-point path that keeps an enemy parked at (x, y).
func stationary(x, y float64) []Position {
	return []Position{{X: x, Y: y}, {X: x, Y: y}}
}

// maxTower places a tower and upgrades it to level 4 via the public API.
func maxTower(t *testing.T, gs *GameStateWithShooting, x, y float64, towerType string) Tower {
	t.Helper()
	gs.mu.Lock()
	if gs.Gold < 100_000 {
		gs.Gold = 100_000
	}
	gs.mu.Unlock()
	tower, err := gs.AddTower(x, y, towerType)
	if err != nil {
		t.Fatalf("failed to place %s at (%v,%v): %v", towerType, x, y, err)
	}
	for lvl := 2; lvl <= 4; lvl++ {
		up, ok := gs.UpgradeTower(tower.ID)
		if !ok {
			t.Fatalf("failed to upgrade %s to level %d", towerType, lvl)
		}
		tower = up
	}
	return tower
}

// evolve is maxTower + EvolveTower, failing the test on any error.
func evolve(t *testing.T, gs *GameStateWithShooting, x, y float64, baseType, evolution string) Tower {
	t.Helper()
	tower := maxTower(t, gs, x, y, baseType)
	evolved, err := gs.EvolveTower(tower.ID, evolution)
	if err != nil {
		t.Fatalf("failed to evolve %s → %s: %v", baseType, evolution, err)
	}
	return evolved
}

func activateCombat(gs *GameStateWithShooting) {
	gs.mu.Lock()
	gs.Phase = PhaseActive
	gs.EnemiesRemaining = 1 // keeps the wave from "completing" mid-test
	gs.mu.Unlock()
}

func enemyByID(t *testing.T, gs *GameStateWithShooting, id int) Enemy {
	t.Helper()
	for _, e := range gs.GetSnapshot().Enemies {
		if e.ID == id {
			return e
		}
	}
	t.Fatalf("enemy %d not found (dead?)", id)
	return Enemy{}
}

// Tesla base tower --------------------------------------------------------

// Design doc: Tesla $150, range 4.0, 20 primary damage, chains at 50% to
// nearby enemies. Chain count/radius grow with level (2/1.5u → 5/2.1u).
func TestTeslaBaseStatsAndUpgradeScaling(t *testing.T) {
	gs := newTestGame()
	gs.mu.Lock()
	gs.Gold = 150
	gs.mu.Unlock()

	tower, err := gs.AddTower(5, 5, "tesla")
	if err != nil {
		t.Fatalf("failed to place tesla: %v", err)
	}
	if g := gs.GetSnapshot().Gold; g != 0 {
		t.Errorf("gold = %d after $150 tesla with $150, want 0", g)
	}
	if tower.Range != 4.0 || tower.Damage != 20.0 || tower.FireRate != 0.8 {
		t.Errorf("tesla L1 = %v/%v/%v, want 4.0/20.0/0.8", tower.Range, tower.Damage, tower.FireRate)
	}
	if tower.ChainCount != 2 || math.Abs(tower.ChainRadius-1.5) > 1e-9 {
		t.Errorf("tesla L1 chain = %d/%v, want 2/1.5", tower.ChainCount, tower.ChainRadius)
	}

	gs.mu.Lock()
	gs.Gold = 450 // 3 upgrades at base cost
	gs.mu.Unlock()
	wantChain := []struct {
		count  int
		radius float64
	}{{3, 1.7}, {4, 1.9}, {5, 2.1}}
	for lvl := 2; lvl <= 4; lvl++ {
		up, ok := gs.UpgradeTower(tower.ID)
		if !ok {
			t.Fatalf("tesla upgrade to L%d failed", lvl)
		}
		w := wantChain[lvl-2]
		if up.ChainCount != w.count || math.Abs(up.ChainRadius-w.radius) > 1e-9 {
			t.Errorf("tesla L%d chain = %d/%v, want %d/%v", lvl, up.ChainCount, up.ChainRadius, w.count, w.radius)
		}
	}
}

// Chain lightning: primary takes full damage, arcs jump nearest-first from
// the last enemy hit, each within the chain radius, capped at chain count.
func TestTeslaChainLightning(t *testing.T) {
	gs := newTestGame()
	primary := gs.AddEnemy("tank", stationary(5, 7), 1)
	near := gs.AddEnemy("tank", stationary(6, 7), 1)     // 1.0 from primary
	second := gs.AddEnemy("tank", stationary(7.2, 7), 1) // 1.2 from near
	far := gs.AddEnemy("tank", stationary(12, 7), 1)     // out of any chain
	activateCombat(gs)

	gs.mu.Lock()
	gs.Projectiles = append(gs.Projectiles, Projectile{
		ID: 1, Position: Position{X: 5.05, Y: 7}, TargetID: primary.ID,
		Speed: 10, Damage: 20, TowerID: 999,
		chainCount: 2, chainRadius: 1.5, chainDamage: 10,
	})
	gs.mu.Unlock()

	gs.Update(1.0 / 60.0)

	if h := enemyByID(t, gs, primary.ID).Health; h != 280 {
		t.Errorf("primary health = %v, want 280 (full 20)", h)
	}
	if h := enemyByID(t, gs, near.ID).Health; h != 290 {
		t.Errorf("chained-1 health = %v, want 290 (chain 10)", h)
	}
	if h := enemyByID(t, gs, second.ID).Health; h != 290 {
		t.Errorf("chained-2 health = %v, want 290 (chain jumped from first arc)", h)
	}
	if h := enemyByID(t, gs, far.ID).Health; h != 300 {
		t.Errorf("far health = %v, want 300 (out of chain radius)", h)
	}
	if arcs := gs.GetSnapshot().Arcs; len(arcs) != 2 {
		t.Errorf("arcs = %d, want 2", len(arcs))
	}
}

// Evolution core rules -----------------------------------------------------

// Design doc cost table (Pulse row): total_spent @MAX = 200, evolution cost
// 2× = 400, total_spent after = 600, sell refund = 420.
func TestEvolutionCostAndRefundMath(t *testing.T) {
	gs := newTestGame()
	tower := maxTower(t, gs, 3, 3, "basic")
	if tower.TotalSpent != 200 {
		t.Fatalf("total_spent @MAX = %d, want 200", tower.TotalSpent)
	}

	gs.mu.Lock()
	gs.Gold = 400
	gs.mu.Unlock()

	evolved, err := gs.EvolveTower(tower.ID, "breach")
	if err != nil {
		t.Fatalf("evolution failed: %v", err)
	}
	if g := gs.GetSnapshot().Gold; g != 0 {
		t.Errorf("gold = %d after $400 evolution with $400, want 0", g)
	}
	if evolved.TotalSpent != 600 {
		t.Errorf("total_spent after evolving = %d, want 600", evolved.TotalSpent)
	}
	if !evolved.Evolved || evolved.TowerType != "breach" {
		t.Errorf("tower = evolved:%v type:%s, want evolved breach", evolved.Evolved, evolved.TowerType)
	}
	// Fresh authored stats, not multipliers on the old ones.
	if evolved.Range != 3.2 || evolved.Damage != 55 || evolved.FireRate != 1.4 {
		t.Errorf("breach stats = %v/%v/%v, want 3.2/55/1.4", evolved.Range, evolved.Damage, evolved.FireRate)
	}

	refund, ok := gs.RemoveTower(tower.ID)
	if !ok || refund != 420 {
		t.Errorf("sell refund = %d, want 420 (70%% of 600)", refund)
	}
}

func TestEvolutionGating(t *testing.T) {
	gs := newTestGame()
	gs.mu.Lock()
	gs.Gold = 100_000
	gs.mu.Unlock()

	tower, _ := gs.AddTower(3, 3, "basic")

	// Not max level.
	if _, err := gs.EvolveTower(tower.ID, "breach"); !errors.Is(err, ErrNotMaxLevel) {
		t.Errorf("level-1 evolution err = %v, want ErrNotMaxLevel", err)
	}

	for i := 0; i < 3; i++ {
		gs.UpgradeTower(tower.ID)
	}

	// Wrong path for the base type.
	if _, err := gs.EvolveTower(tower.ID, "piercer"); !errors.Is(err, ErrInvalidEvolution) {
		t.Errorf("cross-type evolution err = %v, want ErrInvalidEvolution", err)
	}
	if _, err := gs.EvolveTower(tower.ID, "nonsense"); !errors.Is(err, ErrInvalidEvolution) {
		t.Errorf("unknown evolution err = %v, want ErrInvalidEvolution", err)
	}

	// Insufficient gold (needs 2×200 = 400).
	gs.mu.Lock()
	gs.Gold = 399
	gs.mu.Unlock()
	if _, err := gs.EvolveTower(tower.ID, "breach"); !errors.Is(err, ErrInsufficientGold) {
		t.Errorf("poor evolution err = %v, want ErrInsufficientGold", err)
	}

	// Success, then everything is locked.
	gs.mu.Lock()
	gs.Gold = 400
	gs.mu.Unlock()
	if _, err := gs.EvolveTower(tower.ID, "breach"); err != nil {
		t.Fatalf("evolution failed: %v", err)
	}
	gs.mu.Lock()
	gs.Gold = 100_000
	gs.mu.Unlock()
	if _, err := gs.EvolveTower(tower.ID, "barrage"); !errors.Is(err, ErrAlreadyEvolved) {
		t.Errorf("re-evolution err = %v, want ErrAlreadyEvolved", err)
	}
	if _, ok := gs.UpgradeTower(tower.ID); ok {
		t.Error("evolved tower accepted an upgrade")
	}

	// Unknown tower ID.
	if _, err := gs.EvolveTower(9999, "breach"); err == nil {
		t.Error("evolving a nonexistent tower succeeded")
	}
}

// The ten terminal forms are not placeable as base towers.
func TestEvolvedTypesNotPlaceable(t *testing.T) {
	gs := newTestGame()
	gs.mu.Lock()
	gs.Gold = 100_000
	gs.mu.Unlock()
	for evoType := range evolvedStatsByType {
		if _, err := gs.AddTower(5, 5, evoType); !errors.Is(err, ErrInvalidPlacement) {
			t.Errorf("AddTower(%q) err = %v, want ErrInvalidPlacement", evoType, err)
		}
	}
}

// Every base type must evolve cleanly into both of its options.
func TestAllTenEvolutionPaths(t *testing.T) {
	positions := [][2]float64{{2, 2}, {3, 2}, {5, 2}, {6, 2}, {7, 2}, {2, 12}, {3, 12}, {5, 12}, {6, 12}, {7, 12}}
	i := 0
	gs := newTestGame()
	for baseType, options := range evolutionOptions {
		for _, evoType := range options {
			pos := positions[i]
			i++
			tower := evolve(t, gs, pos[0], pos[1], baseType, evoType)
			if tower.TowerType != evoType || !tower.Evolved {
				t.Errorf("%s → %s: got type %s evolved %v", baseType, evoType, tower.TowerType, tower.Evolved)
			}
			es := evolvedStatsByType[evoType]
			if tower.Range != es.Range || tower.Damage != es.Damage || tower.FireRate != es.FireRate {
				t.Errorf("%s stats = %v/%v/%v, want %v/%v/%v",
					evoType, tower.Range, tower.Damage, tower.FireRate, es.Range, es.Damage, es.FireRate)
			}
		}
	}
}

// Evolved mechanics --------------------------------------------------------

// Barrage: one volley = up to 3 projectiles at distinct nearest targets.
func TestBarrageVolley(t *testing.T) {
	gs := newTestGame()
	tower := evolve(t, gs, 5, 7, "basic", "barrage")

	a := gs.AddEnemy("tank", stationary(6, 7), 1)
	b := gs.AddEnemy("tank", stationary(5, 8), 1)
	c := gs.AddEnemy("tank", stationary(4, 7), 1)
	activateCombat(gs)

	gs.Update(1.0 / 60.0)

	snap := gs.GetSnapshot()
	if len(snap.Projectiles) != 3 {
		t.Fatalf("projectiles after one volley = %d, want 3", len(snap.Projectiles))
	}
	targets := map[int]bool{}
	for _, p := range snap.Projectiles {
		if p.Damage != tower.Damage {
			t.Errorf("barrage projectile damage = %v, want %v", p.Damage, tower.Damage)
		}
		targets[p.TargetID] = true
	}
	for _, id := range []int{a.ID, b.ID, c.ID} {
		if !targets[id] {
			t.Errorf("barrage volley missed enemy %d (targets: %v)", id, targets)
		}
	}
}

// Piercer: the shot crosses the whole line and damages each enemy once.
func TestPiercerLineDamage(t *testing.T) {
	gs := newTestGame()
	evolve(t, gs, 2, 7, "sniper", "piercer")

	first := gs.AddEnemy("tank", stationary(5, 7), 1)
	second := gs.AddEnemy("tank", stationary(7, 7), 1)
	offline := gs.AddEnemy("tank", stationary(7, 9), 1) // 2 cells off the line
	activateCombat(gs)

	tick(gs, 2) // several shots fly the full line in 2s (speed 14, range ~8.5)

	// Each pierce shot deals exactly 70 to every enemy on the line — verify
	// both on-line enemies took identical damage and the off-line one none.
	h1 := enemyByID(t, gs, first.ID).Health
	h2 := enemyByID(t, gs, second.ID).Health
	if h1 >= 300 {
		t.Errorf("first on-line enemy untouched: health %v", h1)
	}
	if h1 != h2 {
		t.Errorf("on-line enemies took different damage: %v vs %v (each shot must hit both once)", h1, h2)
	}
	if h3 := enemyByID(t, gs, offline.ID).Health; h3 != 300 {
		t.Errorf("off-line enemy hit: health %v, want 300", h3)
	}
}

// Executioner: double damage below the 20% execute threshold.
func TestExecutionerThreshold(t *testing.T) {
	gs := newTestGame()
	healthy := gs.AddEnemy("tank", stationary(5, 7), 1) // 300 HP — above threshold
	weak := gs.AddEnemy("tank", stationary(8, 7), 1)
	activateCombat(gs)

	gs.mu.Lock()
	for i := range gs.Enemies {
		if gs.Enemies[i].ID == weak.ID {
			gs.Enemies[i].Health = 50 // ≤ 20% of 300
		}
	}
	gs.Projectiles = append(gs.Projectiles,
		Projectile{ID: 1, Position: Position{X: 5.05, Y: 7}, TargetID: healthy.ID,
			Speed: 12, Damage: 95, TowerID: 999, execThreshold: 0.20, execBonus: 2.0},
		Projectile{ID: 2, Position: Position{X: 8.05, Y: 7}, TargetID: weak.ID,
			Speed: 12, Damage: 95, TowerID: 999, execThreshold: 0.20, execBonus: 2.0},
	)
	gs.mu.Unlock()

	gs.Update(1.0 / 60.0)

	if h := enemyByID(t, gs, healthy.ID).Health; h != 205 {
		t.Errorf("healthy target health = %v, want 205 (plain 95)", h)
	}
	// weak: 50 - 190 = dead and removed; confirm it's gone.
	for _, e := range gs.GetSnapshot().Enemies {
		if e.ID == weak.ID {
			t.Errorf("weak target survived an execute: health %v", e.Health)
		}
	}
}

// Cluster/Siege reuse the AOE model with authored radius/percent.
func TestClusterAndSiegeAOE(t *testing.T) {
	gs := newTestGame()
	cluster := evolve(t, gs, 5, 5, "splash", "cluster")
	siege := evolve(t, gs, 8, 5, "splash", "siege")

	if math.Abs(cluster.AOERadius-3.5) > 1e-9 || math.Abs(cluster.AOEDamage-1.0) > 1e-9 {
		t.Errorf("cluster AOE = %v/%v, want 3.5/1.0", cluster.AOERadius, cluster.AOEDamage)
	}
	if math.Abs(siege.AOERadius-1.2) > 1e-9 || math.Abs(siege.AOEDamage-0.6) > 1e-9 {
		t.Errorf("siege AOE = %v/%v, want 1.2/0.6", siege.AOERadius, siege.AOEDamage)
	}

	gs.AddEnemy("tank", stationary(5, 6), 1)
	activateCombat(gs)
	gs.Update(1.0 / 60.0)

	snap := gs.GetSnapshot()
	if len(snap.Projectiles) != 2 {
		t.Fatalf("projectiles = %d, want 2 (cluster + siege)", len(snap.Projectiles))
	}
	for _, p := range snap.Projectiles {
		if !p.IsAOE {
			t.Errorf("projectile from tower %d is not AOE", p.TowerID)
		}
		switch p.TowerID {
		case cluster.ID:
			if p.AOERadius != 3.5 || math.Abs(p.AOEDamage-14.0) > 1e-9 {
				t.Errorf("cluster projectile = r%v/%v dmg, want 3.5/14 (100%% of 14)", p.AOERadius, p.AOEDamage)
			}
		case siege.ID:
			if p.AOERadius != 1.2 || math.Abs(p.AOEDamage-36.0) > 1e-9 {
				t.Errorf("siege projectile = r%v/%v dmg, want 1.2/36 (60%% of 60)", p.AOERadius, p.AOEDamage)
			}
		}
	}
}

// Cryo Field: continuous aura slow, no shots, never overrides a stronger slow.
func TestCryoFieldAura(t *testing.T) {
	gs := newTestGame()
	evolve(t, gs, 5, 7, "slow", "cryo_field")

	inRange := gs.AddEnemy("tank", stationary(7, 7), 1)
	outOfRange := gs.AddEnemy("tank", stationary(12, 7), 1) // 7 cells > 4.5 range
	stasised := gs.AddEnemy("tank", stationary(6, 7), 1)
	activateCombat(gs)

	gs.mu.Lock()
	for i := range gs.Enemies {
		if gs.Enemies[i].ID == stasised.ID {
			gs.Enemies[i].SlowDuration = 2.0
			gs.Enemies[i].SlowMultiplier = 0.25 // stronger than the 0.40 aura
		}
	}
	gs.mu.Unlock()

	tick(gs, 0.5)

	if e := enemyByID(t, gs, inRange.ID); e.SlowDuration <= 0 || math.Abs(e.SlowMultiplier-0.40) > 1e-9 {
		t.Errorf("in-range enemy = %vs/%v×, want continuously slowed at 0.40", e.SlowDuration, e.SlowMultiplier)
	}
	if e := enemyByID(t, gs, outOfRange.ID); e.SlowDuration > 0 {
		t.Errorf("out-of-range enemy slowed: %vs", e.SlowDuration)
	}
	if e := enemyByID(t, gs, stasised.ID); math.Abs(e.SlowMultiplier-0.25) > 1e-9 {
		t.Errorf("aura overrode a stronger slow: %v×, want 0.25", e.SlowMultiplier)
	}
	if n := len(gs.GetSnapshot().Projectiles); n != 0 {
		t.Errorf("cryo field fired %d projectiles, want 0", n)
	}
}

// Deep Freeze: slow on every hit plus a root that pins the enemy in place.
func TestDeepFreezeRoot(t *testing.T) {
	origRoll := rootRoll
	rootRoll = func() float64 { return 0 } // always under RootChance → always root
	defer func() { rootRoll = origRoll }()

	gs := newTestGame()
	evolve(t, gs, 5, 7, "slow", "deep_freeze")

	// A real (moving) path so we can verify the root actually pins it.
	path := []Position{{X: 7, Y: 7}, {X: 19, Y: 7}}
	e := gs.AddEnemy("tank", path, 1)
	activateCombat(gs)

	tick(gs, 1.5) // tower fires within 1/0.8 s; projectile flies < 0.3s

	rooted := enemyByID(t, gs, e.ID)
	if rooted.RootDuration <= 0 {
		t.Fatalf("enemy not rooted after a deep-freeze hit (root duration %v)", rooted.RootDuration)
	}
	if math.Abs(rooted.SlowMultiplier-0.25) > 1e-9 {
		t.Errorf("deep-freeze slow = %v×, want 0.25", rooted.SlowMultiplier)
	}
	posBefore := rooted.Position
	tick(gs, 0.5)
	posAfter := enemyByID(t, gs, e.ID).Position
	if posBefore != posAfter {
		t.Errorf("rooted enemy moved: %+v → %+v", posBefore, posAfter)
	}
}

// Deep Freeze with the dice pinned high must never root.
func TestDeepFreezeNoRootOnHighRoll(t *testing.T) {
	origRoll := rootRoll
	rootRoll = func() float64 { return 0.99 }
	defer func() { rootRoll = origRoll }()

	gs := newTestGame()
	evolve(t, gs, 5, 7, "slow", "deep_freeze")
	e := gs.AddEnemy("tank", stationary(7, 7), 1)
	activateCombat(gs)

	tick(gs, 1.5)

	got := enemyByID(t, gs, e.ID)
	if got.RootDuration > 0 {
		t.Errorf("enemy rooted on a 0.99 roll (chance 0.25)")
	}
	if got.SlowDuration <= 0 {
		t.Errorf("deep-freeze hit did not slow")
	}
}

// Laser: continuous DPS while a target is in range, no projectiles.
func TestLaserBeamDPS(t *testing.T) {
	gs := newTestGame()
	evolve(t, gs, 5, 7, "tesla", "laser")
	e := gs.AddEnemy("tank", stationary(7, 7), 1)
	activateCombat(gs)

	tick(gs, 1.0)

	got := enemyByID(t, gs, e.ID)
	want := 300.0 - 60.0 // 60 DPS × 1s
	if math.Abs(got.Health-want) > 1.5 {
		t.Errorf("health after 1s of beam = %v, want ≈%v", got.Health, want)
	}
	if n := len(gs.GetSnapshot().Projectiles); n != 0 {
		t.Errorf("laser fired %d projectiles, want 0", n)
	}
}

// Amplifier: +25% damage and fire rate for towers in radius, no stacking, and
// the amplifier itself never shoots.
func TestAmplifierBuff(t *testing.T) {
	gs := newTestGame()
	evolve(t, gs, 5, 7, "tesla", "amplifier")
	evolve(t, gs, 6, 8, "tesla", "amplifier") // overlapping second amp: must not stack

	buffed, err := gs.AddTower(6, 7, "basic") // 1 cell from amp (radius 3.5)
	if err != nil {
		t.Fatalf("failed to place basic: %v", err)
	}
	lone, err := gs.AddTower(17, 2, "basic") // far outside any aura
	if err != nil {
		t.Fatalf("failed to place lone basic: %v", err)
	}

	gs.AddEnemy("tank", stationary(7, 7), 1)
	gs.AddEnemy("tank", stationary(16, 2), 1)
	activateCombat(gs)

	gs.Update(1.0 / 60.0)

	snap := gs.GetSnapshot()
	if len(snap.Projectiles) != 2 {
		t.Fatalf("projectiles = %d, want 2 (amps must not shoot)", len(snap.Projectiles))
	}
	for _, p := range snap.Projectiles {
		switch p.TowerID {
		case buffed.ID:
			if math.Abs(p.Damage-15.0*1.25) > 1e-9 {
				t.Errorf("buffed projectile damage = %v, want 18.75 (+25%%, no stacking)", p.Damage)
			}
		case lone.ID:
			if p.Damage != 15.0 {
				t.Errorf("unbuffed projectile damage = %v, want 15", p.Damage)
			}
		default:
			t.Errorf("unexpected shooter: tower %d", p.TowerID)
		}
	}
	// Buffed cooldown: 1/(1.0 × 1.25) = 0.8s.
	for _, tw := range snap.Towers {
		if tw.ID == buffed.ID && math.Abs(tw.Cooldown-0.8) > 0.02 {
			t.Errorf("buffed cooldown = %v, want ≈0.8", tw.Cooldown)
		}
		if tw.ID == lone.ID && math.Abs(tw.Cooldown-1.0) > 0.02 {
			t.Errorf("unbuffed cooldown = %v, want ≈1.0", tw.Cooldown)
		}
	}
}
