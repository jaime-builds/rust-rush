// Package accounts holds optional player accounts: username + password
// (Argon2id), cookie sessions, per-account map progress, the leaderboard,
// the single autosave slot, and achievements. Guests never touch any of it.
//
// Everything lives in the same SQLite file as the private stats (one data
// volume, one backup). Session tokens are stored only as SHA-256 hashes, so a
// copied database can't be used to log in as anyone.
package accounts

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"
	"time"
)

// SessionTTL is how long a login lasts.
const SessionTTL = 30 * 24 * time.Hour

// Password length limits. The upper bound caps hashing work per request.
const (
	MinPasswordLen = 10
	MaxPasswordLen = 128
)

var (
	ErrUsernameInvalid = errors.New("username must be 3-20 letters, digits, _ or -")
	ErrUsernameTaken   = errors.New("username taken")
	ErrPasswordLength  = errors.New("password must be 10-128 characters")
	ErrBadCredentials  = errors.New("wrong username or password")
	ErrNoUser          = errors.New("no such user")
)

var usernamePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{3,20}$`)

// reservedNames can't be registered (case-insensitive): they'd read as
// official on a public leaderboard.
var reservedNames = map[string]bool{
	"admin": true, "administrator": true, "root": true, "system": true, "operator": true,
	"mod": true, "moderator": true, "staff": true, "support": true, "official": true,
	"rustrush": true, "rust-rush": true, "rust_rush": true, "guest": true, "anonymous": true,
	"null": true, "undefined": true, "nobody": true,
}

// ValidUsername applies the public-name rules.
func ValidUsername(name string) bool {
	return usernamePattern.MatchString(name) && !reservedNames[strings.ToLower(name)]
}

// User is an account as the rest of the server sees it.
type User struct {
	ID             int64     `json:"id"`
	Username       string    `json:"username"`
	CreatedAt      time.Time `json:"created_at"`
	FurthestBeaten int       `json:"furthest_beaten"`
}

// Store is the accounts database. Safe for concurrent use.
type Store struct {
	db  *sql.DB
	now func() time.Time
}

const schema = `
CREATE TABLE IF NOT EXISTS users (
	id              INTEGER PRIMARY KEY AUTOINCREMENT,
	username        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
	pw_hash         TEXT    NOT NULL,
	created_at      TEXT    NOT NULL,
	furthest_beaten INTEGER NOT NULL DEFAULT 0,
	bosses_killed   INTEGER NOT NULL DEFAULT 0,
	evolved_bases   TEXT    NOT NULL DEFAULT '',
	secured_maps    TEXT    NOT NULL DEFAULT '',
	secured_harder  TEXT    NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sessions (
	token_hash TEXT    PRIMARY KEY,
	user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS saves (
	user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	state      TEXT    NOT NULL,
	map_id     TEXT    NOT NULL,
	wave       INTEGER NOT NULL,
	updated_at TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS achievements (
	user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	achievement TEXT    NOT NULL,
	unlocked_at TEXT    NOT NULL,
	PRIMARY KEY (user_id, achievement)
);
`

// Open prepares the account tables on an already-open database (the stats
// file). Foreign keys are enforced per connection via the DSN pragma the
// stats store sets; deletes here also clean up by hand so nothing depends
// on it.
func Open(db *sql.DB) (*Store, error) {
	if _, err := db.Exec(schema); err != nil {
		return nil, err
	}
	if err := ensureUserColumns(db); err != nil {
		return nil, err
	}
	return &Store{db: db, now: time.Now}, nil
}

func (s *Store) stamp(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// Register creates an account and returns it.
func (s *Store) Register(username, password string) (User, error) {
	if !ValidUsername(username) {
		return User{}, ErrUsernameInvalid
	}
	if n := len(password); n < MinPasswordLen || n > MaxPasswordLen {
		return User{}, ErrPasswordLength
	}
	hash, err := hashPassword(password)
	if err != nil {
		return User{}, err
	}
	now := s.now()
	res, err := s.db.Exec(`INSERT INTO users (username, pw_hash, created_at) VALUES (?, ?, ?)`,
		username, hash, s.stamp(now))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return User{}, ErrUsernameTaken
		}
		return User{}, err
	}
	id, _ := res.LastInsertId()
	return User{ID: id, Username: username, CreatedAt: now.UTC()}, nil
}

// Authenticate checks a username and password. A missing user still costs a
// full hash, so timing doesn't reveal which names exist.
func (s *Store) Authenticate(username, password string) (User, error) {
	if len(password) > MaxPasswordLen {
		return User{}, ErrBadCredentials
	}
	var u User
	var hash, created string
	err := s.db.QueryRow(`SELECT id, username, pw_hash, created_at, furthest_beaten FROM users WHERE username = ?`,
		username).Scan(&u.ID, &u.Username, &hash, &created, &u.FurthestBeaten)
	if errors.Is(err, sql.ErrNoRows) {
		checkPassword(dummyHash, password)
		return User{}, ErrBadCredentials
	}
	if err != nil {
		return User{}, err
	}
	ok, rehash, err := checkPassword(hash, password)
	if err != nil || !ok {
		return User{}, ErrBadCredentials
	}
	if rehash {
		if h, err := hashPassword(password); err == nil {
			s.db.Exec(`UPDATE users SET pw_hash = ? WHERE id = ?`, h, u.ID)
		}
	}
	u.CreatedAt, _ = time.Parse(time.RFC3339, created)
	return u, nil
}

// ChangePassword verifies the current password and sets a new one. Every
// other session of the account is logged out.
func (s *Store) ChangePassword(userID int64, current, next, keepToken string) error {
	u, err := s.UserByID(userID)
	if err != nil {
		return err
	}
	if _, err := s.Authenticate(u.Username, current); err != nil {
		return err
	}
	if n := len(next); n < MinPasswordLen || n > MaxPasswordLen {
		return ErrPasswordLength
	}
	hash, err := hashPassword(next)
	if err != nil {
		return err
	}
	if _, err := s.db.Exec(`UPDATE users SET pw_hash = ? WHERE id = ?`, hash, userID); err != nil {
		return err
	}
	_, err = s.db.Exec(`DELETE FROM sessions WHERE user_id = ? AND token_hash != ?`, userID, tokenHash(keepToken))
	return err
}

// UserByID loads an account.
func (s *Store) UserByID(id int64) (User, error) {
	var u User
	var created string
	err := s.db.QueryRow(`SELECT id, username, created_at, furthest_beaten FROM users WHERE id = ?`, id).
		Scan(&u.ID, &u.Username, &created, &u.FurthestBeaten)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNoUser
	}
	u.CreatedAt, _ = time.Parse(time.RFC3339, created)
	return u, err
}

// DeleteUser removes an account and everything tied to it: sessions, save,
// achievements. Its leaderboard rows are detached (user_id cleared) rather
// than deleted, so the anonymous game stats keep their history.
func (s *Store) DeleteUser(id int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, q := range []string{
		`DELETE FROM sessions WHERE user_id = ?`,
		`DELETE FROM saves WHERE user_id = ?`,
		`DELETE FROM achievements WHERE user_id = ?`,
		`UPDATE games SET user_id = NULL WHERE user_id = ?`,
	} {
		if _, err := tx.Exec(q, id); err != nil {
			return err
		}
	}
	res, err := tx.Exec(`DELETE FROM users WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNoUser
	}
	return tx.Commit()
}

// Rename changes a username (admin moderation).
func (s *Store) Rename(id int64, username string) error {
	if !ValidUsername(username) {
		return ErrUsernameInvalid
	}
	res, err := s.db.Exec(`UPDATE users SET username = ? WHERE id = ?`, username, id)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return ErrUsernameTaken
		}
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNoUser
	}
	return nil
}

// AdminUser is one row of the admin user list.
type AdminUser struct {
	User
	Games int `json:"games"`
}

// ListUsers returns accounts for the admin page, newest first, optionally
// filtered by a username substring.
func (s *Store) ListUsers(query string, limit int) ([]AdminUser, error) {
	rows, err := s.db.Query(`
		SELECT u.id, u.username, u.created_at, u.furthest_beaten,
		       (SELECT COUNT(*) FROM games g WHERE g.user_id = u.id)
		FROM users u
		WHERE u.username LIKE '%' || ? || '%' ESCAPE '\'
		ORDER BY u.id DESC LIMIT ?`, escapeLike(query), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]AdminUser, 0)
	for rows.Next() {
		var a AdminUser
		var created string
		if err := rows.Scan(&a.ID, &a.Username, &created, &a.FurthestBeaten, &a.Games); err != nil {
			return nil, err
		}
		a.CreatedAt, _ = time.Parse(time.RFC3339, created)
		out = append(out, a)
	}
	return out, rows.Err()
}

func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

// RaiseFurthestBeaten records map progress, never lowering it.
func (s *Store) RaiseFurthestBeaten(id int64, furthest int) (int, error) {
	if furthest < 0 {
		furthest = 0
	}
	if furthest > 6 {
		furthest = 6
	}
	if _, err := s.db.Exec(`UPDATE users SET furthest_beaten = MAX(furthest_beaten, ?) WHERE id = ?`, furthest, id); err != nil {
		return 0, err
	}
	u, err := s.UserByID(id)
	return u.FurthestBeaten, err
}

// --- sessions ---------------------------------------------------------------

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// NewSession issues a session token for the user (the cookie value). Only
// its hash is stored.
func (s *Store) NewSession(userID int64) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(b)
	now := s.now()
	s.db.Exec(`DELETE FROM sessions WHERE expires_at < ?`, s.stamp(now))
	_, err := s.db.Exec(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`,
		tokenHash(token), userID, s.stamp(now.Add(SessionTTL)))
	return token, err
}

// SessionUser resolves a session token to its account, or ErrNoUser.
func (s *Store) SessionUser(token string) (User, error) {
	if token == "" {
		return User{}, ErrNoUser
	}
	var id int64
	var expires string
	err := s.db.QueryRow(`SELECT user_id, expires_at FROM sessions WHERE token_hash = ?`, tokenHash(token)).
		Scan(&id, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNoUser
	}
	if err != nil {
		return User{}, err
	}
	if exp, _ := time.Parse(time.RFC3339, expires); s.now().After(exp) {
		s.db.Exec(`DELETE FROM sessions WHERE token_hash = ?`, tokenHash(token))
		return User{}, ErrNoUser
	}
	return s.UserByID(id)
}

// EndSession deletes one session (logout).
func (s *Store) EndSession(token string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE token_hash = ?`, tokenHash(token))
	return err
}

// AdvanceProgress records a secured zone: the account's furthest-beaten map
// moves to sequence only when it was the next map in line (beating an
// earlier map again never moves it), the same rule the client applies.
func (s *Store) AdvanceProgress(id int64, sequence int) error {
	_, err := s.db.Exec(`UPDATE users SET furthest_beaten = ? WHERE id = ? AND furthest_beaten = ? - 1`,
		sequence, id, sequence)
	return err
}
