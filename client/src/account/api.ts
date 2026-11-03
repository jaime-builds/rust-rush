// Player account API (optional accounts). The session is an HTTP-only
// cookie the page never reads; every call is same-origin JSON.

export interface Account {
  id: number
  username: string
  created_at: string
  furthest_beaten: number
}

// ApiError carries the server's plain-language message for the form.
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, body === undefined
      ? { credentials: 'same-origin' }
      : {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
  } catch {
    throw new ApiError('Could not reach the server.', 0)
  }
  if (res.status === 204) return undefined as T
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    // non-JSON body (proxy error page)
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error
    throw new ApiError(msg ?? `Request failed (${res.status}).`, res.status)
  }
  return data as T
}

export const fetchMe = () => call<{ user: Account | null }>('/api/account/me').then(r => r.user)

export const login = (username: string, password: string, furthestBeaten: number) =>
  call<{ user: Account }>('/api/account/login', { username, password, furthest_beaten: furthestBeaten }).then(r => r.user)

export const register = (username: string, password: string, furthestBeaten: number) =>
  call<{ user: Account }>('/api/account/register', { username, password, furthest_beaten: furthestBeaten }).then(r => r.user)

export const logout = () => call<void>('/api/account/logout', {})

export const changePassword = (current: string, next: string) =>
  call<void>('/api/account/password', { current, next })

export const deleteAccount = (password: string) => call<void>('/api/account/delete', { password })

// Same rules as the server (accounts.ValidUsername), for instant feedback.
// The server re-checks and has the final word (reserved names, taken names).
export const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,20}$/
export const MIN_PASSWORD = 10
export const MAX_PASSWORD = 128

export interface LeaderboardEntry {
  rank: number
  username: string
  score: number
  wave: number
  ended_at: string
}

export interface Leaderboard {
  map: string
  difficulty: 'normal' | 'harder'
  entries: LeaderboardEntry[]
  // The signed-in player's own best and rank on this board (null = none).
  me: LeaderboardEntry | null
}

export const fetchLeaderboard = (mapId: string, difficulty: 'normal' | 'harder') =>
  call<Leaderboard>(`/api/leaderboard?map=${encodeURIComponent(mapId)}&difficulty=${difficulty}`)

export interface AchievementStatus {
  id: string
  name: string
  description: string
  group: string
  unlocked_at: string | null
  progress?: string
}

export const fetchAchievements = () =>
  call<{ signed_in: boolean; achievements: AchievementStatus[] }>('/api/account/achievements')
