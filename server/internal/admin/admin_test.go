package admin

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// newTestAuth builds a configured Auth without touching the process
// environment, so tests stay parallel-safe.
func newTestAuth() *Auth {
	return &Auth{username: "operator", password: "s3cret", sessions: make(map[string]time.Time)}
}

// login posts credentials and returns the response recorder.
func login(t *testing.T, a *Auth, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/admin/login", strings.NewReader(body))
	rec := httptest.NewRecorder()
	a.Login(rec, req)
	return rec
}

// sessionCookieFrom pulls the session cookie out of a login response.
func sessionCookieFrom(t *testing.T, rec *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	for _, c := range rec.Result().Cookies() {
		if c.Name == sessionCookie {
			return c
		}
	}
	t.Fatalf("no %s cookie in response", sessionCookie)
	return nil
}

func TestLoginSetsSessionCookie(t *testing.T) {
	a := newTestAuth()
	rec := login(t, a, `{"username":"operator","password":"s3cret"}`)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("login status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	c := sessionCookieFrom(t, rec)
	if c.Value == "" {
		t.Error("session cookie is empty")
	}
	if !c.HttpOnly {
		t.Error("session cookie is not HttpOnly")
	}
	if c.Value == "operator" || c.Value == "s3cret" {
		t.Error("session cookie leaks the credentials")
	}
}

func TestLoginRejectsBadCredentials(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"wrong password", `{"username":"operator","password":"nope"}`},
		{"wrong username", `{"username":"intruder","password":"s3cret"}`},
		{"empty", `{"username":"","password":""}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a := newTestAuth()
			rec := login(t, a, tc.body)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
			}
			if len(rec.Result().Cookies()) != 0 {
				t.Error("failed login set a cookie")
			}
		})
	}
}

// An unconfigured deployment (env vars unset) must never authenticate, not
// even with empty credentials.
func TestUnconfiguredAlwaysRejects(t *testing.T) {
	a := &Auth{sessions: make(map[string]time.Time)}
	if a.Configured() {
		t.Fatal("Configured() = true with no credentials set")
	}
	if rec := login(t, a, `{"username":"","password":""}`); rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestRequireSession(t *testing.T) {
	a := newTestAuth()
	guarded := a.RequireSession(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("secret stats"))
	})

	// No cookie at all.
	rec := httptest.NewRecorder()
	guarded(rec, httptest.NewRequest(http.MethodGet, "/stats", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("without cookie: status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}

	// A made-up token.
	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/stats", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: "not-a-real-token"})
	guarded(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("with forged cookie: status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}

	// The real thing.
	c := sessionCookieFrom(t, login(t, a, `{"username":"operator","password":"s3cret"}`))
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/stats", nil)
	req.AddCookie(c)
	guarded(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("with valid session: status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Body.String(); got != "secret stats" {
		t.Errorf("body = %q, want %q", got, "secret stats")
	}
}

func TestLogoutInvalidatesSession(t *testing.T) {
	a := newTestAuth()
	c := sessionCookieFrom(t, login(t, a, `{"username":"operator","password":"s3cret"}`))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/logout", nil)
	req.AddCookie(c)
	a.Logout(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("logout status = %d, want %d", rec.Code, http.StatusNoContent)
	}

	// The same cookie must no longer open the gate.
	guarded := a.RequireSession(func(w http.ResponseWriter, r *http.Request) {})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/stats", nil)
	req.AddCookie(c)
	guarded(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("after logout: status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestExpiredSessionRejected(t *testing.T) {
	a := newTestAuth()
	c := sessionCookieFrom(t, login(t, a, `{"username":"operator","password":"s3cret"}`))

	// Backdate the session past its TTL.
	a.mu.Lock()
	a.sessions[c.Value] = time.Now().Add(-time.Minute)
	a.mu.Unlock()

	req := httptest.NewRequest(http.MethodGet, "/stats", nil)
	req.AddCookie(c)
	if a.hasValidSession(req) {
		t.Error("expired session still valid")
	}
}

func TestLoginRejectsMalformedBody(t *testing.T) {
	a := newTestAuth()
	if rec := login(t, a, `not json`); rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestSessionsAreDistinct(t *testing.T) {
	a := newTestAuth()
	first := sessionCookieFrom(t, login(t, a, `{"username":"operator","password":"s3cret"}`))
	second := sessionCookieFrom(t, login(t, a, `{"username":"operator","password":"s3cret"}`))
	if first.Value == second.Value {
		t.Error("two logins produced the same session token")
	}
}
