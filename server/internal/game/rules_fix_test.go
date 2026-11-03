package game

import (
	"math"
	"testing"
)

// sitter returns an enemy that stays put in range with plenty of health.
func sitter(id int, x, y float64) Enemy {
	return Enemy{ID: id, Position: Position{X: x, Y: y}, EnemyType: "tank",
		Health: 1e9, MaxHealth: 1e9, Speed: 0, SpawnWave: 1}
}

// FS-01: over a long stretch, a tower fires at its stated rate. The old
// "Cooldown = 1/rate" dropped the overshoot each shot, so a 1.5/s tower
// fired 1.43/s at 1/60 s steps and less at bigger steps.
func TestTowerFiresAtStatedRate(t *testing.T) {
	gs := newTestGameOnMap(DefaultMapID)
	gs.Phase = PhaseActive
	gs.EnemiesRemaining = 1
	gs.Enemies = append(gs.Enemies, sitter(1, 5, 5))
	gs.Towers = append(gs.Towers, Tower{ID: 1, Position: Position{X: 5, Y: 6}, TowerType: "basic",
		Level: 1, Range: 3, Damage: 1, FireRate: 1.5})

	const seconds = 20.0
	for i := 0; i < int(seconds*60); i++ {
		gs.Update(simStep)
	}
	shots := gs.nextProjectileID - 1
	if want := int(seconds * 1.5); shots < want || shots > want+1 {
		t.Errorf("fired %d shots in %.0f s at 1.5/s, want %d (±1)", shots, seconds, want)
	}
}

// FS-01/FS-08: the loop's advance runs whole 1/60 steps — three per tick at
// 3x, never one big step — and caps how much a stall can catch up.
func TestAdvanceRunsFixedSteps(t *testing.T) {
	gs := newTestGameOnMap(DefaultMapID)
	gs.Phase = PhaseActive
	gs.EnemiesRemaining = 1
	gs.SpeedMultiplier = 3

	acc := 0.0
	for i := 0; i < 60; i++ { // one second of ticks
		acc = advance(gs, acc, 1.0/60)
	}
	if got := gs.GameTime; math.Abs(got-3.0) > 1e-6 {
		t.Errorf("3x for 1 s advanced GameTime %.6f, want 3.0", got)
	}

	before := gs.GameTime
	advance(gs, 0, 5.0) // a 5 s stall
	if got := gs.GameTime - before; math.Abs(got-maxFrameTime*3) > simStep {
		t.Errorf("a 5 s stall advanced %.3f s, want it capped at %.3f", got, maxFrameTime*3)
	}
}

// FS-02: a tower change keeps each enemy where it is and routes it from the
// cell it was heading for; a tower on that cell routes it from the cell it is
// leaving, never through the tower.
func TestRepathKeepsEnemyPosition(t *testing.T) {
	gs := newTestGameOnMap(DefaultMapID)
	gs.Enemies = append(gs.Enemies, Enemy{ID: 1, Position: Position{X: 3.4, Y: 7}, EnemyType: "basic",
		Health: 10, MaxHealth: 10, Speed: 1,
		Path:      []Position{{X: 3, Y: 7}, {X: 4, Y: 7}, {X: 5, Y: 7}},
		PathIndex: 1})

	if _, err := gs.AddTower(10, 2, "basic"); err != nil { // off the lane
		t.Fatalf("AddTower: %v", err)
	}
	e := gs.GetSnapshot().Enemies[0]
	if e.Position.X != 3.4 || e.Position.Y != 7 {
		t.Errorf("enemy moved to %+v on a tower change, want it left at (3.4, 7)", e.Position)
	}
	if e.Path[0] != (Position{X: 4, Y: 7}) {
		t.Errorf("new path starts at %+v, want the cell it was heading for (4,7)", e.Path[0])
	}

	if _, err := gs.AddTower(4, 7, "basic"); err != nil { // right in front of it
		t.Fatalf("AddTower: %v", err)
	}
	e = gs.GetSnapshot().Enemies[0]
	if e.Path[0] != (Position{X: 3, Y: 7}) {
		t.Errorf("path starts at %+v after a tower on its next cell, want (3,7)", e.Path[0])
	}
	for _, p := range e.Path {
		if p == (Position{X: 4, Y: 7}) {
			t.Fatal("new path runs through the tower cell")
		}
	}
	last := e.Path[len(e.Path)-1]
	if last != *gs.GoalPoint {
		t.Errorf("path ends at %+v, want the goal", last)
	}
}

// FS-02 exploit: placing and selling a tower over and over must not hold a
// moving enemy back.
func TestPlaceSellCycleDoesNotStallEnemies(t *testing.T) {
	gs := newTestGameOnMap(DefaultMapID)
	gs.Phase = PhaseActive
	gs.EnemiesRemaining = 1
	path := gs.findPath(*gs.SpawnPoint, *gs.GoalPoint)
	gs.Enemies = append(gs.Enemies, Enemy{ID: 1, Position: path[0], EnemyType: "basic",
		Health: 1e9, MaxHealth: 1e9, Speed: 1, Path: path})
	gs.Gold = 1e6

	for i := 0; i < 60; i++ { // one second, cycling every tick
		tw, err := gs.AddTower(10, 2, "basic")
		if err != nil {
			t.Fatalf("AddTower: %v", err)
		}
		gs.RemoveTower(tw.ID)
		gs.Update(simStep)
	}
	if x := gs.GetSnapshot().Enemies[0].Position.X; x < 0.9 {
		t.Errorf("enemy at speed 1 only reached x=%.2f after 1 s of place/sell, want ~1.0", x)
	}
}

// FS-03: a weaker slow never replaces a stronger one that is still running.
func TestApplySlowKeepsStrongerSlow(t *testing.T) {
	e := &Enemy{}
	applySlow(e, 0.25, 3.5) // Deep Freeze
	applySlow(e, 0.40, 2.0) // level 1 Stasis
	if e.SlowMultiplier != 0.25 || e.SlowDuration != 3.5 {
		t.Errorf("after a weak hit: mult=%.2f dur=%.1f, want 0.25 / 3.5", e.SlowMultiplier, e.SlowDuration)
	}
	applySlow(e, 0.25, 1.0) // same strength, shorter: keep the longer
	if e.SlowDuration != 3.5 {
		t.Errorf("equal slow shortened the duration to %.1f", e.SlowDuration)
	}
	e.SlowDuration = 0 // expired
	applySlow(e, 0.40, 2.0)
	if e.SlowMultiplier != 0.40 || e.SlowDuration != 2.0 {
		t.Errorf("weak slow after expiry not applied: mult=%.2f dur=%.1f", e.SlowMultiplier, e.SlowDuration)
	}
	applySlow(e, 0.10, 1.0) // stronger replaces
	if e.SlowMultiplier != 0.10 || e.SlowDuration != 1.0 {
		t.Errorf("stronger slow not applied: mult=%.2f dur=%.1f", e.SlowMultiplier, e.SlowDuration)
	}
}

// FS-04: refunds are exactly 70%, rounded down, with no float error.
func TestSellRefundExact(t *testing.T) {
	for _, spent := range []int{50, 90, 170, 180, 330, 350} {
		gs := newTestGameOnMap(DefaultMapID)
		gs.Towers = append(gs.Towers, Tower{ID: 1, Position: Position{X: 5, Y: 5}, TowerType: "basic", TotalSpent: spent})
		refund, ok := gs.RemoveTower(1)
		if want := spent * 7 / 10; !ok || refund != want {
			t.Errorf("spent %d: refund %d, want %d", spent, refund, want)
		}
	}
}

// FS-05: towers don't target enemies already killed this tick.
func TestTargetingSkipsDeadEnemies(t *testing.T) {
	gs := newTestGameOnMap(DefaultMapID)
	dead := sitter(1, 5, 5)
	dead.Health = 0
	gs.Enemies = append(gs.Enemies, dead, sitter(2, 6, 5))
	if e := gs.findNearestEnemy(Position{X: 5, Y: 5}, 3); e == nil || e.ID != 2 {
		t.Errorf("findNearestEnemy picked %v, want the living enemy 2", e)
	}
	picked := gs.findNearestEnemies(Position{X: 5, Y: 5}, 3, 3)
	if len(picked) != 1 || picked[0].ID != 2 {
		t.Errorf("findNearestEnemies picked %d enemies, want only the living one", len(picked))
	}
}

// FS-25: snapshots carry the exact prices the server will use.
func TestSnapshotTowerPrices(t *testing.T) {
	gs := newTestGameOnMap(DefaultMapID)
	gs.Gold = 1e6
	tw, err := gs.AddTower(5, 5, "basic")
	if err != nil {
		t.Fatalf("AddTower: %v", err)
	}
	snap := gs.GetSnapshot().Towers[0]
	if snap.SellValue != 35 || snap.UpgradeCost != 50 || snap.EvolveCost != 0 {
		t.Errorf("level 1 basic: sell=%d upgrade=%d evolve=%d, want 35/50/0", snap.SellValue, snap.UpgradeCost, snap.EvolveCost)
	}
	for i := 0; i < 3; i++ {
		gs.UpgradeTower(tw.ID)
	}
	snap = gs.GetSnapshot().Towers[0]
	if snap.Level != 4 || snap.UpgradeCost != 0 || snap.EvolveCost != 400 || snap.SellValue != 140 {
		t.Errorf("max basic: level=%d upgrade=%d evolve=%d sell=%d, want 4/0/400/140",
			snap.Level, snap.UpgradeCost, snap.EvolveCost, snap.SellValue)
	}
	if gs.Towers[0].SellValue != 0 {
		t.Error("prices leaked into the live tower state; they belong on snapshots only")
	}
	if refund, _ := gs.RemoveTower(tw.ID); refund != snap.SellValue {
		t.Errorf("refund %d differs from the shown sell value %d", refund, snap.SellValue)
	}
}

// Improvement (Nov 3): each snapshot previews the next level, and the
// preview equals what UpgradeTower then produces, for every base type and
// level. Max-level and evolved towers carry no preview.
func TestNextLevelPreviewMatchesUpgrade(t *testing.T) {
	for _, typ := range []string{"basic", "sniper", "splash", "slow", "tesla"} {
		gs := newTestGameOnMap(DefaultMapID)
		gs.Gold = 1e6
		tw, err := gs.AddTower(5, 5, typ)
		if err != nil {
			t.Fatalf("%s: AddTower: %v", typ, err)
		}
		for lvl := 1; lvl < maxTowerLevel; lvl++ {
			p := gs.GetSnapshot().Towers[0].Next
			if p == nil {
				t.Fatalf("%s L%d: no preview", typ, lvl)
			}
			up, ok := gs.UpgradeTower(tw.ID)
			if !ok {
				t.Fatalf("%s L%d: upgrade refused", typ, lvl)
			}
			got := TowerPreview{Level: up.Level, Range: up.Range, Damage: up.Damage,
				SlowDuration: up.SlowDuration, SlowMultiplier: up.SlowMultiplier,
				AOERadius: up.AOERadius, AOEDamage: up.AOEDamage,
				ChainCount: up.ChainCount, ChainRadius: up.ChainRadius}
			if *p != got {
				t.Errorf("%s L%d: preview %+v, upgrade gave %+v", typ, lvl, *p, got)
			}
		}
		if gs.GetSnapshot().Towers[0].Next != nil {
			t.Errorf("%s: max-level tower still has a preview", typ)
		}
	}
}
