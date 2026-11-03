import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryStorage } from './test/memoryStorage'
import { ROOM_CODE_KEY, isFreshRun, readRoomCode, writeRoomCode } from './session'
import type { GameState } from './types/game'

const state = (over: Partial<GameState>): GameState => ({
  towers: [], enemies: [], projectiles: [], muzzle_flashes: [], explosions: [],
  gold: 200, health: 100, score: 0, wave: 1, phase: 'waiting', enemies_remaining: 0, game_time: 0,
  ...over,
})

afterEach(() => vi.unstubAllGlobals())

describe('room code', () => {
  it('round-trips through sessionStorage', () => {
    vi.stubGlobal('sessionStorage', new MemoryStorage())
    expect(readRoomCode()).toBeNull()
    writeRoomCode('abc123')
    expect(sessionStorage.getItem(ROOM_CODE_KEY)).toBe('abc123')
    expect(readRoomCode()).toBe('abc123')
  })

  it('degrades to "no code" when storage is blocked', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    })
    expect(readRoomCode()).toBeNull()
    expect(() => writeRoomCode('x')).not.toThrow()
  })
})

describe('isFreshRun', () => {
  it('accepts the reset state and rejects stale frames of the old run', () => {
    expect(isFreshRun(state({}))).toBe(true)
    expect(isFreshRun(state({ phase: 'game_over', wave: 7, game_time: 300 }))).toBe(false)
    expect(isFreshRun(state({ wave: 1, game_time: 12.5, phase: 'active' }))).toBe(false)
  })
})
