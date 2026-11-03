// Visual theme tables for the board and its HTML controls (moved from GameCanvas.tsx).
import { BaseTowerType, EvolvedTowerType, EnemyType } from '../types/game'

// ————————————————————————————————————————————————————————————————————————
// "NEON IRONLINE" visual theme.
// The one rule: SHAPE is the discriminator, hue is the garnish. Towers are
// static closed hardware polygons (cool accents); enemies are pointed,
// heading-rotated glyphs (warm accents). The design survives grayscale.
// ————————————————————————————————————————————————————————————————————————

export const PALETTE = {
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
export const TOWER_COLORS: Record<string, string> = {
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

export const TOWER_LIGHT: Record<string, string> = {
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
export const TOWER_RANGES: Record<string, number> = {
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

export const TOWER_NAMES: Record<string, string> = {
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
export const TOWER_DESCRIPTIONS: Record<string, string> = {
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
export const ENEMY_COLORS: Record<string, string> = {
  basic: '#FF4655',
  fast: '#FF9E2C',
  tank: '#C7502E',
  flying: '#44ff99',
  boss: '#FF2ED2',
}

export const ENEMY_BODY: Record<string, string> = {
  basic: '#2A0E14',
  fast: '#291606',
  tank: '#200D08',
  flying: '#0E2A1C',
  boss: '#230A1E',
}

// Visual radius per enemy type (px) — drives reticles, bars, stasis cages.
export const ENEMY_RADIUS: Record<string, number> = {
  basic: 10,
  fast: 9,
  tank: 15,
  flying: 10,
  boss: 18,
}

// Enemy stat sheet — kept in sync with server getEnemyStats/getEnemyGoldReward/getEnemyScorePoints.
// 'flying' is omitted: it exists in server stats but never spawns in any wave.
export const ENEMY_GLOSSARY: { type: EnemyType, name: string, health: number, speed: number, gold: number, score: number, appears: string }[] = [
  { type: 'basic', name: 'Dart', health: 100, speed: 2.0, gold: 10, score: 10, appears: 'Wave 1+' },
  { type: 'fast', name: 'Needle', health: 50, speed: 4.0, gold: 8, score: 15, appears: 'Wave 4+' },
  { type: 'tank', name: 'Bastion', health: 300, speed: 1.0, gold: 25, score: 30, appears: 'Wave 7+' },
  { type: 'boss', name: 'Dreadnought', health: 1000, speed: 0.5, gold: 100, score: 100, appears: 'Wave 11+' },
]

// Tower stat sheet — kept in sync with server towerStatsByType / UpgradeTower.
export const TOWER_GLOSSARY: { type: BaseTowerType, damage: number, rate: number, upgradeNote: string }[] = [
  { type: 'basic', damage: 15, rate: 1.0, upgradeNote: 'MK2–4: +20% dmg, +10% range per level' },
  { type: 'sniper', damage: 50, rate: 0.5, upgradeNote: 'MK2–4: +20% dmg, +10% range per level' },
  { type: 'splash', damage: 10, rate: 1.5, upgradeNote: 'MK2–4: +20% dmg, +10% range; blast 1.5u/60% → 2.4u/90%' },
  { type: 'slow', damage: 8, rate: 0.8, upgradeNote: 'MK2–4: +20% dmg, +10% range; slow 2.0s/0.40× → 3.5s/0.25×' },
  { type: 'tesla', damage: 20, rate: 0.8, upgradeNote: 'MK2–4: +20% dmg, +10% range; chain 2×/1.5u → 5×/2.1u' },
]

// Evolution stat lines — kept in sync with server evolvedStatsByType.
export const EVO_STATS: Record<EvolvedTowerType, string> = {
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
export const TOWER_ORDER: BaseTowerType[] = ['basic', 'sniper', 'splash', 'slow', 'tesla']
