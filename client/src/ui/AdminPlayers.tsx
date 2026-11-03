import { FormEvent, useCallback, useEffect, useState } from 'react'

interface AdminUser {
  id: number
  username: string
  created_at: string
  furthest_beaten: number
  games: number
}

const post = (path: string, body: unknown) =>
  fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const errorOf = async (res: Response) => {
  try {
    return ((await res.json()) as { error?: string }).error ?? `Failed (${res.status}).`
  } catch {
    return `Failed (${res.status}).`
  }
}

// Player moderation on the stats page: search accounts, rename an
// unsuitable username, or remove an account (its save and achievements go,
// its leaderboard rows disappear, anonymous game stats stay).
export default function AdminPlayers() {
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState('')
  const [renaming, setRenaming] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)

  const load = useCallback(async (q: string) => {
    setError('')
    try {
      const res = await fetch(`/admin/api/users?q=${encodeURIComponent(q)}`, { credentials: 'same-origin' })
      if (!res.ok) {
        setError(await errorOf(res))
        return
      }
      setUsers(((await res.json()) as { users: AdminUser[] }).users)
    } catch {
      setError('Could not reach the server.')
    }
  }, [])

  useEffect(() => { load('') }, [load])

  const search = (e: FormEvent) => {
    e.preventDefault()
    load(query)
  }

  const rename = async (id: number) => {
    const res = await post('/admin/api/users/rename', { id, username: newName }).catch(() => null)
    if (!res) { setError('Could not reach the server.'); return }
    if (!res.ok) { setError(await errorOf(res)); return }
    setRenaming(null)
    setNewName('')
    load(query)
  }

  const remove = async (id: number) => {
    const res = await post('/admin/api/users/delete', { id }).catch(() => null)
    if (!res) { setError('Could not reach the server.'); return }
    if (!res.ok) { setError(await errorOf(res)); return }
    setConfirmDelete(null)
    load(query)
  }

  return (
    <section className="admin-panel admin-section">
      <h2 className="admin-section-title">Players</h2>
      <form className="admin-players-search" onSubmit={search}>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search usernames"
          aria-label="Search usernames"
        />
        <button className="admin-btn" type="submit">SEARCH</button>
      </form>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {users && users.length === 0 && <p className="admin-empty">No players found.</p>}
      {users && users.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr><th>Username</th><th>Joined</th><th>Games</th><th>Zones</th><th></th></tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>
                  {renaming === u.id ? (
                    <form onSubmit={e => { e.preventDefault(); rename(u.id) }} className="admin-inline-form">
                      <input value={newName} onChange={e => setNewName(e.target.value)} aria-label={`New name for ${u.username}`} autoFocus maxLength={20} />
                      <button className="admin-btn" type="submit">SAVE</button>
                      <button className="admin-btn" type="button" onClick={() => setRenaming(null)}>CANCEL</button>
                    </form>
                  ) : u.username}
                </td>
                <td>{new Date(u.created_at).toLocaleDateString()}</td>
                <td>{u.games}</td>
                <td>{u.furthest_beaten}/6</td>
                <td className="admin-actions">
                  {renaming !== u.id && (
                    <button className="admin-btn" onClick={() => { setRenaming(u.id); setNewName(u.username) }}>RENAME</button>
                  )}
                  {confirmDelete === u.id ? (
                    <>
                      <button className="admin-btn admin-btn-danger" onClick={() => remove(u.id)}>CONFIRM REMOVE</button>
                      <button className="admin-btn" onClick={() => setConfirmDelete(null)}>KEEP</button>
                    </>
                  ) : (
                    <button className="admin-btn" onClick={() => setConfirmDelete(u.id)}>REMOVE</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
