// Shape of the private /stats payload. Mirrors statsResponse in
// server/internal/stats/stats.go — keep the two in step.

export interface WaveCount {
  wave: number
  count: number
}

export interface GameRecord {
  ended_at: string
  wave: number
  score: number
  duration_seconds: number
}

export interface StatsResponse {
  concurrent_players: number
  total_games: number
  wave_distribution: WaveCount[]
  top_scores: GameRecord[]
}

// Client-side routes for the admin pages. The server serves index.html for
// both and treats /admin/login as the login API only on POST.
export const ADMIN_LOGIN_PATH = '/admin/login'
export const ADMIN_STATS_PATH = '/admin/stats'
