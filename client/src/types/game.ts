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
export type GamePhase = 'waiting' | 'active' | 'game_over'

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
  spawn_point?: Position
  goal_point?: Position
  // Static map walls (server-authoritative): enemies path around them,
  // towers cannot be built on them.
  obstacles?: Position[]
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
