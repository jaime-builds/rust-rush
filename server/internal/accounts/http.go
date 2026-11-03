package accounts

import (
	"encoding/json"
	"errors"
	"log"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"rust-rush/server/internal/netutil"
)

// CookieName is the player session cookie (HttpOnly, SameSite=Lax).
const CookieName = "rr_session"

const maxBody = 4 << 10

// API serves the /api/account endpoints.
type API struct {
	store *Store
	// Per-visitor limits: failed logins, and new accounts.
	loginFailures *netutil.WindowLimiter
	registrations *netutil.WindowLimiter
	// OnLogout runs after an account is deleted, so the hub can close that
	// account's open game sockets (they reconnect as guests). Optional.
	OnLogout func(userID int64)
}

// NewAPI wires the handlers with the agreed limits: 10 failed logins per 15
// minutes and 5 new accounts per hour, per visitor IP.
func NewAPI(store *Store) *API {
	return &API{
		store:         store,
		loginFailures: netutil.NewWindowLimiter(10, 15*time.Minute),
		registrations: netutil.NewWindowLimiter(5, time.Hour),
	}
}

// Store returns the underlying store.
func (a *API) Store() *Store { return a.store }

// Register mounts the account routes on mux.
func (a *API) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/account/register", a.post(a.handleRegister))
	mux.HandleFunc("/api/account/login", a.post(a.handleLogin))
	mux.HandleFunc("/api/account/logout", a.post(a.handleLogout))
	mux.HandleFunc("/api/account/password", a.post(a.handlePassword))
	mux.HandleFunc("/api/account/delete", a.post(a.handleDelete))
	mux.HandleFunc("/api/account/me", a.handleMe)
	mux.HandleFunc("/api/account/achievements", a.handleAchievements)
}

// post limits a handler to JSON POSTs. Requiring application/json is the
// CSRF guard (with SameSite=Lax): a cross-site page can't send a JSON body
// without a CORS preflight, which this server never approves.
func (a *API) post(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "application/json" {
			writeError(w, http.StatusUnsupportedMediaType, "send JSON")
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		next(w, r)
	}
}

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
	// FurthestBeaten carries this browser's local map progress into the
	// account at login or signup. Map locks are cosmetic, so trusting it is
	// harmless; the account keeps the higher of the two.
	FurthestBeaten int `json:"furthest_beaten"`
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody)).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "bad request")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// isSecure: TLS ends at Cloudflare, so X-Forwarded-Proto says whether the
// browser used HTTPS (plain HTTP on localhost must not get Secure cookies).
func isSecure(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func (a *API) setCookie(w http.ResponseWriter, r *http.Request, token string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name: CookieName, Value: token, Path: "/", HttpOnly: true,
		Secure: isSecure(r), SameSite: http.SameSiteLaxMode, MaxAge: maxAge,
	})
}

func sessionToken(r *http.Request) string {
	if c, err := r.Cookie(CookieName); err == nil {
		return c.Value
	}
	return ""
}

// UserFromRequest resolves the request's session cookie (the WebSocket
// handshake uses this too). ok is false for guests.
func (a *API) UserFromRequest(r *http.Request) (User, bool) {
	u, err := a.store.SessionUser(sessionToken(r))
	return u, err == nil
}

func (a *API) startSession(w http.ResponseWriter, r *http.Request, u User) bool {
	token, err := a.store.NewSession(u.ID)
	if err != nil {
		log.Printf("accounts: session for user %d: %v", u.ID, err)
		writeError(w, http.StatusInternalServerError, "could not sign in")
		return false
	}
	a.setCookie(w, r, token, int(SessionTTL.Seconds()))
	return true
}

func (a *API) handleRegister(w http.ResponseWriter, r *http.Request) {
	ip := netutil.ClientIP(r)
	if a.registrations.Blocked(ip) {
		w.Header().Set("Retry-After", strconv.Itoa(int(a.registrations.Window().Seconds())))
		writeError(w, http.StatusTooManyRequests, "too many new accounts from here; try again later")
		return
	}
	var c credentials
	if !decode(w, r, &c) {
		return
	}
	u, err := a.store.Register(c.Username, c.Password)
	switch {
	case errors.Is(err, ErrUsernameInvalid), errors.Is(err, ErrPasswordLength):
		writeError(w, http.StatusBadRequest, err.Error())
		return
	case errors.Is(err, ErrUsernameTaken):
		writeError(w, http.StatusConflict, "that username is taken")
		return
	case err != nil:
		log.Printf("accounts: register: %v", err)
		writeError(w, http.StatusInternalServerError, "could not create the account")
		return
	}
	a.registrations.Add(ip)
	if c.FurthestBeaten > 0 {
		u.FurthestBeaten, _ = a.store.RaiseFurthestBeaten(u.ID, c.FurthestBeaten)
	}
	if !a.startSession(w, r, u) {
		return
	}
	log.Printf("accounts: new account %d", u.ID)
	writeJSON(w, http.StatusCreated, map[string]any{"user": u})
}

func (a *API) handleLogin(w http.ResponseWriter, r *http.Request) {
	ip := netutil.ClientIP(r)
	if a.loginFailures.Blocked(ip) {
		w.Header().Set("Retry-After", strconv.Itoa(int(a.loginFailures.Window().Seconds())))
		writeError(w, http.StatusTooManyRequests, "too many attempts; try again in 15 minutes")
		return
	}
	var c credentials
	if !decode(w, r, &c) {
		return
	}
	u, err := a.store.Authenticate(c.Username, c.Password)
	if err != nil {
		if errors.Is(err, ErrBadCredentials) {
			n := a.loginFailures.Add(ip)
			log.Printf("accounts: failed login from %s (%d in the last 15m)", ip, n)
			writeError(w, http.StatusUnauthorized, "wrong username or password")
			return
		}
		log.Printf("accounts: login: %v", err)
		writeError(w, http.StatusInternalServerError, "could not sign in")
		return
	}
	a.loginFailures.Reset(ip)
	if c.FurthestBeaten > 0 {
		u.FurthestBeaten, _ = a.store.RaiseFurthestBeaten(u.ID, c.FurthestBeaten)
	}
	if !a.startSession(w, r, u) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

func (a *API) handleLogout(w http.ResponseWriter, r *http.Request) {
	if token := sessionToken(r); token != "" {
		a.store.EndSession(token)
	}
	a.setCookie(w, r, "", -1)
	w.WriteHeader(http.StatusNoContent)
}

// handleMe answers 200 for guests too ({"user": null}), so the page can ask
// on every load without a failed request in the console.
func (a *API) handleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	u, ok := a.UserFromRequest(r)
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"user": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

func (a *API) handlePassword(w http.ResponseWriter, r *http.Request) {
	u, ok := a.UserFromRequest(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "sign in first")
		return
	}
	ip := netutil.ClientIP(r)
	if a.loginFailures.Blocked(ip) {
		writeError(w, http.StatusTooManyRequests, "too many attempts; try again in 15 minutes")
		return
	}
	var body struct {
		Current string `json:"current"`
		Next    string `json:"next"`
	}
	if !decode(w, r, &body) {
		return
	}
	err := a.store.ChangePassword(u.ID, body.Current, body.Next, sessionToken(r))
	switch {
	case errors.Is(err, ErrBadCredentials):
		a.loginFailures.Add(ip)
		writeError(w, http.StatusUnauthorized, "current password is wrong")
	case errors.Is(err, ErrPasswordLength):
		writeError(w, http.StatusBadRequest, err.Error())
	case err != nil:
		log.Printf("accounts: change password: %v", err)
		writeError(w, http.StatusInternalServerError, "could not change the password")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleDelete removes the account after re-checking the password.
func (a *API) handleDelete(w http.ResponseWriter, r *http.Request) {
	u, ok := a.UserFromRequest(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "sign in first")
		return
	}
	ip := netutil.ClientIP(r)
	if a.loginFailures.Blocked(ip) {
		writeError(w, http.StatusTooManyRequests, "too many attempts; try again in 15 minutes")
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if !decode(w, r, &body) {
		return
	}
	if _, err := a.store.Authenticate(u.Username, body.Password); err != nil {
		a.loginFailures.Add(ip)
		writeError(w, http.StatusUnauthorized, "password is wrong")
		return
	}
	if err := a.store.DeleteUser(u.ID); err != nil {
		log.Printf("accounts: delete %d: %v", u.ID, err)
		writeError(w, http.StatusInternalServerError, "could not delete the account")
		return
	}
	if a.OnLogout != nil {
		a.OnLogout(u.ID)
	}
	a.setCookie(w, r, "", -1)
	log.Printf("accounts: account %d deleted", u.ID)
	w.WriteHeader(http.StatusNoContent)
}
