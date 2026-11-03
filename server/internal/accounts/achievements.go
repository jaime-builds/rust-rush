package accounts

import (
	"database/sql"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"rust-rush/server/internal/game"
)

// Achievement is one entry of the fixed list (agreed Nov 3, 2026).
type Achievement struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Group       string `json:"group"`
}

// Totals the cumulative achievements count up to.
const (
	zoneCount      = 6
	baseTowerCount = 5
	bossTarget     = 100
)

// Achievements is the list, in display order. Each has a yes/no rule the
// server checks from run events, so none can be faked from the browser.
var Achievements = []Achievement{
	{"first_contact", "First Contact", "Clear wave 1.", "Progress"},
	{"zone_secured", "Zone Secured", "Secure any zone (reach its win wave).", "Progress"},
	{"full_sweep", "Full Sweep", "Secure all 6 zones.", "Progress"},
	{"hard_line", "Hard Line", "Secure a zone on Harder.", "Difficulty"},
	{"hardened", "Hardened", "Secure all 6 zones on Harder.", "Difficulty"},
	{"untouched", "Untouched", "Reach wave 15 without losing any health.", "Difficulty"},
	{"endurance", "Endurance", "Reach wave 50 in Endless.", "Difficulty"},
	{"metamorph", "Metamorph", "Evolve a tower.", "Building"},
	{"full_spectrum", "Full Spectrum", "Evolve each of the 5 base towers (across all your runs).", "Building"},
	{"fortress", "Fortress", "Have 20 towers on the board at once.", "Building"},
	{"minimalist", "Minimalist", "Secure a zone with 6 towers or fewer.", "Building"},
	{"boss_breaker", "Boss Breaker", "Destroy 100 bosses (across all your runs).", "Combat"},
}

var achievementByID = func() map[string]Achievement {
	m := make(map[string]Achievement, len(Achievements))
	for _, a := range Achievements {
		m[a.ID] = a
	}
	return m
}()

// ensureUserColumns adds achievement-tracking columns a users table from an
// earlier build of this feature might lack.
func ensureUserColumns(db *sql.DB) error {
	have := map[string]bool{}
	rows, err := db.Query(`PRAGMA table_info(users)`)
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
	for _, col := range []string{"secured_maps", "secured_harder"} {
		if !have[col] {
			if _, err := db.Exec(`ALTER TABLE users ADD COLUMN ` + col + ` TEXT NOT NULL DEFAULT ''`); err != nil {
				return err
			}
		}
	}
	return nil
}

// set helpers for the comma-separated columns.
func addToSet(set, item string) (string, int) {
	items := map[string]bool{}
	for _, s := range strings.Split(set, ",") {
		if s != "" {
			items[s] = true
		}
	}
	items[item] = true
	out := make([]string, 0, len(items))
	for s := range items {
		out = append(out, s)
	}
	sort.Strings(out)
	return strings.Join(out, ","), len(out)
}

// addToSetColumn adds item to a set column and returns the new size.
func (s *Store) addToSetColumn(userID int64, column, item string) (int, error) {
	var cur string
	if err := s.db.QueryRow(`SELECT `+column+` FROM users WHERE id = ?`, userID).Scan(&cur); err != nil {
		return 0, err
	}
	next, n := addToSet(cur, item)
	if next != cur {
		if _, err := s.db.Exec(`UPDATE users SET `+column+` = ? WHERE id = ?`, next, userID); err != nil {
			return 0, err
		}
	}
	return n, nil
}

// award records an achievement; true when it is new.
func (s *Store) award(userID int64, id string) bool {
	res, err := s.db.Exec(`INSERT OR IGNORE INTO achievements (user_id, achievement, unlocked_at) VALUES (?, ?, ?)`,
		userID, id, s.stamp(s.now()))
	if err != nil {
		log.Printf("achievements: award %s to %d: %v", id, userID, err)
		return false
	}
	n, _ := res.RowsAffected()
	return n == 1
}

// HandleEvent applies one run event and returns the achievements it newly
// unlocked. Events arrive on one goroutine (the game's event queue), so the
// read-then-write counters here don't race each other.
func (s *Store) HandleEvent(userID int64, ev game.Event) []Achievement {
	var ids []string
	switch ev.Kind {
	case game.EventWaveReached:
		if ev.Wave >= 2 {
			ids = append(ids, "first_contact")
		}
		if ev.Wave >= 15 && ev.Untouched {
			ids = append(ids, "untouched")
		}
		if ev.Endless && ev.Wave >= 50 {
			ids = append(ids, "endurance")
		}
	case game.EventVictory:
		ids = append(ids, "zone_secured")
		if ev.TowerCount <= 6 {
			ids = append(ids, "minimalist")
		}
		if n, err := s.addToSetColumn(userID, "secured_maps", ev.MapID); err == nil && n >= zoneCount {
			ids = append(ids, "full_sweep")
		}
		if ev.Difficulty == game.DifficultyHarder {
			ids = append(ids, "hard_line")
			if n, err := s.addToSetColumn(userID, "secured_harder", ev.MapID); err == nil && n >= zoneCount {
				ids = append(ids, "hardened")
			}
		}
	case game.EventTowerCount:
		if ev.TowerCount >= 20 {
			ids = append(ids, "fortress")
		}
	case game.EventEvolved:
		ids = append(ids, "metamorph")
		if n, err := s.addToSetColumn(userID, "evolved_bases", ev.Base); err == nil && n >= baseTowerCount {
			ids = append(ids, "full_spectrum")
		}
	case game.EventBossKilled:
		var total int
		if err := s.db.QueryRow(`UPDATE users SET bosses_killed = bosses_killed + ? WHERE id = ? RETURNING bosses_killed`,
			ev.Count, userID).Scan(&total); err == nil && total >= bossTarget {
			ids = append(ids, "boss_breaker")
		}
	}
	var unlocked []Achievement
	for _, id := range ids {
		if s.award(userID, id) {
			unlocked = append(unlocked, achievementByID[id])
		}
	}
	return unlocked
}

// AchievementStatus is an achievement plus whether (and when) the player has it.
type AchievementStatus struct {
	Achievement
	UnlockedAt *time.Time `json:"unlocked_at"`
	// Progress for the cumulative ones, "3/5" style; empty for the rest.
	Progress string `json:"progress,omitempty"`
}

// AchievementsFor lists every achievement with the player's state.
func (s *Store) AchievementsFor(userID int64) ([]AchievementStatus, error) {
	got := map[string]time.Time{}
	rows, err := s.db.Query(`SELECT achievement, unlocked_at FROM achievements WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, at string
		if err := rows.Scan(&id, &at); err != nil {
			rows.Close()
			return nil, err
		}
		t, _ := time.Parse(time.RFC3339, at)
		got[id] = t
	}
	rows.Close()

	var bosses int
	var maps, harder, bases string
	s.db.QueryRow(`SELECT bosses_killed, secured_maps, secured_harder, evolved_bases FROM users WHERE id = ?`, userID).
		Scan(&bosses, &maps, &harder, &bases)
	count := func(set string) int {
		if set == "" {
			return 0
		}
		return len(strings.Split(set, ","))
	}
	progress := map[string]string{
		"full_sweep":    progressOf(count(maps), zoneCount),
		"hardened":      progressOf(count(harder), zoneCount),
		"full_spectrum": progressOf(count(bases), baseTowerCount),
		"boss_breaker":  progressOf(bosses, bossTarget),
	}

	out := make([]AchievementStatus, 0, len(Achievements))
	for _, a := range Achievements {
		st := AchievementStatus{Achievement: a, Progress: progress[a.ID]}
		if t, ok := got[a.ID]; ok {
			t := t
			st.UnlockedAt = &t
		}
		out = append(out, st)
	}
	return out, nil
}

func progressOf(n, total int) string {
	if n > total {
		n = total
	}
	return strconv.Itoa(n) + "/" + strconv.Itoa(total)
}

// handleAchievements serves GET /api/account/achievements: the full list,
// with unlock times and progress for a signed-in player, all locked for a
// guest (so the list can be shown before signing in).
func (a *API) handleAchievements(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	u, ok := a.UserFromRequest(r)
	if !ok {
		list := make([]AchievementStatus, 0, len(Achievements))
		for _, ach := range Achievements {
			list = append(list, AchievementStatus{Achievement: ach})
		}
		writeJSON(w, http.StatusOK, map[string]any{"signed_in": false, "achievements": list})
		return
	}
	list, err := a.store.AchievementsFor(u.ID)
	if err != nil {
		log.Printf("achievements: %v", err)
		writeError(w, http.StatusInternalServerError, "achievements unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"signed_in": true, "achievements": list})
}
