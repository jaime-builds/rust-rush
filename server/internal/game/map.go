package game

// map.go — the map roster.
//
// Each map is a named list of obstacle cells: permanent walls that enemies
// path around and towers cannot be built on. The layout is server-
// authoritative and included in every snapshot (small and static), so the
// client renders exactly what the pathfinder sees. Maps are selected per room
// at new-game time (new_game message with a map_id payload); the room keeps
// its map until the next explicit selection.
//
// Any map added here MUST keep a 4-directional path open from the spawn
// (0,7) to the goal (19,7) — TestAllMapsHaveOpenPath guards every entry.

// MapDef is one selectable map: an ID (wire value), a display name, and its
// obstacle cells, plus a flat-grid mirror for O(1) pathfinder lookups.
//
// SequenceOrder (1-6) and WinWave define the progression chain: maps unlock
// strictly in sequence order (client-side, localStorage), and a non-Endless
// run wins when its wave counter reaches WinWave. The ordering comes from a
// measured comparison across all six maps (identical fixed-budget bot build,
// wave reached + score recorded — see map_difficulty_sim_test.go), NOT from
// obstacle count: the sim confirmed obstacle-heavy Switchback is the easiest
// map (44-cell path = most time-on-target) and zero-obstacle Clearway ranks
// mid-pack. Win waves are the confirmed three-tier structure: 25 / 35×3 / 50×2.
type MapDef struct {
	ID            string
	Name          string
	SequenceOrder int
	WinWave       int
	Obstacles     []Position
	set           [gridWidth * gridHeight]bool
}

// DefaultMapID is the map new rooms start on — the plain open board.
const DefaultMapID = "open"

// MapRegistry is the selectable roster. Registry order is unchanged (wire
// IDs and tests depend on nothing here moving); the client sorts its map
// cards by SequenceOrder.
var MapRegistry = []*MapDef{
	newMapDef("open", "THE CLEARWAY", 1, 25, nil),

	// The original Phase-17-era layout, unchanged: three vertical bulkheads
	// force an S-shaped route (down, up, down):
	//
	//	    #         #
	//	    #         #        x=4:  y 0–10 (gap at bottom)
	//	    #    #    #        x=9:  y 4–14 (gap at top)
	//	S   #    #    #    G   x=15: y 0–10 (gap at bottom)
	//	    #    #    #
	//	         #
	//
	// Shortest path: 44 cells vs 20 on an empty board.
	newMapDef("switchback", "THE SWITCHBACK", 2, 35, buildBulkheads([]bulkhead{
		{x: 4, y0: 0, y1: 10},
		{x: 9, y0: 4, y1: 14},
		{x: 15, y0: 0, y1: 10},
	})),

	// Two long horizontal walls squeeze the lane into a three-row canyon
	// through the middle of the board. One straight, brutal firing corridor —
	// the opposite of Switchback's serpentine.
	newMapDef("gauntlet", "THE GAUNTLET", 4, 35, concatCells(
		hwall(5, 3, 16),
		hwall(9, 3, 16),
	)),

	// A solid central island. The route splits around it — and mid-wave tower
	// walls can flip traffic from the north face to the south face and back.
	newMapDef("crucible", "THE CRUCIBLE", 6, 50, blockCells(8, 5, 11, 9)),

	// One column, one gap: every enemy on the board must file through the
	// single cell at (10,7). The definitive kill-zone map.
	newMapDef("needle", "THE NEEDLE", 3, 35, buildBulkheads([]bulkhead{
		{x: 10, y0: 0, y1: 6},
		{x: 10, y0: 8, y1: 14},
	})),

	// Six 2×2 pylons scattered in a staggered lattice. No forced route at
	// all — just hard cover to weave mazes around.
	newMapDef("pylons", "THE PYLON FIELD", 5, 50, concatCells(
		blockCells(3, 2, 4, 3), blockCells(3, 11, 4, 12),
		blockCells(8, 6, 9, 7), blockCells(11, 2, 12, 3),
		blockCells(11, 11, 12, 12), blockCells(15, 6, 16, 7),
	)),
}

// mapsByID indexes the registry for lookup by wire ID.
var mapsByID = func() map[string]*MapDef {
	byID := make(map[string]*MapDef, len(MapRegistry))
	for _, m := range MapRegistry {
		byID[m.ID] = m
	}
	return byID
}()

// GetMapDef returns the map for id, or nil if unknown.
func GetMapDef(id string) *MapDef {
	return mapsByID[id]
}

func newMapDef(id, name string, sequenceOrder, winWave int, obstacles []Position) *MapDef {
	m := &MapDef{ID: id, Name: name, SequenceOrder: sequenceOrder, WinWave: winWave, Obstacles: obstacles}
	if m.Obstacles == nil {
		m.Obstacles = []Position{}
	}
	for _, o := range m.Obstacles {
		x, y := int(o.X), int(o.Y)
		if x >= 0 && x < gridWidth && y >= 0 && y < gridHeight {
			m.set[y*gridWidth+x] = true
		}
	}
	return m
}

func (m *MapDef) isObstacle(x, y int) bool {
	if x < 0 || x >= gridWidth || y < 0 || y >= gridHeight {
		return false
	}
	return m.set[y*gridWidth+x]
}

// Cell-list builders ------------------------------------------------------

type bulkhead struct{ x, y0, y1 int }

// buildBulkheads expands vertical wall runs into cells.
func buildBulkheads(runs []bulkhead) []Position {
	cells := make([]Position, 0, 33)
	for _, r := range runs {
		for y := r.y0; y <= r.y1; y++ {
			cells = append(cells, Position{X: float64(r.x), Y: float64(y)})
		}
	}
	return cells
}

// hwall is a horizontal wall run at row y from x0 to x1 inclusive.
func hwall(y, x0, x1 int) []Position {
	cells := make([]Position, 0, x1-x0+1)
	for x := x0; x <= x1; x++ {
		cells = append(cells, Position{X: float64(x), Y: float64(y)})
	}
	return cells
}

// blockCells is a filled rectangle from (x0,y0) to (x1,y1) inclusive.
func blockCells(x0, y0, x1, y1 int) []Position {
	cells := make([]Position, 0, (x1-x0+1)*(y1-y0+1))
	for y := y0; y <= y1; y++ {
		for x := x0; x <= x1; x++ {
			cells = append(cells, Position{X: float64(x), Y: float64(y)})
		}
	}
	return cells
}

func concatCells(lists ...[]Position) []Position {
	total := 0
	for _, l := range lists {
		total += len(l)
	}
	cells := make([]Position, 0, total)
	for _, l := range lists {
		cells = append(cells, l...)
	}
	return cells
}
