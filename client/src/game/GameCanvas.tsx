import { useCallback, useEffect, useRef, useState } from 'react'
import './GameCanvas.css'
import { SaveSummary, Tower, TowerType, BaseTowerType, EvolvedTowerType, Enemy, Position, GameState, Difficulty, PlacementCheckStore, TOWER_COSTS, EVOLUTION_OPTIONS, GRID_WIDTH, GRID_HEIGHT, CELL_SIZE, GAME_MAPS, GAME_MAPS_BY_SEQUENCE } from '../types/game'
import { settings } from '../settings'
import Dialog from '../ui/Dialog'
import { PALETTE, TOWER_COLORS, TOWER_RANGES, TOWER_NAMES, TOWER_DESCRIPTIONS, ENEMY_GLOSSARY, TOWER_GLOSSARY, EVO_STATS, TOWER_ORDER } from './theme'
import { HIGH_SCORE_KEY, readHighScore, FURTHEST_BEATEN_KEY, readFurthestBeaten } from './progress'
import { hexAlpha } from './shapes'
import { PLACE_ANIM_MS, easeOutBack, BEAM_MS, BEAM_BOSS_FADE_START, LOW_HEALTH_PULSE_THRESHOLD, LOW_HEALTH_PULSE_PERIOD_S, alertVignette, SHAKE_MS, SHAKE_AMP_PX } from './effects'
import { TowerIcon, EnemyGlyph, MapThumb } from './icons'
import { nextLevelChanges, specialStats } from './towerStats'
import { drawBulkheads, drawSpawnGate, drawGoalGate, drawRangeRing, drawAuraField, drawLaserBeam, drawArc, drawSelectionBrackets, drawHoverUnderlay, drawGhostTower, drawTower, drawEnemy, drawProjectile, drawMuzzleFlash, drawExplosion, drawBossBeam, drawReticle } from './draw'
import type { PathPreviewState } from './draw'

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
  // Signed-in player's map progress from the server; merged with this
  // browser's, keeping the further of the two.
  accountFurthest?: number
  // Signed-in player's autosaved run, offered on the map screen.
  savedRun?: SaveSummary | null
  loadError?: string | null
  onLoadSave?: () => void
}


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
  accountFurthest = 0,
  savedRun = null,
  loadError = null,
  onLoadSave,
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
  // An account can know further progress than this browser (another
  // device): adopt it, and keep it locally too.
  useEffect(() => {
    if (accountFurthest > furthestBeaten) {
      setFurthestBeaten(accountFurthest)
      try {
        localStorage.setItem(FURTHEST_BEATEN_KEY, String(accountFurthest))
      } catch {
        // storage unavailable: the account still remembers it
      }
    }
  }, [accountFurthest, furthestBeaten])

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

  // A saved run arriving on a fresh board (a new tab, a reconnect after the
  // room closed, a server restart) opens the map screen once for that save,
  // so Continue is right there. Cancelling it doesn't reopen it.
  const offeredSaveRef = useRef<string | null>(null)
  useEffect(() => {
    if (!savedRun || !isConnected || !gameState) return
    if (offeredSaveRef.current === savedRun.saved_at) return
    const fresh = phase === 'waiting' && gameState.wave === 1 && gameState.towers.length === 0 && gameState.score === 0
    if (!fresh) return
    offeredSaveRef.current = savedRun.saved_at
    setShowMapSelect(true)
  }, [savedRun, isConnected, gameState, phase])

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
    currentProjectiles.forEach(p => drawProjectile(ctx, p, t, towerTypeById, enemyById, projHeadingsRef.current, nextProjHeadings))
    projHeadingsRef.current = nextProjHeadings

    const nextEnemyHeadings = new Map<number, { x: number; y: number; angle: number }>()
    currentEnemies.forEach(enemy => {
      // Boss beam-down: streak first, then the boss fades in under it.
      // Bosses only (rare — every 3rd wave from 11, capped at 6): regular
      // enemy types spawn in dense bursts and get no per-unit animation.
      const beamStart = enemy.enemy_type === 'boss' ? bossBeamAnimsRef.current.get(enemy.id) : undefined
      if (beamStart === undefined) {
        drawEnemy(ctx, enemy, t, enemyHeadingsRef.current, nextEnemyHeadings)
        return
      }
      const p = (nowMs - beamStart) / BEAM_MS
      if (p >= 1) {
        bossBeamAnimsRef.current.delete(enemy.id)
        drawEnemy(ctx, enemy, t, enemyHeadingsRef.current, nextEnemyHeadings)
        return
      }
      if (p > BEAM_BOSS_FADE_START) {
        ctx.save()
        ctx.globalAlpha = (p - BEAM_BOSS_FADE_START) / (1 - BEAM_BOSS_FADE_START)
        drawEnemy(ctx, enemy, t, enemyHeadingsRef.current, nextEnemyHeadings)
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
            {savedRun && onLoadSave && (
              <div className="map-select-continue">
                <span>
                  SAVED RUN · {GAME_MAPS.find(m => m.id === savedRun.map_id)?.name ?? savedRun.map_id} · WAVE {savedRun.wave}
                  {savedRun.difficulty === 'harder' && ' · HARDER'}
                  {savedRun.endless && ' · ENDLESS'}
                </span>
                <button
                  className="btn btn-primary"
                  onClick={() => { onLoadSave(); setShowMapSelect(false) }}
                  disabled={!isConnected}
                  title="Pick up exactly where you left off (starts paused)"
                >
                  CONTINUE ▸
                </button>
              </div>
            )}
            {loadError && <p className="account-error" role="alert">{loadError}</p>}
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
            <p className="map-select-warn">
              Deploying starts a fresh run on the selected map{savedRun ? ' and replaces your saved run' : ''}.
            </p>
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
