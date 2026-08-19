# Rust Rush — Session Log

> This file is referenced from several TODO.md entries (Phases 18/19/20/25) but
> was never actually committed to the repo — the earlier sessions' notes lived
> outside it. Starting it here, from the August 19, 2026 session forward.

---

## August 19, 2026 — Prevent path-blocking tower placement + live placement preview

### The problem

A July 2026 fix made a fully walled-in enemy stop in place instead of counting
as a leak, so the player takes no damage for sealing the lane. Correct on its
own, but it opened a farming exploit: wall the lane mid-wave, let towers shoot
the frozen enemies for free (they take damage, deal none, and never reach the
goal), then sell one tower to reopen the route and let the near-dead enemies
walk in.

The fix is prevention, not detection. If a placement can never seal the only
route, the exploit has no setup. Existing trapped-enemy handling in
`updateEnemies` is untouched — it's still reachable in real play, because a
tower can wall an enemy into a pocket while spawn→goal stays open.

### What was built

**Server (the actual fix)**

- `ErrPathBlocked` added alongside `ErrInsufficientGold` / `ErrInvalidPlacement`
  in `state.go`.
- `pathExistsWithExtraBlock(start, goal, extraX, extraY) bool` — the
  reachability half of `findPath` with one extra ad-hoc blocked cell. Mirrors
  `findPath`'s blocked-set construction (map walls + every existing tower) and
  its expansion order, but returns a bool: no parent walk, no path allocation.
  `mapDef.set` is a fixed-size array, so `blocked := gs.mapDef.set` copies —
  the shared registry entry is never mutated.
- `AddTower` runs the check after every existing validity check and **before**
  gold is deducted, so a rejection leaves the room byte-for-byte unchanged.
  Skipped when `SpawnPoint`/`GoalPoint` are nil (mirrors `RecalculateEnemyPaths`).
- `WouldBlockPath(x, y) bool` — read-only preview wrapper under `RLock`.

**Server (preview endpoint)**

- `MessageTypeCheckPlacement = "check_placement"` in `hub.go`.
- `client.go` handler: takes `{x, y}`, replies to the requesting client only
  (not broadcast) with `{x, y, blocks_path}`. Echoes x/y back so an async reply
  can be matched to its cell. Purely advisory — `AddTower` is still the gate.
- `place_tower` rejection ack now distinguishes `path_blocked` from
  `invalid_placement`. Protocol/log only; the client ignores the ack status.

**Client**

- `PlacementCheckStore` (in `types/game.ts`): `results` (cell → blocks_path),
  `pending` (cell → epoch), and an `epoch` counter. Created in `App`, passed to
  `GameCanvas` as a ref like `liveStateRef`. App writes replies; GameCanvas
  requests, reads and invalidates.
- Requests fire from a `useEffect` keyed on the hovered cell, and only for
  cells that already pass every synchronous check (not a wall/spawn/goal, not
  occupied) — a cell that's invalid for another reason is never asked about.
- Three ghost-tower states replace the old binary valid/invalid:
  **pending** (breathing alpha 0.34±0.06, no range ring), **confirmed safe**
  (unchanged 0.45 + range ring), **blocks path** (0.25 ghost + a red no-entry
  glyph: stroked circle with one diagonal bar).
- Click gating: a placement click only proceeds on a cached `blocks_path: false`.

### Judgment calls (visual first drafts — expected to be tuned)

1. **Pending alpha: `0.34 + 0.06 * sin(t * 5)`** (≈0.28–0.40, ~1.26 s period).
   Sits between the placeable 0.45 and the rejected 0.25. The pulse is there
   because a static in-between alpha reads as "dim", not as "waiting" — but on
   localhost the reply lands in ~1 ms, so this state is almost never seen in
   practice. It only matters on a real network. **Tune or drop the pulse
   freely.**
2. **Pending hides the range ring.** The ring is the strongest "go ahead"
   signal on the board; showing it before the placement is cleared would read
   as approval. This is what makes pending visually distinct from safe in a
   still frame — the alpha difference alone is subtle (see
   `playtest-shots/pathblock-1-safe.png` vs `pathblock-2-pending.png`).
3. **Blocks-path glyph: circle + diagonal bar**, radius `CELL_SIZE * 0.33`,
   3px stroke, 8px red bloom, drawn at full opacity over a 0.25 ghost. Reuses
   `PALETTE.danger` per the brief but deliberately **not** the existing
   corner-to-corner slash — that slash means "you cannot build on this cell at
   all" (wall/spawn/goal/broke), whereas this is a different problem: the cell
   is fine, the *maze* is the issue. At 0.25 the ghost turret underneath is
   quite faint behind the glyph; readable, but if "still-visible ghost" matters
   more, raise that alpha.
4. **Cache invalidation is versioned, not surgical.** Whether a cell seals the
   lane depends on every other tower, so any placement or sale invalidates
   *every* cached answer — including "safe" ones, which can flip to "blocks"
   and back. The layout is identified by the joined tower-id list (ids are a
   monotonic counter and towers never move, so the list identifies the layout
   exactly). Derived from the throttled `gameState` prop rather than
   `liveStateRef` so it's a plain reactive dependency; the ~100 ms lag only
   means the ghost sits in pending a beat longer after a placement.
5. **Stale replies are dropped via the pending ticket, not a hover comparison.**
   The brief suggested discarding a reply if the cursor has moved on. That's
   the wrong axis: an answer is about the *cell*, not the cursor, and keeping
   it cached is what makes moving back to a cell instant. What actually goes
   stale is the *board*, so the epoch stamped on the pending entry is the
   guard — a reply whose epoch no longer matches finds no ticket and is
   discarded instead of cached as fact.

### Two holes found in self-review and closed

- **Click with no prior mousemove** (cursor already parked on the canvas at
  page load) had no cached answer, so the click did nothing and a second click
  would have died the same way. The click now seeds the check on a miss, so the
  retry lands. The click itself is still gated — that part is per the brief.
- **A dropped reply left a cell pending forever** (unclickable for the rest of
  the run, since only a layout change clears pending). `pending` is now cleared
  whenever `isConnected` goes false, so reconnecting re-asks.

### Ancillary change

`handleMouseMove` now dedupes `hoveredCell` by cell value instead of setting a
fresh object per event. The brief assumed hover state already only changed on
cell-boundary crossings; it didn't — every mousemove allocated a new `{x, y}`
and re-rendered React. Deduping was required for "one request per cell crossed"
to be true, and it cuts a re-render per mousemove as a side effect.

### Test changes that were necessary (not optional)

The brief expected existing tests to pass unmodified. Two could not, because
they deliberately construct the state that is now illegal:

- **`wallColumn` (behavior_test.go)** built its wall *through* `AddTower` and
  `t.Fatalf`'d on error — the sealing tower is now rejected. It appends to
  `gs.Towers` directly instead. The trapped-enemy tests it feeds
  (`TestTrappedEnemyStopsInsteadOfLeaking`, `TestTrappedEnemyResumesWhenUnblocked`,
  `TestSpawnWaveFullyBlockedAtStartCompletes`) are otherwise unchanged and still
  pass, and the behavior they cover is still reachable in play.
- **`map_difficulty_sim_test.go`** `t.Fatalf`'d on any `AddTower` error. Its
  greedy bot already had "if that sealed the lane, take it back and re-place"
  logic; it now falls through to that on `ErrPathBlocked` instead of failing.
  The measured difficulty numbers are unchanged (verified with `MAP_SIM=1`) —
  the old flow placed-then-removed the sealing tower, which restored the same
  board the new flow never leaves.
  - *Minor wart left alone:* `simPlaceBestOpen`'s internal
    `if gs.FindPathFromSpawn() != nil` re-check is now logically dead (AddTower
    can't return a sealing placement). Left in place — harmless, and touching
    it risks perturbing the difficulty numbers.

### New tests

Go — `internal/game`:
- `TestAddTowerRejectsSealingThePath` — narrowing placements allowed, the
  sealing one rejected with `ErrPathBlocked`, no gold/tower mutation, path
  still open after.
- `TestAddTowerPathBlockedOnEveryMap` — subtest per registry map.
- `TestWouldBlockPath` — both outcomes, idempotent, no mutation.
- `TestPathCheckSkippedWithoutSpawnGoal` — nil-guard, no panic.

Go — `internal/websocket` (new file `placement_check_test.go`):
- `TestCheckPlacementRoundTrip` — drives `handleMessage` directly against a
  buffered send channel: reply type, x/y echo, both `blocks_path` outcomes,
  read-only (tower count unchanged), and `AddTower` refusing the same cell.
- `TestCheckPlacementIgnoresBadRequests` — non-numeric x, missing y, unknown
  room: all dropped with no reply, so a bad client can't pull something it
  might read as "safe".

### Verification

- `go vet ./...` clean; `go test ./...` all packages pass. (`-race` unavailable
  here: needs CGO.) `MAP_SIM=1` difficulty harness reruns clean.
- `gofmt`: my code is clean. `gofmt -l` still flags `state.go`/`manager.go`,
  but only for pre-existing CRLF line endings and pre-existing struct-tag
  alignment in `Enemy` — no hunk touches the new code. Left alone.
- Client: `tsc --noEmit`, `eslint --max-warnings 0`, `npm run build` all clean.
- **Playwright, 11/11 checks** (production build on :8080). Screenshots in
  `playtest-shots/pathblock-*.png`:
  - 161 mousemove events across 8 cells → **9** `check_placement` requests, 9
    distinct cells, **0** duplicates. Re-hovering an answered cell re-asks
    nothing.
  - All three ghost states captured (safe / pending / blocks).
  - Click on the sealing cell sends no `place_tower`; click while pending
    sends none either; a normal placement one cell over still acks `placed`.
  - **Bypass check:** a second raw WebSocket joining the same room and sending
    `place_tower` for the sealing cell directly — server acks `path_blocked`.
    The client gate is a courtesy; the server is the fence.

### Not touched

Map/difficulty/enemy/sound/evolution/scoring logic, and the `updateEnemies`
trapped-enemy idle/resume behavior. No git operations — working tree left for
review.
