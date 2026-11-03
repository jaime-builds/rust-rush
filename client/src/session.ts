// Per-tab session helpers for App: the private room code and the New Game
// stale-snapshot guard. Kept apart from App so they can be unit tested.
import type { GameState } from './types/game'

// Rooms are private and server-assigned. The join reply carries the room's
// code; this tab keeps it (sessionStorage: per tab, gone when the tab
// closes) and sends it back on every reconnect, so a refresh or a short
// network drop resumes the same game while the server still holds it
// (60 s after the last player leaves). An expired code just gets a new room.
export const ROOM_CODE_KEY = 'rr_room_code'
export const readRoomCode = (): string | null => {
  try {
    return sessionStorage.getItem(ROOM_CODE_KEY)
  } catch {
    return null // storage blocked: every connect starts a fresh room
  }
}
export const writeRoomCode = (code: string) => {
  try {
    sessionStorage.setItem(ROOM_CODE_KEY, code)
  } catch {
    // storage blocked: resume just won't work
  }
}

// After New Game, snapshots already in flight still describe the old run
// (often game over). Until the fresh run shows up (wave 1, no game time) they
// are dropped, so the old screen can't flicker back or replay its sound.
// The guard expires on its own in case the reset never arrives.
export const RESET_GUARD_MS = 3000
export const isFreshRun = (s: GameState) => s.wave === 1 && (s.game_time ?? 0) === 0
