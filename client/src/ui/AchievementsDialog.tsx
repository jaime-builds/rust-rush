import { useEffect, useState } from 'react'
import Dialog from './Dialog'
import { AchievementStatus, ApiError, fetchAchievements } from '../account/api'

interface Props {
  onClose: () => void
}

// The 12 achievements, grouped, with what you've unlocked. Guests see the
// list too, all locked, with a nudge to sign in.
const AchievementsDialog = ({ onClose }: Props) => {
  const [list, setList] = useState<AchievementStatus[] | null>(null)
  const [signedIn, setSignedIn] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchAchievements()
      .then(r => { if (!cancelled) { setList(r.achievements); setSignedIn(r.signed_in) } })
      .catch(err => { if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load achievements.') })
    return () => { cancelled = true }
  }, [])

  const groups = list ? [...new Set(list.map(a => a.group))] : []
  const unlocked = list?.filter(a => a.unlocked_at).length ?? 0

  return (
    <Dialog className="settings-overlay" labelledBy="achievements-title" onClose={onClose} onBackdropClick={onClose}>
      <div className="settings-box panel achievements-box" onClick={e => e.stopPropagation()}>
        <div className="settings-title" id="achievements-title">ACHIEVEMENTS</div>
        {list && <p className="achievements-count">{unlocked} / {list.length} UNLOCKED</p>}
        {!signedIn && list && <p className="account-note">Sign in to earn achievements. The server awards them as you play.</p>}
        {error && <p className="account-error" role="alert">{error}</p>}
        {!list && !error && <p className="account-note" role="status">Loading…</p>}
        {groups.map(group => (
          <section key={group} className="achievements-group">
            <h3 className="account-section-title">{group.toUpperCase()}</h3>
            <ul>
              {list!.filter(a => a.group === group).map(a => (
                <li key={a.id} className={`achievement ${a.unlocked_at ? 'unlocked' : ''}`}>
                  <span className="achievement-mark" aria-hidden="true">{a.unlocked_at ? '◆' : '◇'}</span>
                  <span className="achievement-body">
                    <span className="achievement-name">
                      {a.name}
                      <span className="sr-only">{a.unlocked_at ? ' (unlocked)' : ' (locked)'}</span>
                    </span>
                    <span className="achievement-desc">{a.description}</span>
                  </span>
                  {a.progress && !a.unlocked_at && <span className="achievement-progress">{a.progress}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
        <button className="btn btn-big settings-close" onClick={onClose}>CLOSE</button>
      </div>
    </Dialog>
  )
}

export default AchievementsDialog
