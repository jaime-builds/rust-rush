// Local progress kept in localStorage: high score and the furthest map beaten.
import { GAME_MAPS } from '../types/game'

export const HIGH_SCORE_KEY = 'rustRushHighScore'

export const readHighScore = (): number => {
  try {
    const parsed = parseInt(localStorage.getItem(HIGH_SCORE_KEY) ?? '0', 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  } catch {
    return 0
  }
}

// Map progression unlock state: the single "furthest map beaten" integer
// (0 = nothing beaten, only sequence position 1 selectable; 6 = everything
// beaten). Same localStorage pattern as the high score. A map is selectable
// when its sequenceOrder ≤ furthest-beaten + 1.
export const FURTHEST_BEATEN_KEY = 'rustRushFurthestMapBeaten'

export const readFurthestBeaten = (): number => {
  try {
    const parsed = parseInt(localStorage.getItem(FURTHEST_BEATEN_KEY) ?? '0', 10)
    if (!Number.isFinite(parsed)) return 0
    return Math.min(Math.max(parsed, 0), GAME_MAPS.length)
  } catch {
    return 0
  }
}
