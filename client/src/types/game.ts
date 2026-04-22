export interface Position {
  x: number
  y: number
}

export type TowerType = 'basic' | 'sniper' | 'splash' | 'slow'
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
  path?: Position[]
  path_index?: number
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

export interface GameState {
  room_id?: string
  players?: string[]
  towers: Tower[]
  enemies: Enemy[]
  projectiles: Projectile[]
  muzzle_flashes: MuzzleFlash[]
  explosions: Explosion[]
  gold: number
  health: number
  wave: number
  phase: GamePhase
  enemies_remaining: number
  game_time: number
  spawn_point?: Position
  goal_point?: Position
}

// Tower costs — kept in sync with server
export const TOWER_COSTS: Record<TowerType, number> = {
  basic: 50,
  sniper: 100,
  splash: 75,
  slow: 60,
}
