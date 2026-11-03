// Timing constants and helpers for the client-side one-shot effects.

// ————————————————————————————————————————————————————————————————————————
// Phase 19 effect helpers. All three effects are deliberately cheap: no
// particle systems, no per-frame allocations beyond one gradient on the
// (rare) boss beam.
// ————————————————————————————————————————————————————————————————————————

// Tower materialize: scale-up from nothing with a slight overshoot so the
// pop reads as "locking into place". ~180ms, one tower at a time.
export const PLACE_ANIM_MS = 180
export const easeOutBack = (p: number): number => {
  const c = 1.2 // gentler than the textbook 1.70158 — a nudge, not a bounce
  const q = p - 1
  return 1 + (c + 1) * q * q * q + c * q * q
}

// Boss beam-down: total effect length; the boss itself fades in over the
// back portion once the streak has mostly collapsed.
export const BEAM_MS = 500
export const BEAM_BOSS_FADE_START = 0.45

// Low-health red pulse: "health below 5" in the Phase 19 spec, read in board
// terms — every leak costs exactly 10 health (health only ever moves in -10
// steps from 100), so "below 5" = fewer than 5 remaining hits = health < 50.
// A literal health<5 is unreachable while alive.
export const LOW_HEALTH_PULSE_THRESHOLD = 50
// One continuous slow breath — time-based, so further leaks while already
// low never restart or intensify it. Peak alpha stays under 0.1 on an
// edges-only vignette: deliberately "too subtle" per the design call.
export const LOW_HEALTH_PULSE_PERIOD_S = 3.2

let alertVignetteCache: HTMLCanvasElement | null = null
export const alertVignette = (w: number, h: number): HTMLCanvasElement => {
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
export const SHAKE_MS = 280
export const SHAKE_AMP_PX = 3.5

export const shortestAngleDelta = (a: number): number => {
  let d = a % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}
