// Grid pathfinding: spawn routes, the placement path-block check, and enemy re-routing.

package game

import (
	"math"
)

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

	blocked := gs.mapDef.set // copy: map walls block exactly like towers
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

// pathExistsWithExtraBlock answers "would a route survive if this one extra
// cell were walled?" — the reachability half of findPath, with the candidate
// tower cell added to the blocked set. It mirrors findPath's blocked-set
// construction (map walls + every existing tower) and its expansion order,
// but stops at a bool: callers only need to know whether a route exists, so
// there is no parent walk or path allocation.
//
// mapDef.set is a fixed-size array, so the assignment copies it — the shared
// registry entry is never mutated.
//
// Callers hold gs.mu (read or write).
func (gs *GameStateWithShooting) pathExistsWithExtraBlock(start, goal Position, extraX, extraY int) bool {
	sx, sy := int(math.Round(start.X)), int(math.Round(start.Y))
	gx, gy := int(math.Round(goal.X)), int(math.Round(goal.Y))
	if sx < 0 || sx >= gridWidth || sy < 0 || sy >= gridHeight ||
		gx < 0 || gx >= gridWidth || gy < 0 || gy >= gridHeight {
		return false
	}
	if sx == gx && sy == gy {
		return true
	}

	blocked := gs.mapDef.set // copy: map walls block exactly like towers
	for _, tower := range gs.Towers {
		tx := int(math.Round(tower.Position.X))
		ty := int(math.Round(tower.Position.Y))
		if tx >= 0 && tx < gridWidth && ty >= 0 && ty < gridHeight {
			blocked[ty*gridWidth+tx] = true
		}
	}
	if extraX >= 0 && extraX < gridWidth && extraY >= 0 && extraY < gridHeight {
		blocked[extraY*gridWidth+extraX] = true
	}
	// A candidate on the spawn or goal cell itself is rejected earlier by
	// AddTower; guard anyway so a walled endpoint reads as "no route"
	// rather than silently starting the BFS from inside a wall.
	startIdx := sy*gridWidth + sx
	goalIdx := gy*gridWidth + gx
	if blocked[startIdx] || blocked[goalIdx] {
		return false
	}

	var visited [gridWidth * gridHeight]bool
	visited[startIdx] = true
	queue := make([]int, 1, gridWidth*gridHeight)
	queue[0] = startIdx

	for head := 0; head < len(queue); head++ {
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
			if ni == goalIdx {
				return true
			}
			visited[ni] = true
			queue = append(queue, ni)
		}
	}
	return false
}

// WouldBlockPath reports whether placing a tower on the cell under (x, y)
// would leave no spawn→goal route. Read-only preview for the client's
// placement ghost: it checks connectivity only — no gold, no tower type, no
// occupancy. AddTower stays the authority; this can never be the only gate.
func (gs *GameStateWithShooting) WouldBlockPath(x, y float64) bool {
	gs.mu.RLock()
	defer gs.mu.RUnlock()

	if gs.SpawnPoint == nil || gs.GoalPoint == nil {
		return false
	}
	cx, cy := int(math.Round(x)), int(math.Round(y))
	return !gs.pathExistsWithExtraBlock(*gs.SpawnPoint, *gs.GoalPoint, cx, cy)
}

const gridCells = gridWidth * gridHeight

// blockedCells returns the map walls plus every tower cell. Callers hold gs.mu.
func (gs *GameStateWithShooting) blockedCells() [gridCells]bool {
	blocked := gs.mapDef.set // copy: map walls block exactly like towers
	for _, tower := range gs.Towers {
		tx := int(math.Round(tower.Position.X))
		ty := int(math.Round(tower.Position.Y))
		if tx >= 0 && tx < gridWidth && ty >= 0 && ty < gridHeight {
			blocked[ty*gridWidth+tx] = true
		}
	}
	return blocked
}

// distanceField is one BFS outward from the goal: the step count from every
// open cell to the goal, or -1 where the goal can't be reached. One field
// serves every enemy, instead of one search per enemy. Callers hold gs.mu.
func (gs *GameStateWithShooting) distanceField(blocked *[gridCells]bool) [gridCells]int16 {
	var dist [gridCells]int16
	for i := range dist {
		dist[i] = -1
	}
	gx, gy := int(math.Round(gs.GoalPoint.X)), int(math.Round(gs.GoalPoint.Y))
	if gx < 0 || gx >= gridWidth || gy < 0 || gy >= gridHeight {
		return dist
	}
	goal := gy*gridWidth + gx
	dist[goal] = 0
	queue := make([]int, 1, gridCells)
	queue[0] = goal
	for head := 0; head < len(queue); head++ {
		cur := queue[head]
		cx, cy := cur%gridWidth, cur/gridWidth
		for _, n := range [4][2]int{{cx + 1, cy}, {cx - 1, cy}, {cx, cy + 1}, {cx, cy - 1}} {
			if n[0] < 0 || n[0] >= gridWidth || n[1] < 0 || n[1] >= gridHeight {
				continue
			}
			ni := n[1]*gridWidth + n[0]
			if blocked[ni] || dist[ni] >= 0 {
				continue
			}
			dist[ni] = dist[cur] + 1
			queue = append(queue, ni)
		}
	}
	return dist
}

// cellIndex rounds a position to its grid cell, or -1 off the grid.
func cellIndex(p Position) int {
	x, y := int(math.Round(p.X)), int(math.Round(p.Y))
	if x < 0 || x >= gridWidth || y < 0 || y >= gridHeight {
		return -1
	}
	return y*gridWidth + x
}

func cellPosition(i int) Position {
	return Position{X: float64(i % gridWidth), Y: float64(i / gridWidth)}
}

// RecalculateEnemyPaths re-routes every enemy after a tower change. Enemies
// keep their exact position: each is routed from the cell it was walking
// toward, or, if a tower now sits there or it no longer leads to the goal,
// from the cell it is leaving. Both are adjacent open cells on its current
// segment, so it never walks through a tower, and a place-and-sell cycle
// can't pull enemies backwards. (The old version snapped every enemy to its
// rounded cell, which pushed a wave back up to half a cell per tower change.)
func (gs *GameStateWithShooting) RecalculateEnemyPaths() {
	if gs.GoalPoint == nil {
		return
	}
	blocked := gs.blockedCells()
	dist := gs.distanceField(&blocked)

	for i := range gs.Enemies {
		enemy := &gs.Enemies[i]

		candidates := make([]int, 0, 2)
		if enemy.PathIndex < len(enemy.Path) {
			candidates = append(candidates, cellIndex(enemy.Path[enemy.PathIndex]))
		}
		candidates = append(candidates, cellIndex(enemy.Position))

		start, fallback := -1, -1
		for _, c := range candidates {
			if c < 0 || blocked[c] {
				continue
			}
			if dist[c] >= 0 {
				start = c
				break
			}
			if fallback < 0 {
				fallback = c
			}
		}

		if start < 0 {
			// Trapped: no route from here. Walk to the nearest open cell of
			// the segment and wait there until a tower change opens a route.
			if fallback < 0 {
				enemy.Path = []Position{enemy.Position}
			} else {
				enemy.Path = []Position{cellPosition(fallback)}
			}
			enemy.PathIndex = 0
			continue
		}

		// Descend the distance field to the goal. Neighbor order matches
		// findPath (+x, -x, +y, -y), so ties resolve the same way.
		path := make([]Position, 0, int(dist[start])+1)
		path = append(path, cellPosition(start))
		for cur := start; dist[cur] > 0; {
			cx, cy := cur%gridWidth, cur/gridWidth
			for _, n := range [4][2]int{{cx + 1, cy}, {cx - 1, cy}, {cx, cy + 1}, {cx, cy - 1}} {
				if n[0] < 0 || n[0] >= gridWidth || n[1] < 0 || n[1] >= gridHeight {
					continue
				}
				if ni := n[1]*gridWidth + n[0]; dist[ni] == dist[cur]-1 {
					cur = ni
					break
				}
			}
			path = append(path, cellPosition(cur))
		}
		enemy.Path = path
		enemy.PathIndex = 0
	}
}

// isObstacle checks the room's active map. Callers hold gs.mu (read or
// write); mapDef itself is immutable, only the pointer swaps.
func (gs *GameStateWithShooting) isObstacle(x, y int) bool {
	return gs.mapDef.isObstacle(x, y)
}

func (gs *GameStateWithShooting) FindPathFromSpawn() []Position {
	gs.mu.RLock()
	defer gs.mu.RUnlock()

	if gs.SpawnPoint == nil || gs.GoalPoint == nil {
		return nil
	}
	return gs.findPath(*gs.SpawnPoint, *gs.GoalPoint)
}
