// Plain-text stat lines for the tower upgrade panel: the special effects each
// tower type carries (slow, blast, chain, volley) and what the next upgrade
// changes. Pure functions over the server's tower JSON, so they're unit
// tested without a canvas.
import type { Tower, TowerPreview } from '../types/game'

export interface StatLine {
  label: string
  value: string
}

type StatSource = Pick<Tower,
  'slow_duration_upgrade' | 'slow_multiplier_upgrade' | 'aoe_radius_upgrade' |
  'aoe_damage_pct_upgrade' | 'chain_count' | 'chain_radius'> & { multi_shot?: number }

const num = (n: number, digits = 1) => Number(n.toFixed(digits)).toString()
const pct = (n: number) => `${Math.round(n * 100)}%`

// specialStats lists the effects beyond range, damage and rate. A slow
// multiplier is the speed an enemy keeps (0.40 = moves at 40% speed), shown
// as "Slows to 40% · 2s". Blast is radius and splash damage share; Chain is
// jumps × jump reach.
export function specialStats(t: StatSource): StatLine[] {
  const lines: StatLine[] = []
  if ((t.slow_multiplier_upgrade ?? 0) > 0 && (t.slow_duration_upgrade ?? 0) > 0) {
    lines.push({
      label: 'Slows to',
      value: `${pct(t.slow_multiplier_upgrade!)} · ${num(t.slow_duration_upgrade!)}s`,
    })
  }
  if ((t.aoe_radius_upgrade ?? 0) > 0) {
    lines.push({
      label: 'Blast',
      value: `${num(t.aoe_radius_upgrade!)} tiles · ${pct(t.aoe_damage_pct_upgrade ?? 0)}`,
    })
  }
  if ((t.chain_count ?? 0) > 0) {
    lines.push({
      label: 'Chain',
      value: `${t.chain_count} × ${num(t.chain_radius ?? 0)} tiles`,
    })
  }
  if ((t.multi_shot ?? 0) > 1) {
    lines.push({ label: 'Volley', value: `×${t.multi_shot}` })
  }
  return lines
}

// nextLevelChanges describes what one more upgrade changes, stat by stat,
// as "Damage 10 → 12". Unchanged stats are left out.
export function nextLevelChanges(cur: Tower, next: TowerPreview): string[] {
  const out: string[] = []
  if ((cur.damage ?? 0) !== next.damage) out.push(`Damage ${num(cur.damage ?? 0)} → ${num(next.damage)}`)
  if (cur.range !== next.range) out.push(`Range ${num(cur.range, 2)} → ${num(next.range, 2)}`)
  const before = specialStats(cur)
  for (const line of specialStats(next)) {
    const old = before.find(b => b.label === line.label)
    if (!old || old.value !== line.value) out.push(`${line.label} ${line.value}`)
  }
  return out
}
