// Package admin gates the private stats page behind a single operator login.
// There are no accounts and no user table: one username/password pair comes
// from ADMIN_USERNAME / ADMIN_PASSWORD, and a successful login mints an opaque
// session token held in memory and handed to the browser as an HTTP-only
// cookie. Sessions die with the process — a restart just means logging in
// again, which is the right trade for a one-operator page.
package admin

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"rust-rush/server/internal/netutil"
)

const (
	// sessionCookie is the cookie name; the value is the opaque token, never
	// the credentials themselves.
	sessionCookie = "rr_admin_session"
	// sessionTTL is long enough to leave the stats page open through a work
	// session, short enough that a forgotten tab doesn't stay valid forever.
	sessionTTL = 12 * time.Hour
	// maxLoginBody caps the request body — the payload is two short strings.
	maxLoginBody = 4 << 10
	// maxFailures failed logins per IP inside failureWindow lock that IP out
	// until the oldest failure ages past the window.
	maxFailures   = 10
	failureWindow = 15 * time.Minute
)

// Auth holds the configured credentials and the live session tokens.
// Safe for concurrent use.
type Auth struct {
	username string
	password string

	mu       sync.Mutex
	sessions map[string]time.Time   // token -> expiry
	failures map[string][]time.Time // visitor IP -> recent failed logins
	now      func() time.Time       // clock; tests move it
}

// New reads the credentials from the environment. There are no defaults: if
// either var is unset the admin login is unconfigured, every login attempt
// fails, and the gated endpoints stay closed. Fail-closed is deliberate — an
// unconfigured deployment must not fall back to a guessable pair.
func New() *Auth {
	return &Auth{
		username: os.Getenv("ADMIN_USERNAME"),
		password: os.Getenv("ADMIN_PASSWORD"),
		sessions: make(map[string]time.Time),
		failures: make(map[string][]time.Time),
		now:      time.Now,
	}
}

// recentFailuresLocked prunes failures older than the window (for every IP,
// so the map can't grow without bound) and returns ip's remaining count.
// Caller holds a.mu.
func (a *Auth) recentFailuresLocked(ip string) int {
	cutoff := a.clock().Add(-failureWindow)
	for key, times := range a.failures {
		kept := times[:0]
		for _, t := range times {
			if t.After(cutoff) {
				kept = append(kept, t)
			}
		}
		if len(kept) == 0 {
			delete(a.failures, key)
		} else {
			a.failures[key] = kept
		}
	}
	return len(a.failures[ip])
}

// Configured reports whether both credential env vars are set.
func (a *Auth) Configured() bool {
	return a.username != "" && a.password != ""
}

// loginRequest is the POST /admin/login payload.
type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// Login validates credentials and, on success, sets the session cookie.
// Responds 401 on any credential mismatch — the body never distinguishes a
// wrong username from a wrong password.
//
// Ten failed attempts from one IP within 15 minutes lock that IP out with
// 429 until the window rolls on, checked before the credentials are even
// compared. Failures are logged with the IP and count, never the submitted
// values.
func (a *Auth) Login(w http.ResponseWriter, r *http.Request) {
	ip := netutil.ClientIP(r)
	a.mu.Lock()
	locked := a.recentFailuresLocked(ip) >= maxFailures
	a.mu.Unlock()
	if locked {
		w.Header().Set("Retry-After", strconv.Itoa(int(failureWindow.Seconds())))
		http.Error(w, "too many attempts", http.StatusTooManyRequests)
		return
	}

	var req loginRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxLoginBody)).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if !a.credentialsMatch(req.Username, req.Password) {
		a.mu.Lock()
		if a.failures == nil {
			a.failures = make(map[string][]time.Time)
		}
		a.failures[ip] = append(a.failures[ip], a.clock())
		n := len(a.failures[ip])
		a.mu.Unlock()
		log.Printf("admin: failed login from %s (%d in the last %s)", ip, n, failureWindow)
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	a.mu.Lock()
	delete(a.failures, ip)
	a.mu.Unlock()

	token, err := newToken()
	if err != nil {
		http.Error(w, "login failed", http.StatusInternalServerError)
		log.Printf("admin: could not generate session token: %v", err)
		return
	}

	a.mu.Lock()
	a.pruneLocked()
	a.sessions[token] = time.Now().Add(sessionTTL)
	a.mu.Unlock()

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   isSecure(r),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(sessionTTL.Seconds()),
	})
	log.Println("admin: login succeeded")
	w.WriteHeader(http.StatusNoContent)
}

// Logout drops the session server-side and expires the cookie. Always 204 —
// logging out of a session that is already gone is not an error.
func (a *Auth) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		a.mu.Lock()
		delete(a.sessions, c.Value)
		a.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   isSecure(r),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
	w.WriteHeader(http.StatusNoContent)
}

// RequireSession wraps a handler so it only runs for requests carrying a valid
// session cookie; everything else gets a bare 401 for the client to redirect on.
func (a *Auth) RequireSession(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !a.hasValidSession(r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

// credentialsMatch compares both fields in constant time. Both comparisons run
// unconditionally so a correct username can't be detected from response timing.
func (a *Auth) credentialsMatch(username, password string) bool {
	if !a.Configured() {
		return false
	}
	userOK := subtle.ConstantTimeCompare([]byte(username), []byte(a.username))
	passOK := subtle.ConstantTimeCompare([]byte(password), []byte(a.password))
	return userOK == 1 && passOK == 1
}

// hasValidSession reports whether the request carries a live session token.
func (a *Auth) hasValidSession(r *http.Request) bool {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	expiry, ok := a.sessions[c.Value]
	if !ok {
		return false
	}
	if time.Now().After(expiry) {
		delete(a.sessions, c.Value)
		return false
	}
	return true
}

// pruneLocked drops expired tokens. Caller holds a.mu.
func (a *Auth) pruneLocked() {
	now := time.Now()
	for token, expiry := range a.sessions {
		if now.After(expiry) {
			delete(a.sessions, token)
		}
	}
}

// newToken returns 256 bits of URL-safe randomness.
func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// isSecure reports whether the browser reached us over HTTPS, so the cookie
// gets the Secure flag in production (behind the tunnel, TLS terminates
// upstream and only X-Forwarded-Proto tells us) but not on plain-HTTP
// localhost, where Secure cookies would never be stored.
func isSecure(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// clock returns the configured time source (tests swap it), or time.Now.
func (a *Auth) clock() time.Time {
	if a.now != nil {
		return a.now()
	}
	return time.Now()
}
