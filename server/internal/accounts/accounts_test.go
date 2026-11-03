package accounts

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"rust-rush/server/internal/game"
	"rust-rush/server/internal/stats"
)

func openTestStore(t *testing.T) (*Store, *stats.Store) {
	t.Helper()
	st, err := stats.Open(filepath.Join(t.TempDir(), "rr.db"))
	if err != nil {
		t.Fatalf("stats.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	s, err := Open(st.DB())
	if err != nil {
		t.Fatalf("accounts.Open: %v", err)
	}
	return s, st
}

func TestUsernameRules(t *testing.T) {
	for name, ok := range map[string]bool{
		"neo": true, "Player_1": true, "a-b-c": true, "twentycharsexactly12": true,
		"ab": false, "twentyonecharacters12": false, "has space": false, "émile": false,
		"admin": false, "ADMIN": false, "Rust-Rush": false, "guest": false, "<script>": false,
	} {
		if got := ValidUsername(name); got != ok {
			t.Errorf("ValidUsername(%q) = %v, want %v", name, got, ok)
		}
	}
}

func TestRegisterAndAuthenticate(t *testing.T) {
	s, _ := openTestStore(t)
	u, err := s.Register("Neo", "correct horse battery")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if _, err := s.Register("neo", "another long password"); err != ErrUsernameTaken {
		t.Errorf("same name in another case: err = %v, want ErrUsernameTaken", err)
	}
	if _, err := s.Register("trinity", "short"); err != ErrPasswordLength {
		t.Errorf("short password: err = %v, want ErrPasswordLength", err)
	}
	if _, err := s.Register("trinity", strings.Repeat("x", MaxPasswordLen+1)); err != ErrPasswordLength {
		t.Errorf("huge password: err = %v, want ErrPasswordLength", err)
	}

	var stored string
	s.db.QueryRow(`SELECT pw_hash FROM users WHERE id = ?`, u.ID).Scan(&stored)
	if !strings.HasPrefix(stored, "$argon2id$v=19$m=19456,t=2,p=1$") || strings.Contains(stored, "horse") {
		t.Errorf("stored hash %q is not an Argon2id PHC string", stored)
	}

	if got, err := s.Authenticate("NEO", "correct horse battery"); err != nil || got.ID != u.ID {
		t.Errorf("login with the right password (any case): %v %v", got, err)
	}
	for _, c := range [][2]string{{"neo", "wrong password here"}, {"nobody-here", "correct horse battery"}} {
		if _, err := s.Authenticate(c[0], c[1]); err != ErrBadCredentials {
			t.Errorf("Authenticate(%q): err = %v, want ErrBadCredentials", c[0], err)
		}
	}
}

func TestHashesAreSalted(t *testing.T) {
	a, _ := hashPassword("same password twice")
	b, _ := hashPassword("same password twice")
	if a == b {
		t.Fatal("two hashes of one password are identical: no salt")
	}
	for _, h := range []string{a, b} {
		if ok, _, err := checkPassword(h, "same password twice"); !ok || err != nil {
			t.Errorf("checkPassword rejected its own hash: %v", err)
		}
	}
	if _, _, err := checkPassword("$2a$10$bcrypt-looking", "x"); err == nil {
		t.Error("a non-argon2 hash was accepted")
	}
}

func TestSessions(t *testing.T) {
	s, _ := openTestStore(t)
	u, _ := s.Register("morpheus", "a very long password")
	token, err := s.NewSession(u.ID)
	if err != nil {
		t.Fatalf("NewSession: %v", err)
	}
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE token_hash = ?`, token).Scan(&n)
	if n != 0 {
		t.Error("the raw token is stored; only its hash should be")
	}
	if got, err := s.SessionUser(token); err != nil || got.ID != u.ID {
		t.Fatalf("SessionUser: %v %v", got, err)
	}

	s.now = func() time.Time { return time.Now().Add(SessionTTL + time.Hour) }
	if _, err := s.SessionUser(token); err != ErrNoUser {
		t.Errorf("expired session: err = %v, want ErrNoUser", err)
	}
	s.now = time.Now
	token2, _ := s.NewSession(u.ID)
	s.EndSession(token2)
	if _, err := s.SessionUser(token2); err != ErrNoUser {
		t.Error("session still valid after EndSession")
	}
}

func TestDeleteUserCleansUp(t *testing.T) {
	s, st := openTestStore(t)
	u, _ := s.Register("cypher", "a very long password")
	token, _ := s.NewSession(u.ID)
	s.db.Exec(`INSERT INTO saves (user_id, state, map_id, wave, updated_at) VALUES (?, '{}', 'open', 3, 'x')`, u.ID)
	s.db.Exec(`INSERT INTO achievements (user_id, achievement, unlocked_at) VALUES (?, 'first_contact', 'x')`, u.ID)
	st.RecordGame(stats.GameRecord{EndedAt: time.Now(), Wave: 9, Score: 900, UserID: u.ID, MapID: "open"})

	if err := s.DeleteUser(u.ID); err != nil {
		t.Fatalf("DeleteUser: %v", err)
	}
	for _, q := range []string{
		`SELECT COUNT(*) FROM users WHERE id = ?`,
		`SELECT COUNT(*) FROM sessions WHERE user_id = ?`,
		`SELECT COUNT(*) FROM saves WHERE user_id = ?`,
		`SELECT COUNT(*) FROM achievements WHERE user_id = ?`,
		`SELECT COUNT(*) FROM games WHERE user_id = ?`,
	} {
		var n int
		s.db.QueryRow(q, u.ID).Scan(&n)
		if n != 0 {
			t.Errorf("%s left %d rows", q, n)
		}
	}
	if total, _ := st.TotalGames(); total != 1 {
		t.Errorf("the anonymous game row was deleted too (total %d, want 1)", total)
	}
	if _, err := s.SessionUser(token); err == nil {
		t.Error("deleted account's session still works")
	}
}

func TestRenameAndProgress(t *testing.T) {
	s, _ := openTestStore(t)
	a, _ := s.Register("tank", "a very long password")
	s.Register("dozer", "a very long password")
	if err := s.Rename(a.ID, "Dozer"); err != ErrUsernameTaken {
		t.Errorf("rename onto a taken name: %v", err)
	}
	if err := s.Rename(a.ID, "root"); err != ErrUsernameInvalid {
		t.Errorf("rename to a reserved name: %v", err)
	}
	if err := s.Rename(a.ID, "apoc"); err != nil {
		t.Errorf("rename: %v", err)
	}
	if f, _ := s.RaiseFurthestBeaten(a.ID, 3); f != 3 {
		t.Errorf("furthest = %d, want 3", f)
	}
	if f, _ := s.RaiseFurthestBeaten(a.ID, 1); f != 3 {
		t.Errorf("furthest lowered to %d", f)
	}
	if f, _ := s.RaiseFurthestBeaten(a.ID, 99); f != 6 {
		t.Errorf("furthest = %d, want it capped at 6", f)
	}
	list, _ := s.ListUsers("po", 10)
	if len(list) != 1 || list[0].Username != "apoc" {
		t.Errorf("ListUsers(po) = %+v", list)
	}
	if list, _ := s.ListUsers("%", 10); len(list) != 0 {
		t.Error("a % in the search matched everything (LIKE not escaped)")
	}
}

// --- HTTP -------------------------------------------------------------------

func post(t *testing.T, h http.Handler, path, body string, cookie *http.Cookie, ip string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if ip != "" {
		r.Header.Set("CF-Connecting-IP", ip)
	}
	if cookie != nil {
		r.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

func cookieFrom(rec *httptest.ResponseRecorder) *http.Cookie {
	for _, c := range rec.Result().Cookies() {
		if c.Name == CookieName {
			return c
		}
	}
	return nil
}

func newTestAPI(t *testing.T) (*API, http.Handler) {
	s, _ := openTestStore(t)
	api := NewAPI(s)
	mux := http.NewServeMux()
	api.Register(mux)
	return api, mux
}

func TestHTTPRegisterLoginMe(t *testing.T) {
	_, h := newTestAPI(t)
	rec := post(t, h, "/api/account/register", `{"username":"switch","password":"long enough pass","furthest_beaten":2}`, nil, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("register: %d %s", rec.Code, rec.Body)
	}
	c := cookieFrom(rec)
	if c == nil || !c.HttpOnly || c.SameSite != http.SameSiteLaxMode {
		t.Fatalf("session cookie missing or not HttpOnly/Lax: %+v", c)
	}
	if !strings.Contains(rec.Body.String(), `"furthest_beaten":2`) {
		t.Errorf("local progress not carried into the account: %s", rec.Body)
	}

	me := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/account/me", nil)
	r.AddCookie(c)
	h.ServeHTTP(me, r)
	if !strings.Contains(me.Body.String(), `"username":"switch"`) || strings.Contains(me.Body.String(), "pw_hash") {
		t.Errorf("me: %s", me.Body)
	}
	guest := httptest.NewRecorder()
	h.ServeHTTP(guest, httptest.NewRequest(http.MethodGet, "/api/account/me", nil))
	if guest.Code != 200 || !strings.Contains(guest.Body.String(), `"user":null`) {
		t.Errorf("guest me: %d %s", guest.Code, guest.Body)
	}

	if rec := post(t, h, "/api/account/logout", `{}`, c, ""); rec.Code != http.StatusNoContent || cookieFrom(rec).MaxAge >= 0 {
		t.Errorf("logout: %d", rec.Code)
	}
	again := httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodGet, "/api/account/me", nil)
	r.AddCookie(c)
	h.ServeHTTP(again, r)
	if !strings.Contains(again.Body.String(), `"user":null`) {
		t.Error("old cookie still signed in after logout")
	}
}

func TestHTTPRequiresJSON(t *testing.T) {
	_, h := newTestAPI(t)
	r := httptest.NewRequest(http.MethodPost, "/api/account/login", strings.NewReader("username=a&password=b"))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Errorf("form post: %d, want 415 (the CSRF guard)", rec.Code)
	}
}

func TestHTTPLoginLockout(t *testing.T) {
	_, h := newTestAPI(t)
	post(t, h, "/api/account/register", `{"username":"mouse","password":"long enough pass"}`, nil, "198.51.100.2")
	for i := 0; i < 10; i++ {
		if rec := post(t, h, "/api/account/login", `{"username":"mouse","password":"wrong wrong wrong"}`, nil, "203.0.113.4"); rec.Code != 401 {
			t.Fatalf("failure %d: %d", i+1, rec.Code)
		}
	}
	if rec := post(t, h, "/api/account/login", `{"username":"mouse","password":"long enough pass"}`, nil, "203.0.113.4"); rec.Code != 429 {
		t.Errorf("11th try with the right password: %d, want 429", rec.Code)
	}
	if rec := post(t, h, "/api/account/login", `{"username":"mouse","password":"long enough pass"}`, nil, "203.0.113.5"); rec.Code != 200 {
		t.Errorf("other visitor: %d, want 200", rec.Code)
	}
}

func TestHTTPRegistrationLimit(t *testing.T) {
	_, h := newTestAPI(t)
	for i := 0; i < 5; i++ {
		body := `{"username":"bot` + string(rune('a'+i)) + `","password":"long enough pass"}`
		if rec := post(t, h, "/api/account/register", body, nil, "203.0.113.9"); rec.Code != 201 {
			t.Fatalf("account %d: %d %s", i+1, rec.Code, rec.Body)
		}
	}
	if rec := post(t, h, "/api/account/register", `{"username":"botz","password":"long enough pass"}`, nil, "203.0.113.9"); rec.Code != 429 {
		t.Errorf("6th account in an hour: %d, want 429", rec.Code)
	}
}

func TestHTTPChangePasswordAndDelete(t *testing.T) {
	api, h := newTestAPI(t)
	rec := post(t, h, "/api/account/register", `{"username":"oracle","password":"first long pass"}`, nil, "")
	c1 := cookieFrom(rec)
	c2 := cookieFrom(post(t, h, "/api/account/login", `{"username":"oracle","password":"first long pass"}`, nil, ""))

	if rec := post(t, h, "/api/account/password", `{"current":"nope nope nope","next":"second long pass"}`, c1, ""); rec.Code != 401 {
		t.Errorf("change with a wrong current password: %d", rec.Code)
	}
	if rec := post(t, h, "/api/account/password", `{"current":"first long pass","next":"second long pass"}`, c1, ""); rec.Code != 204 {
		t.Fatalf("change password: %d %s", rec.Code, rec.Body)
	}
	if _, err := api.store.SessionUser(c2.Value); err == nil {
		t.Error("the other session survived a password change")
	}
	if _, err := api.store.SessionUser(c1.Value); err != nil {
		t.Error("the session that changed the password was logged out")
	}

	var dropped int64
	api.OnLogout = func(id int64) { dropped = id }
	if rec := post(t, h, "/api/account/delete", `{"password":"first long pass"}`, c1, ""); rec.Code != 401 {
		t.Errorf("delete with the old password: %d", rec.Code)
	}
	if rec := post(t, h, "/api/account/delete", `{"password":"second long pass"}`, c1, ""); rec.Code != 204 {
		t.Fatalf("delete: %d", rec.Code)
	}
	if dropped == 0 {
		t.Error("open game sockets were not told about the deletion")
	}
	if rec := post(t, h, "/api/account/login", `{"username":"oracle","password":"second long pass"}`, nil, ""); rec.Code != 401 {
		t.Errorf("login after delete: %d", rec.Code)
	}
}

func TestAdvanceProgressOnlyNextInLine(t *testing.T) {
	s, _ := openTestStore(t)
	u, _ := s.Register("ghost", "a very long password")
	s.AdvanceProgress(u.ID, 2) // skipping ahead: ignored
	if got, _ := s.UserByID(u.ID); got.FurthestBeaten != 0 {
		t.Fatalf("out-of-sequence win moved progress to %d", got.FurthestBeaten)
	}
	s.AdvanceProgress(u.ID, 1)
	s.AdvanceProgress(u.ID, 2)
	s.AdvanceProgress(u.ID, 1) // replaying an earlier map
	if got, _ := s.UserByID(u.ID); got.FurthestBeaten != 2 {
		t.Errorf("furthest = %d, want 2", got.FurthestBeaten)
	}
}

func TestLeaderboard(t *testing.T) {
	s, st := openTestStore(t)
	ids := map[string]int64{}
	for _, n := range []string{"ann", "bob", "cat"} {
		u, _ := s.Register(n, "a very long password")
		ids[n] = u.ID
	}
	base := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	rec := func(user string, score int, mapID, diff string, minute int) {
		st.RecordGame(stats.GameRecord{EndedAt: base.Add(time.Duration(minute) * time.Minute), Wave: score / 100,
			Score: score, UserID: ids[user], MapID: mapID, Difficulty: diff})
	}
	rec("ann", 500, "open", "normal", 1)
	rec("ann", 900, "open", "normal", 2) // ann's best
	rec("bob", 900, "open", "normal", 3) // ties ann, but later
	rec("cat", 700, "open", "normal", 4)
	rec("cat", 5000, "open", "harder", 5)                                                             // other board
	rec("cat", 9000, "needle", "normal", 6)                                                           // other map
	st.RecordGame(stats.GameRecord{EndedAt: base, Score: 99999, MapID: "open", Difficulty: "normal"}) // guest

	board, err := s.Leaderboard("open", "normal", 10)
	if err != nil {
		t.Fatal(err)
	}
	got := []string{}
	for _, e := range board {
		got = append(got, e.Username)
	}
	if strings.Join(got, ",") != "ann,bob,cat" || board[0].Score != 900 || board[0].Rank != 1 || board[2].Rank != 3 {
		t.Errorf("board = %+v", board)
	}
	if me, _ := s.PlayerStanding(ids["cat"], "open", "normal"); me == nil || me.Rank != 3 || me.Score != 700 {
		t.Errorf("cat's standing = %+v, want rank 3 with 700", me)
	}
	if me, _ := s.PlayerStanding(ids["bob"], "open", "harder"); me != nil {
		t.Errorf("bob has no harder run but got %+v", me)
	}
	if top, _ := s.Leaderboard("open", "normal", 2); len(top) != 2 {
		t.Errorf("limit ignored: %d rows", len(top))
	}
}

func TestLeaderboardHTTP(t *testing.T) {
	api, _ := newTestAPI(t)
	h := api.LeaderboardHandler(func(id string) bool { return id == "open" })
	for target, code := range map[string]int{
		"/api/leaderboard?map=open":                   200,
		"/api/leaderboard?map=open&difficulty=harder": 200,
		"/api/leaderboard?map=nope":                   400,
		"/api/leaderboard?map=open&difficulty=insane": 400,
	} {
		rec := httptest.NewRecorder()
		h(rec, httptest.NewRequest(http.MethodGet, target, nil))
		if rec.Code != code {
			t.Errorf("%s: %d, want %d", target, rec.Code, code)
		}
	}
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/api/leaderboard?map=open", nil))
	if !strings.Contains(rec.Body.String(), `"entries":[]`) || rec.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("empty guest board: %s cache=%q", rec.Body, rec.Header().Get("Cache-Control"))
	}
}

func TestSaveRunRoundTrip(t *testing.T) {
	s, _ := openTestStore(t)
	u, _ := s.Register("niobe", "a very long password")
	if _, ok, _ := s.LoadRun(u.ID); ok {
		t.Fatal("new account has a save")
	}
	run := game.SavedRun{Version: game.SaveVersion, MapID: "open", Wave: 7, Gold: 321,
		Towers: []game.Tower{{ID: 1, TowerType: "basic", Level: 2}}}
	if err := s.SaveRun(u.ID, run); err != nil {
		t.Fatal(err)
	}
	run.Wave = 8
	s.SaveRun(u.ID, run) // replaces
	got, ok, err := s.LoadRun(u.ID)
	if err != nil || !ok || got.Wave != 8 || got.Gold != 321 || len(got.Towers) != 1 || got.Towers[0].Level != 2 {
		t.Fatalf("LoadRun = %+v ok=%v err=%v", got, ok, err)
	}
	s.DeleteRun(u.ID)
	if _, ok, _ := s.LoadRun(u.ID); ok {
		t.Error("save survived DeleteRun")
	}
}

func ids(list []Achievement) string {
	out := make([]string, 0, len(list))
	for _, a := range list {
		out = append(out, a.ID)
	}
	return strings.Join(out, ",")
}

// Every one of the 12 rules, from the events the game sends.
func TestAchievementRules(t *testing.T) {
	s, _ := openTestStore(t)
	u, _ := s.Register("trinity", "a very long password")
	ev := func(e game.Event) string { return ids(s.HandleEvent(u.ID, e)) }

	if got := ev(game.Event{Kind: game.EventWaveReached, Wave: 2, Untouched: true}); got != "first_contact" {
		t.Errorf("wave 2: %q", got)
	}
	if got := ev(game.Event{Kind: game.EventWaveReached, Wave: 15, Untouched: false}); got != "" {
		t.Errorf("wave 15 with damage: %q", got)
	}
	if got := ev(game.Event{Kind: game.EventWaveReached, Wave: 15, Untouched: true}); got != "untouched" {
		t.Errorf("wave 15 untouched: %q", got)
	}
	if got := ev(game.Event{Kind: game.EventWaveReached, Wave: 50, Endless: false}); got != "" {
		t.Errorf("wave 50 not endless: %q", got)
	}
	if got := ev(game.Event{Kind: game.EventWaveReached, Wave: 50, Endless: true}); got != "endurance" {
		t.Errorf("wave 50 endless: %q", got)
	}
	if got := ev(game.Event{Kind: game.EventVictory, MapID: "open", Difficulty: "normal", TowerCount: 9}); got != "zone_secured" {
		t.Errorf("first win: %q", got)
	}
	if got := ev(game.Event{Kind: game.EventVictory, MapID: "needle", Difficulty: "harder", TowerCount: 6}); got != "minimalist,hard_line" {
		t.Errorf("harder win with 6 towers: %q", got)
	}
	maps := []string{"open", "switchback", "needle", "gauntlet", "pylons", "crucible"}
	got := ""
	for _, m := range maps {
		got += ev(game.Event{Kind: game.EventVictory, MapID: m, Difficulty: "harder", TowerCount: 12})
	}
	// The sixth harder win completes both sets at once.
	if got != "full_sweep,hardened" {
		t.Errorf("all 6 on harder: %q, want full_sweep and hardened, once each", got)
	}
	if got := ev(game.Event{Kind: game.EventTowerCount, TowerCount: 20}); got != "fortress" {
		t.Errorf("20 towers: %q", got)
	}
	got = ""
	for _, b := range []string{"basic", "sniper", "basic", "splash", "slow", "tesla"} {
		got += ev(game.Event{Kind: game.EventEvolved, Base: b}) + ";"
	}
	if got != "metamorph;;;;;full_spectrum;" {
		t.Errorf("evolutions: %q", got)
	}
	got = ""
	for i := 0; i < 10; i++ {
		got += ev(game.Event{Kind: game.EventBossKilled, Count: 10})
	}
	if got != "boss_breaker" {
		t.Errorf("100 bosses: %q", got)
	}

	list, err := s.AchievementsFor(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	unlocked := 0
	for _, a := range list {
		if a.UnlockedAt != nil {
			unlocked++
		}
	}
	if len(list) != 12 || unlocked != 12 {
		t.Errorf("list has %d entries, %d unlocked; want 12 and 12", len(list), unlocked)
	}
	for _, a := range list {
		if a.ID == "full_spectrum" && a.Progress != "5/5" {
			t.Errorf("full_spectrum progress %q", a.Progress)
		}
	}
}

func TestAchievementsHTTP(t *testing.T) {
	api, h := newTestAPI(t)
	guest := httptest.NewRecorder()
	h.ServeHTTP(guest, httptest.NewRequest(http.MethodGet, "/api/account/achievements", nil))
	if !strings.Contains(guest.Body.String(), `"signed_in":false`) || strings.Count(guest.Body.String(), `"unlocked_at":null`) != 12 {
		t.Errorf("guest list: %s", guest.Body)
	}
	c := cookieFrom(post(t, h, "/api/account/register", `{"username":"seraph","password":"long enough pass"}`, nil, ""))
	u, _ := api.store.SessionUser(c.Value)
	api.store.HandleEvent(u.ID, game.Event{Kind: game.EventWaveReached, Wave: 2})
	r := httptest.NewRequest(http.MethodGet, "/api/account/achievements", nil)
	r.AddCookie(c)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	if !strings.Contains(rec.Body.String(), `"signed_in":true`) || strings.Count(rec.Body.String(), `"unlocked_at":null`) != 11 {
		t.Errorf("signed-in list: %s", rec.Body)
	}
}

func TestAdminModeration(t *testing.T) {
	api, _ := newTestAPI(t)
	mux := http.NewServeMux()
	gate := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("X-Test-Admin") != "yes" {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			next(w, r)
		}
	}
	api.RegisterAdmin(mux, gate)
	u, _ := api.store.Register("badname", "a very long password")
	api.store.Register("taken", "a very long password")
	do := func(method, path, body string, admin bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if admin {
			r.Header.Set("X-Test-Admin", "yes")
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, r)
		return rec
	}
	if rec := do("GET", "/admin/api/users", "", false); rec.Code != 401 {
		t.Errorf("list without admin: %d", rec.Code)
	}
	if rec := do("GET", "/admin/api/users?q=bad", "", true); !strings.Contains(rec.Body.String(), `"username":"badname"`) || strings.Contains(rec.Body.String(), "pw_hash") {
		t.Errorf("list: %s", rec.Body)
	}
	id := strconv.FormatInt(u.ID, 10)
	if rec := do("POST", "/admin/api/users/rename", `{"id":`+id+`,"username":"Taken"}`, true); rec.Code != 409 {
		t.Errorf("rename to a taken name: %d", rec.Code)
	}
	if rec := do("POST", "/admin/api/users/rename", `{"id":`+id+`,"username":"renamed_1"}`, true); rec.Code != 204 {
		t.Errorf("rename: %d %s", rec.Code, rec.Body)
	}
	if got, _ := api.store.UserByID(u.ID); got.Username != "renamed_1" {
		t.Errorf("name after rename: %s", got.Username)
	}
	if rec := do("POST", "/admin/api/users/delete", `{"id":`+id+`}`, true); rec.Code != 204 {
		t.Errorf("delete: %d", rec.Code)
	}
	if rec := do("POST", "/admin/api/users/delete", `{"id":`+id+`}`, true); rec.Code != 404 {
		t.Errorf("delete twice: %d", rec.Code)
	}
}
