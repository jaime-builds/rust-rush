package game

import (
	"errors"
	"math"
	"testing"
)

// Test helpers -----------------------------------------------------------

// newTestGame pins the Switchback map: these behavior tests were written
// against its bulkheads (route lengths, obstacle-cell rejections), and the
// per-room default is now the open map.
func newTestGame() *GameStateWithShooting {
	return newTestGameOnMap("switchback")
}

func newTestGameOnMap(mapID string) *GameStateWithShooting {
	gs := NewGameStateWithShooting("test")
	if !gs.ResetToMap(mapID) {
		panic("unknown test map: " + mapID)
	}
	gs.SpawnPoint = &Position{X: 0, Y: 7}
	gs.GoalPoint = &Position{X: 19, Y: 7}
	return gs
}

// wallColumn places towers down every open cell of a grid column via the
// public API, so combined with any map obstacles the column fully blocks
// pathfinding.
func wallColumn(t *testing.T, gs *GameStateWithShooting, x int) {
	t.Helper()
	gs.mu.Lock()
	gs.Gold = 1_000_000
	gs.mu.Unlock()
	for y := 0; y < 15; y++ {
		if gs.isObstacle(x, y) {
			continue // already walled by the map itself
		}
		if _, err := gs.AddTower(float64(x), float64(y), "basic"); err != nil {
			t.Fatalf("failed to place wall tower at (%d,%d): %v", x, y, err)
		}
	}
	// Disarm the wall so these tests exercise pathing, not combat.
	gs.mu.Lock()
	for i := range gs.Towers {
		gs.Towers[i].Damage = 0
	}
	gs.mu.Unlock()
}

func tick(gs *GameStateWithShooting, seconds float64) {
	steps := int(seconds * 60)
	for i := 0; i < steps; i++ {
		gs.Update(1.0 / 60.0)
	}
}

// Documented behavior: "Trapped enemies stop moving" (TODO.md Phase 6).
// A trapped enemy must NOT be treated as having reached the goal: no -10
// health leak, and it stays on the field until a path opens again.
func TestTrappedEnemyStopsInsteadOfLeaking(t *testing.T) {
	gs := newTestGame()
	path := gs.FindPathFromSpawn()
	if path == nil {
		t.Fatal("expected an open path on an empty board")
	}
	gs.AddEnemy("basic", path, 1)
	gs.StartWave(1)
	gs.DecrementEnemiesRemaining() // spawn accounting: 1 spawned, 0 remaining

	wallColumn(t, gs, 10) // fully blocks the goal; RecalculateEnemyPaths runs inside AddTower

	tick(gs, 5)

	snap := gs.GetSnapshot()
	if snap.Health != 100 {
		t.Errorf("trapped enemy leaked damage: health = %d, want 100", snap.Health)
	}
	if len(snap.Enemies) != 1 {
		t.Errorf("trapped enemy was removed from the field: %d enemies, want 1", len(snap.Enemies))
	}
	if snap.Wave != 1 {
		t.Errorf("wave advanced while an enemy was trapped: wave = %d, want 1", snap.Wave)
	}
}

// Once the blocking tower is sold, a trapped enemy should resume moving and
// eventually reach the goal (normal -10 leak applies).
func TestTrappedEnemyResumesWhenUnblocked(t *testing.T) {
	gs := newTestGame()
	path := gs.FindPathFromSpawn()
	gs.AddEnemy("basic", path, 1)
	gs.StartWave(1)
	gs.DecrementEnemiesRemaining()

	// Wall column 2 — clear of the map bulkheads on both sides, so selling
	// one tower genuinely reopens a route (a wall hugging a bulkhead would
	// stay sealed by the bulkhead itself).
	wallColumn(t, gs, 2)
	tick(gs, 2)

	// Sell one wall tower to reopen the path (the wall towers are the only
	// towers, placed in y order 0..14 — sell the middle one).
	snap := gs.GetSnapshot()
	if len(snap.Towers) != 15 {
		t.Fatalf("expected 15 wall towers, got %d", len(snap.Towers))
	}
	if _, ok := gs.RemoveTower(snap.Towers[7].ID); !ok {
		t.Fatal("failed to sell wall tower")
	}

	// Basic enemy speed 2.0 cells/s; the switchback route after unblocking
	// can run ~45+ cells, so give it plenty of time.
	tick(gs, 45)

	snap = gs.GetSnapshot()
	if len(snap.Enemies) != 0 {
		t.Fatalf("enemy never reached the goal after unblocking (pos of first: %+v)", snap.Enemies[0].Position)
	}
	if snap.Health != 90 {
		t.Errorf("health = %d after leak, want 90", snap.Health)
	}
}

// Documented behavior (death-tick fix): if the final leaked enemy drops
// health to 0, the run ends — no completion bonus, no wave advance.
func TestGameOverBeatsWaveCompletion(t *testing.T) {
	gs := newTestGame()
	gs.mu.Lock()
	gs.Health = 10
	gs.mu.Unlock()

	// Enemy one short hop from the goal.
	path := []Position{{X: 18, Y: 7}, {X: 19, Y: 7}}
	gs.AddEnemy("fast", path, 1)
	gs.StartWave(1)
	gs.DecrementEnemiesRemaining()

	tick(gs, 3)

	snap := gs.GetSnapshot()
	if snap.Phase != PhaseGameOver {
		t.Fatalf("phase = %s, want game_over", snap.Phase)
	}
	if snap.Health != 0 {
		t.Errorf("health = %d, want 0", snap.Health)
	}
	if snap.Wave != 1 {
		t.Errorf("wave advanced past game over: wave = %d, want 1", snap.Wave)
	}
	if snap.Score != 0 {
		t.Errorf("completion bonus awarded on game over: score = %d, want 0", snap.Score)
	}
}

// Documented behavior: wave completion bonus = 50 × wave, doubled at full health.
func TestWaveCompletionBonus(t *testing.T) {
	gs := newTestGame()
	path := []Position{{X: 18, Y: 7}, {X: 19, Y: 7}}
	gs.AddEnemy("basic", path, 1)
	gs.StartWave(1)
	gs.DecrementEnemiesRemaining()

	tick(gs, 3) // enemy leaks: health 90, wave completes at NON-full health

	snap := gs.GetSnapshot()
	if snap.Phase != PhaseWaiting || snap.Wave != 2 {
		t.Fatalf("wave did not complete: phase=%s wave=%d", snap.Phase, snap.Wave)
	}
	if snap.Score != 50 {
		t.Errorf("score = %d, want 50 (50×wave1, not doubled at 90 health)", snap.Score)
	}

	// Full-health completion doubles the bonus.
	gs2 := newTestGame()
	gs2.StartWave(1)
	gs2.DecrementEnemiesRemaining()
	tick(gs2, 0.1) // no enemies at all → completes immediately at 100 health
	snap2 := gs2.GetSnapshot()
	if snap2.Score != 100 {
		t.Errorf("full-health bonus: score = %d, want 100 (2×50×wave1)", snap2.Score)
	}
}

// Documented behavior: kill score = base points × the wave the enemy spawned
// in (so debug spawns passed wave=1 score at wave-1 rates).
func TestKillScoreUsesSpawnWave(t *testing.T) {
	gs := newTestGame()
	path := []Position{{X: 5, Y: 7}, {X: 19, Y: 7}}
	enemy := gs.AddEnemy("tank", path, 8)
	gs.StartWave(1)
	gs.DecrementEnemiesRemaining()

	gs.mu.Lock()
	for i := range gs.Enemies {
		if gs.Enemies[i].ID == enemy.ID {
			gs.Enemies[i].Health = 0
		}
	}
	gs.mu.Unlock()

	tick(gs, 0.1)

	snap := gs.GetSnapshot()
	wantScore := 30*8 + 2*50 // tank kill at spawn wave 8 + full-health completion bonus for wave 1
	if snap.Score != wantScore {
		t.Errorf("score = %d, want %d", snap.Score, wantScore)
	}
	if snap.Gold != 200+25 {
		t.Errorf("gold = %d, want 225 (tank reward 25)", snap.Gold)
	}
}

// Documented behavior (README upgrade table): +20% damage and +10% range
// compound per level, upgrade cost = base cost, sell refund 70% of total spent.
func TestUpgradeMath(t *testing.T) {
	gs := newTestGame()
	tower, err := gs.AddTower(3, 3, "basic")
	if err != nil {
		t.Fatalf("failed to place tower: %v", err)
	}
	// 200 starting gold: 50 tower + 3×50 upgrades = exactly affordable.
	wantDamage := []float64{18, 21.6, 25.9}
	wantRange := []float64{3.3, 3.63, 3.99}
	for lvl := 2; lvl <= 4; lvl++ {
		up, ok := gs.UpgradeTower(tower.ID)
		if !ok {
			t.Fatalf("upgrade to level %d failed", lvl)
		}
		if up.Level != lvl {
			t.Errorf("level = %d, want %d", up.Level, lvl)
		}
		if math.Abs(up.Damage-wantDamage[lvl-2]) > 1e-9 {
			t.Errorf("L%d damage = %v, want %v", lvl, up.Damage, wantDamage[lvl-2])
		}
		if math.Abs(up.Range-wantRange[lvl-2]) > 1e-9 {
			t.Errorf("L%d range = %v, want %v", lvl, up.Range, wantRange[lvl-2])
		}
	}
	if _, ok := gs.UpgradeTower(tower.ID); ok {
		t.Error("upgrade past level 4 should fail")
	}
	refund, ok := gs.RemoveTower(tower.ID)
	if !ok || refund != 140 {
		t.Errorf("sell refund = %d, want 140 (70%% of 200 total spent)", refund)
	}
}

// Documented behavior (TODO Phase 12/13): slow and splash specials scale per level.
func TestSpecialUpgrades(t *testing.T) {
	gs := newTestGame()
	gs.mu.Lock()
	gs.Gold = 10000
	gs.mu.Unlock()

	slow, _ := gs.AddTower(2, 2, "slow")
	splash, _ := gs.AddTower(6, 4, "splash")

	for i := 0; i < 3; i++ {
		gs.UpgradeTower(slow.ID)
		gs.UpgradeTower(splash.ID)
	}
	snap := gs.GetSnapshot()
	for _, tw := range snap.Towers {
		switch tw.TowerType {
		case "slow":
			if math.Abs(tw.SlowDuration-3.5) > 1e-9 || math.Abs(tw.SlowMultiplier-0.25) > 1e-9 {
				t.Errorf("slow L4 = %.2fs/%.2fx, want 3.5s/0.25x", tw.SlowDuration, tw.SlowMultiplier)
			}
		case "splash":
			if math.Abs(tw.AOERadius-2.4) > 1e-9 || math.Abs(tw.AOEDamage-0.90) > 1e-9 {
				t.Errorf("splash L4 = %.2fu/%.0f%%, want 2.4u/90%%", tw.AOERadius, tw.AOEDamage*100)
			}
		}
	}
}

// Documented behavior (README wave table & TODO Phase 12): wave composition.
func TestWaveConfigProgression(t *testing.T) {
	for wave, wantBasic := range map[int]int{1: 5, 2: 7, 3: 9} {
		cfg := GetWaveConfig(wave)
		if len(cfg.Enemies) != 1 || cfg.Enemies[0].EnemyType != "basic" || cfg.Enemies[0].Count != wantBasic {
			t.Errorf("wave %d config = %+v, want basic×%d only", wave, cfg.Enemies, wantBasic)
		}
	}
	types := func(cfg WaveConfig) map[string]int {
		m := map[string]int{}
		for _, g := range cfg.Enemies {
			m[g.EnemyType] = g.Count
		}
		return m
	}
	w5 := types(GetWaveConfig(5))
	if w5["fast"] == 0 || w5["tank"] != 0 || w5["boss"] != 0 {
		t.Errorf("wave 5 = %v, want basic+fast only", w5)
	}
	w8 := types(GetWaveConfig(8))
	if w8["tank"] == 0 || w8["boss"] != 0 {
		t.Errorf("wave 8 = %v, want tanks but no boss", w8)
	}
	// Boss cadence: 1 at wave 11, +1 every 3rd wave, capped at 6.
	for wave, want := range map[int]int{10: 0, 11: 1, 13: 1, 14: 2, 26: 6, 40: 6} {
		if got := types(GetWaveConfig(wave))["boss"]; got != want {
			t.Errorf("wave %d boss count = %d, want %d", wave, got, want)
		}
	}
	// Spawn delay floor 0.25s.
	deep := GetWaveConfig(60)
	for _, g := range deep.Enemies {
		if g.EnemyType == "basic" && g.SpawnDelay != 0.25 {
			t.Errorf("wave 60 basic delay = %v, want floor 0.25", g.SpawnDelay)
		}
	}
}

// Documented behavior (TODO Phase 12): +10% health compound above wave 5,
// +3% speed compound above wave 5 capped at +80%.
func TestEnemyScaling(t *testing.T) {
	h1, s1 := ScaledEnemyStats("basic", 1)
	if h1 != 100 || s1 != 2.0 {
		t.Errorf("wave 1 basic = %v hp / %v spd, want 100 / 2.0", h1, s1)
	}
	h5, s5 := ScaledEnemyStats("basic", 5)
	if h5 != 100 || s5 != 2.0 {
		t.Errorf("wave 5 basic = %v hp / %v spd, want unscaled 100 / 2.0", h5, s5)
	}
	h10, s10 := ScaledEnemyStats("basic", 10)
	if math.Abs(h10-100*math.Pow(1.10, 5)) > 1e-9 {
		t.Errorf("wave 10 health = %v, want %v", h10, 100*math.Pow(1.10, 5))
	}
	if math.Abs(s10-2.0*math.Pow(1.03, 5)) > 1e-9 {
		t.Errorf("wave 10 speed = %v, want %v", s10, 2.0*math.Pow(1.03, 5))
	}
	_, s60 := ScaledEnemyStats("basic", 60)
	if math.Abs(s60-2.0*1.80) > 1e-9 {
		t.Errorf("wave 60 speed = %v, want capped at %v (+80%%)", s60, 2.0*1.80)
	}
}

// Slow debuff: 60% speed reduction (0.40 multiplier) that expires and refreshes.
func TestSlowDebuffTicksAndExpires(t *testing.T) {
	gs := newTestGame()
	path := []Position{{X: 0, Y: 7}, {X: 19, Y: 7}}
	e := gs.AddEnemy("tank", path, 1)
	gs.StartWave(1)
	gs.DecrementEnemiesRemaining()

	gs.mu.Lock()
	gs.Enemies[0].SlowDuration = 0.5
	gs.Enemies[0].SlowMultiplier = 0.40
	gs.mu.Unlock()

	start := gs.GetSnapshot().Enemies[0].Position.X
	tick(gs, 0.5)
	slowedDist := gs.GetSnapshot().Enemies[0].Position.X - start
	wantSlowed := 1.0 * 0.40 * 0.5 // tank speed 1.0 × multiplier × time
	if math.Abs(slowedDist-wantSlowed) > 0.02 {
		t.Errorf("slowed movement = %v cells in 0.5s, want ≈%v", slowedDist, wantSlowed)
	}

	snap := gs.GetSnapshot()
	if snap.Enemies[0].SlowDuration > 1e-9 {
		t.Errorf("slow did not expire: duration = %v", snap.Enemies[0].SlowDuration)
	}
	_ = e
}

// AOE projectile hit: full damage to target, AOEDamage to others in radius only.
func TestSplashDamage(t *testing.T) {
	gs := newTestGame()
	gs.mu.Lock()
	gs.Gold = 1000
	gs.mu.Unlock()

	// Stationary enemies: primary at (5,7), close neighbor in radius, far one outside.
	stay := func(x, y float64) []Position { return []Position{{X: x, Y: y}, {X: x, Y: y}} }
	primary := gs.AddEnemy("tank", stay(5, 7), 1)
	near := gs.AddEnemy("tank", stay(6, 7), 1)
	far := gs.AddEnemy("tank", stay(9, 7), 1)

	gs.mu.Lock()
	gs.Projectiles = append(gs.Projectiles, Projectile{
		ID: 1, Position: Position{X: 5.05, Y: 7}, TargetID: primary.ID,
		Speed: 8, Damage: 10, TowerID: 999, IsAOE: true, AOERadius: 1.5, AOEDamage: 6,
	})
	gs.EnemiesRemaining = 0
	gs.Phase = PhaseActive
	gs.mu.Unlock()

	gs.Update(1.0 / 60.0)

	snap := gs.GetSnapshot()
	health := map[int]float64{}
	for _, e := range snap.Enemies {
		health[e.ID] = e.Health
	}
	if health[primary.ID] != 290 {
		t.Errorf("primary health = %v, want 290 (full 10 damage)", health[primary.ID])
	}
	if health[near.ID] != 294 {
		t.Errorf("near health = %v, want 294 (6 AOE damage)", health[near.ID])
	}
	if health[far.ID] != 300 {
		t.Errorf("far health = %v, want 300 (outside radius)", health[far.ID])
	}
}

// New Game must cancel the active spawn goroutine's channel and reset state.
func TestResetCancelsSpawnAndResets(t *testing.T) {
	gs := newTestGame()
	cancel := gs.GetSpawnCancel()
	gs.mu.Lock()
	gs.Gold = 5
	gs.Wave = 9
	gs.Score = 1234
	gs.mu.Unlock()

	gs.Reset()

	select {
	case <-cancel:
		// closed as expected
	default:
		t.Error("Reset did not close the spawn cancel channel")
	}
	snap := gs.GetSnapshot()
	if snap.Gold != 200 || snap.Wave != 1 || snap.Score != 0 || snap.Phase != PhaseWaiting {
		t.Errorf("Reset state = gold %d wave %d score %d phase %s", snap.Gold, snap.Wave, snap.Score, snap.Phase)
	}
	// A second Reset must not panic (double-close guard via channel swap).
	gs.Reset()
}

// Insufficient funds must block placement and not mutate state.
func TestAddTowerInsufficientFunds(t *testing.T) {
	gs := newTestGame()
	gs.mu.Lock()
	gs.Gold = 40
	gs.mu.Unlock()
	if _, err := gs.AddTower(3, 3, "basic"); !errors.Is(err, ErrInsufficientGold) {
		t.Errorf("placed a $50 tower with $40 (err = %v)", err)
	}
	snap := gs.GetSnapshot()
	if snap.Gold != 40 || len(snap.Towers) != 0 {
		t.Errorf("state mutated on rejected placement: gold %d, towers %d", snap.Gold, len(snap.Towers))
	}
}

// The server validates placement itself instead of trusting the client.
func TestAddTowerPlacementValidation(t *testing.T) {
	gs := newTestGame()
	cases := []struct {
		name string
		x, y float64
		typ  string
	}{
		{"out of bounds x", -1, 7, "basic"},
		{"out of bounds y", 5, 15, "basic"},
		{"spawn cell", 0, 7, "basic"},
		{"goal cell", 19, 7, "basic"},
		{"unknown tower type", 5, 5, "laser"},
	}
	for _, c := range cases {
		if _, err := gs.AddTower(c.x, c.y, c.typ); !errors.Is(err, ErrInvalidPlacement) {
			t.Errorf("%s: err = %v, want ErrInvalidPlacement", c.name, err)
		}
	}

	if _, err := gs.AddTower(5, 5, "basic"); err != nil {
		t.Fatalf("valid placement rejected: %v", err)
	}
	if _, err := gs.AddTower(5, 5, "basic"); !errors.Is(err, ErrInvalidPlacement) {
		t.Error("occupied cell accepted")
	}
	for _, o := range GetMapDef("switchback").Obstacles {
		if _, err := gs.AddTower(o.X, o.Y, "basic"); !errors.Is(err, ErrInvalidPlacement) {
			t.Fatalf("obstacle cell (%v,%v) accepted", o.X, o.Y)
		}
	}

	if g := gs.GetSnapshot().Gold; g != 150 {
		t.Errorf("gold = %d after one $50 tower + rejections, want 150", g)
	}
}

// Any future edit to any map layout must keep the spawn→goal route open and
// must actually block the cells it claims to — every registry entry is
// checked, not just the original Switchback.
func TestAllMapsHaveOpenPath(t *testing.T) {
	if len(MapRegistry) < 5 {
		t.Fatalf("map registry has %d maps, want at least 5", len(MapRegistry))
	}
	for _, m := range MapRegistry {
		t.Run(m.ID, func(t *testing.T) {
			gs := newTestGameOnMap(m.ID)
			path := gs.FindPathFromSpawn()
			if path == nil {
				t.Fatal("map layout blocks the spawn→goal path entirely")
			}
			for _, p := range path {
				if gs.isObstacle(int(p.X), int(p.Y)) {
					t.Fatalf("path passes through obstacle at %v", p)
				}
			}
			for _, o := range m.Obstacles {
				if !gs.isObstacle(int(o.X), int(o.Y)) {
					t.Fatalf("declared obstacle (%v,%v) not blocked in lookup set", o.X, o.Y)
				}
			}
			t.Logf("%s (%s): path length %d cells (%d obstacles)", m.ID, m.Name, len(path), len(m.Obstacles))
		})
	}
}

// The default for fresh rooms is the open map, and new_game map switching
// works through ResetToMap.
func TestMapSelection(t *testing.T) {
	gs := NewGameStateWithShooting("test")
	if gs.GetSnapshot().MapID != DefaultMapID {
		t.Fatalf("fresh room map = %q, want %q", gs.GetSnapshot().MapID, DefaultMapID)
	}
	if len(gs.GetSnapshot().Obstacles) != 0 {
		t.Fatalf("open map should have no obstacles, got %d", len(gs.GetSnapshot().Obstacles))
	}

	if !gs.ResetToMap("needle") {
		t.Fatal("ResetToMap rejected a valid map ID")
	}
	snap := gs.GetSnapshot()
	if snap.MapID != "needle" || len(snap.Obstacles) != len(GetMapDef("needle").Obstacles) {
		t.Fatalf("after ResetToMap: map=%q obstacles=%d", snap.MapID, len(snap.Obstacles))
	}

	// The map's walls now drive placement validation and pathfinding.
	gs.SpawnPoint = &Position{X: 0, Y: 7}
	gs.GoalPoint = &Position{X: 19, Y: 7}
	if _, err := gs.AddTower(10, 0, "basic"); err == nil {
		t.Error("placement on a needle wall cell was accepted")
	}
	path := gs.FindPathFromSpawn()
	if path == nil {
		t.Fatal("no path on needle map")
	}
	through := false
	for _, p := range path {
		if int(p.X) == 10 && int(p.Y) == 7 {
			through = true
		}
	}
	if !through {
		t.Error("needle path does not pass through the (10,7) gate")
	}

	// Unknown ID: reset still happens, map unchanged.
	if gs.ResetToMap("no-such-map") {
		t.Error("ResetToMap accepted an unknown map ID")
	}
	if gs.GetSnapshot().MapID != "needle" {
		t.Errorf("map changed on unknown ID: %q", gs.GetSnapshot().MapID)
	}
}

// Pause must freeze the simulation completely — enemies, projectiles,
// cooldowns, effects, and the game clock — and resume from the same state.
func TestPauseFreezesUpdate(t *testing.T) {
	gs := newTestGame()
	path := gs.FindPathFromSpawn()
	if path == nil {
		t.Fatal("no path from spawn")
	}
	gs.AddEnemy("basic", path, 1)
	if !gs.StartWave(0) {
		t.Fatal("could not start wave")
	}
	gs.mu.Lock()
	gs.Explosions = append(gs.Explosions, Explosion{ID: 1, Position: Position{X: 5, Y: 5}, Duration: 0.3, Radius: 0.5})
	gs.mu.Unlock()

	gs.Update(1.0 / 60.0)
	before := gs.GetSnapshot()

	gs.SetPaused(true)
	for i := 0; i < 60; i++ {
		gs.Update(1.0 / 60.0)
	}
	frozen := gs.GetSnapshot()

	if !frozen.Paused {
		t.Error("snapshot does not carry Paused=true")
	}
	if frozen.Enemies[0].Position != before.Enemies[0].Position {
		t.Errorf("enemy moved while paused: %v -> %v", before.Enemies[0].Position, frozen.Enemies[0].Position)
	}
	if frozen.GameTime != before.GameTime {
		t.Errorf("game time advanced while paused: %v -> %v", before.GameTime, frozen.GameTime)
	}
	if len(frozen.Explosions) != len(before.Explosions) || frozen.Explosions[0].Duration != before.Explosions[0].Duration {
		t.Error("effects ticked down while paused")
	}

	// Resume: exactly one tick of movement from the frozen position.
	gs.SetPaused(false)
	gs.Update(1.0 / 60.0)
	after := gs.GetSnapshot()
	if after.Paused {
		t.Error("snapshot still Paused after resume")
	}
	if after.Enemies[0].Position == frozen.Enemies[0].Position {
		t.Error("enemy did not resume moving after unpause")
	}
	if after.GameTime <= frozen.GameTime {
		t.Error("game time did not resume after unpause")
	}
}

// SetSpeedMultiplier accepts exactly 1/2/3 and keeps FastForward coherent;
// Reset clears both pause and speed.
func TestSpeedMultiplierAndReset(t *testing.T) {
	gs := newTestGame()

	if !gs.SetSpeedMultiplier(2.0) {
		t.Error("2x rejected")
	}
	snap := gs.GetSnapshot()
	if snap.SpeedMultiplier != 2.0 || !snap.FastForward {
		t.Errorf("2x: multiplier %v fastforward %v", snap.SpeedMultiplier, snap.FastForward)
	}

	if gs.SetSpeedMultiplier(5.0) || gs.SetSpeedMultiplier(0) || gs.SetSpeedMultiplier(-1) {
		t.Error("invalid speed accepted")
	}
	if gs.GetSpeedMultiplier() != 2.0 {
		t.Errorf("invalid speed mutated multiplier: %v", gs.GetSpeedMultiplier())
	}

	if !gs.SetSpeedMultiplier(1.0) {
		t.Error("1x rejected")
	}
	if gs.GetSnapshot().FastForward {
		t.Error("FastForward still set at 1x")
	}

	gs.SetSpeedMultiplier(3.0)
	gs.SetPaused(true)
	gs.Reset()
	snap = gs.GetSnapshot()
	if snap.Paused || snap.SpeedMultiplier != 1.0 || snap.FastForward {
		t.Errorf("Reset kept pause/speed: paused %v multiplier %v ff %v", snap.Paused, snap.SpeedMultiplier, snap.FastForward)
	}
}
