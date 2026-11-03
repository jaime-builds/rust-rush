// Canvas drawing for the board: map, gates, towers, enemies, projectiles and
// effects. Each function takes the 2D context and plain data, so they hold no
// React state (moved out of GameCanvas.tsx, RR-13).
import { Tower, TowerType, Enemy, Projectile, MuzzleFlash, Explosion, Arc, Position, GRID_HEIGHT, CELL_SIZE } from '../types/game'
import { PALETTE, TOWER_COLORS, TOWER_LIGHT, TOWER_RANGES, ENEMY_COLORS, ENEMY_BODY, ENEMY_RADIUS } from './theme'
import { polyPath, regularPolyPath, SHAPES, memoPath, hexAlpha, glowSprite, roundRectPath } from './shapes'
import { shortestAngleDelta } from './effects'

// Last drawn heading per entity, so movement turns smoothly frame to frame.
// The caller owns these maps: last frame's goes in as prevHeadings, this
// frame's is filled in next.
export type HeadingMap = Map<number, { x: number; y: number; angle: number }>

// Where a hovered cell stands with the server's path-block check: 'ok' =
// cleared (or never asked, because a synchronous check already rejected it),
// 'pending' = asked, no answer yet, 'blocks' = the placement would seal the
// only spawn→goal route.
export type PathPreviewState = 'ok' | 'pending' | 'blocks'

// Obstacles render as merged "containment bulkheads": one rounded plate per
// contiguous vertical run, with hatching, a power seam, and hazard stripes
// on the corridor-facing end cells. shadowBlur is allowed here only — this
// draws once per map, not per frame.
export const drawBulkheads = (b: CanvasRenderingContext2D, obstacles: Position[]) => {
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

export const drawSpawnGate = (ctx: CanvasRenderingContext2D, pos: Position, t: number) => {
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

export const drawGoalGate = (ctx: CanvasRenderingContext2D, pos: Position, t: number, alarm: boolean) => {
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

export const drawRangeRing = (ctx: CanvasRenderingContext2D, pos: Position, range: number, accent: string, t: number, alpha: number) => {
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
export const drawAuraField = (ctx: CanvasRenderingContext2D, tower: Tower, t: number) => {
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
export const drawLaserBeam = (ctx: CanvasRenderingContext2D, tower: Tower, victim: Enemy, t: number) => {
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
export const drawArc = (ctx: CanvasRenderingContext2D, arc: Arc, t: number) => {
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

export const drawSelectionBrackets = (ctx: CanvasRenderingContext2D, pos: Position) => {
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
export const drawHoverUnderlay = (ctx: CanvasRenderingContext2D, pos: Position, towerType: TowerType, t: number, invalid: boolean, showRange: boolean) => {
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
export const drawGhostTower = (ctx: CanvasRenderingContext2D, pos: Position, towerType: TowerType, t: number, blocked: boolean, canAfford: boolean, pathState: PathPreviewState) => {
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
export const drawNoEntryGlyph = (ctx: CanvasRenderingContext2D, cx: number, cy: number) => {
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

export const drawTower = (ctx: CanvasRenderingContext2D, tower: Tower, t: number, alphaScale: number) => {
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

export const drawEnemy = (ctx: CanvasRenderingContext2D, enemy: Enemy, t: number, prevHeadings: HeadingMap, next: HeadingMap) => {
  const x = enemy.position.x * CELL_SIZE + CELL_SIZE / 2
  const y = enemy.position.y * CELL_SIZE + CELL_SIZE / 2
  const type = enemy.enemy_type
  const accent = ENEMY_COLORS[type] || ENEMY_COLORS.basic
  const body = ENEMY_BODY[type] || ENEMY_BODY.basic
  const R = ENEMY_RADIUS[type] ?? 10
  const isRooted = (enemy.root_duration ?? 0) > 0
  const isSlowed = (enemy.slow_duration ?? 0) > 0 && !isRooted

  // Heading: smoothed toward the movement direction.
  const prev = prevHeadings.get(enemy.id)
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

export const drawProjectile = (
  ctx: CanvasRenderingContext2D,
  projectile: Projectile,
  t: number,
  towerTypeById: Map<number, string>,
  enemyById: Map<number, Enemy>,
  prevHeadings: HeadingMap,
  next: HeadingMap,
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
    const prev = prevHeadings.get(projectile.id)
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

export const drawMuzzleFlash = (ctx: CanvasRenderingContext2D, flash: MuzzleFlash, towerByCell: Map<string, Tower>) => {
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

export const drawExplosion = (ctx: CanvasRenderingContext2D, explosion: Explosion) => {
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
export const drawBossBeam = (ctx: CanvasRenderingContext2D, pos: Position, p: number) => {
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

export const drawReticle = (ctx: CanvasRenderingContext2D, enemy: Enemy, accent: string) => {
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
