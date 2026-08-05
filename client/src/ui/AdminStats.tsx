import { useCallback, useEffect, useState } from 'react'
import { ADMIN_LOGIN_PATH, StatsResponse } from '../types/stats'

interface Props {
  navigate: (to: string) => void
}

// Game-time seconds → m:ss, matching the clock the player saw in game.
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const mins = Math.floor(total / 60)
  return `${mins}:${String(total % 60).padStart(2, '0')}`
}

function formatEndedAt(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

// The private stats dashboard. The session lives in an HTTP-only cookie, so
// "am I logged in?" is only ever answered by the server: a 401 from /stats is
// the signal to bounce back to the login page.
export default function AdminStats({ navigate }: Props) {
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch('/stats', { credentials: 'same-origin' })
        if (cancelled) return
        if (res.status === 401) {
          navigate(ADMIN_LOGIN_PATH)
          return
        }
        if (!res.ok) {
          setError(`Could not load stats (${res.status}).`)
          return
        }
        setStats(await res.json())
      } catch {
        if (!cancelled) setError('Could not reach the server.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [navigate])

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/admin/logout', { method: 'POST', credentials: 'same-origin' })
    } finally {
      navigate(ADMIN_LOGIN_PATH)
    }
  }, [navigate])

  if (loading) {
    return <div className="admin-page"><p className="admin-loading">Loading stats…</p></div>
  }

  if (error || !stats) {
    return (
      <div className="admin-page">
        <p className="admin-error" role="alert">{error || 'No stats available.'}</p>
        <button className="admin-btn" onClick={handleLogout}>LOG OUT</button>
      </div>
    )
  }

  // Bar widths are relative to the busiest wave, so the shape of the drop-off
  // reads at a glance regardless of how many games are recorded.
  const busiestWave = stats.wave_distribution.reduce((max, w) => Math.max(max, w.count), 0)

  return (
    <div className="admin-page admin-stats">
      <header className="admin-stats-header">
        <h1 className="admin-title">🦀 Rust Rush — Stats</h1>
        <button className="admin-btn" onClick={handleLogout}>LOG OUT</button>
      </header>

      <div className="admin-tiles">
        <div className="admin-panel admin-tile">
          <span className="admin-tile-value">{stats.concurrent_players}</span>
          <span className="admin-tile-label">Concurrent players</span>
        </div>
        <div className="admin-panel admin-tile">
          <span className="admin-tile-value">{stats.total_games}</span>
          <span className="admin-tile-label">Total games played</span>
        </div>
      </div>

      <section className="admin-panel admin-section">
        <h2 className="admin-section-title">Wave distribution</h2>
        {stats.wave_distribution.length === 0 ? (
          <p className="admin-empty">No games recorded yet.</p>
        ) : (
          <ul className="admin-waves">
            {stats.wave_distribution.map(w => (
              <li key={w.wave} className="admin-wave-row">
                <span className="admin-wave-label">Wave {w.wave}</span>
                <span className="admin-wave-track">
                  <span
                    className="admin-wave-bar"
                    style={{ width: `${busiestWave ? (w.count / busiestWave) * 100 : 0}%` }}
                  />
                </span>
                <span className="admin-wave-count">{w.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="admin-panel admin-section">
        <h2 className="admin-section-title">Top 10 scores</h2>
        {stats.top_scores.length === 0 ? (
          <p className="admin-empty">No games recorded yet.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Score</th>
                <th>Wave</th>
                <th>Duration</th>
                <th>Ended</th>
              </tr>
            </thead>
            <tbody>
              {stats.top_scores.map((game, i) => (
                <tr key={`${game.ended_at}-${game.score}`}>
                  <td className="admin-rank">{i + 1}</td>
                  <td className="admin-score">{game.score.toLocaleString()}</td>
                  <td>{game.wave}</td>
                  <td>{formatDuration(game.duration_seconds)}</td>
                  <td className="admin-ended">{formatEndedAt(game.ended_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
