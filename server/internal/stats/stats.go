// Package stats persists one row per completed game to SQLite and serves the
// private /stats JSON endpoint. A row carries an account ID only when a
// signed-in player finished the run (that is what the public leaderboard
// reads); the stats endpoint itself never exposes it.
//
// The driver is modernc.org/sqlite (pure Go, no cgo): this dev machine has no
// C toolchain, and a cgo driver (mattn/go-sqlite3) would not even build here.
package stats

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// GameRecord is one completed game. Duration is game-time seconds (fast
// forward compresses it, matching what the player experienced on the clock
// shown in game).
type GameRecord struct {
	EndedAt  time.Time `json:"ended_at"`
	Wave     int       `json:"wave"`
	Score    int       `json:"score"`
	Duration float64   `json:"duration_seconds"`
	// Run details (since Nov 3, 2026; older rows have defaults). UserID is 0
	// for guests. Not part of the /stats JSON.
	UserID     int64  `json:"-"`
	MapID      string `json:"-"`
	Difficulty string `json:"-"`
	Endless    bool   `json:"-"`
	Victory    bool   `json:"-"`
}

// WaveCount is one entry of the wave-reached distribution.
type WaveCount struct {
	Wave  int `json:"wave"`
	Count int `json:"count"`
}

// Store wraps the SQLite database. Safe for concurrent use (database/sql
// pools; modernc.org/sqlite serializes writers).
type Store struct {
	db *sql.DB
}

// Open opens (creating if needed) the stats database at path, including any
// missing parent directories — the production path lives on a mounted volume.
func Open(path string) (*Store, error) {
	if dir := filepath.Dir(path); dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	// busy_timeout: a concurrent write (game over in another room) waits
	// briefly instead of failing with SQLITE_BUSY.
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS games (
			id               INTEGER PRIMARY KEY AUTOINCREMENT,
			ended_at         TEXT    NOT NULL,
			wave             INTEGER NOT NULL,
			score            INTEGER NOT NULL,
			duration_seconds REAL    NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_games_score ON games(score DESC);
	`); err != nil {
		db.Close()
		return nil, err
	}
	if err := migrateGames(db); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

// migrateGames adds the run-detail columns to a games table created before
// accounts existed. Each ALTER runs only if its column is missing, so this is
// safe on every start.
func migrateGames(db *sql.DB) error {
	have := map[string]bool{}
	rows, err := db.Query(`PRAGMA table_info(games)`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var cid, notnull, pk int
		var name, typ string
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &typ, &notnull, &dflt, &pk); err != nil {
			rows.Close()
			return err
		}
		have[name] = true
	}
	rows.Close()
	add := []struct{ name, def string }{
		{"user_id", "INTEGER"},
		{"map_id", "TEXT NOT NULL DEFAULT ''"},
		{"difficulty", "TEXT NOT NULL DEFAULT 'normal'"},
		{"endless", "INTEGER NOT NULL DEFAULT 0"},
		{"victory", "INTEGER NOT NULL DEFAULT 0"},
	}
	for _, c := range add {
		if have[c.name] {
			continue
		}
		if _, err := db.Exec(`ALTER TABLE games ADD COLUMN ` + c.name + " " + c.def); err != nil {
			return err
		}
	}
	_, err = db.Exec(`CREATE INDEX IF NOT EXISTS idx_games_board ON games(map_id, difficulty, user_id, score DESC)`)
	return err
}

// DB exposes the database so the accounts store can keep its tables in the
// same file (one volume, one backup).
func (s *Store) DB() *sql.DB { return s.db }

func (s *Store) Close() error {
	return s.db.Close()
}

// RecordGame inserts one completed game.
func (s *Store) RecordGame(r GameRecord) error {
	var user any
	if r.UserID > 0 {
		user = r.UserID
	}
	difficulty := r.Difficulty
	if difficulty == "" {
		difficulty = "normal"
	}
	_, err := s.db.Exec(
		`INSERT INTO games (ended_at, wave, score, duration_seconds, user_id, map_id, difficulty, endless, victory)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.EndedAt.UTC().Format(time.RFC3339), r.Wave, r.Score, r.Duration,
		user, r.MapID, difficulty, r.Endless, r.Victory,
	)
	return err
}

// TotalGames returns the number of completed games recorded.
func (s *Store) TotalGames() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM games`).Scan(&n)
	return n, err
}

// WaveDistribution returns how many games ended at each wave, ascending.
func (s *Store) WaveDistribution() ([]WaveCount, error) {
	rows, err := s.db.Query(`SELECT wave, COUNT(*) FROM games GROUP BY wave ORDER BY wave`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	dist := make([]WaveCount, 0)
	for rows.Next() {
		var wc WaveCount
		if err := rows.Scan(&wc.Wave, &wc.Count); err != nil {
			return nil, err
		}
		dist = append(dist, wc)
	}
	return dist, rows.Err()
}

// TopScores returns the n highest-scoring games, best first.
func (s *Store) TopScores(n int) ([]GameRecord, error) {
	rows, err := s.db.Query(
		`SELECT ended_at, wave, score, duration_seconds FROM games ORDER BY score DESC, ended_at ASC LIMIT ?`, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	top := make([]GameRecord, 0, n)
	for rows.Next() {
		var r GameRecord
		var endedAt string
		if err := rows.Scan(&endedAt, &r.Wave, &r.Score, &r.Duration); err != nil {
			return nil, err
		}
		r.EndedAt, _ = time.Parse(time.RFC3339, endedAt)
		top = append(top, r)
	}
	return top, rows.Err()
}

// statsResponse is the /stats endpoint payload.
type statsResponse struct {
	ConcurrentPlayers int          `json:"concurrent_players"`
	TotalGames        int          `json:"total_games"`
	WaveDistribution  []WaveCount  `json:"wave_distribution"`
	TopScores         []GameRecord `json:"top_scores"`
}

// Handler serves the private stats JSON. playerCount reads the live client
// count from the hub; everything else comes from the database.
func Handler(store *Store, playerCount func() int) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		total, err := store.TotalGames()
		if err != nil {
			http.Error(w, "stats query failed", http.StatusInternalServerError)
			log.Printf("stats: total games query failed: %v", err)
			return
		}
		dist, err := store.WaveDistribution()
		if err != nil {
			http.Error(w, "stats query failed", http.StatusInternalServerError)
			log.Printf("stats: wave distribution query failed: %v", err)
			return
		}
		top, err := store.TopScores(10)
		if err != nil {
			http.Error(w, "stats query failed", http.StatusInternalServerError)
			log.Printf("stats: top scores query failed: %v", err)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(statsResponse{
			ConcurrentPlayers: playerCount(),
			TotalGames:        total,
			WaveDistribution:  dist,
			TopScores:         top,
		})
	}
}
