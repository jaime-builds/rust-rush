// Inline SVG tower and enemy icons, and the map-select thumbnails.
import { TowerType, GameMapInfo } from '../types/game'
import { PALETTE, TOWER_COLORS, ENEMY_COLORS, ENEMY_BODY } from './theme'

// ————————————————————————————————————————————————————————————————————————
// Inline SVG silhouettes — the HTML buttons and legends share the canvas
// shape language, so the UI teaches shapes, not hues.
// ————————————————————————————————————————————————————————————————————————

export const TowerIcon = ({ type, size = 20 }: { type: TowerType, size?: number }) => {
  const c = TOWER_COLORS[type]
  const common = { fill: PALETTE.platefill, stroke: c, strokeWidth: 2 }
  return (
    <svg width={size} height={size} viewBox="-20 -20 40 40" aria-hidden="true">
      {type === 'basic' && (<>
        <polygon points="12.9,5.4 5.4,12.9 -5.4,12.9 -12.9,5.4 -12.9,-5.4 -5.4,-12.9 5.4,-12.9 12.9,-5.4" {...common} />
        <rect x="2" y="-3" width="15" height="6" fill={c} stroke="none" />
      </>)}
      {type === 'sniper' && (<>
        <polygon points="0,-15 15,0 0,15 -15,0" {...common} />
        <rect x="1" y="-3" width="18" height="2" fill={c} stroke="none" />
        <rect x="1" y="1" width="18" height="2" fill={c} stroke="none" />
      </>)}
      {type === 'splash' && (<>
        <polygon points="-14,-9 -9,-14 9,-14 14,-9 14,9 9,14 -9,14 -14,9" {...common} />
        <rect x="0" y="-5" width="12" height="10" fill={c} stroke="none" />
      </>)}
      {type === 'slow' && (<>
        <polygon points="0,-14 12.1,-7 12.1,7 0,14 -12.1,7 -12.1,-7" {...common} />
        <polygon points="5,-2.5 14,0 5,2.5" fill={c} stroke="none" />
        <polygon points="-1.3,3.9 -7,12.1 -4.6,2.9" fill={c} stroke="none" />
        <polygon points="-4.6,-2.9 -7,-12.1 -1.3,-3.9" fill={c} stroke="none" />
      </>)}
      {type === 'tesla' && (<>
        <polygon points="15,-6 6,-6 6,-15 -6,-15 -6,-6 -15,-6 -15,6 -6,6 -6,15 6,15 6,6 15,6" {...common} />
        <polyline points="-3,-8 3,-2 -2,0 4,8" fill="none" stroke={c} strokeWidth="2" />
      </>)}
      {type === 'breach' && (<>
        <polygon points="0,-15 14.3,-4.6 8.8,12.1 -8.8,12.1 -14.3,-4.6" {...common} />
        <rect x="2" y="-6" width="13" height="4.5" fill={c} stroke="none" />
        <rect x="2" y="1.5" width="13" height="4.5" fill={c} stroke="none" />
      </>)}
      {type === 'barrage' && (<>
        <polygon points="-15,-10 15,-10 10,12 -10,12" {...common} />
        <rect x="3" y="-7" width="12" height="3" fill={c} stroke="none" transform="rotate(-12)" />
        <rect x="3" y="-1.5" width="12" height="3" fill={c} stroke="none" />
        <rect x="3" y="4" width="12" height="3" fill={c} stroke="none" transform="rotate(12)" />
      </>)}
      {type === 'piercer' && (<>
        <polygon points="17,0 9,-8 -9,-8 -17,0 -9,8 9,8" {...common} />
        <rect x="-14" y="-1.25" width="33" height="2.5" fill={c} stroke="none" />
      </>)}
      {type === 'executioner' && (<>
        <polygon points="0,15 -14.3,4.6 -8.8,-12.1 8.8,-12.1 14.3,4.6" {...common} />
        <rect x="0" y="-2" width="12" height="4" fill={c} stroke="none" />
        <polygon points="11,-6 19,0 11,6" fill={c} stroke="none" />
      </>)}
      {type === 'cluster' && (<>
        <polygon points="13.5,3.6 9.9,9.9 3.6,13.5 -3.6,13.5 -9.9,9.9 -13.5,3.6 -13.5,-3.6 -9.9,-9.9 -3.6,-13.5 3.6,-13.5 9.9,-9.9 13.5,-3.6" {...common} />
        <circle cx="6" cy="-4" r="2" fill={c} />
        <circle cx="8" cy="1" r="2" fill={c} />
        <circle cx="5" cy="6" r="2" fill={c} />
      </>)}
      {type === 'siege' && (<>
        <rect x="-13" y="-13" width="26" height="26" {...common} />
        <rect x="0" y="-5.5" width="16" height="11" fill={c} stroke="none" />
      </>)}
      {type === 'cryo_field' && (<>
        <polygon points="0,-15 4,-6.9 13,-7.5 8,0 13,7.5 4,6.9 0,15 -4,6.9 -13,7.5 -8,0 -13,-7.5 -4,-6.9" {...common} />
        <circle r="3" fill={c} />
      </>)}
      {type === 'deep_freeze' && (<>
        <polygon points="0,-17 9,-8 9,8 0,17 -9,8 -9,-8" {...common} />
        <polyline points="-4,-8 3,0 -3,8" fill="none" stroke={c} strokeWidth="2" />
      </>)}
      {type === 'laser' && (<>
        <circle r="13" {...common} />
        <circle r="5" fill="none" stroke={c} strokeWidth="2" />
        <circle r="1.75" fill={c} />
      </>)}
      {type === 'amplifier' && (<>
        <polygon points="0,-15 13,7.5 -13,7.5" {...common} />
        <polygon points="0,-8 7,4.5 -7,4.5" fill="none" stroke={c} strokeWidth="1.5" />
        <circle cy="1" r="2" fill={c} />
      </>)}
    </svg>
  )
}

export const EnemyGlyph = ({ type, size = 14 }: { type: string, size?: number }) => {
  const c = ENEMY_COLORS[type] ?? PALETTE.danger
  const body = ENEMY_BODY[type] ?? '#1A0A0E'
  return (
    <svg width={size} height={size} viewBox="-16 -16 32 32" aria-hidden="true">
      {type === 'basic' && <polygon points="10,0 -8,-7 -4,0 -8,7" fill={body} stroke={c} strokeWidth="2" />}
      {type === 'fast' && <polygon points="13,0 -9,-6 -3,0 -9,6" fill={body} stroke={c} strokeWidth="2" />}
      {type === 'tank' && (<>
        <polygon points="12,0 5.6,-8.8 -8,-8.8 -12,0 -8,8.8 5.6,8.8" fill={body} stroke={c} strokeWidth="2" />
        <polygon points="7.4,0 3.5,-5.5 -5,-5.5 -7.4,0 -5,5.5 3.5,5.5" fill="none" stroke={c} strokeWidth="1" opacity="0.7" />
      </>)}
      {type === 'boss' && (<>
        <polygon points="9.2,3.8 3.8,9.2 -3.8,9.2 -9.2,3.8 -9.2,-3.8 -3.8,-9.2 3.8,-9.2 9.2,-3.8" fill={body} stroke={c} strokeWidth="2" />
        <circle r="2.5" fill="#FFFFFF" />
      </>)}
    </svg>
  )
}

// MapThumb — miniature schematic of one map for the selection screen: the
// 20×15 board with wall cells, spawn, and goal. Drawn from the client-side
// GAME_MAPS mirror (previews only — in-game walls come from the server).
export const MapThumb = ({ map }: { map: GameMapInfo }) => (
  <svg viewBox="0 0 20 15" className="map-thumb" aria-hidden="true">
    <rect x="0" y="0" width="20" height="15" fill={PALETTE.bgDeep} />
    {map.obstacles.map((o, i) => (
      <rect key={i} x={o.x} y={o.y} width="1" height="1" fill={PALETTE.wallEdge} />
    ))}
    <rect x="0" y="7" width="1" height="1" fill={PALETTE.spawn} />
    <rect x="19" y="7" width="1" height="1" fill={PALETTE.goal} />
  </svg>
)
