package game

// map_difficulty_sim_test.go — the measurement harness behind the map
// progression sequence (SequenceOrder in map.go). Not a pass/fail test: it
// plays every map with an identical, deterministic bot strategy and reports
// how far the run gets, so relative map difficulty can be compared with the
// build held constant. Skipped unless MAP_SIM=1 so the normal suite stays
// fast. Rerun with:
//
//	MAP_SIM=1 go test ./internal/game -run TestMapDifficultySimulation -v
//
// Method: for each map and each fixed tower budget, place basic towers one
// at a time on the open cell whose range covers the most cells of the
// current spawn→goal path (recomputing the path between placements, since
// towers reroute it; placements that would seal the path entirely are
// rejected). Then run real waves — same GetWaveConfig, same spawn pacing as
// SpawnWave, same Update() loop — until the base falls. Everything is
// deterministic (basic towers roll no dice), so the numbers are exactly
// reproducible.
//
// The bot is a naive-but-consistent player: it hugs the lane rather than
// mazing, never upgrades, never sells. Absolute waves reached mean nothing;
// only the comparison between maps under the identical strategy does.

import (
	"errors"
	"fmt"
	"math"
	"os"
	"testing"
)

// simPlaceGreedy places n basic towers by max-path-coverage greedy.
func simPlaceGreedy(t *testing.T, gs *GameStateWithShooting, n int) {
	t.Helper()
	gs.mu.Lock()
	gs.Gold = 1_000_000
	gs.mu.Unlock()

	const towerRange = 3.0 // basic tower range
	for placed := 0; placed < n; placed++ {
		path := gs.FindPathFromSpawn()
		if path == nil {
			t.Fatal("sim: path sealed before placement — should be impossible")
		}
		bestScore, bestX, bestY := -1, -1, -1
		for y := 0; y < gridHeight; y++ {
			for x := 0; x < gridWidth; x++ {
				if gs.isObstacle(x, y) {
					continue
				}
				if (x == 0 && y == 7) || (x == 19 && y == 7) {
					continue // spawn / goal
				}
				occupied := false
				for _, tw := range gs.Towers {
					if int(math.Round(tw.Position.X)) == x && int(math.Round(tw.Position.Y)) == y {
						occupied = true
						break
					}
				}
				if occupied {
					continue
				}
				score := 0
				for _, p := range path {
					dx, dy := p.X-float64(x), p.Y-float64(y)
					if dx*dx+dy*dy <= towerRange*towerRange {
						score++
					}
				}
				if score > bestScore {
					bestScore, bestX, bestY = score, x, y
				}
			}
		}
		if bestX < 0 {
			t.Fatal("sim: no buildable cell left")
		}
		// Never seal the lane. The server refuses sealing placements itself
		// now (ErrPathBlocked), so the greedy pick just falls through to the
		// best cell that keeps the path open — the next-best cell differs
		// once the tower list changes, and the path recompute above re-scores
		// all cells anyway.
		if _, err := gs.AddTower(float64(bestX), float64(bestY), "basic"); err != nil {
			if !errors.Is(err, ErrPathBlocked) {
				t.Fatalf("sim: greedy placement failed at (%d,%d): %v", bestX, bestY, err)
			}
			if !simPlaceBestOpen(gs, towerRange) {
				t.Fatal("sim: could not place without sealing the path")
			}
		}
	}
}

// simPlaceBestOpen is the fallback for a greedy pick that sealed the lane:
// walk candidate cells in score order and take the best one that keeps a
// path open.
func simPlaceBestOpen(gs *GameStateWithShooting, towerRange float64) bool {
	path := gs.FindPathFromSpawn()
	if path == nil {
		return false
	}
	type cand struct{ score, x, y int }
	var cands []cand
	for y := 0; y < gridHeight; y++ {
		for x := 0; x < gridWidth; x++ {
			if gs.isObstacle(x, y) || (x == 0 && y == 7) || (x == 19 && y == 7) {
				continue
			}
			occupied := false
			for _, tw := range gs.Towers {
				if int(math.Round(tw.Position.X)) == x && int(math.Round(tw.Position.Y)) == y {
					occupied = true
					break
				}
			}
			if occupied {
				continue
			}
			score := 0
			for _, p := range path {
				dx, dy := p.X-float64(x), p.Y-float64(y)
				if dx*dx+dy*dy <= towerRange*towerRange {
					score++
				}
			}
			cands = append(cands, cand{score, x, y})
		}
	}
	// Selection sort by score desc, deterministic tie-break by scan order.
	for i := 0; i < len(cands); i++ {
		best := i
		for j := i + 1; j < len(cands); j++ {
			if cands[j].score > cands[best].score {
				best = j
			}
		}
		cands[i], cands[best] = cands[best], cands[i]
		c := cands[i]
		if _, err := gs.AddTower(float64(c.x), float64(c.y), "basic"); err != nil {
			continue
		}
		if gs.FindPathFromSpawn() != nil {
			return true
		}
		snap := gs.GetSnapshot()
		gs.RemoveTower(snap.Towers[len(snap.Towers)-1].ID)
	}
	return false
}

// simRun plays map mapID with towerCount basic towers until game over (or
// maxWave survived). Returns the wave the run died on (maxWave+1 if it
// survived the cap) and the final score — score is the finer-grained
// tiebreaker, since it keeps counting kills inside the fatal wave.
func simRun(t *testing.T, mapID string, towerCount, maxWave int) (int, int) {
	t.Helper()
	gs := newTestGameOnMap(mapID)
	simPlaceGreedy(t, gs, towerCount)

	const dt = 1.0 / 60.0
	for {
		wave := gs.Wave
		if wave > maxWave {
			return maxWave + 1, gs.Score
		}
		cfg := GetWaveConfig(wave)
		total := 0
		for _, g := range cfg.Enemies {
			total += g.Count
		}
		if !gs.StartWave(total) {
			t.Fatalf("sim: could not start wave %d on %s", wave, mapID)
		}
		// Same schedule as SpawnWave: groups run sequentially, one enemy per
		// SpawnDelay, first enemy of a group immediately.
		type ev struct {
			at float64
			et string
		}
		var events []ev
		cursor := 0.0
		for _, g := range cfg.Enemies {
			for i := 0; i < g.Count; i++ {
				events = append(events, ev{cursor, g.EnemyType})
				cursor += g.SpawnDelay
			}
		}
		simT, idx := 0.0, 0
		for {
			for idx < len(events) && events[idx].at <= simT {
				if p := gs.FindPathFromSpawn(); p != nil {
					gs.AddEnemy(events[idx].et, p, wave)
				}
				gs.DecrementEnemiesRemaining()
				idx++
			}
			gs.Update(dt)
			simT += dt
			phase := gs.GetPhase()
			if phase == PhaseGameOver {
				return wave, gs.Score
			}
			if phase == PhaseWaiting {
				break // wave cleared, next one
			}
			if simT > 1200 {
				t.Fatalf("sim: wave %d on %s stalled (%d enemies left)", wave, mapID, len(gs.Enemies))
			}
		}
	}
}

// TestMapDifficultySimulation prints the comparison table. MAP_SIM=1 to run.
func TestMapDifficultySimulation(t *testing.T) {
	if os.Getenv("MAP_SIM") == "" {
		t.Skip("measurement harness, not a regression test — set MAP_SIM=1 to run")
	}
	maps := []string{"open", "switchback", "gauntlet", "crucible", "needle", "pylons"}
	budgets := []int{8, 12, 16, 20, 24, 28} // basic towers: 400–1400 gold

	header := fmt.Sprintf("%-12s", "map")
	for _, b := range budgets {
		header += fmt.Sprintf(" %13s", fmt.Sprintf("%dtwr (score)", b))
	}
	fmt.Println(header + "   sum-waves  sum-score  path-len")
	for _, id := range maps {
		gs := newTestGameOnMap(id)
		pathLen := len(gs.FindPathFromSpawn())
		row := fmt.Sprintf("%-12s", id)
		sumW, sumS := 0, 0
		for _, b := range budgets {
			died, score := simRun(t, id, b, 60)
			sumW += died
			sumS += score
			row += fmt.Sprintf(" %4d (%6d)", died, score)
		}
		fmt.Printf("%s   %9d %10d %9d\n", row, sumW, sumS, pathLen)
	}
}
