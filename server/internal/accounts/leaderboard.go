package accounts

import (
	"database/sql"
	"errors"
	"log"
	"net/http"
	"time"
)

// LeaderboardSize is how many players each board shows.
const LeaderboardSize = 10

// Entry is one leaderboard row: a player's best finished run on the board.
type Entry struct {
	Rank     int       `json:"rank"`
	Username string    `json:"username"`
	Score    int       `json:"score"`
	Wave     int       `json:"wave"`
	EndedAt  time.Time `json:"ended_at"`
}

// best is each signed-in player's best run on one board (map + difficulty),
// ties broken by who got there first. Every score is computed by the server,
// so nothing here can be faked from the browser.
const best = `
	SELECT user_id, username, score, wave, ended_at FROM (
		SELECT g.user_id, u.username, g.score, g.wave, g.ended_at,
		       ROW_NUMBER() OVER (PARTITION BY g.user_id ORDER BY g.score DESC, g.ended_at ASC) AS rn
		FROM games g JOIN users u ON u.id = g.user_id
		WHERE g.map_id = ? AND g.difficulty = ?
	) WHERE rn = 1`

// Leaderboard returns the top players on a board.
func (s *Store) Leaderboard(mapID, difficulty string, limit int) ([]Entry, error) {
	rows, err := s.db.Query(best+` ORDER BY score DESC, ended_at ASC LIMIT ?`, mapID, difficulty, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Entry, 0, limit)
	for rows.Next() {
		var e Entry
		var id int64
		var ended string
		if err := rows.Scan(&id, &e.Username, &e.Score, &e.Wave, &ended); err != nil {
			return nil, err
		}
		e.EndedAt, _ = time.Parse(time.RFC3339, ended)
		e.Rank = len(out) + 1
		out = append(out, e)
	}
	return out, rows.Err()
}

// PlayerStanding returns a player's own best entry and rank on a board, or
// nil if they have no finished run there.
func (s *Store) PlayerStanding(userID int64, mapID, difficulty string) (*Entry, error) {
	var e Entry
	var id int64
	var ended string
	err := s.db.QueryRow(`SELECT * FROM (`+best+`) WHERE user_id = ?`, mapID, difficulty, userID).
		Scan(&id, &e.Username, &e.Score, &e.Wave, &ended)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	e.EndedAt, _ = time.Parse(time.RFC3339, ended)
	// Rank = players strictly ahead + 1 (ahead = higher score, or the same
	// score reached earlier).
	err = s.db.QueryRow(`SELECT COUNT(*) + 1 FROM (`+best+`) WHERE score > ? OR (score = ? AND ended_at < ?)`,
		mapID, difficulty, e.Score, e.Score, ended).Scan(&e.Rank)
	return &e, err
}

// ValidBoard reports whether a map ID exists (main passes the game's map
// registry lookup).
type ValidBoard func(mapID string) bool

// LeaderboardHandler serves GET /api/leaderboard?map=<id>&difficulty=normal|harder.
// Public. A signed-in caller also gets their own standing ("me"), even when
// they're outside the top 10.
func (a *API) LeaderboardHandler(valid ValidBoard) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		mapID := r.URL.Query().Get("map")
		difficulty := r.URL.Query().Get("difficulty")
		if difficulty == "" {
			difficulty = "normal"
		}
		if !valid(mapID) || (difficulty != "normal" && difficulty != "harder") {
			writeError(w, http.StatusBadRequest, "unknown board")
			return
		}
		entries, err := a.store.Leaderboard(mapID, difficulty, LeaderboardSize)
		if err != nil {
			log.Printf("leaderboard: %v", err)
			writeError(w, http.StatusInternalServerError, "leaderboard unavailable")
			return
		}
		resp := map[string]any{"map": mapID, "difficulty": difficulty, "entries": entries, "me": nil}
		if u, ok := a.UserFromRequest(r); ok {
			if me, err := a.store.PlayerStanding(u.ID, mapID, difficulty); err == nil && me != nil {
				resp["me"] = me
			}
		}
		// Never cached: a player who just finished a run expects to see it,
		// and a moderated name must disappear at once.
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, resp)
	}
}
