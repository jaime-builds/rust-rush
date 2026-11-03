import { useCallback, useEffect, useRef, useState } from 'react'
import './GameCanvas.css'
import { Tower, TowerType, BaseTowerType, EvolvedTowerType, Enemy, Projectile, MuzzleFlash, Explosion, Arc, Position, GameState, Difficulty, PlacementCheckStore, TOWER_COSTS, EVOLUTION_OPTIONS, GRID_WIDTH, GRID_HEIGHT, CELL_SIZE, GAME_MAPS, GAME_MAPS_BY_SEQUENCE } from '../types/game'
import { settings } from '../settings'
import Dialog from '../ui/Dialog'
import { PALETTE, TOWER_COLORS, TOWER_LIGHT, TOWER_RANGES, TOWER_NAMES, TOWER_DESCRIPTIONS, ENEMY_COLORS, ENEMY_BODY, ENEMY_RADIUS, ENEMY_GLOSSARY, TOWER_GLOSSARY, EVO_STATS, TOWER_ORDER } from './theme'
import { HIGH_SCORE_KEY, readHighScore, FURTHEST_BEATEN_KEY, readFurthestBeaten } from './progress'
import { polyPath, regularPolyPath, SHAPES, memoPath, hexAlpha, glowSprite, roundRectPath } from './shapes'
import { PLACE_ANIM_MS, easeOutBack, BEAM_MS, BEAM_BOSS_FADE_START, LOW_HEALTH_PULSE_THRESHOLD, LOW_HEALTH_PULSE_PERIOD_S, alertVignette, SHAKE_MS, SHAKE_AMP_PX, shortestAngleDelta } from './effects'
import { TowerIcon, EnemyGlyph, MapThumb } from './icons'
import { nextLevelChanges, specialStats } from './towerStats'

interface GameCanvasProps {
  isConnected: boolean
  onPlaceTower: (x: number, y: number, towerType: string) => void
  onSellTower: (towerId: number) => void
  onUpgradeTower: (towerId: number) => void
  onEvolveTower: (towerId: number, evolution: string) => void
  onStartWave: () => void
  // Starts a fresh run; mapId switches the room's map (omit = same map),
  // difficulty/endless configure the run (omit = normal survival).
  onNewGame: (mapId?: string, difficulty?: Difficulty, endless?: boolean) => void
  // Victory screen: continue the current run past the win wave in Endless.
  onContinueEndless: () => void
  onSpawnEnemy?: () => void
  // Asks the server whether a tower on this cell would seal the lane. Fired
  // once per newly hovered buildable cell; the reply lands in
  // placementChecksRef.
  onCheckPlacement: (x: number, y: number) => void
  // Shared with App, which writes the check_placement replies into it.
  placementChecksRef: React.MutableRefObject<PlacementCheckStore>
  gameState?: GameState
  // Newest snapshot, updated on every server message (60/sec). The canvas
  // draws from this so it stays smooth while the React tree re-renders at
  // the throttled gameState cadence.
  liveStateRef: React.MutableRefObject<GameState>
  showDebug?: boolean
}

// Where a hovered cell stands with the server's path-block check: 'ok' =
// cleared (or never asked, because a synchronous check already rejected it),
// 'pending' = asked, no answer yet, 'blocks' = the placement would seal the
// only spawn→goal route.
type PathPreviewState = 'ok' | 'pending' | 'blocks'

const GameCanvas = ({
  isConnected,
  onPlaceTower,
  onSellTower,
  onUpgradeTower,
  onEvolveTower,
  onStartWave,
  onNewGame,
  onContinueEndless,
  onSpawnEnemy,
  onCheckPlacement,
  placementChecksRef,
  gameState,
  liveStateRef,
  showDebug,
}: GameCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number>()
  const hoveredCellRef = useRef<Position | null>(null)
  const selectedTowerTypeRef = useRef<BaseTowerType | null>('basic')
  const selectedTowerRef = useRef<Tower | null>(null)
  // Canvas-only state: pre-rendered static background and per-entity headings
  // (computed from movement deltas — the server doesn't send facing angles).
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const bgKeyRef = useRef('')
  const enemyHeadingsRef = useRef<Map<number, { x: number; y: number; angle: number }>>(new Map())
  const projHeadingsRef = useRef<Map<number, { x: number; y: number; angle: number }>>(new Map())
  // Phase 19 client-side one-shot effects: the server doesn't know about
  // these, so arrival detection (new tower/boss IDs, health drops) happens
  // here against the live snapshot. fxSeeded guards the first REAL snapshot
  // (room_id present): a mid-game rejoin seeds silently instead of playing
  // an arrival animation for everything already on the board.
  const fxSeededRef = useRef(false)
  const knownTowerIdsRef = useRef<Set<number>>(new Set())
  const towerPlaceAnimsRef = useRef<Map<number, number>>(new Map()) // tower id → start (ms)
  const knownBossIdsRef = useRef<Set<number>>(new Set())
  const bossBeamAnimsRef = useRef<Map<number, number>>(new Map()) // enemy id → start (ms)
  const prevHealthRef = useRef<number | null>(null)
  const shakeStartRef = useRef<number | null>(null)

  const [hoveredCell, setHoveredCell] = useState<Position | null>(null)
  const [selectedTowerType, setSelectedTowerType] = useState<BaseTowerType | null>('basic')
  const [selectedTower, setSelectedTower] = useState<Tower | null>(null)
  // Evolve flow: which option is pending its irreversible-choice confirmation.
  const [evolveChoice, setEvolveChoice] = useState<EvolvedTowerType | null>(null)
  const [autoWave, setAutoWave] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  // Auto Wave timers live in refs owned by the countdown effect; SEND NOW
  // clears the countdown one and arms the re-arm one.
  const countdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rearmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Bumped when a start we sent didn't take (the server refused it, so the
  // phase stayed waiting): restarts the countdown instead of stalling.
  const [autoRearm, setAutoRearm] = useState(0)
  // Keyboard play: whether the board cursor came from the keyboard (so the
  // canvas keeps a cursor drawn while focused even if the mouse is elsewhere).
  const keyboardCursorRef = useRef(false)
  const [highScore, setHighScore] = useState<number>(() => readHighScore())
  const [isNewHighScore, setIsNewHighScore] = useState(false)
  const prevPhaseRef = useRef<string>('waiting')
  // Tower-id list the cached path-block answers were computed against.
  const placementLayoutKeyRef = useRef<string | null>(null)
  const [showGlossary, setShowGlossary] = useState(false)
  const [glossaryTab, setGlossaryTab] = useState<'towers' | 'enemies'>('towers')
  // Map selection: happens before a game starts (auto-opens on a fresh
  // board, or via NEW GAME / CHANGE MAP / MAP SELECT). Never mid-game.
  const [showMapSelect, setShowMapSelect] = useState(false)
  const [pendingMapId, setPendingMapId] = useState<string>(GAME_MAPS[0].id)
  const mapSelectAutoOpenedRef = useRef(false)
  // Progression: furthest map beaten (localStorage) plus the run settings
  // picked on the map-select screen for an already-beaten map.
  const [furthestBeaten, setFurthestBeaten] = useState<number>(() => readFurthestBeaten())
  const [pendingDifficulty, setPendingDifficulty] = useState<Difficulty>('normal')
  const [pendingEndless, setPendingEndless] = useState(false)

  // Sync refs (game state itself arrives via liveStateRef at full rate)
  hoveredCellRef.current = hoveredCell
  selectedTowerTypeRef.current = selectedTowerType
  selectedTowerRef.current = selectedTower

  const phase = gameState?.phase || 'waiting'
  const gold = gameState?.gold ?? 200
  const isWaveActive = phase === 'active'
  const isGameOver = phase === 'game_over'
  const isVictory = phase === 'victory'
  // Both terminal phases halt the run identically — victory differs only in
  // which overlay it shows and where the run can go next.
  const isRunOver = isGameOver || isVictory

  // Auto-open the map selector once, on joining a fresh board (nothing
  // placed, wave 1, waiting). Rejoining a game in progress skips it.
  useEffect(() => {
    if (mapSelectAutoOpenedRef.current || !isConnected || !gameState) return
    if (phase === 'waiting' && gameState.wave === 1 && gameState.towers.length === 0 && gameState.score === 0) {
      mapSelectAutoOpenedRef.current = true
      setPendingMapId(gameState.map_id ?? GAME_MAPS[0].id)
      setShowMapSelect(true)
    } else {
      mapSelectAutoOpenedRef.current = true // game in progress — never auto-open
    }
  }, [isConnected, gameState, phase])

  const openMapSelect = () => {
    // Default to the room's current map — unless it's locked (possible if
    // localStorage was cleared while the room sits on a later map), in which
    // case fall back to the next map in the chain.
    const current = GAME_MAPS.find(m => m.id === gameState?.map_id)
    const fallback = GAME_MAPS_BY_SEQUENCE[Math.min(furthestBeaten, GAME_MAPS.length - 1)]
    setPendingMapId(current && current.sequenceOrder <= furthestBeaten + 1 ? current.id : fallback.id)
    // Seed the run-settings toggles from the current run so reopening the
    // screen doesn't silently drop back to normal survival.
    setPendingDifficulty(gameState?.difficulty === 'harder' ? 'harder' : 'normal')
    setPendingEndless(gameState?.endless ?? false)
    setShowMapSelect(true)
  }

  // ——— placement path-block preview ———
  //
  // The server owns the rule (AddTower returns path_blocked), so the client
  // asks before the click rather than guessing: one check_placement per
  // newly hovered buildable cell, answers cached per cell in
  // placementChecksRef.
  //
  // towerLayoutKey versions that cache. Whether a cell seals the lane
  // depends on every other tower on the board, so a single placement or
  // sale invalidates every cached answer — including "safe" ones, which can
  // turn into "blocks" and back. Tower IDs are a monotonic counter and a
  // tower never moves, so the id list identifies the layout exactly. It is
  // derived from the throttled gameState rather than liveStateRef so it is
  // a plain reactive dependency; the ~100 ms lag only means the ghost sits
  // in its pending state a beat longer after a placement.
  const towerLayoutKey = (gameState?.towers ?? []).map(tw => tw.id).join(',')
  // Primitives, not the object: hoveredCell is deduped by cell in
  // handleMouseMove, but destructuring keeps the dependency statically
  // checkable. -1 stands in for "nothing hovered".
  const hoverX = hoveredCell?.x ?? -1
  const hoverY = hoveredCell?.y ?? -1

  // Asks about one cell unless it is already answered or already in flight.
  // Shared by the hover effect and the click, so a click on a cell that was
  // never hovered (cursor already parked on the canvas at load) seeds the
  // check instead of going nowhere twice.
  const requestPlacementCheck = useCallback((x: number, y: number) => {
    const store = placementChecksRef.current
    const key = `${x},${y}`
    if (store.results.has(key) || store.pending.has(key)) return
    store.pending.set(key, store.epoch)
    onCheckPlacement(x, y)
  }, [onCheckPlacement, placementChecksRef])

  useEffect(() => {
    const store = placementChecksRef.current
    if (towerLayoutKey !== placementLayoutKeyRef.current) {
      placementLayoutKeyRef.current = towerLayoutKey
      store.epoch++
      store.results.clear()
      // Dropping pending too is what makes the epoch bump stick: replies
      // computed against the old layout find no matching entry and are
      // discarded rather than cached as fact.
      store.pending.clear()
    }

    if (!isConnected) {
      // A dropped socket means any in-flight reply is never arriving. Clear
      // the tickets so reconnecting re-asks, instead of leaving those cells
      // stuck pending — and unclickable — for the rest of the run.
      store.pending.clear()
      return
    }
    if (isRunOver || hoverX < 0 || selectedTower || !selectedTowerType) return

    // Cells that already fail a synchronous check are invalid for an
    // unrelated reason — asking the server about them is pure noise.
    const gs = liveStateRef.current
    if (
      (gs?.obstacles ?? []).some(o => o.x === hoverX && o.y === hoverY) ||
      (gs?.spawn_point?.x === hoverX && gs?.spawn_point?.y === hoverY) ||
      (gs?.goal_point?.x === hoverX && gs?.goal_point?.y === hoverY) ||
      (gs?.towers ?? []).some(tw => tw.position.x === hoverX && tw.position.y === hoverY)
    ) return

    requestPlacementCheck(hoverX, hoverY)
  }, [
    hoverX, hoverY, towerLayoutKey, isConnected, isRunOver,
    selectedTower, selectedTowerType, requestPlacementCheck, placementChecksRef, liveStateRef,
  ])

  // Progression unlock: on the transition into victory, the beaten map
  // advances the chain — but only when it was exactly the next map in line
  // (beating an earlier map again, or an out-of-sequence state from edited
  // localStorage, can never corrupt the counter).
  const prevVictoryRef = useRef(false)
  useEffect(() => {
    if (isVictory && !prevVictoryRef.current) {
      const beaten = GAME_MAPS.find(m => m.id === gameState?.map_id)
      if (beaten && beaten.sequenceOrder === furthestBeaten + 1) {
        const next = beaten.sequenceOrder
        setFurthestBeaten(next)
        try {
          localStorage.setItem(FURTHEST_BEATEN_KEY, String(next))
        } catch {
          // localStorage unavailable (private mode) — unlocks just won't persist
        }
      }
    }
    prevVictoryRef.current = isVictory
  }, [isVictory, gameState?.map_id, furthestBeaten])

  // Auto Wave: a 5 s countdown as a timeout chain. The start is sent from
  // the timer callback, never inside a React state updater (React may run
  // updaters twice, which could send two starts). If the wave hasn't started
  // 2 s after we asked (the server refused), the countdown re-arms instead of
  // stalling silently. The effect re-runs, cancelling everything, whenever
  // the wave starts, the run ends, or Auto is switched off.
  useEffect(() => {
    const clearTimers = () => {
      if (countdownTimerRef.current) clearTimeout(countdownTimerRef.current)
      if (rearmTimerRef.current) clearTimeout(rearmTimerRef.current)
      countdownTimerRef.current = null
      rearmTimerRef.current = null
    }
    if (!autoWave || isWaveActive || isRunOver || !isConnected) {
      clearTimers()
      setCountdown(null)
      return
    }

    let remaining = 5
    setCountdown(remaining)
    const tick = () => {
      remaining -= 1
      if (remaining > 0) {
        setCountdown(remaining)
        countdownTimerRef.current = setTimeout(tick, 1000)
        return
      }
      countdownTimerRef.current = null
      setCountdown(null)
      onStartWave()
      rearmTimerRef.current = setTimeout(() => setAutoRearm(n => n + 1), 2000)
    }
    countdownTimerRef.current = setTimeout(tick, 1000)
    return clearTimers
  }, [autoWave, isWaveActive, isRunOver, isConnected, onStartWave, autoRearm])

  // Persist high score on the transition into either terminal phase — a win
  // ends the run with a final score exactly like a loss does (and a victory
  // continued into Endless can still set a higher one at its eventual loss).
  useEffect(() => {
    const isTerminal = phase === 'game_over' || phase === 'victory'
    const wasTerminal = prevPhaseRef.current === 'game_over' || prevPhaseRef.current === 'victory'
    if (isTerminal && !wasTerminal) {
      const finalScore = gameState?.score ?? 0
      if (finalScore > highScore) {
        setHighScore(finalScore)
        setIsNewHighScore(true)
        try {
          localStorage.setItem(HIGH_SCORE_KEY, String(finalScore))
        } catch {
          // localStorage unavailable (private mode) — high score just won't persist
        }
      } else {
        setIsNewHighScore(false)
      }
    } else if (!isTerminal && wasTerminal) {
      // Clear on leaving the terminal phase so a later, lower-scoring run
      // can't paint a stale "New High Score!" frame before the effect
      // re-evaluates.
      setIsNewHighScore(false)
    }
    prevPhaseRef.current = phase
    // prevPhaseRef gates the body to phase *transitions*, so the extra
    // score/highScore re-runs are no-ops.
  }, [phase, gameState?.score, highScore])

  // Deselect tower if it no longer exists (was sold or cleared)
  // Also sync selected tower stats when server broadcasts an update
  // (e.g. after upgrade or evolution)
  useEffect(() => {
    if (selectedTower) {
      const updated = gameState?.towers.find(t => t.id === selectedTower.id)
      if (!updated) {
        setSelectedTower(null)
      } else if (
        updated.level !== selectedTower.level ||
        updated.damage !== selectedTower.damage ||
        updated.tower_type !== selectedTower.tower_type ||
        updated.total_spent !== selectedTower.total_spent
      ) {
        setSelectedTower(updated)
      }
    }
  }, [gameState?.towers, selectedTower])

  // Hotkeys: 1-5 select the base towers in button order, Escape deselects
  // to NONE (same as the ∅ button), U upgrades and S sells the selected
  // tower, Space starts the wave. Guarded against focused text inputs, and
  // against any open dialog (settings, map select): keys belong to the
  // dialog then, never to the board underneath. The actions read the latest
  // render through hotkeyActionsRef, so the listener is bound once.
  const hotkeyActionsRef = useRef({ upgrade: () => {}, sell: () => {}, startWave: () => {} })
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (isRunOver) return
      if (document.querySelector('[role="dialog"]')) return
      if (e.key === 'Escape') {
        setSelectedTowerType(null)
        setSelectedTower(null)
        return
      }
      if (e.key >= '1' && e.key <= '5') {
        setSelectedTowerType(TOWER_ORDER[Number(e.key) - 1])
        setSelectedTower(null)
        return
      }
      const key = e.key.toLowerCase()
      if (key === 'u') {
        hotkeyActionsRef.current.upgrade()
      } else if (key === 's') {
        hotkeyActionsRef.current.sell()
      } else if (e.key === ' ' && el?.tagName !== 'BUTTON') {
        // Space on a focused button presses that button; leave it alone.
        e.preventDefault() // don't scroll the page
        hotkeyActionsRef.current.startWave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isRunOver])

  // Any change of selection resets a half-finished evolve confirmation.
  const selectedTowerId = selectedTower?.id
  const selectedTowerVariant = selectedTower?.tower_type
  useEffect(() => {
    setEvolveChoice(null)
  }, [selectedTowerId, selectedTowerVariant])

  // Animation loop — runs once for the component's lifetime and calls the
  // freshest render closure through a ref, so the effect needs no deps.
  const renderRef = useRef<() => void>(() => {})
  useEffect(() => {
    const animate = () => {
      renderRef.current()
      animationFrameRef.current = requestAnimationFrame(animate)
    }
    animationFrameRef.current = requestAnimationFrame(animate)
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
    }
  }, [])

  const render = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const gs = liveStateRef.current
    const hovered = hoveredCellRef.current
    const selType = selectedTowerTypeRef.current
    const selTower = selectedTowerRef.current
    const currentTowers = gs?.towers || []
    const currentEnemies = gs?.enemies || []
    const currentProjectiles = gs?.projectiles || []
    const currentFlashes = gs?.muzzle_flashes || []
    const currentExplosions = gs?.explosions || []
    const currentGold = gs?.gold ?? 200
    const currentPhase = gs?.phase || 'waiting'
    const currentIsGameOver = currentPhase === 'game_over' || currentPhase === 'victory'
    const nowMs = performance.now()
    const t = nowMs / 1000

    // 0. One-shot effect bookkeeping — only against real server snapshots
    //    (room_id is never set on the client's default state).
    if (gs?.room_id) {
      const health = gs.health ?? 100
      if (!fxSeededRef.current) {
        fxSeededRef.current = true
        currentTowers.forEach(tw => knownTowerIdsRef.current.add(tw.id))
        currentEnemies.forEach(e => {
          if (e.enemy_type === 'boss') knownBossIdsRef.current.add(e.id)
        })
        prevHealthRef.current = health
      } else {
        currentTowers.forEach(tw => {
          if (!knownTowerIdsRef.current.has(tw.id)) {
            knownTowerIdsRef.current.add(tw.id)
            towerPlaceAnimsRef.current.set(tw.id, nowMs)
          }
        })
        // New game wipes the board and restarts IDs at 1 — drop stale sets so
        // the fresh run's IDs read as new placements/spawns again.
        if (currentTowers.length === 0 && knownTowerIdsRef.current.size > 0) {
          knownTowerIdsRef.current.clear()
          towerPlaceAnimsRef.current.clear()
        }
        currentEnemies.forEach(e => {
          if (e.enemy_type === 'boss' && !knownBossIdsRef.current.has(e.id)) {
            knownBossIdsRef.current.add(e.id)
            if (settings.current.bossBeamDown) bossBeamAnimsRef.current.set(e.id, nowMs)
          }
        })
        if (currentEnemies.length === 0 && knownBossIdsRef.current.size > 0) {
          knownBossIdsRef.current.clear()
          bossBeamAnimsRef.current.clear()
        }
        const prevHealth = prevHealthRef.current ?? health
        // Health only drops on a goal leak (-10) — the one "ouch" moment.
        // It only rises on a new-game reset, which must not shake.
        if (health < prevHealth && settings.current.screenShake) {
          shakeStartRef.current = nowMs
        }
        prevHealthRef.current = health
      }
    }

    // Screen shake offset for this frame (quadratic decay to zero).
    let shakeX = 0
    let shakeY = 0
    if (shakeStartRef.current !== null) {
      const sp = (nowMs - shakeStartRef.current) / SHAKE_MS
      if (sp >= 1) {
        shakeStartRef.current = null
      } else {
        const decay = (1 - sp) * (1 - sp)
        shakeX = SHAKE_AMP_PX * decay * Math.sin(nowMs * 0.09)
        shakeY = SHAKE_AMP_PX * decay * Math.sin(nowMs * 0.13 + 1.7)
      }
    }
    const shaking = shakeX !== 0 || shakeY !== 0
    if (shaking) {
      // The translate exposes a sliver of raw canvas at the edges — pre-fill
      // with the board's base color so it reads as shadow, not garbage.
      ctx.fillStyle = PALETTE.bgDeep
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.save()
      ctx.translate(shakeX, shakeY)
    }

    // 1. Static layers (gradient, grid, bulkheads, portal pads) from the
    //    offscreen canvas — re-rendered only when the map changes.
    ctx.drawImage(ensureBackground(gs), 0, 0)

    // 2. Portal animations (goal gate goes alarm-red when health is low).
    const lowHealth = (gs?.health ?? 100) <= 30
    if (gs?.spawn_point) drawSpawnGate(ctx, gs.spawn_point, t)
    if (gs?.goal_point) drawGoalGate(ctx, gs.goal_point, t, lowHealth)

    // Lookup tables for this frame.
    const towerTypeById = new Map<number, string>()
    const towerByCell = new Map<string, Tower>()
    currentTowers.forEach(tw => {
      towerTypeById.set(tw.id, tw.tower_type)
      towerByCell.set(`${tw.position.x},${tw.position.y}`, tw)
    })
    const enemyById = new Map<number, Enemy>()
    currentEnemies.forEach(e => enemyById.set(e.id, e))

    // 3. Range rings + always-on aura fields + hover underlay go under the
    //    entities.
    const liveSel = selTower ? currentTowers.find(tw => tw.id === selTower.id) : undefined
    if (liveSel) {
      drawRangeRing(ctx, liveSel.position, liveSel.range, TOWER_COLORS[liveSel.tower_type], t, 0.7)
    }
    currentTowers.forEach(tw => {
      if (tw.tower_type === 'cryo_field' || tw.tower_type === 'amplifier') {
        drawAuraField(ctx, tw, t)
      }
    })
    let hoverBlocked = false
    // Third axis on top of the old valid/invalid split: whether the server
    // has cleared this cell as not sealing the lane. 'pending' is the honest
    // "we haven't heard back" state — it must not read as approval, since
    // the click is gated on a confirmed 'ok'.
    let hoverPath: PathPreviewState = 'ok'
    const hoverPlacing = hovered && !currentIsGameOver && !selTower && selType !== null &&
      !towerByCell.has(`${hovered.x},${hovered.y}`)
    if (hoverPlacing && hovered && selType) {
      hoverBlocked =
        (gs?.obstacles ?? []).some(o => o.x === hovered.x && o.y === hovered.y) ||
        (gs?.spawn_point?.x === hovered.x && gs?.spawn_point?.y === hovered.y) ||
        (gs?.goal_point?.x === hovered.x && gs?.goal_point?.y === hovered.y)
      if (!hoverBlocked) {
        // Only cells that pass every synchronous check are ever asked about,
        // so anything else stays 'ok' and the existing invalid look wins.
        const answer = placementChecksRef.current.results.get(`${hovered.x},${hovered.y}`)
        hoverPath = answer === undefined ? 'pending' : answer ? 'blocks' : 'ok'
      }
      const canAfford = currentGold >= TOWER_COSTS[selType]
      drawHoverUnderlay(
        ctx, hovered, selType, t,
        hoverBlocked || !canAfford || hoverPath === 'blocks',
        // The range ring is the "go ahead" signal — hold it back until the
        // placement is actually cleared.
        !hoverBlocked && canAfford && hoverPath === 'ok',
      )
    }

    // 4. Entities.
    currentTowers.forEach(tower => {
      // Placement materialize: scale the whole tower (plate, turret, pips)
      // up from nothing around its cell center. Unconditional — towers place
      // one at a time, so there is no density risk to toggle away.
      const placedAt = towerPlaceAnimsRef.current.get(tower.id)
      if (placedAt !== undefined) {
        const p = (nowMs - placedAt) / PLACE_ANIM_MS
        if (p >= 1) {
          towerPlaceAnimsRef.current.delete(tower.id)
          drawTower(ctx, tower, t, 1)
        } else {
          const s = Math.max(easeOutBack(p), 0.02)
          const cx = tower.position.x * CELL_SIZE + CELL_SIZE / 2
          const cy = tower.position.y * CELL_SIZE + CELL_SIZE / 2
          ctx.save()
          ctx.translate(cx, cy)
          ctx.scale(s, s)
          ctx.translate(-cx, -cy)
          drawTower(ctx, tower, t, 1)
          ctx.restore()
        }
      } else {
        drawTower(ctx, tower, t, 1)
      }
    })
    const nextProjHeadings = new Map<number, { x: number; y: number; angle: number }>()
    currentProjectiles.forEach(p => drawProjectile(ctx, p, t, towerTypeById, enemyById, nextProjHeadings))
    projHeadingsRef.current = nextProjHeadings

    const nextEnemyHeadings = new Map<number, { x: number; y: number; angle: number }>()
    currentEnemies.forEach(enemy => {
      // Boss beam-down: streak first, then the boss fades in under it.
      // Bosses only (rare — every 3rd wave from 11, capped at 6): regular
      // enemy types spawn in dense bursts and get no per-unit animation.
      const beamStart = enemy.enemy_type === 'boss' ? bossBeamAnimsRef.current.get(enemy.id) : undefined
      if (beamStart === undefined) {
        drawEnemy(ctx, enemy, t, nextEnemyHeadings)
        return
      }
      const p = (nowMs - beamStart) / BEAM_MS
      if (p >= 1) {
        bossBeamAnimsRef.current.delete(enemy.id)
        drawEnemy(ctx, enemy, t, nextEnemyHeadings)
        return
      }
      if (p > BEAM_BOSS_FADE_START) {
        ctx.save()
        ctx.globalAlpha = (p - BEAM_BOSS_FADE_START) / (1 - BEAM_BOSS_FADE_START)
        drawEnemy(ctx, enemy, t, nextEnemyHeadings)
        ctx.restore()
      } else {
        // Boss not visible yet — keep its heading entry warm so it doesn't
        // snap-rotate on its first drawn frame.
        const hx = enemy.position.x * CELL_SIZE + CELL_SIZE / 2
        const hy = enemy.position.y * CELL_SIZE + CELL_SIZE / 2
        nextEnemyHeadings.set(enemy.id, enemyHeadingsRef.current.get(enemy.id) ?? { x: hx, y: hy, angle: 0 })
      }
      drawBossBeam(ctx, enemy.position, p)
    })
    enemyHeadingsRef.current = nextEnemyHeadings

    // 5. Effects. Laser beams draw between towers and enemies (both already
    //    on screen); chain arcs ride the snapshot like explosions do.
    currentTowers.forEach(tw => {
      if (tw.tower_type === 'laser' && tw.current_target) {
        const victim = enemyById.get(tw.current_target)
        if (victim) drawLaserBeam(ctx, tw, victim, t)
      }
    })
    ;(gs?.arcs || []).forEach(arc => drawArc(ctx, arc, t))
    currentFlashes.forEach(flash => drawMuzzleFlash(ctx, flash, towerByCell))
    currentExplosions.forEach(explosion => drawExplosion(ctx, explosion))

    // 6. Target reticles: corner ticks on each tower's current victim.
    currentTowers.forEach(tw => {
      if (!tw.current_target) return
      const victim = enemyById.get(tw.current_target)
      if (victim) drawReticle(ctx, victim, TOWER_COLORS[tw.tower_type])
    })

    // 7. Selection brackets + ghost preview on top.
    if (liveSel) drawSelectionBrackets(ctx, liveSel.position)
    if (hoverPlacing && hovered && selType) {
      drawGhostTower(ctx, hovered, selType, t, hoverBlocked, currentGold >= TOWER_COSTS[selType], hoverPath)
    }

    if (shaking) ctx.restore()

    // 8. Low-health status pulse — screen-space (outside the shake
    //    transform), a single slow ambient breath while the run is critical.
    const currentHealth = gs?.health ?? 100
    if (
      settings.current.lowHealthPulse &&
      !currentIsGameOver &&
      currentHealth > 0 &&
      currentHealth < LOW_HEALTH_PULSE_THRESHOLD
    ) {
      const breath = 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / LOW_HEALTH_PULSE_PERIOD_S)
      ctx.globalAlpha = 0.04 + 0.05 * breath
      ctx.drawImage(alertVignette(canvas.width, canvas.height), 0, 0)
      ctx.globalAlpha = 1
    }
  }
  renderRef.current = render

  // ——— static background (rendered once per map) ———

  const ensureBackground = (gs?: GameState): HTMLCanvasElement => {
    const obstacles = gs?.obstacles ?? []
    // map_id is in the key: two maps could share an obstacle count, and the
    // pre-rendered board must repaint when the room switches maps.
    const key = `${gs?.map_id ?? ''}|${obstacles.length}|${gs?.spawn_point?.x},${gs?.spawn_point?.y}|${gs?.goal_point?.x},${gs?.goal_point?.y}`
    if (bgCanvasRef.current && bgKeyRef.current === key) return bgCanvasRef.current

    const c = document.createElement('canvas')
    c.width = GRID_WIDTH * CELL_SIZE
    c.height = GRID_HEIGHT * CELL_SIZE
    const b = c.getContext('2d')!

    // Base gradient + center glow.
    const grad = b.createLinearGradient(0, 0, 0, c.height)
    grad.addColorStop(0, PALETTE.bgNavy)
    grad.addColorStop(1, PALETTE.bgDeep)
    b.fillStyle = grad
    b.fillRect(0, 0, c.width, c.height)
    const glow = b.createRadialGradient(c.width / 2, c.height / 2, 0, c.width / 2, c.height / 2, 420)
    glow.addColorStop(0, hexAlpha(PALETTE.bgGlow, 0.35))
    glow.addColorStop(1, 'rgba(0,0,0,0)')
    b.fillStyle = glow
    b.fillRect(0, 0, c.width, c.height)

    // Grid: minor every cell, brighter major every 5 cells, '+' ticks at
    // major intersections.
    b.lineWidth = 1
    for (const major of [false, true]) {
      b.strokeStyle = major ? PALETTE.gridMajor : PALETTE.gridMinor
      b.beginPath()
      for (let x = 0; x <= GRID_WIDTH; x++) {
        if (x % 5 === 0 !== major) continue
        b.moveTo(x * CELL_SIZE + 0.5, 0)
        b.lineTo(x * CELL_SIZE + 0.5, c.height)
      }
      for (let y = 0; y <= GRID_HEIGHT; y++) {
        if (y % 5 === 0 !== major) continue
        b.moveTo(0, y * CELL_SIZE + 0.5)
        b.lineTo(c.width, y * CELL_SIZE + 0.5)
      }
      b.stroke()
    }
    b.strokeStyle = PALETTE.gridNode
    b.beginPath()
    for (let x = 5; x < GRID_WIDTH; x += 5) {
      for (let y = 5; y < GRID_HEIGHT; y += 5) {
        const px = x * CELL_SIZE + 0.5
        const py = y * CELL_SIZE + 0.5
        b.moveTo(px - 3, py)
        b.lineTo(px + 3, py)
        b.moveTo(px, py - 3)
        b.lineTo(px, py + 3)
      }
    }
    b.stroke()

    drawBulkheads(b, obstacles)

    // Portal cell tints (the animated gates render per frame).
    if (gs?.spawn_point) {
      b.fillStyle = hexAlpha(PALETTE.spawn, 0.08)
      b.fillRect(gs.spawn_point.x * CELL_SIZE, gs.spawn_point.y * CELL_SIZE, CELL_SIZE, CELL_SIZE)
    }
    if (gs?.goal_point) {
      b.fillStyle = hexAlpha(PALETTE.goal, 0.08)
      b.fillRect(gs.goal_point.x * CELL_SIZE, gs.goal_point.y * CELL_SIZE, CELL_SIZE, CELL_SIZE)
    }

    // Vignette.
    const vin = b.createRadialGradient(c.width / 2, c.height / 2, Math.min(c.width, c.height) / 2 - 40, c.width / 2, c.height / 2, Math.max(c.width, c.height) / 2 + 80)
    vin.addColorStop(0, 'rgba(0,0,0,0)')
    vin.addColorStop(1, 'rgba(0,0,0,0.35)')
    b.fillStyle = vin
    b.fillRect(0, 0, c.width, c.height)

    bgCanvasRef.current = c
    bgKeyRef.current = key
    return c
  }

  // Obstacles render as merged "containment bulkheads": one rounded plate per
  // contiguous vertical run, with hatching, a power seam, and hazard stripes
  // on the corridor-facing end cells. shadowBlur is allowed here only — this
  // draws once per map, not per frame.
  const drawBulkheads = (b: CanvasRenderingContext2D, obstacles: Position[]) => {
    const byX = new Map<number, number[]>()
    obstacles.forEach(o => {
      const ys = byX.get(o.x) ?? []
      ys.push(o.y)
      byX.set(o.x, ys)
    })
    byX.forEach((ys, x) => {
      ys.sort((a, c) => a - c)
      let start = ys[0]
      let prev = ys[0]
      const flush = (y0: number, y1: number) => {
        const px = x * CELL_SIZE + 2
        const py = y0 * CELL_SIZE + 2
        const w = CELL_SIZE - 4
        const h = (y1 - y0 + 1) * CELL_SIZE - 4

        const fill = b.createLinearGradient(0, py, 0, py + h)
        fill.addColorStop(0, PALETTE.wallFillHi)
        fill.addColorStop(1, PALETTE.wallFillLo)
        roundRectPath(b, px, py, w, h, 6)
        b.fillStyle = fill
        b.fill()

        b.save()
        roundRectPath(b, px, py, w, h, 6)
        b.clip()
        b.strokeStyle = PALETTE.wallHatch
        b.lineWidth = 1
        b.beginPath()
        for (let d = -h; d < w; d += 8) {
          b.moveTo(px + d, py + h)
          b.lineTo(px + d + h, py)
        }
        b.stroke()
        // Power seam + node dots at each cell center.
        b.strokeStyle = hexAlpha(PALETTE.wallEdge, 0.5)
        b.lineWidth = 2
        b.beginPath()
        b.moveTo(px + w / 2, py + 6)
        b.lineTo(px + w / 2, py + h - 6)
        b.stroke()
        b.fillStyle = hexAlpha(PALETTE.wallNode, 0.8)
        for (let y = y0; y <= y1; y++) {
          b.beginPath()
          b.arc(x * CELL_SIZE + CELL_SIZE / 2, y * CELL_SIZE + CELL_SIZE / 2, 2, 0, Math.PI * 2)
          b.fill()
        }
        // Hazard stripes on ends that face a corridor gap (not the border).
        b.strokeStyle = hexAlpha(PALETTE.hazard, 0.5)
        b.lineWidth = 3
        const stripe = (cy: number) => {
          b.beginPath()
          for (let i = 0; i < 3; i++) {
            const sx = px + 4 + i * 11
            b.moveTo(sx, cy + 14)
            b.lineTo(sx + 10, cy + 4)
          }
          b.stroke()
        }
        if (y0 > 0) stripe(y0 * CELL_SIZE + 2)
        if (y1 < GRID_HEIGHT - 1) stripe(y1 * CELL_SIZE + CELL_SIZE - 20)
        b.restore()

        b.save()
        b.shadowColor = '#1E6FB8'
        b.shadowBlur = 14
        roundRectPath(b, px, py, w, h, 6)
        b.strokeStyle = PALETTE.wallEdge
        b.lineWidth = 2
        b.stroke()
        b.restore()
        roundRectPath(b, px + 4, py + 4, w - 8, h - 8, 4)
        b.strokeStyle = PALETTE.wallInner
        b.lineWidth = 1
        b.stroke()
      }
      for (let i = 1; i < ys.length; i++) {
        if (ys[i] === prev + 1) {
          prev = ys[i]
        } else {
          flush(start, prev)
          start = ys[i]
          prev = ys[i]
        }
      }
      flush(start, prev)
    })
  }

  // ——— portals ———

  const drawSpawnGate = (ctx: CanvasRenderingContext2D, pos: Position, t: number) => {
    const x = pos.x * CELL_SIZE + CELL_SIZE / 2
    const y = pos.y * CELL_SIZE + CELL_SIZE / 2
    ctx.strokeStyle = PALETTE.spawn
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x, y, 13, 0, Math.PI * 2)
    ctx.stroke()
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(t * 0.9)
    ctx.strokeStyle = PALETTE.spawnLight
    ctx.lineWidth = 1.5
    ctx.stroke(memoPath('hex8', () => regularPolyPath(8, 6, 0)))
    ctx.restore()
    // Pulse ring.
    ctx.globalAlpha = 0.35
    ctx.strokeStyle = PALETTE.spawn
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(x, y, 13 + 3 * Math.sin((Math.PI * 2 * t) / 1.6), 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 1
    // Marching ">" chevrons fading out toward the corridor.
    ctx.strokeStyle = PALETTE.spawnLight
    ctx.lineWidth = 1.5
    for (let i = 0; i < 3; i++) {
      const cx = -6 + ((t * 20 + i * 8) % 24)
      ctx.globalAlpha = Math.max(0, 1 - (cx + 6) / 24)
      ctx.beginPath()
      ctx.moveTo(x + cx - 3, y - 3)
      ctx.lineTo(x + cx, y)
      ctx.lineTo(x + cx - 3, y + 3)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  const drawGoalGate = (ctx: CanvasRenderingContext2D, pos: Position, t: number, alarm: boolean) => {
    const x = pos.x * CELL_SIZE + CELL_SIZE / 2
    const y = pos.y * CELL_SIZE + CELL_SIZE / 2
    const accent = alarm ? PALETTE.hpLow : PALETTE.goal
    const light = alarm ? PALETTE.hpLow : PALETTE.goalLight
    const rate = alarm ? 2 : 1
    ctx.strokeStyle = accent
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x, y, 13, 0, Math.PI * 2)
    ctx.stroke()
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(-t * 0.9 * rate)
    ctx.strokeStyle = light
    ctx.lineWidth = 1.5
    ctx.stroke(memoPath('hex8', () => regularPolyPath(8, 6, 0)))
    ctx.restore()
    ctx.globalAlpha = 0.35
    ctx.strokeStyle = accent
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(x, y, 13 + 3 * Math.sin((Math.PI * 2 * t * rate) / 1.6), 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 1
    // Core.
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.drawImage(glowSprite(accent), x - 9, y - 9, 18, 18)
    ctx.fillStyle = PALETTE.white
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // ——— rings, brackets, hover ———

  const drawRangeRing = (ctx: CanvasRenderingContext2D, pos: Position, range: number, accent: string, t: number, alpha: number) => {
    const x = pos.x * CELL_SIZE + CELL_SIZE / 2
    const y = pos.y * CELL_SIZE + CELL_SIZE / 2
    const r = range * CELL_SIZE
    ctx.fillStyle = hexAlpha(accent, 0.05)
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = hexAlpha(accent, alpha)
    ctx.lineWidth = 1.5
    ctx.setLineDash([10, 6])
    ctx.lineDashOffset = -((t * 20) % 16)
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.lineDashOffset = 0
    ctx.strokeStyle = hexAlpha(accent, 0.15)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(x, y, r - 3, 0, Math.PI * 2)
    ctx.stroke()
  }

  // Always-on aura field (cryo field, amplifier): faint fill + slow-crawling
  // dashed rim, quieter than the selection range ring so it reads as ambient.
  const drawAuraField = (ctx: CanvasRenderingContext2D, tower: Tower, t: number) => {
    const x = tower.position.x * CELL_SIZE + CELL_SIZE / 2
    const y = tower.position.y * CELL_SIZE + CELL_SIZE / 2
    const r = tower.range * CELL_SIZE
    const accent = TOWER_COLORS[tower.tower_type]
    ctx.fillStyle = hexAlpha(accent, 0.045)
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = hexAlpha(accent, 0.35)
    ctx.lineWidth = 1
    ctx.setLineDash([4, 8])
    ctx.lineDashOffset = -((t * 8) % 12)
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.lineDashOffset = 0
  }

  // Laser beam: accent glow + white core from the lens to the target, with an
  // impact bloom. Drawn from live positions every frame — no wire data.
  const drawLaserBeam = (ctx: CanvasRenderingContext2D, tower: Tower, victim: Enemy, t: number) => {
    const x1 = tower.position.x * CELL_SIZE + CELL_SIZE / 2
    const y1 = tower.position.y * CELL_SIZE + CELL_SIZE / 2
    const x2 = victim.position.x * CELL_SIZE + CELL_SIZE / 2
    const y2 = victim.position.y * CELL_SIZE + CELL_SIZE / 2
    const accent = TOWER_COLORS.laser
    const pulse = 0.75 + 0.25 * Math.sin(t * 18 + tower.id)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = hexAlpha(accent, 0.3 * pulse)
    ctx.lineWidth = 5
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.strokeStyle = hexAlpha(PALETTE.white, 0.85 * pulse)
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    const bloom = 10 + 3 * Math.sin(t * 23)
    ctx.drawImage(glowSprite(accent), x2 - bloom, y2 - bloom, bloom * 2, bloom * 2)
    ctx.restore()
  }

  // Chain-lightning arc: jagged accent bolt + white core between two points.
  // The jitter re-rolls every frame (seeded by id + time) so it flickers.
  const drawArc = (ctx: CanvasRenderingContext2D, arc: Arc, t: number) => {
    const x1 = arc.from.x * CELL_SIZE + CELL_SIZE / 2
    const y1 = arc.from.y * CELL_SIZE + CELL_SIZE / 2
    const x2 = arc.to.x * CELL_SIZE + CELL_SIZE / 2
    const y2 = arc.to.y * CELL_SIZE + CELL_SIZE / 2
    const alpha = Math.max(0, Math.min(arc.duration / 0.18, 1))
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    const nx = -dy / len
    const ny = dx / len
    const segs = 5

    const bolt = (jitterScale: number) => {
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      for (let i = 1; i < segs; i++) {
        const f = i / segs
        const seed = Math.sin(arc.id * 13.7 + i * 71.3 + Math.floor(t * 40) * 5.1)
        const jitter = seed * jitterScale
        ctx.lineTo(x1 + dx * f + nx * jitter, y1 + dy * f + ny * jitter)
      }
      ctx.lineTo(x2, y2)
      ctx.stroke()
    }

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = hexAlpha(TOWER_COLORS.tesla, 0.55 * alpha)
    ctx.lineWidth = 2.5
    bolt(6)
    ctx.strokeStyle = hexAlpha(PALETTE.white, 0.9 * alpha)
    ctx.lineWidth = 1
    bolt(6)
    ctx.restore()
  }

  const drawSelectionBrackets = (ctx: CanvasRenderingContext2D, pos: Position) => {
    const px = pos.x * CELL_SIZE
    const py = pos.y * CELL_SIZE
    const inset = 3
    const arm = 8
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (const [cx, cy, dx, dy] of [
      [px + inset, py + inset, 1, 1],
      [px + CELL_SIZE - inset, py + inset, -1, 1],
      [px + CELL_SIZE - inset, py + CELL_SIZE - inset, -1, -1],
      [px + inset, py + CELL_SIZE - inset, 1, -1],
    ]) {
      ctx.moveTo(cx + dx * arm, cy)
      ctx.lineTo(cx, cy)
      ctx.lineTo(cx, cy + dy * arm)
    }
    ctx.stroke()
  }

  // showRange is not simply !invalid any more: a placement waiting on the
  // server's path-block answer is not invalid, but it isn't cleared either.
  const drawHoverUnderlay = (ctx: CanvasRenderingContext2D, pos: Position, towerType: TowerType, t: number, invalid: boolean, showRange: boolean) => {
    const px = pos.x * CELL_SIZE
    const py = pos.y * CELL_SIZE
    const accent = invalid ? PALETTE.danger : TOWER_COLORS[towerType]
    ctx.fillStyle = hexAlpha(accent, 0.08)
    ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE)
    ctx.strokeStyle = accent
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 3])
    ctx.strokeRect(px + 3.5, py + 3.5, CELL_SIZE - 7, CELL_SIZE - 7)
    ctx.setLineDash([])
    if (showRange) {
      drawRangeRing(ctx, pos, TOWER_RANGES[towerType], accent, t, 0.4)
    }
  }

  // Three ghost states, in priority order:
  //   invalid  (wall / spawn / goal / broke) — 0.25 + corner-to-corner slash
  //   blocks   (would seal the lane)         — 0.25 + no-entry glyph
  //   pending  (server hasn't answered yet)  — breathing alpha, no marking
  //   ok                                     — 0.45, unmarked
  // 'blocks' shares the danger red with 'invalid' but swaps the glyph: it is
  // a different problem (the maze, not the cell), and the slash already
  // means "you cannot build here at all".
  const drawGhostTower = (ctx: CanvasRenderingContext2D, pos: Position, towerType: TowerType, t: number, blocked: boolean, canAfford: boolean, pathState: PathPreviewState) => {
    const invalid = blocked || !canAfford
    const px = pos.x * CELL_SIZE
    const py = pos.y * CELL_SIZE
    if (invalid || pathState === 'blocks') {
      ctx.globalAlpha = 0.25
    } else if (pathState === 'pending') {
      // Sits between the placeable 0.45 and the rejected 0.25, and breathes
      // so a slow reply reads as "still thinking" rather than a dim ghost.
      ctx.globalAlpha = 0.34 + 0.06 * Math.sin(t * 5)
    } else {
      ctx.globalAlpha = 0.45
    }
    drawTower(ctx, {
      id: -1,
      position: { x: pos.x, y: pos.y },
      tower_type: towerType,
      level: 1,
      range: TOWER_RANGES[towerType],
      rotation: 0,
    }, t, 1)
    ctx.globalAlpha = 1
    if (invalid) {
      ctx.strokeStyle = PALETTE.danger
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(px + 6, py + 6)
      ctx.lineTo(px + CELL_SIZE - 6, py + CELL_SIZE - 6)
      ctx.stroke()
    } else if (pathState === 'blocks') {
      drawNoEntryGlyph(ctx, px + CELL_SIZE / 2, py + CELL_SIZE / 2)
    }
  }

  // "No entry": stroked circle with one diagonal bar, sized to fill the
  // cell. Drawn over the ghost at full opacity with a soft red bloom so it
  // stays legible on top of the turret silhouette.
  const drawNoEntryGlyph = (ctx: CanvasRenderingContext2D, cx: number, cy: number) => {
    const r = CELL_SIZE * 0.33
    const bar = r * 0.72 // chord inset, so the bar stops inside the ring
    ctx.save()
    ctx.strokeStyle = PALETTE.danger
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.shadowColor = PALETTE.danger
    ctx.shadowBlur = 8
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx - bar, cy + bar)
    ctx.lineTo(cx + bar, cy - bar)
    ctx.stroke()
    ctx.restore()
  }

  // ——— towers ———

  const drawTower = (ctx: CanvasRenderingContext2D, tower: Tower, t: number, alphaScale: number) => {
    const x = tower.position.x * CELL_SIZE + CELL_SIZE / 2
    const y = tower.position.y * CELL_SIZE + CELL_SIZE / 2
    const type = tower.tower_type
    const accent = TOWER_COLORS[type] || TOWER_COLORS.basic
    const light = TOWER_LIGHT[type] || PALETTE.white
    const level = tower.level || 1
    const evolved = tower.evolved ?? false
    const base = SHAPES.towerBase[type] || SHAPES.towerBase.basic

    ctx.save()
    ctx.translate(x, y)

    // Base plate: dark fill + two-pass accent edge glow. Never rotates.
    ctx.fillStyle = PALETTE.platefill
    ctx.fill(base)
    ctx.strokeStyle = hexAlpha(accent, 0.2 * alphaScale)
    ctx.lineWidth = 5
    ctx.stroke(base)
    ctx.strokeStyle = accent
    ctx.lineWidth = 1.5
    ctx.stroke(base)
    // MAX-level inset ring — base forms only; evolved plates ARE the payoff.
    if (level >= 4 && !evolved) {
      ctx.strokeStyle = hexAlpha(PALETTE.white, 0.8)
      ctx.lineWidth = 1
      ctx.stroke(SHAPES.towerBaseInset[type] || SHAPES.towerBaseInset.basic)
    }

    // Ambient dashed ring: slow's motion accent, inherited by its evolutions.
    if (type === 'slow' || type === 'cryo_field' || type === 'deep_freeze') {
      ctx.strokeStyle = hexAlpha(light, 0.5)
      ctx.lineWidth = 1
      ctx.setLineDash([3, 5])
      ctx.lineDashOffset = -((t * 6) % 8)
      ctx.beginPath()
      ctx.arc(0, 0, 13, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.lineDashOffset = 0
    }

    // Aura hardware (cryo field, amplifier) never rotates — no turret pass.
    const isAuraTower = type === 'cryo_field' || type === 'amplifier'

    if (!isAuraTower) {
      // Turret: rotates toward the target and scales up with level.
      ctx.rotate(tower.rotation || 0)
      const s = evolved ? 1.1 : 1 + 0.06 * (level - 1)
      ctx.scale(s, s)
      switch (type) {
        case 'sniper':
          ctx.fillStyle = accent
          ctx.fillRect(2, -2.5, 22, 1.5)
          ctx.fillRect(2, 1, 22, 1.5)
          ctx.fillRect(22, -3, 2, 6)
          ctx.strokeStyle = light
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(4, 0)
          ctx.lineTo(22, 0)
          ctx.stroke()
          ctx.fillStyle = accent
          ctx.beginPath()
          ctx.arc(0, 0, 3.5, 0, Math.PI * 2)
          ctx.fill()
          break
        case 'splash':
          ctx.fillStyle = PALETTE.turretMetal
          ctx.fillRect(0, -5, 12, 10)
          ctx.strokeStyle = accent
          ctx.lineWidth = 1.5
          ctx.strokeRect(0, -5, 12, 10)
          ctx.fillStyle = PALETTE.bgDeep
          ctx.beginPath()
          ctx.arc(12, 0, 2.5, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = accent
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(0, 0, 6, 0, Math.PI * 2)
          ctx.stroke()
          ctx.fillStyle = accent
          ctx.beginPath()
          ctx.arc(0, 0, 2, 0, Math.PI * 2)
          ctx.fill()
          break
        case 'slow': {
          // Three emitter vanes at 120°.
          ctx.fillStyle = PALETTE.turretMetal
          ctx.strokeStyle = accent
          ctx.lineWidth = 1.5
          for (let i = 0; i < 3; i++) {
            ctx.save()
            ctx.rotate((i * 2 * Math.PI) / 3)
            const vane = memoPath('vane', () => polyPath([[6, -3], [15, 0], [6, 3]]))
            ctx.fill(vane)
            ctx.stroke(vane)
            ctx.restore()
          }
          break
        }
        case 'tesla': {
          // Twin-prong arc emitter with a flickering spark bridging the gap.
          ctx.fillStyle = PALETTE.turretMetal
          ctx.fillRect(2, -4, 7, 8)
          ctx.strokeStyle = accent
          ctx.lineWidth = 1.5
          ctx.strokeRect(2, -4, 7, 8)
          ctx.beginPath()
          ctx.moveTo(9, -3.5)
          ctx.lineTo(16, -5)
          ctx.moveTo(9, 3.5)
          ctx.lineTo(16, 5)
          ctx.stroke()
          const flick = Math.sin(t * 31 + tower.id * 7)
          ctx.strokeStyle = hexAlpha(light, 0.5 + 0.5 * Math.abs(flick))
          ctx.lineWidth = 1.25
          ctx.beginPath()
          ctx.moveTo(15, -4)
          ctx.lineTo(12.5, flick * 2.5)
          ctx.lineTo(15, 4)
          ctx.stroke()
          ctx.fillStyle = accent
          ctx.beginPath()
          ctx.arc(0, 0, 4.5, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = light
          ctx.beginPath()
          ctx.arc(0, 0, 1.8, 0, Math.PI * 2)
          ctx.fill()
          break
        }
        case 'breach': {
          // Twin heavy short barrels with a muzzle brace.
          ctx.fillStyle = PALETTE.turretMetal
          ctx.fillRect(3, -5.5, 12, 4.5)
          ctx.fillRect(3, 1, 12, 4.5)
          ctx.strokeStyle = accent
          ctx.lineWidth = 1.5
          ctx.strokeRect(3, -5.5, 12, 4.5)
          ctx.strokeRect(3, 1, 12, 4.5)
          ctx.fillStyle = accent
          ctx.fillRect(14, -6, 2.5, 12)
          ctx.beginPath()
          ctx.arc(0, 0, 5, 0, Math.PI * 2)
          ctx.fill()
          break
        }
        case 'barrage': {
          // Three fanned launcher tubes.
          ctx.fillStyle = PALETTE.turretMetal
          ctx.strokeStyle = accent
          ctx.lineWidth = 1.25
          for (const a of [-0.24, 0, 0.24]) {
            ctx.save()
            ctx.rotate(a)
            ctx.fillRect(4, -1.75, 14, 3.5)
            ctx.strokeRect(4, -1.75, 14, 3.5)
            ctx.restore()
          }
          ctx.fillStyle = accent
          ctx.beginPath()
          ctx.arc(0, 0, 4.5, 0, Math.PI * 2)
          ctx.fill()
          break
        }
        case 'piercer': {
          // Extra-long twin rails with an energized core line.
          ctx.fillStyle = accent
          ctx.fillRect(2, -3, 28, 1.5)
          ctx.fillRect(2, 1.5, 28, 1.5)
          ctx.strokeStyle = light
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(2, 0)
          ctx.lineTo(30, 0)
          ctx.stroke()
          ctx.fillStyle = PALETTE.turretMetal
          ctx.fillRect(-2, -4, 8, 8)
          ctx.strokeStyle = accent
          ctx.lineWidth = 1.5
          ctx.strokeRect(-2, -4, 8, 8)
          break
        }
        case 'executioner': {
          // Rail plus a blade at the muzzle.
          ctx.fillStyle = accent
          ctx.fillRect(2, -2, 18, 4)
          const blade = memoPath('blade', () => polyPath([[19, -6], [28, 0], [19, 6]]))
          ctx.fillStyle = light
          ctx.fill(blade)
          ctx.strokeStyle = accent
          ctx.lineWidth = 1.25
          ctx.stroke(blade)
          ctx.fillStyle = accent
          ctx.beginPath()
          ctx.arc(0, 0, 4, 0, Math.PI * 2)
          ctx.fill()
          break
        }
        case 'cluster': {
          // Wide triple-muzzle drum.
          ctx.fillStyle = PALETTE.turretMetal
          ctx.fillRect(0, -8, 11, 16)
          ctx.strokeStyle = accent
          ctx.lineWidth = 1.5
          ctx.strokeRect(0, -8, 11, 16)
          ctx.fillStyle = PALETTE.bgDeep
          for (const oy of [-5, 0, 5]) {
            ctx.beginPath()
            ctx.arc(11, oy, 2, 0, Math.PI * 2)
            ctx.fill()
          }
          ctx.strokeStyle = accent
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(0, 0, 5.5, 0, Math.PI * 2)
          ctx.stroke()
          break
        }
        case 'siege': {
          // One massive reinforced tube.
          ctx.fillStyle = PALETTE.turretMetal
          ctx.fillRect(0, -6.5, 17, 13)
          ctx.strokeStyle = accent
          ctx.lineWidth = 1.75
          ctx.strokeRect(0, -6.5, 17, 13)
          ctx.fillStyle = accent
          ctx.fillRect(5, -7.5, 3, 15)
          ctx.fillStyle = PALETTE.bgDeep
          ctx.beginPath()
          ctx.arc(17, 0, 3.5, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = light
          ctx.lineWidth = 1
          ctx.stroke()
          break
        }
        case 'deep_freeze': {
          // One large crystal lance plus side shards.
          const lance = memoPath('lance', () => polyPath([[3, -4.5], [19, 0], [3, 4.5], [0, 0]]))
          ctx.fillStyle = light
          ctx.fill(lance)
          ctx.strokeStyle = accent
          ctx.lineWidth = 1.5
          ctx.stroke(lance)
          for (const sy of [-1, 1]) {
            const shard = memoPath(`lanceShard:${sy}`, () => polyPath([[2, sy * 5], [9, sy * 9], [5, sy * 4]]))
            ctx.fillStyle = hexAlpha(light, 0.7)
            ctx.fill(shard)
          }
          break
        }
        case 'laser': {
          // Lens housing with a focusing ring — the beam itself is drawn in
          // the effects pass (drawLaserBeams).
          ctx.fillStyle = PALETTE.turretMetal
          ctx.fillRect(-1, -4.5, 11, 9)
          ctx.strokeStyle = accent
          ctx.lineWidth = 1.5
          ctx.strokeRect(-1, -4.5, 11, 9)
          ctx.beginPath()
          ctx.arc(12, 0, 4, 0, Math.PI * 2)
          ctx.stroke()
          ctx.fillStyle = light
          ctx.beginPath()
          ctx.arc(12, 0, 1.75, 0, Math.PI * 2)
          ctx.fill()
          break
        }
        default: { // basic
          const barrelLen = 13 + level
          ctx.fillStyle = PALETTE.turretMetal
          ctx.fillRect(4, -3, barrelLen, 6)
          ctx.strokeStyle = accent
          ctx.lineWidth = 1.5
          ctx.strokeRect(4, -3, barrelLen, 6)
          ctx.strokeStyle = light
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(4 + barrelLen, -3)
          ctx.lineTo(4 + barrelLen, 3)
          ctx.stroke()
          ctx.fillStyle = accent
          ctx.beginPath()
          ctx.arc(0, 0, 4.5, 0, Math.PI * 2)
          ctx.fill()
          break
        }
      }
    }
    ctx.restore()

    // Static screen-frame toppers (never rotate with the turret).
    if (type === 'slow') {
      ctx.strokeStyle = TOWER_LIGHT.slow
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3
        ctx.moveTo(x + 2 * Math.cos(a), y + 2 * Math.sin(a))
        ctx.lineTo(x + 7 * Math.cos(a), y + 7 * Math.sin(a))
      }
      ctx.stroke()
      ctx.fillStyle = TOWER_LIGHT.slow
      ctx.beginPath()
      ctx.arc(x, y, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
    if (type === 'cryo_field') {
      // Bigger, slowly-rotating snowflake core.
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(t * 0.35)
      ctx.strokeStyle = light
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3
        ctx.moveTo(2 * Math.cos(a), 2 * Math.sin(a))
        ctx.lineTo(10 * Math.cos(a), 10 * Math.sin(a))
        // Side barbs
        ctx.moveTo(6 * Math.cos(a), 6 * Math.sin(a))
        ctx.lineTo(6 * Math.cos(a) + 3 * Math.cos(a + 1.1), 6 * Math.sin(a) + 3 * Math.sin(a + 1.1))
        ctx.moveTo(6 * Math.cos(a), 6 * Math.sin(a))
        ctx.lineTo(6 * Math.cos(a) + 3 * Math.cos(a - 1.1), 6 * Math.sin(a) + 3 * Math.sin(a - 1.1))
      }
      ctx.stroke()
      ctx.fillStyle = light
      ctx.beginPath()
      ctx.arc(0, 0, 2.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    if (type === 'amplifier') {
      // Counter-rotating emitter triangle + pulsing core.
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(-t * 0.6)
      ctx.strokeStyle = hexAlpha(accent, 0.9)
      ctx.lineWidth = 1.5
      ctx.stroke(memoPath('tri8', () => regularPolyPath(8, 3, -Math.PI / 2)))
      ctx.restore()
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 2.5 + tower.id)
      ctx.drawImage(glowSprite(accent), x - 8, y - 8, 16, 16)
      ctx.restore()
      ctx.fillStyle = light
      ctx.beginPath()
      ctx.arc(x, y, 2.25, 0, Math.PI * 2)
      ctx.fill()
    }

    if (evolved) {
      // Evolved marker: one filled diamond flanked by ticks — replaces the
      // 4-pip level row entirely.
      ctx.fillStyle = accent
      ctx.strokeStyle = hexAlpha(accent, 0.55)
      ctx.lineWidth = 1
      const py = Math.round(y + 19)
      ctx.beginPath()
      ctx.moveTo(x, py - 3.5)
      ctx.lineTo(x + 3.5, py)
      ctx.lineTo(x, py + 3.5)
      ctx.lineTo(x - 3.5, py)
      ctx.closePath()
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(x - 11, py)
      ctx.lineTo(x - 6, py)
      ctx.moveTo(x + 6, py)
      ctx.lineTo(x + 11, py)
      ctx.stroke()
    } else {
      // Upgrade pips: 4 outlined slots, first `level` filled (screen frame).
      ctx.strokeStyle = hexAlpha(accent, 0.2)
      ctx.fillStyle = accent
      ctx.lineWidth = 1
      for (let i = 0; i < 4; i++) {
        const px = Math.round(x - 12 + i * 8) - 2
        const py = Math.round(y + 17) - 2
        if (i < level) ctx.fillRect(px, py, 4, 4)
        else ctx.strokeRect(px + 0.5, py + 0.5, 3, 3)
      }
    }
  }

  // ——— enemies ———

  const drawEnemy = (ctx: CanvasRenderingContext2D, enemy: Enemy, t: number, next: Map<number, { x: number; y: number; angle: number }>) => {
    const x = enemy.position.x * CELL_SIZE + CELL_SIZE / 2
    const y = enemy.position.y * CELL_SIZE + CELL_SIZE / 2
    const type = enemy.enemy_type
    const accent = ENEMY_COLORS[type] || ENEMY_COLORS.basic
    const body = ENEMY_BODY[type] || ENEMY_BODY.basic
    const R = ENEMY_RADIUS[type] ?? 10
    const isRooted = (enemy.root_duration ?? 0) > 0
    const isSlowed = (enemy.slow_duration ?? 0) > 0 && !isRooted

    // Heading: smoothed toward the movement direction.
    const prev = enemyHeadingsRef.current.get(enemy.id)
    let angle = prev?.angle ?? 0
    if (prev) {
      const dx = x - prev.x
      const dy = y - prev.y
      if (dx * dx + dy * dy > 0.0016) {
        angle += shortestAngleDelta(Math.atan2(dy, dx) - angle) * 0.25
      }
    }
    next.set(enemy.id, { x, y, angle })

    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    const shape = SHAPES.enemy[type] || SHAPES.enemy.basic
    ctx.fillStyle = body
    ctx.fill(shape)
    if (type === 'tank' || type === 'boss') {
      ctx.strokeStyle = hexAlpha(accent, 0.2)
      ctx.lineWidth = 5.5
      ctx.stroke(shape)
      ctx.strokeStyle = accent
      ctx.lineWidth = 2.5
      ctx.stroke(shape)
    } else {
      ctx.strokeStyle = accent
      ctx.lineWidth = 2
      ctx.stroke(shape)
    }
    switch (type) {
      case 'basic':
        ctx.strokeStyle = '#FF8A94'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(-6, -3)
        ctx.lineTo(-6, 3)
        ctx.stroke()
        break
      case 'fast':
        ctx.strokeStyle = hexAlpha('#FFC98A', 0.5)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(-8, -3)
        ctx.lineTo(-14, -3)
        ctx.moveTo(-8, 3)
        ctx.lineTo(-14, 3)
        ctx.stroke()
        break
      case 'tank':
        ctx.strokeStyle = '#FF9A6B'
        ctx.lineWidth = 1.25
        ctx.stroke(SHAPES.enemy.tankInner)
        ctx.strokeStyle = hexAlpha(accent, 0.4)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(-2, -9)
        ctx.lineTo(-2, 9)
        ctx.moveTo(6, -9)
        ctx.lineTo(6, 9)
        ctx.stroke()
        break
      default:
        break
    }
    ctx.restore()

    if (type === 'boss') {
      // Pulsing white core + time-rotating blade ring (not heading-locked).
      ctx.save()
      ctx.globalAlpha = 0.7 + 0.3 * Math.sin(t * 3)
      ctx.drawImage(glowSprite(PALETTE.white), x - 10, y - 10, 20, 20)
      ctx.fillStyle = PALETTE.white
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      ctx.strokeStyle = accent
      ctx.lineWidth = 3
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + t * 1.2
        ctx.beginPath()
        ctx.arc(x, y, 16, a, a + (40 * Math.PI) / 180)
        ctx.stroke()
      }
    }

    // Deep-freeze root: solid ice block — unmistakably harder than the cage.
    if (isRooted) {
      ctx.save()
      ctx.translate(x, y)
      const block = memoPath(`iceBlock:${R}`, () => regularPolyPath(R + 6, 6, -Math.PI / 2))
      ctx.fillStyle = 'rgba(159, 194, 255, 0.28)'
      ctx.fill(block)
      ctx.strokeStyle = TOWER_LIGHT.deep_freeze
      ctx.lineWidth = 2
      ctx.stroke(block)
      // Frost spikes at the vertices.
      ctx.fillStyle = TOWER_LIGHT.deep_freeze
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3
        const bx = (R + 6) * Math.cos(a)
        const by = (R + 6) * Math.sin(a)
        const spike = memoPath(`spike:${R}:${i}`, () => polyPath([
          [bx, by],
          [bx + 4 * Math.cos(a - 0.35), by + 4 * Math.sin(a - 0.35)],
          [bx + 6 * Math.cos(a), by + 6 * Math.sin(a)],
          [bx + 4 * Math.cos(a + 0.35), by + 4 * Math.sin(a + 0.35)],
        ]))
        ctx.fill(spike)
      }
      // Inner glint.
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(-R * 0.5, -R * 0.6)
      ctx.lineTo(R * 0.3, R * 0.5)
      ctx.stroke()
      ctx.restore()
    }

    // Stasis cage: shape-based debuff tell — the body is never recolored.
    if (isSlowed) {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(t * 0.8)
      const cage = memoPath(`cage:${R}`, () => regularPolyPath(R + 5, 6, -Math.PI / 2))
      ctx.fillStyle = 'rgba(61, 139, 255, 0.12)'
      ctx.fill(cage)
      ctx.strokeStyle = hexAlpha(PALETTE.slowRing, 0.9)
      ctx.lineWidth = 1.5
      ctx.stroke(cage)
      ctx.strokeStyle = PALETTE.slowCrystal
      ctx.lineWidth = 3
      for (const i of [4, 5]) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3
        ctx.beginPath()
        ctx.moveTo((R + 5) * Math.cos(a), (R + 5) * Math.sin(a))
        ctx.lineTo((R + 8) * Math.cos(a), (R + 8) * Math.sin(a))
        ctx.stroke()
      }
      ctx.restore()
    }

    // Health bar: only once damaged (boss always), screen-aligned.
    const frac = Math.max(0, Math.min(1, enemy.health / enemy.max_health))
    if (frac < 1 || type === 'boss') {
      const barW = type === 'boss' ? 40 : type === 'tank' ? 32 : 26
      const barH = type === 'boss' ? 5 : 4
      const bx = Math.round(x - barW / 2)
      const by = Math.round(y - (R + 7) - barH)
      ctx.fillStyle = PALETTE.hpTrack
      ctx.fillRect(bx, by, barW, barH)
      ctx.fillStyle = frac > 0.5 ? PALETTE.hpHigh : frac > 0.25 ? PALETTE.hpMid : PALETTE.hpLow
      ctx.fillRect(bx + 1, by + 1, Math.round((barW - 2) * frac), barH - 2)
      if (type === 'tank' || type === 'boss') {
        ctx.fillStyle = PALETTE.hpTrack
        for (const q of [0.25, 0.5, 0.75]) {
          ctx.fillRect(bx + Math.round(barW * q), by + 1, 1, barH - 2)
        }
      }
      ctx.strokeStyle = PALETTE.hpBorder
      ctx.lineWidth = 1
      ctx.strokeRect(bx + 0.5, by + 0.5, barW - 1, barH - 1)
    }
  }

  // ——— projectiles & effects ———

  const drawProjectile = (
    ctx: CanvasRenderingContext2D,
    projectile: Projectile,
    t: number,
    towerTypeById: Map<number, string>,
    enemyById: Map<number, Enemy>,
    next: Map<number, { x: number; y: number; angle: number }>,
  ) => {
    const x = projectile.position.x * CELL_SIZE + CELL_SIZE / 2
    const y = projectile.position.y * CELL_SIZE + CELL_SIZE / 2
    const type = towerTypeById.get(projectile.tower_id) ?? (projectile.is_aoe ? 'splash' : 'basic')

    // Face the target; fall back to the movement delta.
    const target = enemyById.get(projectile.target_id)
    let angle: number
    if (target) {
      angle = Math.atan2(
        target.position.y * CELL_SIZE + CELL_SIZE / 2 - y,
        target.position.x * CELL_SIZE + CELL_SIZE / 2 - x,
      )
      next.set(projectile.id, { x, y, angle })
    } else {
      const prev = projHeadingsRef.current.get(projectile.id)
      angle = prev?.angle ?? 0
      if (prev) {
        const dx = x - prev.x
        const dy = y - prev.y
        if (dx * dx + dy * dy > 0.0016) angle = Math.atan2(dy, dx)
      }
      next.set(projectile.id, { x, y, angle })
    }

    // Visual family per firing type — evolved forms keep their parent's
    // projectile language, tinted with their own accent.
    const accent = TOWER_COLORS[type] || TOWER_COLORS.basic
    const light = TOWER_LIGHT[type] || PALETTE.white

    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    switch (type) {
      case 'sniper':
      case 'executioner': {
        ctx.strokeStyle = accent
        ctx.lineWidth = 2
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(-18, 0)
        ctx.lineTo(0, 0)
        ctx.stroke()
        ctx.drawImage(glowSprite(accent), -8, -8, 16, 16)
        ctx.fillStyle = PALETTE.white
        ctx.beginPath()
        ctx.arc(0, 0, 2.5, 0, Math.PI * 2)
        ctx.fill()
        if (type === 'executioner') {
          // Blade tip on the execute round.
          const tip = memoPath('execTip', () => polyPath([[2, -3], [7, 0], [2, 3]]))
          ctx.fillStyle = light
          ctx.fill(tip)
        }
        break
      }
      case 'piercer': {
        // A lance, not a dot: long white-hot rail segment.
        ctx.strokeStyle = hexAlpha(accent, 0.55)
        ctx.lineWidth = 4
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(-24, 0)
        ctx.lineTo(4, 0)
        ctx.stroke()
        ctx.strokeStyle = PALETTE.white
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(-24, 0)
        ctx.lineTo(6, 0)
        ctx.stroke()
        ctx.drawImage(glowSprite(accent), -8, -8, 16, 16)
        break
      }
      case 'splash':
      case 'cluster':
      case 'siege': {
        const shellR = type === 'siege' ? 5.5 : 4.5
        ctx.drawImage(glowSprite(accent), -14, -14, 28, 28)
        ctx.globalAlpha = 0.35
        ctx.fillStyle = accent
        ctx.beginPath()
        ctx.arc(-6, 0, 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 0.15
        ctx.beginPath()
        ctx.arc(-12, 0, 2, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.fillStyle = accent
        ctx.beginPath()
        ctx.arc(0, 0, shellR, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = light
        ctx.lineWidth = 1
        ctx.stroke()
        break
      }
      case 'slow':
      case 'deep_freeze': {
        const s = type === 'deep_freeze' ? 1.5 : 1
        ctx.strokeStyle = hexAlpha(accent, 0.5)
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(-10 * s, 0)
        ctx.lineTo(-3 * s, 0)
        ctx.stroke()
        ctx.rotate(t * 12 + projectile.id)
        const shard = memoPath(`slowShard:${s}`, () => polyPath([[5 * s, 0], [0, -3 * s], [-5 * s, 0], [0, 3 * s]]))
        ctx.fillStyle = light
        ctx.fill(shard)
        ctx.strokeStyle = accent
        ctx.lineWidth = 1
        ctx.stroke(shard)
        break
      }
      case 'tesla': {
        // Spark bolt: flickering star + short crackle tail.
        const flick = Math.sin(t * 40 + projectile.id * 3)
        ctx.strokeStyle = hexAlpha(accent, 0.6)
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(-12, 0)
        ctx.lineTo(-7, flick * 2)
        ctx.lineTo(-3, 0)
        ctx.stroke()
        ctx.drawImage(glowSprite(accent), -10, -10, 20, 20)
        ctx.save()
        ctx.rotate(t * 10 + projectile.id)
        const spark = memoPath('spark', () => polyPath([[5, 0], [1.5, -1.5], [0, -5], [-1.5, -1.5], [-5, 0], [-1.5, 1.5], [0, 5], [1.5, 1.5]]))
        ctx.fillStyle = PALETTE.white
        ctx.fill(spark)
        ctx.strokeStyle = accent
        ctx.lineWidth = 1
        ctx.stroke(spark)
        ctx.restore()
        break
      }
      case 'breach': {
        // Heavier tracer than pulse.
        ctx.strokeStyle = hexAlpha(accent, 0.8)
        ctx.lineWidth = 3.5
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(-11, 0)
        ctx.lineTo(-2, 0)
        ctx.stroke()
        ctx.drawImage(glowSprite(accent), -12, -12, 24, 24)
        ctx.fillStyle = PALETTE.white
        ctx.beginPath()
        ctx.arc(0, 0, 3.5, 0, Math.PI * 2)
        ctx.fill()
        break
      }
      case 'barrage': {
        // Small dart — three of these fly per volley.
        const dart = memoPath('dart', () => polyPath([[5, 0], [-4, -2.5], [-4, 2.5]]))
        ctx.fillStyle = accent
        ctx.fill(dart)
        ctx.strokeStyle = light
        ctx.lineWidth = 1
        ctx.stroke(dart)
        ctx.drawImage(glowSprite(accent), -8, -8, 16, 16)
        break
      }
      default: // basic
        ctx.strokeStyle = hexAlpha(TOWER_COLORS.basic, 0.7)
        ctx.lineWidth = 2
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(-10, 0)
        ctx.lineTo(-2, 0)
        ctx.stroke()
        ctx.drawImage(glowSprite(TOWER_COLORS.basic), -12, -12, 24, 24)
        ctx.fillStyle = PALETTE.white
        ctx.beginPath()
        ctx.arc(0, 0, 3, 0, Math.PI * 2)
        ctx.fill()
        break
    }
    ctx.restore()
  }

  const MUZZLE_OFFSET: Record<string, number> = {
    basic: 18, sniper: 24, splash: 12, slow: 15, tesla: 16,
    breach: 17, barrage: 18, piercer: 30, executioner: 28,
    cluster: 12, siege: 18, deep_freeze: 19,
  }

  const drawMuzzleFlash = (ctx: CanvasRenderingContext2D, flash: MuzzleFlash, towerByCell: Map<string, Tower>) => {
    const i = Math.max(0, Math.min(flash.duration / 0.1, 1))
    const tower = towerByCell.get(`${flash.position.x},${flash.position.y}`)
    const type = tower?.tower_type ?? 'basic'
    const accent = TOWER_COLORS[type] || TOWER_COLORS.basic
    const cx = flash.position.x * CELL_SIZE + CELL_SIZE / 2
    const cy = flash.position.y * CELL_SIZE + CELL_SIZE / 2

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(tower?.rotation ?? 0)
    ctx.translate(MUZZLE_OFFSET[type] ?? 18, 0)
    ctx.globalAlpha = i
    ctx.drawImage(glowSprite(accent), -10 * i, -10 * i, 20 * i, 20 * i)
    for (const [dx, dy, len] of [[1, 0, 10 * i], [0, 1, 5 * i], [0, -1, 5 * i]]) {
      ctx.strokeStyle = accent
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(dx * len, dy * len)
      ctx.stroke()
      ctx.strokeStyle = PALETTE.white
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(dx * len, dy * len)
      ctx.stroke()
    }
    ctx.restore()
    ctx.globalAlpha = 1
  }

  const drawExplosion = (ctx: CanvasRenderingContext2D, explosion: Explosion) => {
    const x = explosion.position.x * CELL_SIZE + CELL_SIZE / 2
    const y = explosion.position.y * CELL_SIZE + CELL_SIZE / 2
    const isAOE = explosion.radius > 0.6 // server: standard 0.5 / AOE ≥ 1.5
    const life = isAOE ? 0.4 : 0.3
    const p = Math.max(0, Math.min(1 - explosion.duration / life, 1))

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    if (isAOE) {
      const R = explosion.radius * CELL_SIZE
      ctx.strokeStyle = hexAlpha(TOWER_COLORS.splash, 1 - p)
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(x, y, R * (0.35 + 0.65 * p), 0, Math.PI * 2)
      ctx.stroke()
      ctx.strokeStyle = hexAlpha('#FF9E2C', (1 - p) * 0.6)
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(x, y, R * (0.35 + 0.65 * p) * 0.7, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = hexAlpha(TOWER_LIGHT.splash, (1 - p) * 0.5)
      ctx.beginPath()
      ctx.arc(x, y, R * 0.3 * (1 - p), 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = hexAlpha(TOWER_COLORS.splash, 1 - p)
      const ringR = R * (0.35 + 0.65 * p)
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 + explosion.id
        ctx.beginPath()
        ctx.arc(x + ringR * Math.cos(a), y + ringR * Math.sin(a), 2, 0, Math.PI * 2)
        ctx.fill()
      }
    } else {
      ctx.strokeStyle = `rgba(255, 255, 255, ${1 - p})`
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(x, y, 4 + 10 * p, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = '#FFD166'
      ctx.globalAlpha = 1 - p
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2 + explosion.id
        const d = 4 + 12 * p
        ctx.beginPath()
        ctx.arc(x + d * Math.cos(a), y + d * Math.sin(a), 1.5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = (1 - p) * 0.4
      ctx.drawImage(glowSprite(PALETTE.white), x - 13, y - 13, 26, 26)
      ctx.globalAlpha = 1
    }
    ctx.restore()
  }

  // Boss beam-down: a narrowing vertical light streak that collapses onto
  // the spawn cell, plus a ground bloom. One gradient + one sprite blit per
  // boss per frame for ~0.5s — no particle system, per the Phase 19 scope.
  const drawBossBeam = (ctx: CanvasRenderingContext2D, pos: Position, p: number) => {
    const x = pos.x * CELL_SIZE + CELL_SIZE / 2
    const y = pos.y * CELL_SIZE + CELL_SIZE / 2
    const fade = 1 - p
    const accent = ENEMY_COLORS.boss
    const h = 130
    const w = 2 + 10 * fade

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const grad = ctx.createLinearGradient(0, y - h, 0, y)
    grad.addColorStop(0, hexAlpha(accent, 0))
    grad.addColorStop(1, hexAlpha(accent, 0.75 * fade))
    ctx.fillStyle = grad
    ctx.fillRect(x - w / 2, y - h, w, h)
    // White-hot core line.
    ctx.fillStyle = hexAlpha(PALETTE.white, 0.85 * fade)
    ctx.fillRect(x - 1, y - h * 0.85, 2, h * 0.85)
    // Ground bloom where the boss materializes.
    ctx.globalAlpha = fade
    const bloom = 14 + 8 * fade
    ctx.drawImage(glowSprite(accent), x - bloom, y - bloom, bloom * 2, bloom * 2)
    ctx.restore()
  }

  const drawReticle = (ctx: CanvasRenderingContext2D, enemy: Enemy, accent: string) => {
    const x = enemy.position.x * CELL_SIZE + CELL_SIZE / 2
    const y = enemy.position.y * CELL_SIZE + CELL_SIZE / 2
    const h = (ENEMY_RADIUS[enemy.enemy_type] ?? 10) + 5
    ctx.strokeStyle = hexAlpha(accent, 0.8)
    ctx.lineWidth = 1.25
    ctx.beginPath()
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const cx = x + sx * h
      const cy = y + sy * h
      ctx.moveTo(cx - sx * 4, cy)
      ctx.lineTo(cx, cy)
      ctx.lineTo(cx, cy - sy * 4)
    }
    ctx.stroke()
  }

  // ——— input ———

  const cellFromEvent = (e: React.MouseEvent<HTMLCanvasElement>): Position | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = Math.floor((e.clientX - rect.left) / CELL_SIZE)
    const y = Math.floor((e.clientY - rect.top) / CELL_SIZE)
    return x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT ? { x, y } : null
  }

  // Deduped by cell, not by event: a mousemove inside the current cell keeps
  // the previous object, so React skips the re-render and the path-block
  // check fires once per cell crossed instead of once per pixel of travel.
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    keyboardCursorRef.current = false
    const cell = cellFromEvent(e)
    setHoveredCell(prev => {
      if (prev === cell) return prev
      if (prev && cell && prev.x === cell.x && prev.y === cell.y) return prev
      return cell
    })
  }

  const handleMouseLeave = () => {
    if (!keyboardCursorRef.current) setHoveredCell(null)
  }

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    keyboardCursorRef.current = false
    // Use the click's own coordinates — the hover ref lags one render behind
    // and a fast move+click would act on the previous cell.
    actOnCell(cellFromEvent(e))
  }

  // Keyboard play on the focused board: arrow keys move a cursor cell (the
  // same hover state the mouse drives, so the ghost, range ring and
  // path-block preview all follow it), Enter acts on the cell exactly like a
  // click: select a tower there, or build the selected type.
  const handleBoardKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    }
    const move = moves[e.key]
    if (move) {
      e.preventDefault()
      keyboardCursorRef.current = true
      setHoveredCell(prev => {
        const from = prev ?? { x: Math.floor(GRID_WIDTH / 2), y: Math.floor(GRID_HEIGHT / 2) }
        return {
          x: Math.min(GRID_WIDTH - 1, Math.max(0, from.x + move[0])),
          y: Math.min(GRID_HEIGHT - 1, Math.max(0, from.y + move[1])),
        }
      })
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      actOnCell(hoveredCellRef.current)
    }
  }

  const handleBoardFocus = () => {
    if (!hoveredCellRef.current) {
      keyboardCursorRef.current = true
      setHoveredCell({ x: Math.floor(GRID_WIDTH / 2), y: Math.floor(GRID_HEIGHT / 2) })
    }
  }

  const handleBoardBlur = () => {
    if (keyboardCursorRef.current) setHoveredCell(null)
    keyboardCursorRef.current = false
  }

  const actOnCell = (hovered: Position | null) => {
    if (isRunOver) return
    const gs = liveStateRef.current
    const selType = selectedTowerTypeRef.current
    const currentTowers = gs?.towers || []
    const currentGold = gs?.gold ?? 0

    if (!hovered) return

    const clickedTower = currentTowers.find(
      t => t.position.x === hovered.x && t.position.y === hovered.y
    )

    if (clickedTower) {
      setSelectedTower(prev => prev?.id === clickedTower.id ? null : clickedTower)
      return
    }

    if (selectedTowerRef.current) {
      setSelectedTower(null)
      return
    }

    // Walls and the spawn/goal gates are not buildable (the server
    // enforces this too).
    const blocked =
      (gs?.obstacles ?? []).some(o => o.x === hovered.x && o.y === hovered.y) ||
      (gs?.spawn_point && gs.spawn_point.x === hovered.x && gs.spawn_point.y === hovered.y) ||
      (gs?.goal_point && gs.goal_point.x === hovered.x && gs.goal_point.y === hovered.y)

    // Sealing the lane is a server-side rejection, so the click needs the
    // server's answer for this cell first. No answer yet (hover check still
    // in flight, or the board changed a moment ago) is treated exactly like
    // a known-invalid cell: the click does nothing and the next frame's
    // ghost shows why.
    const pathOK = placementChecksRef.current.results.get(`${hovered.x},${hovered.y}`) === false

    if (isConnected && !blocked && selType !== null && currentGold >= TOWER_COSTS[selType]) {
      if (pathOK) {
        onPlaceTower(hovered.x, hovered.y, selType)
      } else {
        // No answer for this cell yet. Make sure one is on its way so the
        // retry click lands, rather than dying the same way.
        requestPlacementCheck(hovered.x, hovered.y)
      }
    }
  }

  const handleSellSelected = () => {
    if (selectedTower) {
      onSellTower(selectedTower.id)
      setSelectedTower(null)
    }
  }

  const handleUpgradeSelected = () => {
    if (selectedTower) {
      onUpgradeTower(selectedTower.id)
    }
  }

  hotkeyActionsRef.current = {
    upgrade: () => {
      if (selectedTower && !selectedTower.evolved && (selectedTower.level ?? 1) < 4) handleUpgradeSelected()
    },
    sell: handleSellSelected,
    startWave: () => {
      if (isConnected && !isWaveActive && !isRunOver) handleStartWave()
    },
  }

  const handleStartWave = () => {
    if (countdownTimerRef.current) clearTimeout(countdownTimerRef.current)
    countdownTimerRef.current = null
    setCountdown(null)
    onStartWave()
    if (autoWave) {
      // Same safety net as the countdown: a refused start re-arms Auto Wave.
      if (rearmTimerRef.current) clearTimeout(rearmTimerRef.current)
      rearmTimerRef.current = setTimeout(() => setAutoRearm(n => n + 1), 2000)
    }
  }

  const waveStatusLabel = () => {
    if (isRunOver) return null
    if (isWaveActive) {
      const alive = gameState?.enemies.length ?? 0
      const remaining = gameState?.enemies_remaining ?? 0
      return <span style={{ color: TOWER_COLORS.splash }}>WAVE {gameState?.wave} ACTIVE — {alive + remaining} HOSTILES LEFT</span>
    }
    if (countdown !== null) {
      return <span style={{ color: PALETTE.goal }}>NEXT WAVE IN {countdown}s… <button onClick={handleStartWave} className="btn btn-inline">SEND NOW ▸</button></span>
    }
    return <span style={{ color: PALETTE.hpHigh }}>WAVE {gameState?.wave} — READY</span>
  }

  const towerButtons = TOWER_ORDER

  const isEvolved = selectedTower?.evolved ?? false
  // Prices come from the server on every snapshot (sell_value, upgrade_cost,
  // evolve_cost), so the panel always shows what the server will actually
  // charge or pay. The live tower is read from the snapshot rather than the
  // selection copy, so a price change can't lag behind.
  const liveSelected = selectedTower ? gameState?.towers.find(t => t.id === selectedTower.id) ?? selectedTower : null
  const sellPrice = liveSelected?.sell_value ?? 0
  const upgradeCost = liveSelected?.upgrade_cost ?? 0
  const canAffordUpgrade = selectedTower ? gold >= upgradeCost : false
  const isMaxLevel = selectedTower ? (selectedTower.level ?? 1) >= 4 : false
  const evolveCost = liveSelected?.evolve_cost ?? 0
  // What one more upgrade changes, straight from the server's preview.
  const nextChanges = liveSelected?.next ? nextLevelChanges(liveSelected, liveSelected.next) : []
  const evolveOptions = selectedTower && !isEvolved && isMaxLevel
    ? EVOLUTION_OPTIONS[selectedTower.tower_type as BaseTowerType] ?? null
    : null

  return (
    <div className="game-canvas-container">
      {isGameOver && !showMapSelect && (
        <Dialog className="game-over-overlay" labelledBy="game-over-title">
          <div className="game-over-box panel">
            <div className="game-over-title" id="game-over-title">SIGNAL LOST</div>
            <p className="game-over-sub">
              You survived {(gameState?.wave ?? 1) - 1} wave{(gameState?.wave ?? 1) - 1 !== 1 ? 's' : ''}
              {gameState?.difficulty === 'harder' && ' — HARDER'}
            </p>
            <p className="game-over-score">SCORE {(gameState?.score ?? 0).toLocaleString()}</p>
            {isNewHighScore ? (
              <p className="game-over-best new-best">★ NEW HIGH SCORE ★</p>
            ) : (
              <p className="game-over-best">BEST {highScore.toLocaleString()}</p>
            )}
            <button
              onClick={() => onNewGame(undefined, gameState?.difficulty, gameState?.endless)}
              className="btn btn-primary btn-big"
            >
              REDEPLOY ▸
            </button>
            <button onClick={openMapSelect} className="btn btn-big">
              CHANGE MAP
            </button>
          </div>
        </Dialog>
      )}

      {isVictory && !showMapSelect && (
        <Dialog className="victory-overlay" labelledBy="victory-title">
          <div className="victory-box panel">
            <div className="victory-title" id="victory-title">ZONE SECURED</div>
            <p className="victory-sub">
              {GAME_MAPS.find(m => m.id === gameState?.map_id)?.name ?? 'ZONE'} held to wave{' '}
              {gameState?.wave ?? 0}{gameState?.difficulty === 'harder' && ' — HARDER'}
            </p>
            <p className="victory-score">SCORE {(gameState?.score ?? 0).toLocaleString()}</p>
            {isNewHighScore ? (
              <p className="victory-best new-best">★ NEW HIGH SCORE ★</p>
            ) : (
              <p className="victory-best">BEST {highScore.toLocaleString()}</p>
            )}
            <button onClick={onContinueEndless} className="btn btn-victory btn-big">
              CONTINUE (ENDLESS) ▸
            </button>
            <button onClick={openMapSelect} className="btn btn-big">
              MAP SELECT
            </button>
          </div>
        </Dialog>
      )}

      {showMapSelect && (() => {
        const pendingMap = GAME_MAPS.find(m => m.id === pendingMapId)
        const pendingBeaten = (pendingMap?.sequenceOrder ?? 99) <= furthestBeaten
        // Run settings only exist for beaten maps — an unbeaten map always
        // deploys as normal survival, whatever the toggles last said.
        const deployDifficulty: Difficulty = pendingBeaten ? pendingDifficulty : 'normal'
        const deployEndless = pendingBeaten ? pendingEndless : false
        return (
        <Dialog className="map-select-overlay" labelledBy="map-select-title" onClose={() => setShowMapSelect(false)}>
          <div className="map-select-box panel">
            <div className="map-select-title" id="map-select-title">SELECT DEPLOYMENT ZONE</div>
            <div className="map-select-grid">
              {GAME_MAPS_BY_SEQUENCE.map(m => {
                const locked = m.sequenceOrder > furthestBeaten + 1
                const beaten = m.sequenceOrder <= furthestBeaten
                return (
                  <button
                    key={m.id}
                    className={`map-card ${pendingMapId === m.id ? 'selected' : ''} ${locked ? 'locked' : ''}`}
                    onClick={() => setPendingMapId(m.id)}
                    disabled={locked}
                    title={locked ? 'Secure the previous zone to unlock' : m.tagline}
                  >
                    <span className="map-card-seq">{String(m.sequenceOrder).padStart(2, '0')}</span>
                    <MapThumb map={m} />
                    {locked && <span className="map-card-lock" role="img" aria-label="locked">🔒</span>}
                    <span className="map-card-name">
                      {m.name}
                      {!locked && gameState?.map_id === m.id && <span className="map-card-current"> ● ACTIVE</span>}
                    </span>
                    <span className="map-card-tag">
                      {locked ? 'SECURE PREVIOUS ZONE TO UNLOCK' : m.tagline}
                    </span>
                    <span className={`map-card-win ${beaten ? 'secured' : ''}`}>
                      {beaten ? '✓ SECURED · ' : ''}WIN: WAVE {m.winWave}
                    </span>
                  </button>
                )
              })}
            </div>
            {pendingBeaten ? (
              <div className="map-select-modes">
                <span className="mode-group">
                  <span className="mode-label">DIFFICULTY</span>
                  <button
                    className={`btn btn-inline ${deployDifficulty === 'normal' ? 'btn-toggled' : ''}`}
                    onClick={() => setPendingDifficulty('normal')}
                    aria-pressed={deployDifficulty === 'normal'}
                  >
                    NORMAL
                  </button>
                  <button
                    className={`btn btn-inline ${deployDifficulty === 'harder' ? 'btn-toggled' : ''}`}
                    onClick={() => setPendingDifficulty('harder')}
                    aria-pressed={deployDifficulty === 'harder'}
                    title="−30% gold per kill, bosses ×1.5 health"
                  >
                    HARDER
                  </button>
                </span>
                <span className="mode-group">
                  <span className="mode-label">MODE</span>
                  <button
                    className={`btn btn-inline ${!deployEndless ? 'btn-toggled' : ''}`}
                    onClick={() => setPendingEndless(false)}
                    aria-pressed={!deployEndless}
                    title={`Win by reaching wave ${pendingMap?.winWave}`}
                  >
                    SURVIVAL
                  </button>
                  <button
                    className={`btn btn-inline ${deployEndless ? 'btn-toggled' : ''}`}
                    onClick={() => setPendingEndless(true)}
                    aria-pressed={deployEndless}
                    title="No win wave — hold out as long as you can"
                  >
                    ENDLESS
                  </button>
                </span>
              </div>
            ) : (
              <p className="map-select-objective">
                OBJECTIVE: REACH WAVE {pendingMap?.winWave ?? '—'} — beating a zone unlocks the
                next one, plus HARDER and ENDLESS on this zone.
              </p>
            )}
            <div className="map-select-actions">
              <button
                className="btn btn-primary btn-big"
                onClick={() => {
                  onNewGame(pendingMapId, deployDifficulty, deployEndless)
                  setShowMapSelect(false)
                }}
                disabled={!isConnected || !pendingMap || pendingMap.sequenceOrder > furthestBeaten + 1}
              >
                DEPLOY ▸
              </button>
              <button className="btn" onClick={() => setShowMapSelect(false)}>CANCEL</button>
            </div>
            <p className="map-select-warn">Deploying starts a fresh run on the selected map.</p>
          </div>
        </Dialog>
        )
      })()}

      <p className="sr-only" role="status" aria-live="polite">
        {isVictory ? 'Zone secured.' : isGameOver ? 'Signal lost. Game over.'
          : isWaveActive ? `Wave ${gameState?.wave ?? 1} in progress.` : `Wave ${gameState?.wave ?? 1} ready.`}
      </p>
      <div className="game-info panel">
        <div className="info-item"><span className="label">Gold</span><span className="value gold">${gold}</span></div>
        <div className="info-item"><span className="label">Health</span><span className={`value ${(gameState?.health ?? 100) <= 30 ? 'health-low' : ''}`}>{gameState?.health ?? 100}</span></div>
        <div className="info-item"><span className="label">Score</span><span className="value">{(gameState?.score ?? 0).toLocaleString()}</span></div>
        <div className="info-item"><span className="label">Best</span><span className="value">{highScore.toLocaleString()}</span></div>
        <div className="info-item"><span className="label">Wave</span><span className="value">{String(gameState?.wave ?? 1).padStart(2, '0')}</span></div>
        <div className="info-item"><span className="label">Zone</span><span className="value">
          {GAME_MAPS.find(m => m.id === (gameState?.map_id ?? 'open'))?.name ?? '—'}
          {gameState?.difficulty === 'harder' && ' · HARDER'}
          {gameState?.endless && ' · ENDLESS'}
        </span></div>
        <div className="info-item"><span className="label">Link</span><span className={`value ${isConnected ? 'connected' : 'disconnected'}`}>{isConnected ? 'ONLINE' : 'OFFLINE'}</span></div>
      </div>

      <div className="wave-status">
        {waveStatusLabel()}
      </div>

      {!isRunOver && (gameState?.wave_preview?.length ?? 0) > 0 && (
        <div className="wave-preview panel">
          <span className="label">{isWaveActive ? 'THIS WAVE' : 'NEXT WAVE'}</span>
          {gameState!.wave_preview!.map(entry => (
            <span key={entry.enemy_type} className="wave-preview-entry">
              <EnemyGlyph type={entry.enemy_type} />
              <strong>×{entry.count}</strong>
            </span>
          ))}
        </div>
      )}

      <div className="tower-selection">
        {towerButtons.map((type, i) => {
          const cost = TOWER_COSTS[type]
          const canAfford = gold >= cost
          return (
            <button
              key={type}
              className={`tower-btn ${selectedTowerType === type ? 'selected' : ''} ${!canAfford ? 'cannot-afford' : ''}`}
              style={{ '--accent': TOWER_COLORS[type] } as React.CSSProperties}
              onClick={() => { setSelectedTowerType(type); setSelectedTower(null) }}
              disabled={isRunOver}
              title={`${canAfford ? `Select ${TOWER_NAMES[type]} tower` : `Not enough gold (need ${cost})`} — hotkey ${i + 1}`}
            >
              <span className="hotkey-hint">{i + 1}</span>
              <TowerIcon type={type} />
              <span>{TOWER_NAMES[type]}</span>
              <span className="cost" style={{ color: canAfford ? PALETTE.gold : PALETTE.danger }}>${cost}</span>
            </button>
          )
        })}
        <button
          className={`tower-btn tower-btn-none ${selectedTowerType === null ? 'selected' : ''}`}
          onClick={() => { setSelectedTowerType(null); setSelectedTower(null) }}
          disabled={isRunOver}
          title="Deselect tower — cursor mode (Esc)"
        >
          <span className="none-icon">∅</span>
          <span>None</span>
        </button>
      </div>

      {selectedTower && (
        <div className="selected-panel panel" style={{ '--accent': TOWER_COLORS[selectedTower.tower_type] } as React.CSSProperties}>
          <div className="selected-main">
            <div className="selected-name">
              <TowerIcon type={selectedTower.tower_type as TowerType} size={24} />
              <span>
                {TOWER_NAMES[selectedTower.tower_type]}{' '}
                {isEvolved ? (
                  <span className="evolved-badge">◆ EVOLVED</span>
                ) : (
                  <span className="selected-level">MK{selectedTower.level ?? 1}{isMaxLevel ? ' ★MAX' : ''}</span>
                )}
              </span>
            </div>
            {selectedTower.tower_type === 'cryo_field' || selectedTower.tower_type === 'amplifier' ? (
              <>
                <div className="selected-stat"><span className="label">Radius</span><span className="value">{selectedTower.range}</span></div>
                <div className="selected-stat"><span className="label">Effect</span><span className="value">
                  {selectedTower.tower_type === 'cryo_field' ? 'Slow 40%' : '+25% dmg·rate'}
                </span></div>
              </>
            ) : (
              <>
                <div className="selected-stat"><span className="label">Range</span><span className="value">{selectedTower.range}</span></div>
                <div className="selected-stat"><span className="label">{selectedTower.tower_type === 'laser' ? 'Dmg/s' : 'Damage'}</span><span className="value">{selectedTower.damage}</span></div>
                {selectedTower.tower_type !== 'laser' && (
                  <div className="selected-stat"><span className="label">Rate</span><span className="value">{selectedTower.fire_rate}/s</span></div>
                )}
                {specialStats(liveSelected ?? selectedTower).map(line => (
                  <div key={line.label} className="selected-stat"><span className="label">{line.label}</span><span className="value">{line.value}</span></div>
                ))}
              </>
            )}
            <button onClick={handleSellSelected} className="btn btn-danger">SELL ${sellPrice}</button>
            {!isEvolved && !isMaxLevel && (
              <button
                onClick={handleUpgradeSelected}
                disabled={!canAffordUpgrade}
                className="btn btn-gold"
                title={canAffordUpgrade ? `Upgrade to MK${(selectedTower.level ?? 1) + 1}` : `Need ${upgradeCost} to upgrade`}
                aria-describedby={nextChanges.length ? 'selected-next' : undefined}
              >
                UPGRADE ${upgradeCost}
              </button>
            )}
            <button onClick={() => setSelectedTower(null)} className="btn btn-close" aria-label="Close tower panel" title="Close (Esc)">✕</button>
          </div>

          {nextChanges.length > 0 && (
            <div className="selected-next" id="selected-next">
              <span className="selected-next-label">NEXT · MK{liveSelected?.next?.level}</span>
              {nextChanges.map(change => <span key={change} className="selected-next-item">{change}</span>)}
            </div>
          )}

          {evolveOptions && !evolveChoice && (
            <div className="evolve-row">
              <div className="evolve-title">EVOLVE <span className="evolve-warn">— permanent, pick one</span></div>
              <div className="evolve-options">
                {evolveOptions.map(evo => (
                  <button
                    key={evo}
                    className="evolve-option"
                    style={{ '--accent': TOWER_COLORS[evo] } as React.CSSProperties}
                    onClick={() => setEvolveChoice(evo)}
                    title={`${TOWER_NAMES[evo]} — $${evolveCost}`}
                  >
                    <TowerIcon type={evo} size={30} />
                    <span className="evolve-option-body">
                      <span className="evolve-option-name" style={{ color: TOWER_COLORS[evo] }}>{TOWER_NAMES[evo]}</span>
                      <span className="evolve-option-desc">{TOWER_DESCRIPTIONS[evo]}</span>
                    </span>
                    <span className="cost" style={{ color: gold >= evolveCost ? PALETTE.gold : PALETTE.danger }}>${evolveCost}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {evolveOptions && evolveChoice && (
            <div className="evolve-confirm" style={{ '--accent': TOWER_COLORS[evolveChoice] } as React.CSSProperties}>
              <TowerIcon type={evolveChoice} size={30} />
              <span className="evolve-confirm-text">
                Evolve into <strong style={{ color: TOWER_COLORS[evolveChoice] }}>{TOWER_NAMES[evolveChoice]}</strong> for{' '}
                <strong className="gold-text">${evolveCost}</strong>?
                <span className="evolve-warn"> Permanent — cannot be undone, upgraded, or re-evolved.</span>
              </span>
              <button
                className="btn btn-gold"
                disabled={gold < evolveCost}
                title={gold >= evolveCost ? 'Commit — this cannot be undone' : `Need $${evolveCost}`}
                onClick={() => {
                  onEvolveTower(selectedTower.id, evolveChoice)
                  setEvolveChoice(null)
                }}
              >
                CONFIRM ▸
              </button>
              <button className="btn" onClick={() => setEvolveChoice(null)}>CANCEL</button>
            </div>
          )}
        </div>
      )}

      <div className="canvas-frame">
        <canvas
          ref={canvasRef}
          width={GRID_WIDTH * CELL_SIZE}
          height={GRID_HEIGHT * CELL_SIZE}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          tabIndex={0}
          onKeyDown={handleBoardKeyDown}
          onFocus={handleBoardFocus}
          onBlur={handleBoardBlur}
          role="application"
          aria-label="Game board. Arrow keys move the cursor, Enter builds or selects. 1 to 5 pick a tower, U upgrades, S sells, Space starts the wave."
          style={{ cursor: isRunOver ? 'default' : 'crosshair', display: 'block' }}
        />
      </div>

      <div className="controls">
        <button
          className="btn btn-primary"
          onClick={handleStartWave}
          disabled={!isConnected || isWaveActive || isRunOver || countdown !== null}
          title={isWaveActive ? 'Wave already in progress' : 'Start the next wave'}
        >
          {isWaveActive ? 'WAVE ACTIVE…' : 'START WAVE ▸'}
        </button>
        <button
          className={`btn ${autoWave ? 'btn-toggled' : ''}`}
          onClick={() => setAutoWave(prev => !prev)}
          aria-pressed={autoWave}
          disabled={isRunOver}
          title="Automatically start next wave after 5 seconds"
        >
          AUTO: {autoWave ? 'ON' : 'OFF'}
        </button>
        <button className="btn" onClick={openMapSelect} disabled={!isConnected}>
          NEW GAME
        </button>
        <button
          className={`btn ${showGlossary ? 'btn-toggled' : ''}`}
          onClick={() => setShowGlossary(prev => !prev)}
          title="Enemy types, stats, and rewards"
        >
          GLOSSARY
        </button>
        {showDebug && (
          <button className="btn" onClick={onSpawnEnemy} disabled={!isConnected}>
            SPAWN TEST
          </button>
        )}
      </div>

      {showGlossary && (
        <div className="glossary panel">
          <div className="glossary-tabs">
            <button
              className={`glossary-tab ${glossaryTab === 'towers' ? 'active' : ''}`}
              onClick={() => setGlossaryTab('towers')}
            >
              TOWER REGISTRY
            </button>
            <button
              className={`glossary-tab ${glossaryTab === 'enemies' ? 'active' : ''}`}
              onClick={() => setGlossaryTab('enemies')}
            >
              HOSTILE REGISTRY
            </button>
          </div>

          {glossaryTab === 'enemies' ? (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Unit</th>
                    <th>HP</th>
                    <th>Speed</th>
                    <th>Gold</th>
                    <th>Score</th>
                    <th>Appears</th>
                  </tr>
                </thead>
                <tbody>
                  {ENEMY_GLOSSARY.map(enemy => (
                    <tr key={enemy.type}>
                      <td>
                        <span className="glossary-unit">
                          <EnemyGlyph type={enemy.type} size={18} />
                          <strong>{enemy.name}</strong>
                        </span>
                      </td>
                      <td>{enemy.health}</td>
                      <td>{enemy.speed}</td>
                      <td className="gold-text">+{enemy.gold}</td>
                      <td className="gold-text">{enemy.score}×wave</td>
                      <td>{enemy.appears}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="glossary-note">
                HP and speed scale up past wave 5. A boss appears every wave from 11 — another joins every 3rd wave (max 6).
              </div>
            </>
          ) : (
            <>
              <div className="glossary-towers">
                {TOWER_GLOSSARY.map(tw => (
                  <div key={tw.type} className="glossary-tower">
                    <div className="glossary-tower-head">
                      <span className="glossary-unit">
                        <TowerIcon type={tw.type} size={20} />
                        <strong style={{ color: TOWER_COLORS[tw.type] }}>{TOWER_NAMES[tw.type]}</strong>
                      </span>
                      <span className="gold-text">${TOWER_COSTS[tw.type]}</span>
                      <span>{tw.damage} dmg</span>
                      <span>{TOWER_RANGES[tw.type]} rng</span>
                      <span>{tw.rate}/s</span>
                    </div>
                    <div className="glossary-tower-note">
                      {TOWER_DESCRIPTIONS[tw.type]} {tw.upgradeNote}.
                    </div>
                    <div className="glossary-evos">
                      {EVOLUTION_OPTIONS[tw.type].map(evo => (
                        <div key={evo} className="glossary-evo">
                          <span className="glossary-unit">
                            <TowerIcon type={evo} size={17} />
                            <strong style={{ color: TOWER_COLORS[evo] }}>{TOWER_NAMES[evo]}</strong>
                          </span>
                          <span className="glossary-evo-stats">{EVO_STATS[evo]}</span>
                          <span className="glossary-evo-desc">{TOWER_DESCRIPTIONS[evo]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="glossary-note">
                Evolutions unlock at MK4 and cost 2× everything spent on the tower so far
                (the cost adds to its value — selling still refunds 70% of the total). Permanent: no undo, no further upgrades.
              </div>
            </>
          )}
        </div>
      )}

      <div className="info-box panel">
        <p>
          <span className="label">Towers</span> {gameState?.towers.length ?? 0}
          <span className="label sep">Hostiles</span> {gameState?.enemies.length ?? 0}
          <span className="label sep">Shots</span> {gameState?.projectiles.length ?? 0}
        </p>
        <p className="hint">
          {selectedTower
            ? 'Click elsewhere to deselect tower'
            : selectedTowerType === null
            ? 'Cursor mode — click a tower to select it'
            : 'Click a tower to select and upgrade/sell it, or click the grid to place'}
        </p>
      </div>
    </div>
  )
}

export default GameCanvas
