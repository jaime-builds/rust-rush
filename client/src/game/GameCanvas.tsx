import { useEffect, useRef, useState } from 'react'
import './GameCanvas.css'
import {
  Tower, TowerType, BaseTowerType, EvolvedTowerType, Enemy, EnemyType, Projectile,
  MuzzleFlash, Explosion, Arc, Position, GameState,
  TOWER_COSTS, EVOLUTION_OPTIONS, GRID_WIDTH, GRID_HEIGHT, CELL_SIZE,
  GAME_MAPS, GameMapInfo,
} from '../types/game'
import { settings } from '../settings'

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
// Evolved forms stay in their base tower's hue family (hue is the garnish);
// the new silhouette is what actually announces the evolution.
const TOWER_COLORS: Record<string, string> = {
  basic: '#00E5FF',
  sniper: '#B388FF',
  splash: '#FFD60A',
  slow: '#3D8BFF',
  tesla: '#A8FF3E',
  breach: '#00C0F0',
  barrage: '#66F2FF',
  piercer: '#CBA9FF',
  executioner: '#8E5CFF',
  cluster: '#FFE566',
  siege: '#FFB300',
  cryo_field: '#7FB8FF',
  deep_freeze: '#2E7BFF',
  laser: '#D6FF5E',
  amplifier: '#6BFFA8',
}

const TOWER_LIGHT: Record<string, string> = {
  basic: '#9FF6FF',
  sniper: '#DCC8FF',
  splash: '#FFF3B0',
  slow: '#A6CFFF',
  tesla: '#E2FFB0',
  breach: '#8AE8FF',
  barrage: '#C8FBFF',
  piercer: '#E8DAFF',
  executioner: '#C9AFFF',
  cluster: '#FFF6C4',
  siege: '#FFDB8A',
  cryo_field: '#CFE5FF',
  deep_freeze: '#9FC2FF',
  laser: '#F0FFB8',
  amplifier: '#C4FFDD',
}

// Kept in sync with server towerStatsByType + evolvedStatsByType.
const TOWER_RANGES: Record<string, number> = {
  basic: 3.0,
  sniper: 6.0,
  splash: 2.5,
  slow: 3.5,
  tesla: 4.0,
  breach: 3.2,
  barrage: 4.2,
  piercer: 8.0,
  executioner: 8.0,
  cluster: 3.6,
  siege: 3.6,
  cryo_field: 4.5,
  deep_freeze: 4.5,
  laser: 5.5,
  amplifier: 3.5,
}

const TOWER_NAMES: Record<string, string> = {
  basic: 'Pulse',
  sniper: 'Railgun',
  splash: 'Mortar',
  slow: 'Stasis',
  tesla: 'Tesla',
  breach: 'Breach',
  barrage: 'Barrage',
  piercer: 'Piercer',
  executioner: 'Executioner',
  cluster: 'Cluster',
  siege: 'Siege',
  cryo_field: 'Cryo Field',
  deep_freeze: 'Deep Freeze',
  laser: 'Laser',
  amplifier: 'Amplifier',
}

// One-liners for the evolve dialog and the tower glossary.
const TOWER_DESCRIPTIONS: Record<string, string> = {
  basic: 'Reliable workhorse turret — solid damage at a steady rate.',
  sniper: 'Long-range single-target rail — slow, heavy hits.',
  splash: 'Lobbed shells splash damage around the impact point.',
  slow: 'Tags enemies with a stasis field that cuts their speed.',
  tesla: 'Chain lightning arcs from the target to nearby enemies. Upgrades add arcs and reach.',
  breach: 'Close-range shredder — much harder hits, faster firing, shorter reach.',
  barrage: 'Fires a 3-shot volley at separate targets — volume over punch.',
  piercer: 'The rail shot punches through everything along its line.',
  executioner: 'Double damage against enemies below 20% health.',
  cluster: 'Huge blast radius at full splash damage — chokepoint eraser.',
  siege: 'Massive direct hits; the splash shrinks to a pinpoint.',
  cryo_field: 'Constant slow field — everything in range crawls at 40% speed. Fires nothing.',
  deep_freeze: 'Severe single-target slow, with a 25% chance to freeze solid for 1.5s.',
  laser: 'Continuous beam — 60 damage per second, no travel time.',
  amplifier: 'Deals no damage; nearby towers gain +25% damage and fire rate.',
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

// Tower stat sheet — kept in sync with server towerStatsByType / UpgradeTower.
const TOWER_GLOSSARY: { type: BaseTowerType, damage: number, rate: number, upgradeNote: string }[] = [
  { type: 'basic', damage: 15, rate: 1.0, upgradeNote: 'MK2–4: +20% dmg, +10% range per level' },
  { type: 'sniper', damage: 50, rate: 0.5, upgradeNote: 'MK2–4: +20% dmg, +10% range per level' },
  { type: 'splash', damage: 10, rate: 1.5, upgradeNote: 'MK2–4: +20% dmg, +10% range; blast 1.5u/60% → 2.4u/90%' },
  { type: 'slow', damage: 8, rate: 0.8, upgradeNote: 'MK2–4: +20% dmg, +10% range; slow 2.0s/0.40× → 3.5s/0.25×' },
  { type: 'tesla', damage: 20, rate: 0.8, upgradeNote: 'MK2–4: +20% dmg, +10% range; chain 2×/1.5u → 5×/2.1u' },
]

// Evolution stat lines — kept in sync with server evolvedStatsByType.
const EVO_STATS: Record<EvolvedTowerType, string> = {
  breach: '55 dmg · 1.4/s · 3.2 rng',
  barrage: '18 dmg ×3 shots · 1.2/s · 4.2 rng',
  piercer: '70 dmg thru-line · 0.5/s · 8.0 rng',
  executioner: '95 dmg, ×2 under 20% HP · 0.6/s · 8.0 rng',
  cluster: '14 dmg · 3.5u blast @ 100% · 1.5/s',
  siege: '60 dmg · 1.2u blast @ 60% · 1.0/s',
  cryo_field: 'no attack · 4.5u field · 40% speed',
  deep_freeze: '15 dmg · 0.25× slow · 25% root 1.5s',
  laser: '60 dmg/s beam · 5.5 rng',
  amplifier: 'no attack · 3.5u aura · +25% dmg & rate',
}

// Tower hotkey/button order — keys 1-5 map to this, matching the on-screen
// button row (Pulse, Railgun, Mortar, Stasis, Tesla).
const TOWER_ORDER: BaseTowerType[] = ['basic', 'sniper', 'splash', 'slow', 'tesla']

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

// starPolyPath alternates between two radii — snowflake/spark plates.
const starPolyPath = (rOuter: number, rInner: number, points: number, rot = 0): Path2D => {
  const pts: number[][] = []
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner
    const a = rot + (i * Math.PI) / points
    pts.push([r * Math.cos(a), r * Math.sin(a)])
  }
  return polyPath(pts)
}

// Cross/plus plate (Tesla): arm half-width w, arm length L.
const crossPts = (L: number, w: number) => [
  [L, -w], [w, -w], [w, -L], [-w, -L], [-w, -w], [-L, -w],
  [-L, w], [-w, w], [-w, L], [w, L], [w, w], [L, w],
]

// Every tower base is a distinct closed silhouette — SHAPE is the
// discriminator. The ten evolved plates are deliberately louder geometry than
// the base five: the evolution moment is where the visual payoff lives.
const SHAPES = {
  towerBase: {
    basic: regularPolyPath(14, 8, Math.PI / 8),
    sniper: polyPath([[0, -15], [15, 0], [0, 15], [-15, 0]]),
    splash: polyPath([[-14, -9], [-9, -14], [9, -14], [14, -9], [14, 9], [9, 14], [-9, 14], [-14, 9]]),
    slow: regularPolyPath(14, 6, -Math.PI / 2),
    tesla: polyPath(crossPts(15, 6)),
    // Pulse forks
    breach: regularPolyPath(15, 5, -Math.PI / 2),                                  // pentagon — forward mass
    barrage: polyPath([[-15, -10], [15, -10], [10, 12], [-10, 12]]),               // wide battery trapezoid
    // Railgun forks
    piercer: polyPath([[17, 0], [9, -8], [-9, -8], [-17, 0], [-9, 8], [9, 8]]),    // elongated lens
    executioner: regularPolyPath(15, 5, Math.PI / 2),                              // inverted pentagon — the blade
    // Mortar forks
    cluster: regularPolyPath(14, 12, Math.PI / 12),                                // round drum
    siege: polyPath([[-13, -13], [13, -13], [13, 13], [-13, 13]]),                 // square bastion
    // Stasis forks
    cryo_field: starPolyPath(15, 8, 6, -Math.PI / 2),                              // snowflake plate
    deep_freeze: polyPath([[0, -17], [9, -8], [9, 8], [0, 17], [-9, 8], [-9, -8]]), // tall crystal
    // Tesla forks
    laser: regularPolyPath(13, 16),                                                // lens ring
    amplifier: regularPolyPath(15, 3, -Math.PI / 2),                               // broadcast pylon
  } as Record<string, Path2D>,
  towerBaseInset: {
    basic: regularPolyPath(12, 8, Math.PI / 8),
    sniper: polyPath([[0, -13], [13, 0], [0, 13], [-13, 0]]),
    splash: polyPath(scalePts([[-14, -9], [-9, -14], [9, -14], [14, -9], [14, 9], [9, 14], [-9, 14], [-14, 9]], 12 / 14)),
    slow: regularPolyPath(12, 6, -Math.PI / 2),
    tesla: polyPath(scalePts(crossPts(15, 6), 12 / 15)),
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

// ————————————————————————————————————————————————————————————————————————
// Phase 19 effect helpers. All three effects are deliberately cheap: no
// particle systems, no per-frame allocations beyond one gradient on the
// (rare) boss beam.
// ————————————————————————————————————————————————————————————————————————

// Tower materialize: scale-up from nothing with a slight overshoot so the
// pop reads as "locking into place". ~180ms, one tower at a time.
const PLACE_ANIM_MS = 180
const easeOutBack = (p: number): number => {
  const c = 1.2 // gentler than the textbook 1.70158 — a nudge, not a bounce
  const q = p - 1
  return 1 + (c + 1) * q * q * q + c * q * q
}

// Boss beam-down: total effect length; the boss itself fades in over the
// back portion once the streak has mostly collapsed.
const BEAM_MS = 500
const BEAM_BOSS_FADE_START = 0.45

// Low-health red pulse: "health below 5" in the Phase 19 spec, read in board
// terms — every leak costs exactly 10 health (health only ever moves in -10
// steps from 100), so "below 5" = fewer than 5 remaining hits = health < 50.
// A literal health<5 is unreachable while alive.
const LOW_HEALTH_PULSE_THRESHOLD = 50
// One continuous slow breath — time-based, so further leaks while already
// low never restart or intensify it. Peak alpha stays under 0.1 on an
// edges-only vignette: deliberately "too subtle" per the design call.
const LOW_HEALTH_PULSE_PERIOD_S = 3.2

let alertVignetteCache: HTMLCanvasElement | null = null
const alertVignette = (w: number, h: number): HTMLCanvasElement => {
  if (!alertVignetteCache || alertVignetteCache.width !== w || alertVignetteCache.height !== h) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.38, w / 2, h / 2, Math.max(w, h) * 0.62)
    grad.addColorStop(0, 'rgba(255, 59, 78, 0)')
    grad.addColorStop(1, 'rgba(255, 59, 78, 0.85)')
    g.fillStyle = grad
    g.fillRect(0, 0, w, h)
    alertVignetteCache = c
  }
  return alertVignetteCache
}

// Screen shake: two incommensurate sine waves, quadratic decay. Small and
// short by design — it fires on health loss only (a rare, meaningful event),
// never on tower hits.
const SHAKE_MS = 280
const SHAKE_AMP_PX = 3.5

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
      {type === 'tesla' && (<>
        <polygon points="15,-6 6,-6 6,-15 -6,-15 -6,-6 -15,-6 -15,6 -6,6 -6,15 6,15 6,6 15,6" {...common} />
        <polyline points="-3,-8 3,-2 -2,0 4,8" fill="none" stroke={c} strokeWidth="2" />
      </>)}
      {type === 'breach' && (<>
        <polygon points="0,-15 14.3,-4.6 8.8,12.1 -8.8,12.1 -14.3,-4.6" {...common} />
        <rect x="2" y="-6" width="13" height="4.5" fill={c} stroke="none" />
        <rect x="2" y="1.5" width="13" height="4.5" fill={c} stroke="none" />
      </>)}
      {type === 'barrage' && (<>
        <polygon points="-15,-10 15,-10 10,12 -10,12" {...common} />
        <rect x="3" y="-7" width="12" height="3" fill={c} stroke="none" transform="rotate(-12)" />
        <rect x="3" y="-1.5" width="12" height="3" fill={c} stroke="none" />
        <rect x="3" y="4" width="12" height="3" fill={c} stroke="none" transform="rotate(12)" />
      </>)}
      {type === 'piercer' && (<>
        <polygon points="17,0 9,-8 -9,-8 -17,0 -9,8 9,8" {...common} />
        <rect x="-14" y="-1.25" width="33" height="2.5" fill={c} stroke="none" />
      </>)}
      {type === 'executioner' && (<>
        <polygon points="0,15 -14.3,4.6 -8.8,-12.1 8.8,-12.1 14.3,4.6" {...common} />
        <rect x="0" y="-2" width="12" height="4" fill={c} stroke="none" />
        <polygon points="11,-6 19,0 11,6" fill={c} stroke="none" />
      </>)}
      {type === 'cluster' && (<>
        <polygon points="13.5,3.6 9.9,9.9 3.6,13.5 -3.6,13.5 -9.9,9.9 -13.5,3.6 -13.5,-3.6 -9.9,-9.9 -3.6,-13.5 3.6,-13.5 9.9,-9.9 13.5,-3.6" {...common} />
        <circle cx="6" cy="-4" r="2" fill={c} />
        <circle cx="8" cy="1" r="2" fill={c} />
        <circle cx="5" cy="6" r="2" fill={c} />
      </>)}
      {type === 'siege' && (<>
        <rect x="-13" y="-13" width="26" height="26" {...common} />
        <rect x="0" y="-5.5" width="16" height="11" fill={c} stroke="none" />
      </>)}
      {type === 'cryo_field' && (<>
        <polygon points="0,-15 4,-6.9 13,-7.5 8,0 13,7.5 4,6.9 0,15 -4,6.9 -13,7.5 -8,0 -13,-7.5 -4,-6.9" {...common} />
        <circle r="3" fill={c} />
      </>)}
      {type === 'deep_freeze' && (<>
        <polygon points="0,-17 9,-8 9,8 0,17 -9,8 -9,-8" {...common} />
        <polyline points="-4,-8 3,0 -3,8" fill="none" stroke={c} strokeWidth="2" />
      </>)}
      {type === 'laser' && (<>
        <circle r="13" {...common} />
        <circle r="5" fill="none" stroke={c} strokeWidth="2" />
        <circle r="1.75" fill={c} />
      </>)}
      {type === 'amplifier' && (<>
        <polygon points="0,-15 13,7.5 -13,7.5" {...common} />
        <polygon points="0,-8 7,4.5 -7,4.5" fill="none" stroke={c} strokeWidth="1.5" />
        <circle cy="1" r="2" fill={c} />
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

// MapThumb — miniature schematic of one map for the selection screen: the
// 20×15 board with wall cells, spawn, and goal. Drawn from the client-side
// GAME_MAPS mirror (previews only — in-game walls come from the server).
const MapThumb = ({ map }: { map: GameMapInfo }) => (
  <svg viewBox="0 0 20 15" className="map-thumb" aria-hidden="true">
    <rect x="0" y="0" width="20" height="15" fill={PALETTE.bgDeep} />
    {map.obstacles.map((o, i) => (
      <rect key={i} x={o.x} y={o.y} width="1" height="1" fill={PALETTE.wallEdge} />
    ))}
    <rect x="0" y="7" width="1" height="1" fill={PALETTE.spawn} />
    <rect x="19" y="7" width="1" height="1" fill={PALETTE.goal} />
  </svg>
)

interface GameCanvasProps {
  isConnected: boolean
  onPlaceTower: (x: number, y: number, towerType: string) => void
  onSellTower: (towerId: number) => void
  onUpgradeTower: (towerId: number) => void
  onEvolveTower: (towerId: number, evolution: string) => void
  onStartWave: () => void
  // Starts a fresh run; mapId switches the room's map (omit = same map).
  onNewGame: (mapId?: string) => void
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
  onEvolveTower,
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
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [highScore, setHighScore] = useState<number>(() => readHighScore())
  const [isNewHighScore, setIsNewHighScore] = useState(false)
  const prevPhaseRef = useRef<string>('waiting')
  const [showGlossary, setShowGlossary] = useState(false)
  const [glossaryTab, setGlossaryTab] = useState<'towers' | 'enemies'>('towers')
  // Map selection: happens before a game starts (auto-opens on a fresh
  // board, or via NEW GAME / CHANGE MAP). Never mid-game.
  const [showMapSelect, setShowMapSelect] = useState(false)
  const [pendingMapId, setPendingMapId] = useState<string>(GAME_MAPS[0].id)
  const mapSelectAutoOpenedRef = useRef(false)

  // Sync refs (game state itself arrives via liveStateRef at full rate)
  hoveredCellRef.current = hoveredCell
  selectedTowerTypeRef.current = selectedTowerType
  selectedTowerRef.current = selectedTower

  const phase = gameState?.phase || 'waiting'
  const gold = gameState?.gold ?? 200
  const isWaveActive = phase === 'active'
  const isGameOver = phase === 'game_over'

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
    setPendingMapId(gameState?.map_id ?? GAME_MAPS[0].id)
    setShowMapSelect(true)
  }

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
  // to NONE (same as the ∅ button). Guarded against focused text inputs so
  // a future settings/chat field can't fire tower selection while typing.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (isGameOver) return
      // While the settings modal is open, Escape belongs to it (close wins
      // over deselect) and number keys shouldn't reach the board either.
      if (document.querySelector('.settings-overlay')) return
      if (e.key === 'Escape') {
        setSelectedTowerType(null)
        setSelectedTower(null)
        return
      }
      if (e.key >= '1' && e.key <= '5') {
        setSelectedTowerType(TOWER_ORDER[Number(e.key) - 1])
        setSelectedTower(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isGameOver])

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
    const currentIsGameOver = currentPhase === 'game_over'
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
      drawGhostTower(ctx, hovered, selType, t, hoverBlocked, currentGold >= TOWER_COSTS[selType])
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
            const vane = polyPath([[6, -3], [15, 0], [6, 3]])
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
          const blade = polyPath([[19, -6], [28, 0], [19, 6]])
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
          const lance = polyPath([[3, -4.5], [19, 0], [3, 4.5], [0, 0]])
          ctx.fillStyle = light
          ctx.fill(lance)
          ctx.strokeStyle = accent
          ctx.lineWidth = 1.5
          ctx.stroke(lance)
          for (const sy of [-1, 1]) {
            const shard = polyPath([[2, sy * 5], [9, sy * 9], [5, sy * 4]])
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
      ctx.stroke(regularPolyPath(8, 3, -Math.PI / 2))
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
      const block = regularPolyPath(R + 6, 6, -Math.PI / 2)
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
        const spike = polyPath([
          [bx, by],
          [bx + 4 * Math.cos(a - 0.35), by + 4 * Math.sin(a - 0.35)],
          [bx + 6 * Math.cos(a), by + 6 * Math.sin(a)],
          [bx + 4 * Math.cos(a + 0.35), by + 4 * Math.sin(a + 0.35)],
        ])
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
          const tip = polyPath([[2, -3], [7, 0], [2, 3]])
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
        const shard = polyPath([[5 * s, 0], [0, -3 * s], [-5 * s, 0], [0, 3 * s]])
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
        const spark = polyPath([[5, 0], [1.5, -1.5], [0, -5], [-1.5, -1.5], [-5, 0], [-1.5, 1.5], [0, 5], [1.5, 1.5]])
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
        const dart = polyPath([[5, 0], [-4, -2.5], [-4, 2.5]])
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

  const towerButtons = TOWER_ORDER

  const isEvolved = selectedTower?.evolved ?? false
  const sellPrice = selectedTower
    ? Math.floor((selectedTower.total_spent ?? TOWER_COSTS[selectedTower.tower_type as BaseTowerType] ?? 0) * 0.7)
    : 0
  const upgradeCost = selectedTower && !isEvolved ? TOWER_COSTS[selectedTower.tower_type as BaseTowerType] : 0
  const canAffordUpgrade = selectedTower ? gold >= upgradeCost : false
  const isMaxLevel = selectedTower ? (selectedTower.level ?? 1) >= 4 : false
  // Evolution: 2× everything spent so far, added to total_spent on commit.
  const evolveCost = (selectedTower?.total_spent ?? 0) * 2
  const evolveOptions = selectedTower && !isEvolved && isMaxLevel
    ? EVOLUTION_OPTIONS[selectedTower.tower_type as BaseTowerType] ?? null
    : null

  return (
    <div className="game-canvas-container">
      {isGameOver && !showMapSelect && (
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
            <button onClick={() => onNewGame()} className="btn btn-primary btn-big">
              REDEPLOY ▸
            </button>
            <button onClick={openMapSelect} className="btn btn-big">
              CHANGE MAP
            </button>
          </div>
        </div>
      )}

      {showMapSelect && (
        <div className="map-select-overlay">
          <div className="map-select-box panel">
            <div className="map-select-title">SELECT DEPLOYMENT ZONE</div>
            <div className="map-select-grid">
              {GAME_MAPS.map(m => (
                <button
                  key={m.id}
                  className={`map-card ${pendingMapId === m.id ? 'selected' : ''}`}
                  onClick={() => setPendingMapId(m.id)}
                  title={m.tagline}
                >
                  <MapThumb map={m} />
                  <span className="map-card-name">
                    {m.name}
                    {gameState?.map_id === m.id && <span className="map-card-current"> ● ACTIVE</span>}
                  </span>
                  <span className="map-card-tag">{m.tagline}</span>
                </button>
              ))}
            </div>
            <div className="map-select-actions">
              <button
                className="btn btn-primary btn-big"
                onClick={() => {
                  onNewGame(pendingMapId)
                  setShowMapSelect(false)
                }}
                disabled={!isConnected}
              >
                DEPLOY ▸
              </button>
              <button className="btn" onClick={() => setShowMapSelect(false)}>CANCEL</button>
            </div>
            <p className="map-select-warn">Deploying starts a fresh run on the selected map.</p>
          </div>
        </div>
      )}

      <div className="game-info panel">
        <div className="info-item"><span className="label">Gold</span><span className="value gold">${gold}</span></div>
        <div className="info-item"><span className="label">Health</span><span className={`value ${(gameState?.health ?? 100) <= 30 ? 'health-low' : ''}`}>{gameState?.health ?? 100}</span></div>
        <div className="info-item"><span className="label">Score</span><span className="value">{(gameState?.score ?? 0).toLocaleString()}</span></div>
        <div className="info-item"><span className="label">Best</span><span className="value">{highScore.toLocaleString()}</span></div>
        <div className="info-item"><span className="label">Wave</span><span className="value">{String(gameState?.wave ?? 1).padStart(2, '0')}</span></div>
        <div className="info-item"><span className="label">Zone</span><span className="value">{GAME_MAPS.find(m => m.id === (gameState?.map_id ?? 'open'))?.name ?? '—'}</span></div>
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
        {towerButtons.map((type, i) => {
          const cost = TOWER_COSTS[type]
          const canAfford = gold >= cost
          return (
            <button
              key={type}
              className={`tower-btn ${selectedTowerType === type ? 'selected' : ''} ${!canAfford ? 'cannot-afford' : ''}`}
              style={{ '--accent': TOWER_COLORS[type] } as React.CSSProperties}
              onClick={() => { setSelectedTowerType(type); setSelectedTower(null) }}
              disabled={isGameOver}
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
          disabled={isGameOver}
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
                {(selectedTower.chain_count ?? 0) > 0 && (
                  <div className="selected-stat"><span className="label">Chains</span><span className="value">×{selectedTower.chain_count}</span></div>
                )}
              </>
            )}
            <button onClick={handleSellSelected} className="btn btn-danger">SELL ${sellPrice}</button>
            {!isEvolved && !isMaxLevel && (
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
