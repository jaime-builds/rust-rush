package game

// progression_test.go — Map Progression & Unlocks: win-wave victory
// transitions, the Harder difficulty modifiers, Endless mode, and the
// sequence data on the map registry.

import (
	"testing"
	"time"
)

// leakOneEnemyThroughWave runs one wave where a single enemy leaks to the
// goal, completing the wave (the enemy is removed on arrival). The game must
// be in the waiting phase.
func leakOneEnemyThroughWave(t *testing.T, gs *GameStateWithShooting) {
	t.Helper()
	path := []Position{{X: 18, Y: 7}, {X: 19, Y: 7}}
	if !gs.StartWave(1) {
		t.Fatalf("could not start wave (phase %s)", gs.GetPhase())
	}
	gs.AddEnemy("fast", path, 1)
	gs.DecrementEnemiesRemaining()
	tick(gs, 3)
}

// The win transition must fire exactly once — same single-fire care as the
// game-over hook (TestOnGameOverFiresOnce): the phase flips to victory when
// the wave counter reaches WinWave, OnGameOver records the run, and further
// ticks in the victory phase change nothing.
func TestVictoryFiresOnceAtWinWave(t *testing.T) {
	gs := newTestGameOnMap("open") // Clearway: WinWave 25

	fired := make(chan int, 8)
	gs.mu.Lock()
	gs.Wave = 24 // clearing this wave takes the counter to 25 = WinWave
	gs.OnGameOver = func(wave, score int, duration float64) { fired <- wave }
	gs.mu.Unlock()

	leakOneEnemyThroughWave(t, gs)

	if gs.GetPhase() != PhaseVictory {
		t.Fatalf("phase = %s, want victory", gs.GetPhase())
	}
	snap := gs.GetSnapshot()
	if snap.Wave != 25 {
		t.Errorf("wave = %d, want 25 (the win wave)", snap.Wave)
	}

	select {
	case wave := <-fired:
		if wave != 25 {
			t.Errorf("run-complete hook got wave=%d, want 25", wave)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("run-complete hook never fired on victory")
	}

	// Keep ticking in the victory phase: no second fire, no phase change.
	tick(gs, 2)
	select {
	case extra := <-fired:
		t.Fatalf("hook fired again while sitting in victory: wave=%d", extra)
	case <-time.After(200 * time.Millisecond):
	}
	if gs.GetPhase() != PhaseVictory {
		t.Errorf("phase drifted out of victory: %s", gs.GetPhase())
	}
}

// An Endless run must never fire the win transition — the run just keeps
// going past the win wave exactly as today.
func TestEndlessNeverFiresVictory(t *testing.T) {
	gs := NewGameStateWithShooting("test")
	if !gs.ResetToMapWithOptions("open", DifficultyNormal, true) {
		t.Fatal("unknown map")
	}
	gs.SpawnPoint = &Position{X: 0, Y: 7}
	gs.GoalPoint = &Position{X: 19, Y: 7}
	gs.mu.Lock()
	gs.Wave = 24
	gs.mu.Unlock()

	// Clear two waves straight through the win wave.
	for i := 0; i < 2; i++ {
		leakOneEnemyThroughWave(t, gs)
		if phase := gs.GetPhase(); phase != PhaseWaiting {
			t.Fatalf("endless run stopped at phase %s after wave %d", phase, 24+i)
		}
	}
	if snap := gs.GetSnapshot(); snap.Wave != 26 {
		t.Errorf("wave = %d, want 26 (played past the win wave)", snap.Wave)
	}
}

// CONTINUE (ENDLESS) from the victory screen: victory → waiting with
// Endless set and everything else carried over; a later game over must not
// produce a second stats row for the same run.
func TestContinueEndlessFromVictory(t *testing.T) {
	gs := newTestGameOnMap("open")
	firedCount := 0
	fired := make(chan struct{}, 8)
	gs.mu.Lock()
	gs.Wave = 24
	gs.Gold = 777
	gs.OnGameOver = func(wave, score int, duration float64) { fired <- struct{}{} }
	gs.mu.Unlock()

	leakOneEnemyThroughWave(t, gs)
	if gs.GetPhase() != PhaseVictory {
		t.Fatalf("phase = %s, want victory", gs.GetPhase())
	}
	select {
	case <-fired:
		firedCount++
	case <-time.After(2 * time.Second):
		t.Fatal("hook never fired on victory")
	}

	if !gs.ContinueEndless() {
		t.Fatal("ContinueEndless refused from the victory phase")
	}
	snap := gs.GetSnapshot()
	if snap.Phase != PhaseWaiting || !snap.Endless {
		t.Fatalf("after continue: phase=%s endless=%v, want waiting/true", snap.Phase, snap.Endless)
	}
	if snap.Wave != 25 || snap.Gold != 777 {
		t.Errorf("continue was not seamless: wave=%d gold=%d, want 25/777", snap.Wave, snap.Gold)
	}

	// Die in the endless continuation — the run was already recorded at the
	// victory, so the hook must NOT fire a second time.
	gs.mu.Lock()
	gs.Health = 10
	gs.mu.Unlock()
	if !gs.StartWave(1) {
		t.Fatal("could not start endless wave")
	}
	gs.AddEnemy("fast", []Position{{X: 18, Y: 7}, {X: 19, Y: 7}}, 25)
	gs.DecrementEnemiesRemaining()
	tick(gs, 3)
	if gs.GetPhase() != PhaseGameOver {
		t.Fatalf("phase = %s, want game_over", gs.GetPhase())
	}
	select {
	case <-fired:
		t.Fatal("hook fired twice for one run (victory + later game over)")
	case <-time.After(200 * time.Millisecond):
	}

	// ContinueEndless is a no-op from every non-victory phase.
	if gs.ContinueEndless() {
		t.Error("ContinueEndless succeeded from game_over")
	}
}

// A fresh run after a victory must be able to win again (runRecorded and
// Endless both reset with the game).
func TestResetRearmsVictory(t *testing.T) {
	gs := newTestGameOnMap("open")
	gs.mu.Lock()
	gs.Wave = 24
	gs.mu.Unlock()
	leakOneEnemyThroughWave(t, gs)
	if gs.GetPhase() != PhaseVictory {
		t.Fatalf("phase = %s, want victory", gs.GetPhase())
	}

	fired := make(chan struct{}, 8)
	gs.Reset()
	gs.mu.Lock()
	gs.Wave = 24
	gs.OnGameOver = func(wave, score int, duration float64) { fired <- struct{}{} }
	if gs.Endless {
		t.Error("Endless survived a reset")
	}
	gs.mu.Unlock()

	leakOneEnemyThroughWave(t, gs)
	if gs.GetPhase() != PhaseVictory {
		t.Fatalf("second run: phase = %s, want victory", gs.GetPhase())
	}
	select {
	case <-fired:
	case <-time.After(2 * time.Second):
		t.Fatal("hook never fired for the second run's victory")
	}
}

// Harder difficulty: gold per kill −30% (rounded to nearest), score untouched.
func TestHarderDifficultyReducesGold(t *testing.T) {
	kills := map[string]int{"basic": 10, "fast": 8, "tank": 25, "boss": 100}
	wantHarder := map[string]int{"basic": 7, "fast": 6, "tank": 18, "boss": 70}

	for enemyType, normalReward := range kills {
		for _, difficulty := range []string{DifficultyNormal, DifficultyHarder} {
			gs := NewGameStateWithShooting("test")
			if !gs.ResetToMapWithOptions("open", difficulty, false) {
				t.Fatal("unknown map")
			}
			gs.SpawnPoint = &Position{X: 0, Y: 7}
			gs.GoalPoint = &Position{X: 19, Y: 7}
			gs.StartWave(1)
			gs.DecrementEnemiesRemaining()
			gs.AddEnemy(enemyType, []Position{{X: 5, Y: 7}, {X: 19, Y: 7}}, 1)
			goldBefore := gs.GetSnapshot().Gold
			gs.mu.Lock()
			gs.Enemies[0].Health = 0
			gs.mu.Unlock()
			gs.Update(1.0 / 60.0)

			got := gs.GetSnapshot().Gold - goldBefore
			want := normalReward
			if difficulty == DifficultyHarder {
				want = wantHarder[enemyType]
			}
			if got != want {
				t.Errorf("%s kill on %s: gold +%d, want +%d", enemyType, difficulty, got, want)
			}
		}
	}
}

// Harder difficulty: boss health ×1.5, boss speed unchanged, and non-boss
// enemies completely untouched.
func TestHarderDifficultyScalesBossHealthOnly(t *testing.T) {
	spawn := func(difficulty, enemyType string, wave int) Enemy {
		gs := NewGameStateWithShooting("test")
		if !gs.ResetToMapWithOptions("open", difficulty, false) {
			t.Fatal("unknown map")
		}
		gs.SpawnPoint = &Position{X: 0, Y: 7}
		gs.GoalPoint = &Position{X: 19, Y: 7}
		return gs.AddEnemy(enemyType, []Position{{X: 0, Y: 7}, {X: 19, Y: 7}}, wave)
	}

	for _, wave := range []int{1, 11, 20} { // across the wave-scaling curve
		normal := spawn(DifficultyNormal, "boss", wave)
		harder := spawn(DifficultyHarder, "boss", wave)
		if harder.Health != normal.Health*1.5 || harder.MaxHealth != normal.MaxHealth*1.5 {
			t.Errorf("wave %d boss: harder health %.1f/%.1f, want ×1.5 of %.1f/%.1f",
				wave, harder.Health, harder.MaxHealth, normal.Health, normal.MaxHealth)
		}
		if harder.Speed != normal.Speed {
			t.Errorf("wave %d boss: harder speed %.2f ≠ normal %.2f — speed must not change", wave, harder.Speed, normal.Speed)
		}
	}

	normalTank := spawn(DifficultyNormal, "tank", 12)
	harderTank := spawn(DifficultyHarder, "tank", 12)
	if harderTank.Health != normalTank.Health || harderTank.Speed != normalTank.Speed {
		t.Errorf("tank stats changed on harder (%.1f/%.2f vs %.1f/%.2f) — only bosses scale",
			harderTank.Health, harderTank.Speed, normalTank.Health, normalTank.Speed)
	}
}

// The registry's progression data: sequence orders are exactly 1-6 with no
// gaps or duplicates, win waves follow the confirmed 25/35×3/50×2 tier
// structure, and Clearway anchors the chain.
func TestMapRegistryProgressionData(t *testing.T) {
	if len(MapRegistry) != 6 {
		t.Fatalf("registry has %d maps, want 6", len(MapRegistry))
	}
	bySeq := make(map[int]*MapDef)
	tierCounts := make(map[int]int)
	for _, m := range MapRegistry {
		if m.SequenceOrder < 1 || m.SequenceOrder > 6 {
			t.Errorf("%s: sequence order %d out of range", m.ID, m.SequenceOrder)
		}
		if prev, dup := bySeq[m.SequenceOrder]; dup {
			t.Errorf("%s and %s share sequence order %d", m.ID, prev.ID, m.SequenceOrder)
		}
		bySeq[m.SequenceOrder] = m
		tierCounts[m.WinWave]++
	}
	if first := bySeq[1]; first == nil || first.ID != "open" || first.WinWave != 25 {
		t.Errorf("sequence position 1 = %+v, want Clearway at win wave 25", first)
	}
	if tierCounts[25] != 1 || tierCounts[35] != 3 || tierCounts[50] != 2 {
		t.Errorf("win-wave tiers = %v, want 1×25, 3×35, 2×50", tierCounts)
	}
	// Win waves must never decrease along the sequence — the design's three
	// escalating steps.
	for seq := 2; seq <= 6; seq++ {
		if bySeq[seq].WinWave < bySeq[seq-1].WinWave {
			t.Errorf("win wave drops from %d (#%d) to %d (#%d)",
				bySeq[seq-1].WinWave, seq-1, bySeq[seq].WinWave, seq)
		}
	}
}
