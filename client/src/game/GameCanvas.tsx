import { useEffect, useRef, useState } from 'react'
import './GameCanvas.css'
import {
  Tower, TowerType, Enemy, EnemyType, Projectile, MuzzleFlash, Explosion, Position,
  GameState, TOWER_COSTS, GRID_WIDTH, GRID_HEIGHT, CELL_SIZE,
} from '../types/game'

// ————————————————————————————————————————————————————————————————————————
// "NEON IRONLINE" visual theme.
// The one rule: SHAPE is the discriminator, hue is the garnish. Towers are
// static closed hardware polygons (cool accents); enemies are pointed,
// heading-rotated glyphs (warm accents). The design survives grayscale.
// ————————————————————————————————————————————————————————————————————————

const PALETTE = {
  bgDeep: '#04070F',
  bgNavy: '#0A1428',
  bgGlow: '#10223E',
  gridMinor: '#101E33',
  gridMajor: '#16283F',
  gridNode: '#22395C',
  wallFillHi: '#0D1A2E',
  wallFillLo: '#0A1322',
  wallEdge: '#2E5E8F',
  wallInner: '#16406B',
  wallHatch: '#14263E',
  wallNode: '#46A8FF',
  hazard: '#B8860B',
  platefill: '#0B1526',
  turretMetal: '#0E2230',
  spawn: '#FF4655',
  spawnLight: '#FF8A94',
  goal: '#00E5FF',
  goalLight: '#7DF3FF',
  hpHigh: '#35F58C',
  hpMid: '#FFC533',
  hpLow: '#FF3B4E',
  hpTrack: '#0A101C',
  hpBorder: '#23324D',
  slowRing: '#3D8BFF',
  slowCrystal: '#BFE0FF',
  danger: '#FF4655',
  text: '#D9E8FF',
  textDim: '#7C90B0',
  gold: '#FFD60A',
  white: '#FFFFFF',
}

// Tower accents (cool faction) — used by the canvas AND the HTML buttons.
const TOWER_COLORS: Record<string, string> = {
  basic: '#00E5FF',
  sniper: '#B388FF',
  splash: '#FFD60A',
  slow: '#3D8BFF',
}

const TOWER_LIGHT: Record<string, string> = {
  basic: '#9FF6FF',
  sniper: '#DCC8FF',
  splash: '#FFF3B0',
  slow: '#A6CFFF',
}

const TOWER_RANGES: Record<string, number> = {
  basic: 3.0,
  sniper: 6.0,
  splash: 2.5,
  slow: 3.5,
}

const TOWER_NAMES: Record<string, string> = {
  basic: 'Pulse',
  sniper: 'Railgun',
  splash: 'Mortar',
  slow: 'Stasis',
}

// Enemy accents (warm faction) — single source for canvas + legend + preview.
const ENEMY_COLORS: Record<string, string> = {
  basic: '#FF4655',
  fast: '#FF9E2C',
  tank: '#C7502E',
  flying: '#44ff99',
  boss: '#FF2ED2',
}

const ENEMY_BODY: Record<string, string> = {
  basic: '#2A0E14',
  fast: '#291606',
  tank: '#200D08',
  flying: '#0E2A1C',
  boss: '#230A1E',
}

// Visual radius per enemy type (px) — drives reticles, bars, stasis cages.
const ENEMY_RADIUS: Record<string, number> = {
  basic: 10,
  fast: 9,
  tank: 15,
  flying: 10,
  boss: 18,
}

// Enemy stat sheet — kept in sync with server getEnemyStats/getEnemyGoldReward/getEnemyScorePoints.
// 'flying' is omitted: it exists in server stats but never spawns in any wave.
const ENEMY_GLOSSARY: { type: EnemyType, name: string, health: number, speed: number, gold: number, score: number, appears: string }[] = [
  { type: 'basic', name: 'Dart', health: 100, speed: 2.0, gold: 10, score: 10, appears: 'Wave 1+' },
  { type: 'fast', name: 'Needle', health: 50, speed: 4.0, gold: 8, score: 15, appears: 'Wave 4+' },
  { type: 'tank', name: 'Bastion', health: 300, speed: 1.0, gold: 25, score: 30, appears: 'Wave 7+' },
  { type: 'boss', name: 'Dreadnought', health: 1000, speed: 0.5, gold: 100, score: 100, appears: 'Wave 11+' },
]

const HIGH_SCORE_KEY = 'rustRushHighScore'

const readHighScore = (): number => {
  try {
    const parsed = parseInt(localStorage.getItem(HIGH_SCORE_KEY) ?? '0', 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  } catch {
    return 0
  }
}

// ————————————————————————————————————————————————————————————————————————
// Cached geometry (Path2D, local coords, forward = +x) and glow sprites.
// Built once at module load; per-entity drawing is translate/rotate + fill.
// ————————————————————————————————————————————————————————————————————————

const polyPath = (pts: number[][]): Path2D => {
  const p = new Path2D()
  p.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1])
  p.closePath()
  return p
}

const regularPolyPath = (r: number, sides: number, rot = 0): Path2D => {
  const pts: number[][] = []
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * 2 * Math.PI) / sides
    pts.push([r * Math.cos(a), r * Math.sin(a)])
  }
  return polyPath(pts)
}

const scalePts = (pts: number[][], s: number) => pts.map(([x, y]) => [x * s, y * s])

const TANK_HULL = [[15, 0], [7, -11], [-10, -11], [-15, 0], [-10, 11], [7, 11]]

const SHAPES = {
  towerBase: {
    basic: regularPolyPath(14, 8, Math.PI / 8),
    sniper: polyPath([[0, -15], [15, 0], [0, 15], [-15, 0]]),
    splash: polyPath([[-14, -9], [-9, -14], [9, -14], [14, -9], [14, 9], [9, 14], [-9, 14], [-14, 9]]),
    slow: regularPolyPath(14, 6, -Math.PI / 2),
  } as Record<string, Path2D>,
  towerBaseInset: {
    basic: regularPolyPath(12, 8, Math.PI / 8),
    sniper: polyPath([[0, -13], [13, 0], [0, 13], [-13, 0]]),
    splash: polyPath(scalePts([[-14, -9], [-9, -14], [9, -14], [14, -9], [14, 9], [9, 14], [-9, 14], [-14, 9]], 12 / 14)),
    slow: regularPolyPath(12, 6, -Math.PI / 2),
  } as Record<string, Path2D>,
  enemy: {
    basic: polyPath([[10, 0], [-8, -7], [-4, 0], [-8, 7]]),
    fast: polyPath([[11, 0], [-7, -5], [-2, 0], [-7, 5]]),
    tank: polyPath(TANK_HULL),
    tankInner: polyPath(scalePts(TANK_HULL, 0.62)),
    flying: polyPath([[9, 0], [0, -6], [-9, 0], [0, 6]]),
    boss: regularPolyPath(12, 8, Math.PI / 8),
  } as Record<string, Path2D>,
}

const glowSpriteCache = new Map<string, HTMLCanvasElement>()
const hexAlpha = (hex: string, a: number): string => {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

const glowSprite = (color: string): HTMLCanvasElement => {
  let s = glowSpriteCache.get(color)
  if (!s) {
    s = document.createElement('canvas')
    s.width = 32
    s.height = 32
    const g = s.getContext('2d')!
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16)
    grad.addColorStop(0, hexAlpha(color, 0.55))
    grad.addColorStop(0.35, hexAlpha(color, 0.2))
    grad.addColorStop(1, hexAlpha(color, 0))
    g.fillStyle = grad
    g.fillRect(0, 0, 32, 32)
    glowSpriteCache.set(color, s)
  }
  return s
}

const roundRectPath = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

const shortestAngleDelta = (a: number): number => {
  let d = a % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

// ————————————————————————————————————————————————————————————————————————
// Inline SVG silhouettes — the HTML buttons and legends share the canvas
// shape language, so the UI teaches shapes, not hues.
// ————————————————————————————————————————————————————————————————————————

const TowerIcon = ({ type, size = 20 }: { type: TowerType, size?: number }) => {
  const c = TOWER_COLORS[type]
  const common = { fill: PALETTE.platefill, stroke: c, strokeWidth: 2 }
  return (
    <svg width={size} height={size} viewBox="-20 -20 40 40" aria-hidden="true">
      {type === 'basic' && (<>
        <polygon points="12.9,5.4 5.4,12.9 -5.4,12.9 -12.9,5.4 -12.9,-5.4 -5.4,-12.9 5.4,-12.9 12.9,-5.4" {...common} />
        <rect x="2" y="-3" width="15" height="6" fill={c} stroke="none" />
      </>)}
      {type === 'sniper' && (<>
        <polygon points="0,-15 15,0 0,15 -15,0" {...common} />
        <rect x="1" y="-3" width="18" height="2" fill={c} stroke="none" />
        <rect x="1" y="1" width="18" height="2" fill={c} stroke="none" />
      </>)}
      {type === 'splash' && (<>
        <polygon points="-14,-9 -9,-14 9,-14 14,-9 14,9 9,14 -9,14 -14,9" {...common} />
        <rect x="0" y="-5" width="12" height="10" fill={c} stroke="none" />
      </>)}
      {type === 'slow' && (<>
        <polygon points="0,-14 12.1,-7 12.1,7 0,14 -12.1,7 -12.1,-7" {...common} />
        <polygon points="5,-2.5 14,0 5,2.5" fill={c} stroke="none" />
        <polygon points="-1.3,3.9 -7,12.1 -4.6,2.9" fill={c} stroke="none" />
        <polygon points="-4.6,-2.9 -7,-12.1 -1.3,-3.9" fill={c} stroke="none" />
      </>)}
    </svg>
  )
}

const EnemyGlyph = ({ type, size = 14 }: { type: string, size?: number }) => {
  const c = ENEMY_COLORS[type] ?? PALETTE.danger
  const body = ENEMY_BODY[type] ?? '#1A0A0E'
  return (
    <svg width={size} height={size} viewBox="-16 -16 32 32" aria-hidden="true">
      {type === 'basic' && <polygon points="10,0 -8,-7 -4,0 -8,7" fill={body} stroke={c} strokeWidth="2" />}
      {type === 'fast' && <polygon points="13,0 -9,-6 -3,0 -9,6" fill={body} stroke={c} strokeWidth="2" />}
      {type === 'tank' && (<>
        <polygon points="12,0 5.6,-8.8 -8,-8.8 -12,0 -8,8.8 5.6,8.8" fill={body} stroke={c} strokeWidth="2" />
        <polygon points="7.4,0 3.5,-5.5 -5,-5.5 -7.4,0 -5,5.5 3.5,5.5" fill="none" stroke={c} strokeWidth="1" opacity="0.7" />
      </>)}
      {type === 'boss' && (<>
        <polygon points="9.2,3.8 3.8,9.2 -3.8,9.2 -9.2,3.8 -9.2,-3.8 -3.8,-9.2 3.8,-9.2 9.2,-3.8" fill={body} stroke={c} strokeWidth="2" />
        <circle r="2.5" fill="#FFFFFF" />
      </>)}
    </svg>
  )
}

interface GameCanvasProps {
  isConnected: boolean
  onPlaceTower: (x: number, y: number, towerType: string) => void
  onSellTower: (towerId: number) => void
  onUpgradeTower: (towerId: number) => void
  onStartWave: () => void
  onNewGame: () => void
  onSpawnEnemy?: () => void
  gameState?: GameState
  // Newest snapshot, updated on every server message (60/sec). The canvas
  // draws from this so it stays smooth while the React tree re-renders at
  // the throttled gameState cadence.
  liveStateRef: React.MutableRefObject<GameState>
  showDebug?: boolean
}

const GameCanvas = ({
  isConnected,
  onPlaceTower,
  onSellTower,
  onUpgradeTower,
  onStartWave,
  onNewGame,
  onSpawnEnemy,
  gameState,
  liveStateRef,
  showDebug,
}: GameCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number>()
  const hoveredCellRef = useRef<Position | null>(null)
  const selectedTowerTypeRef = useRef<TowerType | null>('basic')
  const selectedTowerRef = useRef<Tower | null>(null)
  // Canvas-only state: pre-rendered static background and per-entity headings
  // (computed from movement deltas — the server doesn't send facing angles).
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const bgKeyRef = useRef('')
  const enemyHeadingsRef = useRef<Map<number, { x: number; y: number; angle: number }>>(new Map())
  const projHeadingsRef = useRef<Map<number, { x: number; y: number; angle: number }>>(new Map())

  const [hoveredCell, setHoveredCell] = useState<Position | null>(null)
  const [selectedTowerType, setSelectedTowerType] = useState<TowerType | null>('basic')
  const [selectedTower, setSelectedTower] = useState<Tower | null>(null)
  const [autoWave, setAutoWave] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [highScore, setHighScore] = useState<number>(() => readHighScore())
  const [isNewHighScore, setIsNewHighScore] = useState(false)
  const prevPhaseRef = useRef<string>('waiting')
  const [showGlossary, setShowGlossary] = useState(false)

  // Sync refs (game state itself arrives via liveStateRef at full rate)
  hoveredCellRef.current = hoveredCell
  selectedTowerTypeRef.current = selectedTowerType
  selectedTowerRef.current = selectedTower

  const phase = gameState?.phase || 'waiting'
  const gold = gameState?.gold ?? 200
  const isWaveActive = phase === 'active'
  const isGameOver = phase === 'game_over'

  // Auto wave countdown logic
  useEffect(() => {
    if (!autoWave || isWaveActive || isGameOver || !isConnected) return

    setCountdown(5)
    const tick = setInterval(() => {
      setCountdown(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(tick)
          setCountdown(null)
          onStartWave()
          return null
        }
        return prev - 1
      })
    }, 1000)

    countdownRef.current = tick
    return () => clearInterval(tick)
  }, [autoWave, isWaveActive, isGameOver, isConnected, onStartWave])

  // Clear countdown if wave starts manually or game over
  useEffect(() => {
    if (isWaveActive || isGameOver) {
      if (countdownRef.current) clearInterval(countdownRef.current)
      setCountdown(null)
    }
  }, [isWaveActive, isGameOver])

  // Persist high score on the transition into game over
  useEffect(() => {
    if (phase === 'game_over' && prevPhaseRef.current !== 'game_over') {
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
    } else if (phase !== 'game_over' && prevPhaseRef.current === 'game_over') {
      // Clear on leaving game over so a later, lower-scoring run can't paint
      // a stale "New High Score!" frame before the effect re-evaluates.
      setIsNewHighScore(false)
    }
    prevPhaseRef.current = phase
    // prevPhaseRef gates the body to phase *transitions*, so the extra
    // score/highScore re-runs are no-ops.
  }, [phase, gameState?.score, highScore])

  // Deselect tower if it no longer exists (was sold or cleared)
  // Also sync selected tower stats when server broadcasts an update (e.g. after upgrade)
  useEffect(() => {
    if (selectedTower) {
      const updated = gameState?.towers.find(t => t.id === selectedTower.id)
      if (!updated) {
        setSelectedTower(null)
      } else if (updated.level !== selectedTower.level || updated.damage !== selectedTower.damage) {
        setSelectedTower(updated)
      }
    }
  }, [gameState?.towers, selectedTower])

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
    const currentIsGameOver = currentPhase === 'game_over'
    const t = performance.now() / 1000

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

    // 3. Range rings + hover underlay go under the entities.
    const liveSel = selTower ? currentTowers.find(tw => tw.id === selTower.id) : undefined
    if (liveSel) {
      drawRangeRing(ctx, liveSel.position, liveSel.range, TOWER_COLORS[liveSel.tower_type], t, 0.7)
    }
    let hoverBlocked = false
    const hoverPlacing = hovered && !currentIsGameOver && !selTower && selType !== null &&
      !towerByCell.has(`${hovered.x},${hovered.y}`)
    if (hoverPlacing && hovered && selType) {
      hoverBlocked =
        (gs?.obstacles ?? []).some(o => o.x === hovered.x && o.y === hovered.y) ||
        (gs?.spawn_point?.x === hovered.x && gs?.spawn_point?.y === hovered.y) ||
        (gs?.goal_point?.x === hovered.x && gs?.goal_point?.y === hovered.y)
      const canAfford = currentGold >= TOWER_COSTS[selType]
      drawHoverUnderlay(ctx, hovered, selType, t, hoverBlocked || !canAfford)
    }

    // 4. Entities.
    currentTowers.forEach(tower => drawTower(ctx, tower, t, 1))
    const nextProjHeadings = new Map<number, { x: number; y: number; angle: number }>()
    currentProjectiles.forEach(p => drawProjectile(ctx, p, t, towerTypeById, enemyById, nextProjHeadings))
    projHeadingsRef.current = nextProjHeadings

    const nextEnemyHeadings = new Map<number, { x: number; y: number; angle: number }>()
    currentEnemies.forEach(enemy => drawEnemy(ctx, enemy, t, nextEnemyHeadings))
    enemyHeadingsRef.current = nextEnemyHeadings

    // 5. Effects.
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
      drawGhostTower(ctx, hovered, selType, t, hoverBlocked, currentGold >= TOWER_COSTS[selType])
    }
  }
  renderRef.current = render

  // ——— static background (rendered once per map) ———

  const ensureBackground = (gs?: GameState): HTMLCanvasElement => {
    const obstacles = gs?.obstacles ?? []
    const key = `${obstacles.length}|${gs?.spawn_point?.x},${gs?.spawn_point?.y}|${gs?.goal_point?.x},${gs?.goal_point?.y}`
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
    ctx.stroke(regularPolyPath(8, 6, 0))
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
    ctx.stroke(regularPolyPath(8, 6, 0))
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

  const drawHoverUnderlay = (ctx: CanvasRenderingContext2D, pos: Position, towerType: TowerType, t: number, invalid: boolean) => {
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
    if (!invalid) {
      drawRangeRing(ctx, pos, TOWER_RANGES[towerType], accent, t, 0.4)
    }
  }

  const drawGhostTower = (ctx: CanvasRenderingContext2D, pos: Position, towerType: TowerType, t: number, blocked: boolean, canAfford: boolean) => {
    const invalid = blocked || !canAfford
    ctx.globalAlpha = invalid ? 0.25 : 0.45
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
      const px = pos.x * CELL_SIZE
      const py = pos.y * CELL_SIZE
      ctx.strokeStyle = PALETTE.danger
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(px + 6, py + 6)
      ctx.lineTo(px + CELL_SIZE - 6, py + CELL_SIZE - 6)
      ctx.stroke()
    }
  }

  // ——— towers ———

  const drawTower = (ctx: CanvasRenderingContext2D, tower: Tower, t: number, alphaScale: number) => {
    const x = tower.position.x * CELL_SIZE + CELL_SIZE / 2
    const y = tower.position.y * CELL_SIZE + CELL_SIZE / 2
    const type = tower.tower_type
    const accent = TOWER_COLORS[type] || TOWER_COLORS.basic
    const light = TOWER_LIGHT[type] || PALETTE.white
    const level = tower.level || 1
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
    if (level >= 4) {
      ctx.strokeStyle = hexAlpha(PALETTE.white, 0.8)
      ctx.lineWidth = 1
      ctx.stroke(SHAPES.towerBaseInset[type] || SHAPES.towerBaseInset.basic)
    }

    // Slow tower ambient ring: dashed crawl (the tower's motion accent).
    if (type === 'slow') {
      ctx.strokeStyle = hexAlpha(TOWER_LIGHT.slow, 0.5)
      ctx.lineWidth = 1
      ctx.setLineDash([3, 5])
      ctx.lineDashOffset = -((t * 6) % 8)
      ctx.beginPath()
      ctx.arc(0, 0, 13, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.lineDashOffset = 0
    }

    // Turret: rotates toward the target and scales up with level.
    ctx.rotate(tower.rotation || 0)
    const s = 1 + 0.06 * (level - 1)
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
          const vane = polyPath([[6, -3], [15, 0], [6, 3]])
          ctx.fill(vane)
          ctx.stroke(vane)
          ctx.restore()
        }
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
    ctx.restore()

    // Slow tower static snowflake overlay (screen frame, not rotated).
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

  // ——— enemies ———

  const drawEnemy = (ctx: CanvasRenderingContext2D, enemy: Enemy, t: number, next: Map<number, { x: number; y: number; angle: number }>) => {
    const x = enemy.position.x * CELL_SIZE + CELL_SIZE / 2
    const y = enemy.position.y * CELL_SIZE + CELL_SIZE / 2
    const type = enemy.enemy_type
    const accent = ENEMY_COLORS[type] || ENEMY_COLORS.basic
    const body = ENEMY_BODY[type] || ENEMY_BODY.basic
    const R = ENEMY_RADIUS[type] ?? 10
    const isSlowed = (enemy.slow_duration ?? 0) > 0

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

    // Stasis cage: shape-based debuff tell — the body is never recolored.
    if (isSlowed) {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(t * 0.8)
      const cage = regularPolyPath(R + 5, 6, -Math.PI / 2)
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

    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    switch (type) {
      case 'sniper':
        ctx.strokeStyle = TOWER_COLORS.sniper
        ctx.lineWidth = 2
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(-18, 0)
        ctx.lineTo(0, 0)
        ctx.stroke()
        ctx.drawImage(glowSprite(TOWER_COLORS.sniper), -8, -8, 16, 16)
        ctx.fillStyle = PALETTE.white
        ctx.beginPath()
        ctx.arc(0, 0, 2.5, 0, Math.PI * 2)
        ctx.fill()
        break
      case 'splash':
        ctx.drawImage(glowSprite(TOWER_COLORS.splash), -14, -14, 28, 28)
        ctx.globalAlpha = 0.35
        ctx.fillStyle = TOWER_COLORS.splash
        ctx.beginPath()
        ctx.arc(-6, 0, 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 0.15
        ctx.beginPath()
        ctx.arc(-12, 0, 2, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.fillStyle = TOWER_COLORS.splash
        ctx.beginPath()
        ctx.arc(0, 0, 4.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = TOWER_LIGHT.splash
        ctx.lineWidth = 1
        ctx.stroke()
        break
      case 'slow': {
        ctx.strokeStyle = hexAlpha(TOWER_COLORS.slow, 0.5)
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(-10, 0)
        ctx.lineTo(-3, 0)
        ctx.stroke()
        ctx.rotate(t * 12 + projectile.id)
        const shard = polyPath([[5, 0], [0, -3], [-5, 0], [0, 3]])
        ctx.fillStyle = TOWER_LIGHT.slow
        ctx.fill(shard)
        ctx.strokeStyle = TOWER_COLORS.slow
        ctx.lineWidth = 1
        ctx.stroke(shard)
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

  const MUZZLE_OFFSET: Record<string, number> = { basic: 18, sniper: 24, splash: 12, slow: 15 }

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

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setHoveredCell(cellFromEvent(e))
  }

  const handleMouseLeave = () => setHoveredCell(null)

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isGameOver) return
    // Use the click's own coordinates — the hover ref lags one render behind
    // and a fast move+click would act on the previous cell.
    const hovered = cellFromEvent(e)
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

    if (isConnected && !blocked && selType !== null && currentGold >= TOWER_COSTS[selType]) {
      onPlaceTower(hovered.x, hovered.y, selType)
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

  const handleStartWave = () => {
    if (countdownRef.current) clearInterval(countdownRef.current)
    setCountdown(null)
    onStartWave()
  }

  const waveStatusLabel = () => {
    if (isGameOver) return null
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

  const towerButtons: TowerType[] = ['basic', 'sniper', 'splash', 'slow']

  const sellPrice = selectedTower
    ? Math.floor((selectedTower.total_spent ?? TOWER_COSTS[selectedTower.tower_type as TowerType]) * 0.7)
    : 0
  const upgradeCost = selectedTower ? TOWER_COSTS[selectedTower.tower_type as TowerType] : 0
  const canAffordUpgrade = selectedTower ? gold >= upgradeCost : false
  const isMaxLevel = selectedTower ? (selectedTower.level ?? 1) >= 4 : false

  return (
    <div className="game-canvas-container">
      {isGameOver && (
        <div className="game-over-overlay">
          <div className="game-over-box panel">
            <div className="game-over-title">SIGNAL LOST</div>
            <p className="game-over-sub">
              You survived {(gameState?.wave ?? 1) - 1} wave{(gameState?.wave ?? 1) - 1 !== 1 ? 's' : ''}
            </p>
            <p className="game-over-score">SCORE {(gameState?.score ?? 0).toLocaleString()}</p>
            {isNewHighScore ? (
              <p className="game-over-best new-best">★ NEW HIGH SCORE ★</p>
            ) : (
              <p className="game-over-best">BEST {highScore.toLocaleString()}</p>
            )}
            <button onClick={onNewGame} className="btn btn-primary btn-big">
              REDEPLOY ▸
            </button>
          </div>
        </div>
      )}

      <div className="game-info panel">
        <div className="info-item"><span className="label">Gold</span><span className="value gold">${gold}</span></div>
        <div className="info-item"><span className="label">Health</span><span className={`value ${(gameState?.health ?? 100) <= 30 ? 'health-low' : ''}`}>{gameState?.health ?? 100}</span></div>
        <div className="info-item"><span className="label">Score</span><span className="value">{(gameState?.score ?? 0).toLocaleString()}</span></div>
        <div className="info-item"><span className="label">Best</span><span className="value">{highScore.toLocaleString()}</span></div>
        <div className="info-item"><span className="label">Wave</span><span className="value">{String(gameState?.wave ?? 1).padStart(2, '0')}</span></div>
        <div className="info-item"><span className="label">Link</span><span className={`value ${isConnected ? 'connected' : 'disconnected'}`}>{isConnected ? 'ONLINE' : 'OFFLINE'}</span></div>
      </div>

      <div className="wave-status">
        {waveStatusLabel()}
      </div>

      {!isGameOver && (gameState?.wave_preview?.length ?? 0) > 0 && (
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
        {towerButtons.map(type => {
          const cost = TOWER_COSTS[type]
          const canAfford = gold >= cost
          return (
            <button
              key={type}
              className={`tower-btn ${selectedTowerType === type ? 'selected' : ''} ${!canAfford ? 'cannot-afford' : ''}`}
              style={{ '--accent': TOWER_COLORS[type] } as React.CSSProperties}
              onClick={() => { setSelectedTowerType(type); setSelectedTower(null) }}
              disabled={isGameOver}
              title={canAfford ? `Select ${TOWER_NAMES[type]} tower` : `Not enough gold (need ${cost})`}
            >
              <TowerIcon type={type} />
              <span>{TOWER_NAMES[type]}</span>
              <span className="cost" style={{ color: canAfford ? PALETTE.gold : PALETTE.danger }}>${cost}</span>
            </button>
          )
        })}
        <button
          className={`tower-btn tower-btn-none ${selectedTowerType === null ? 'selected' : ''}`}
          onClick={() => { setSelectedTowerType(null); setSelectedTower(null) }}
          disabled={isGameOver}
          title="Deselect tower — cursor mode"
        >
          <span className="none-icon">∅</span>
          <span>None</span>
        </button>
      </div>

      {selectedTower && (
        <div className="selected-panel panel" style={{ '--accent': TOWER_COLORS[selectedTower.tower_type] } as React.CSSProperties}>
          <div className="selected-name">
            <TowerIcon type={selectedTower.tower_type as TowerType} size={24} />
            <span>
              {TOWER_NAMES[selectedTower.tower_type]} <span className="selected-level">MK{selectedTower.level ?? 1}{isMaxLevel ? ' ★MAX' : ''}</span>
            </span>
          </div>
          <div className="selected-stat"><span className="label">Range</span><span className="value">{selectedTower.range}</span></div>
          <div className="selected-stat"><span className="label">Damage</span><span className="value">{selectedTower.damage}</span></div>
          <div className="selected-stat"><span className="label">Rate</span><span className="value">{selectedTower.fire_rate}/s</span></div>
          <button onClick={handleSellSelected} className="btn btn-danger">SELL ${sellPrice}</button>
          {isMaxLevel ? (
            <span className="max-badge">★ MAX</span>
          ) : (
            <button
              onClick={handleUpgradeSelected}
              disabled={!canAffordUpgrade}
              className="btn btn-gold"
              title={canAffordUpgrade ? `Upgrade to MK${(selectedTower.level ?? 1) + 1}` : `Need $${upgradeCost} to upgrade`}
            >
              UPGRADE ${upgradeCost}
            </button>
          )}
          <button onClick={() => setSelectedTower(null)} className="btn btn-close">✕</button>
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
          style={{ cursor: isGameOver ? 'default' : 'crosshair', display: 'block' }}
        />
      </div>

      <div className="controls">
        <button
          className="btn btn-primary"
          onClick={handleStartWave}
          disabled={!isConnected || isWaveActive || isGameOver || countdown !== null}
          title={isWaveActive ? 'Wave already in progress' : 'Start the next wave'}
        >
          {isWaveActive ? 'WAVE ACTIVE…' : 'START WAVE ▸'}
        </button>
        <button
          className={`btn ${autoWave ? 'btn-toggled' : ''}`}
          onClick={() => {
            setAutoWave(prev => {
              if (prev) {
                if (countdownRef.current) clearInterval(countdownRef.current)
                setCountdown(null)
              }
              return !prev
            })
          }}
          disabled={isGameOver}
          title="Automatically start next wave after 5 seconds"
        >
          AUTO: {autoWave ? 'ON' : 'OFF'}
        </button>
        <button className="btn" onClick={onNewGame} disabled={!isConnected}>
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
          <div className="glossary-title">HOSTILE REGISTRY</div>
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
