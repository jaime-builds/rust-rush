import { useEffect, useState } from 'react'
import Dialog from './Dialog'
import { ApiError, Leaderboard, fetchLeaderboard } from '../account/api'
import { GAME_MAPS_BY_SEQUENCE } from '../types/game'

interface Props {
  initialMap: string
  initialDifficulty: 'normal' | 'harder'
  signedIn: boolean
  username: string | null
  onClose: () => void
}

// Public leaderboard: top 10 signed-in players per zone, Normal and Harder
// ranked separately, each player once with their best finished run.
const LeaderboardDialog = ({ initialMap, initialDifficulty, signedIn, username, onClose }: Props) => {
  const [mapId, setMapId] = useState(initialMap)
  const [difficulty, setDifficulty] = useState<'normal' | 'harder'>(initialDifficulty)
  const [board, setBoard] = useState<Leaderboard | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setBoard(null)
    setError('')
    fetchLeaderboard(mapId, difficulty)
      .then(b => { if (!cancelled) setBoard(b) })
      .catch(err => { if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the board.') })
    return () => { cancelled = true }
  }, [mapId, difficulty])

  const meInTop = board?.me && board.entries.some(e => e.username === board.me!.username)

  return (
    <Dialog className="settings-overlay" labelledBy="leaderboard-title" onClose={onClose} onBackdropClick={onClose}>
      <div className="settings-box panel leaderboard-box" onClick={e => e.stopPropagation()}>
        <div className="settings-title" id="leaderboard-title">LEADERBOARD</div>

        <div className="leaderboard-controls">
          <label className="leaderboard-select">
            <span>ZONE</span>
            <select value={mapId} onChange={e => setMapId(e.target.value)}>
              {GAME_MAPS_BY_SEQUENCE.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <span className="mode-group" role="group" aria-label="Difficulty">
            {(['normal', 'harder'] as const).map(d => (
              <button key={d} className={`btn btn-inline ${difficulty === d ? 'btn-toggled' : ''}`}
                aria-pressed={difficulty === d} onClick={() => setDifficulty(d)}>
                {d.toUpperCase()}
              </button>
            ))}
          </span>
        </div>

        {error && <p className="account-error" role="alert">{error}</p>}
        {!board && !error && <p className="account-note" role="status">Loading…</p>}
        {board && board.entries.length === 0 && (
          <p className="account-note">No finished runs on this board yet. Sign in and be the first.</p>
        )}
        {board && board.entries.length > 0 && (
          <table className="leaderboard-table">
            <thead>
              <tr><th>#</th><th>PILOT</th><th>SCORE</th><th>WAVE</th></tr>
            </thead>
            <tbody>
              {board.entries.map(e => (
                <tr key={e.username} className={e.username === username ? 'leaderboard-me' : ''}>
                  <td>{e.rank}</td>
                  <td>{e.username}</td>
                  <td>{e.score.toLocaleString()}</td>
                  <td>{e.wave}</td>
                </tr>
              ))}
              {board.me && !meInTop && (
                <tr className="leaderboard-me leaderboard-gap">
                  <td>{board.me.rank}</td>
                  <td>{board.me.username}</td>
                  <td>{board.me.score.toLocaleString()}</td>
                  <td>{board.me.wave}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {!signedIn && <p className="account-note">Only signed-in players&apos; runs are ranked.</p>}

        <button className="btn btn-big settings-close" onClick={onClose}>CLOSE</button>
      </div>
    </Dialog>
  )
}

export default LeaderboardDialog
