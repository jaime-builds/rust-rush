export interface Position {
  x: number
  y: number
}

// Board geometry — single client-side source; the server hardcodes the same
// 20×15 grid in state.go findPath.
export const GRID_WIDTH = 20
export const GRID_HEIGHT = 15
export const CELL_SIZE = 40

// The five placeable base towers.
export type BaseTowerType = 'basic' | 'sniper' | 'splash' | 'slow' | 'tesla'
// The ten permanent terminal forms (two per base tower).
export type EvolvedTowerType =
  | 'breach' | 'barrage'          // ← basic (Pulse)
  | 'piercer' | 'executioner'     // ← sniper (Railgun)
  | 'cluster' | 'siege'           // ← splash (Mortar)
  | 'cryo_field' | 'deep_freeze'  // ← slow (Stasis)
  | 'laser' | 'amplifier'         // ← tesla
export type TowerType = BaseTowerType | EvolvedTowerType
export type EnemyType = 'basic' | 'fast' | 'tank' | 'flying' | 'boss'
// 'victory': a non-Endless run whose wave counter reached the map's win wave.
export type GamePhase = 'waiting' | 'active' | 'game_over' | 'victory'
// Run-level settings, chosen at deploy time (Harder/Endless unlock per map
// by beating it).
export type Difficulty = 'normal' | 'harder'

export interface Tower {
  id: number
  position: Position
  tower_type: TowerType
  level: number
  range: number
  damage?: number
  fire_rate?: number
  cooldown?: number
  rotation?: number
  current_target?: number
  total_spent?: number
  slow_duration_upgrade?: number
  slow_multiplier_upgrade?: number
  aoe_radius_upgrade?: number
  aoe_damage_pct_upgrade?: number
  chain_count?: number
  chain_radius?: number
  evolved?: boolean
  multi_shot?: number
}

export interface Enemy {
  id: number
  position: Position
  enemy_type: EnemyType
  health: number
  max_health: number
  speed: number
  slow_duration?: number
  slow_multiplier?: number
  root_duration?: number
}

export interface Projectile {
  id: number
  position: Position
  target_id: number
  speed: number
  damage: number
  tower_id: number
  is_aoe?: boolean
  aoe_radius?: number
  aoe_damage?: number
  pierce?: boolean
}

// Short-lived lightning arc between two points (Tesla chain hits).
export interface Arc {
  id: number
  from: Position
  to: Position
  duration: number
}

export interface MuzzleFlash {
  id: number
  position: Position
  duration: number
}

export interface Explosion {
  id: number
  position: Position
  duration: number
  radius: number
}

export interface WavePreviewEntry {
  enemy_type: EnemyType
  count: number
}

export interface GameState {
  room_id?: string
  players?: string[]
  towers: Tower[]
  enemies: Enemy[]
  projectiles: Projectile[]
  muzzle_flashes: MuzzleFlash[]
  explosions: Explosion[]
  arcs?: Arc[]
  gold: number
  health: number
  score: number
  wave: number
  phase: GamePhase
  enemies_remaining: number
  game_time: number
  fast_forward?: boolean
  speed_multiplier?: number
  paused?: boolean
  // Run settings echoed by the server (set via new_game / continue_endless).
  difficulty?: Difficulty
  endless?: boolean
  spawn_point?: Position
  goal_point?: Position
  // Static map walls (server-authoritative): enemies path around them,
  // towers cannot be built on them.
  obstacles?: Position[]
  // The room's current map (see GAME_MAPS / server MapRegistry).
  map_id?: string
  wave_preview?: WavePreviewEntry[]
}

// Tower costs — kept in sync with server
export const TOWER_COSTS: Record<BaseTowerType, number> = {
  basic: 50,
  sniper: 100,
  splash: 75,
  slow: 60,
  tesla: 150,
}

// Evolution paths — kept in sync with server evolutionOptions
export const EVOLUTION_OPTIONS: Record<BaseTowerType, [EvolvedTowerType, EvolvedTowerType]> = {
  basic: ['breach', 'barrage'],
  sniper: ['piercer', 'executioner'],
  splash: ['cluster', 'siege'],
  slow: ['cryo_field', 'deep_freeze'],
  tesla: ['laser', 'amplifier'],
}

export const isEvolvedType = (t: TowerType): t is EvolvedTowerType => !(t in TOWER_COSTS)

// --- Map roster ------------------------------------------------------------
// Mirrored from server MapRegistry (map.go) — kept in sync by hand, same as
// TOWER_COSTS. The obstacle lists here are ONLY for the map-select previews;
// in-game rendering always uses the server's obstacles from the snapshot.

export interface GameMapInfo {
  id: string
  name: string
  tagline: string
  // Progression chain position (1-6) and the wave a non-Endless run must
  // reach to win — mirrored from server MapDef (map.go), kept in sync by
  // hand like everything else in this file. A map is selectable when its
  // sequenceOrder ≤ furthest-beaten + 1 (see readFurthestBeaten).
  sequenceOrder: number
  winWave: number
  obstacles: Position[]
}

const vwall = (x: number, y0: number, y1: number): Position[] =>
  Array.from({ length: y1 - y0 + 1 }, (_, i) => ({ x, y: y0 + i }))
const hwall = (y: number, x0: number, x1: number): Position[] =>
  Array.from({ length: x1 - x0 + 1 }, (_, i) => ({ x: x0 + i, y }))
const block = (x0: number, y0: number, x1: number, y1: number): Position[] => {
  const cells: Position[] = []
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push({ x, y })
  return cells
}

export const GAME_MAPS: GameMapInfo[] = [
  {
    id: 'open', name: 'THE CLEARWAY', tagline: 'No cover. No excuses.',
    sequenceOrder: 1, winWave: 25, obstacles: [],
  },
  {
    id: 'switchback', name: 'THE SWITCHBACK', tagline: 'Three bulkheads, one long S-route.',
    sequenceOrder: 2, winWave: 35,
    obstacles: [...vwall(4, 0, 10), ...vwall(9, 4, 14), ...vwall(15, 0, 10)],
  },
  {
    id: 'gauntlet', name: 'THE GAUNTLET', tagline: 'One straight canyon. Line the walls.',
    sequenceOrder: 4, winWave: 35,
    obstacles: [...hwall(5, 3, 16), ...hwall(9, 3, 16)],
  },
  {
    id: 'crucible', name: 'THE CRUCIBLE', tagline: 'A central island. Flip the flow around it.',
    sequenceOrder: 6, winWave: 50,
    obstacles: block(8, 5, 11, 9),
  },
  {
    id: 'needle', name: 'THE NEEDLE', tagline: 'Every hostile files through one cell.',
    sequenceOrder: 3, winWave: 35,
    obstacles: [...vwall(10, 0, 6), ...vwall(10, 8, 14)],
  },
  {
    id: 'pylons', name: 'THE PYLON FIELD', tagline: 'Scattered hard cover. Build your own maze.',
    sequenceOrder: 5, winWave: 50,
    obstacles: [
      ...block(3, 2, 4, 3), ...block(3, 11, 4, 12), ...block(8, 6, 9, 7),
      ...block(11, 2, 12, 3), ...block(11, 11, 12, 12), ...block(15, 6, 16, 7),
    ],
  },
]

// The progression chain: GAME_MAPS in sequence order (1-6). The map-select
// screen renders this so the unlock chain reads left-to-right.
export const GAME_MAPS_BY_SEQUENCE: GameMapInfo[] =
  [...GAME_MAPS].sort((a, b) => a.sequenceOrder - b.sequenceOrder)
