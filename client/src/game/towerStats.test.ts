import { describe, expect, it } from 'vitest'
import { nextLevelChanges, specialStats } from './towerStats'
import type { Tower } from '../types/game'

const tower = (over: Partial<Tower>): Tower => ({
  id: 1, position: { x: 0, y: 0 }, tower_type: 'basic', level: 1, range: 3, damage: 10, ...over,
})

describe('specialStats', () => {
  it('describes slow, blast, chain and volley', () => {
    expect(specialStats(tower({ slow_multiplier_upgrade: 0.4, slow_duration_upgrade: 2 })))
      .toEqual([{ label: 'Slows to', value: '40% · 2s' }])
    expect(specialStats(tower({ aoe_radius_upgrade: 1.8, aoe_damage_pct_upgrade: 0.7 })))
      .toEqual([{ label: 'Blast', value: '1.8 tiles · 70%' }])
    expect(specialStats(tower({ chain_count: 3, chain_radius: 1.7 })))
      .toEqual([{ label: 'Chain', value: '3 × 1.7 tiles' }])
    expect(specialStats(tower({ multi_shot: 3 }))).toEqual([{ label: 'Volley', value: '×3' }])
  })

  it('shows nothing for a plain tower', () => {
    expect(specialStats(tower({}))).toEqual([])
    expect(specialStats(tower({ multi_shot: 1 }))).toEqual([])
  })

  it('rounds float noise from the server', () => {
    // 0.40 - 0.05*2 arrives as 0.30000000000000004
    expect(specialStats(tower({ slow_multiplier_upgrade: 0.30000000000000004, slow_duration_upgrade: 3 }))[0].value)
      .toBe('30% · 3s')
  })
})

describe('nextLevelChanges', () => {
  it('lists only what changes', () => {
    const cur = tower({ tower_type: 'slow', damage: 5, range: 3, slow_multiplier_upgrade: 0.4, slow_duration_upgrade: 2 })
    expect(nextLevelChanges(cur, {
      level: 2, damage: 6, range: 3.3, slow_multiplier_upgrade: 0.35, slow_duration_upgrade: 2.5,
    })).toEqual(['Damage 5 → 6', 'Range 3 → 3.3', 'Slows to 35% · 2.5s'])
    expect(nextLevelChanges(tower({}), { level: 2, damage: 10, range: 3 })).toEqual([])
  })
})
