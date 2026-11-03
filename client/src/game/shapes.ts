// Canvas geometry: cached Path2D silhouettes, glow sprites and color helpers.

// ————————————————————————————————————————————————————————————————————————
// Cached geometry (Path2D, local coords, forward = +x) and glow sprites.
// Built once at module load; per-entity drawing is translate/rotate + fill.
// ————————————————————————————————————————————————————————————————————————

export const polyPath = (pts: number[][]): Path2D => {
  const p = new Path2D()
  p.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1])
  p.closePath()
  return p
}

export const regularPolyPath = (r: number, sides: number, rot = 0): Path2D => {
  const pts: number[][] = []
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * 2 * Math.PI) / sides
    pts.push([r * Math.cos(a), r * Math.sin(a)])
  }
  return polyPath(pts)
}

export const scalePts = (pts: number[][], s: number) => pts.map(([x, y]) => [x * s, y * s])

export const TANK_HULL = [[15, 0], [7, -11], [-10, -11], [-15, 0], [-10, 11], [7, 11]]

// starPolyPath alternates between two radii — snowflake/spark plates.
export const starPolyPath = (rOuter: number, rInner: number, points: number, rot = 0): Path2D => {
  const pts: number[][] = []
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner
    const a = rot + (i * Math.PI) / points
    pts.push([r * Math.cos(a), r * Math.sin(a)])
  }
  return polyPath(pts)
}

// Cross/plus plate (Tesla): arm half-width w, arm length L.
export const crossPts = (L: number, w: number) => [
  [L, -w], [w, -w], [w, -L], [-w, -L], [-w, -w], [-L, -w],
  [-L, w], [-w, w], [-w, L], [w, L], [w, w], [L, w],
]

// Every tower base is a distinct closed silhouette — SHAPE is the
// discriminator. The ten evolved plates are deliberately louder geometry than
// the base five: the evolution moment is where the visual payoff lives.
export const SHAPES = {
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

// Shapes drawn inside the frame loop are built once per distinct key and
// reused: building Path2D objects (and rgba strings) every frame for every
// tower, enemy and projectile made hundreds of short-lived objects per frame
// in late waves, which showed up as GC stutter.
export const pathCache = new Map<string, Path2D>()
export const memoPath = (key: string, build: () => Path2D): Path2D => {
  let p = pathCache.get(key)
  if (!p) {
    p = build()
    pathCache.set(key, p)
  }
  return p
}

export const glowSpriteCache = new Map<string, HTMLCanvasElement>()
export const hexAlphaCache = new Map<string, string>()
export const hexAlpha = (hex: string, a: number): string => {
  const key = hex + a
  let out = hexAlphaCache.get(key)
  if (out === undefined) {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    out = `rgba(${r}, ${g}, ${b}, ${a})`
    // Alphas animated per frame would grow this without bound; past a few
    // thousand entries just start over.
    if (hexAlphaCache.size > 4000) hexAlphaCache.clear()
    hexAlphaCache.set(key, out)
  }
  return out
}

export const glowSprite = (color: string): HTMLCanvasElement => {
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

export const roundRectPath = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
