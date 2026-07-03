package game

import (
	"fmt"
	"math"
	"math/rand"
	"testing"
)

// findPathReference is the pre-optimization BFS (string-keyed maps, full path
// copy per node), kept as the oracle for the rewritten findPath. Map obstacles
// are blocked here the same way the live implementation blocks them, so the
// equivalence property holds on the real map.
func (gs *GameStateWithShooting) findPathReference(start, goal Position) []Position {
	const gridWidth = 20
	const gridHeight = 15

	blocked := make(map[string]bool)
	for _, o := range mapObstacles {
		blocked[fmt.Sprintf("%d,%d", int(o.X), int(o.Y))] = true
	}
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

func pathsEqual(a, b []Position) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// The rewritten findPath must return byte-identical paths to the old
// implementation across random tower layouts, including no-path boards.
func TestFindPathMatchesReference(t *testing.T) {
	rng := rand.New(rand.NewSource(42))

	for trial := 0; trial < 500; trial++ {
		gs := NewGameStateWithShooting("path-eq")
		nTowers := rng.Intn(80)
		for i := 0; i < nTowers; i++ {
			gs.Towers = append(gs.Towers, Tower{
				ID:       i + 1,
				Position: Position{X: float64(rng.Intn(20)), Y: float64(rng.Intn(15))},
			})
		}
		start := Position{X: float64(rng.Intn(20)), Y: float64(rng.Intn(15))}
		goal := Position{X: float64(rng.Intn(20)), Y: float64(rng.Intn(15))}

		got := gs.findPath(start, goal)
		want := gs.findPathReference(start, goal)
		if !pathsEqual(got, want) {
			t.Fatalf("trial %d: paths differ for start=%v goal=%v towers=%d\n got: %v\nwant: %v",
				trial, start, goal, nTowers, got, want)
		}
	}

	// Canonical case: no towers, spawn to goal — the switchback route.
	gs := NewGameStateWithShooting("path-eq")
	got := gs.findPath(Position{X: 0, Y: 7}, Position{X: 19, Y: 7})
	want := gs.findPathReference(Position{X: 0, Y: 7}, Position{X: 19, Y: 7})
	if !pathsEqual(got, want) {
		t.Fatalf("canonical path mismatch: got %d nodes, want %d", len(got), len(want))
	}
}

func BenchmarkFindPath(b *testing.B) {
	gs := NewGameStateWithShooting("bench")
	rng := rand.New(rand.NewSource(7))
	for i := 0; i < 40; i++ {
		gs.Towers = append(gs.Towers, Tower{ID: i + 1, Position: Position{X: float64(rng.Intn(20)), Y: float64(1 + rng.Intn(13))}})
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		gs.findPath(Position{X: 0, Y: 7}, Position{X: 19, Y: 7})
	}
}

func BenchmarkFindPathReference(b *testing.B) {
	gs := NewGameStateWithShooting("bench")
	rng := rand.New(rand.NewSource(7))
	for i := 0; i < 40; i++ {
		gs.Towers = append(gs.Towers, Tower{ID: i + 1, Position: Position{X: float64(rng.Intn(20)), Y: float64(1 + rng.Intn(13))}})
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		gs.findPathReference(Position{X: 0, Y: 7}, Position{X: 19, Y: 7})
	}
}
