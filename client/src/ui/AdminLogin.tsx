import { FormEvent, useState } from 'react'
import { ADMIN_LOGIN_PATH, ADMIN_STATS_PATH } from '../types/stats'

interface Props {
  navigate: (to: string) => void
}

// Single-operator login. The server owns the session entirely — on success it
// sets an HTTP-only cookie the page can't read, so there is nothing to stash
// in localStorage and no token to keep in state.
export default function AdminLogin({ navigate }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(ADMIN_LOGIN_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) {
        setError(res.status === 401 ? 'Invalid credentials.' : `Login failed (${res.status}).`)
        return
      }
      setPassword('')
      navigate(ADMIN_STATS_PATH)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="admin-page admin-login">
      <form className="admin-panel admin-login-form" onSubmit={handleSubmit}>
        <h1 className="admin-title">🦀 Rust Rush — Admin</h1>

        <label className="admin-field">
          <span>Username</span>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>

        <label className="admin-field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && <p className="admin-error" role="alert">{error}</p>}

        <button className="admin-btn admin-btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'SIGNING IN…' : 'SIGN IN'}
        </button>
      </form>
    </div>
  )
}
