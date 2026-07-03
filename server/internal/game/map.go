package game

// map.go — the static map layout: "The Switchback".
//
// Obstacle cells are permanent walls: enemies path around them and towers
// cannot be built on them. The layout is server-authoritative and included in
// every snapshot (small and static), so the client renders exactly what the
// pathfinder sees. Any edit here MUST keep a 4-directional path open from the
// spawn (0,7) to the goal (19,7) — TestMapHasOpenPath guards that.
//
// Three vertical bulkheads force an S-shaped route (down, up, down):
//
//	    #         #
//	    #         #        x=4:  y 0–10 (gap at bottom)
//	    #    #    #        x=9:  y 4–14 (gap at top)
//	S   #    #    #    G   x=15: y 0–10 (gap at bottom)
//	    #    #    #
//	         #
//
// Shortest path: 44 cells vs 20 on an empty board.
var mapObstacles = buildBulkheads([]bulkhead{
	{x: 4, y0: 0, y1: 10},
	{x: 9, y0: 4, y1: 14},
	{x: 15, y0: 0, y1: 10},
})

type bulkhead struct{ x, y0, y1 int }

func buildBulkheads(runs []bulkhead) []Position {
	cells := make([]Position, 0, 33)
	for _, r := range runs {
		for y := r.y0; y <= r.y1; y++ {
			cells = append(cells, Position{X: float64(r.x), Y: float64(y)})
		}
	}
	return cells
}

// obstacleSet mirrors mapObstacles as a flat grid for O(1) lookups in the
// pathfinder and placement validation.
var obstacleSet = func() [gridWidth * gridHeight]bool {
	var s [gridWidth * gridHeight]bool
	for _, o := range mapObstacles {
		x, y := int(o.X), int(o.Y)
		if x >= 0 && x < gridWidth && y >= 0 && y < gridHeight {
			s[y*gridWidth+x] = true
		}
	}
	return s
}()

func isObstacle(x, y int) bool {
	if x < 0 || x >= gridWidth || y < 0 || y >= gridHeight {
		return false
	}
	return obstacleSet[y*gridWidth+x]
}
