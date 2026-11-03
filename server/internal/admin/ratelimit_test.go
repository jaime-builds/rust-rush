package admin

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func loginFrom(a *Auth, ip, body string) int {
	req := httptest.NewRequest(http.MethodPost, "/admin/login", strings.NewReader(body))
	req.Header.Set("CF-Connecting-IP", ip)
	rec := httptest.NewRecorder()
	a.Login(rec, req)
	return rec.Code
}

// RR-07: ten failures from one IP in 15 minutes lock that IP out (even with
// the right password), other IPs are unaffected, and the lock lifts once the
// window passes.
func TestLoginLockoutPerIP(t *testing.T) {
	a := newTestAuth()
	now := time.Now()
	a.now = func() time.Time { return now }
	const bad = `{"username":"operator","password":"nope"}`
	const good = `{"username":"operator","password":"s3cret"}`

	for i := 0; i < maxFailures; i++ {
		if code := loginFrom(a, "203.0.113.9", bad); code != http.StatusUnauthorized {
			t.Fatalf("failure %d: status %d, want 401", i+1, code)
		}
	}
	if code := loginFrom(a, "203.0.113.9", good); code != http.StatusTooManyRequests {
		t.Errorf("11th attempt with the right password: status %d, want 429", code)
	}
	if code := loginFrom(a, "198.51.100.1", good); code != http.StatusNoContent {
		t.Errorf("another IP: status %d, want 204", code)
	}

	now = now.Add(failureWindow + time.Second)
	if code := loginFrom(a, "203.0.113.9", good); code != http.StatusNoContent {
		t.Errorf("after the window: status %d, want 204", code)
	}
}

// A successful login clears that IP's failures.
func TestLoginSuccessResetsFailures(t *testing.T) {
	a := newTestAuth()
	for i := 0; i < maxFailures-1; i++ {
		loginFrom(a, "203.0.113.9", `{"username":"operator","password":"nope"}`)
	}
	loginFrom(a, "203.0.113.9", `{"username":"operator","password":"s3cret"}`)
	loginFrom(a, "203.0.113.9", `{"username":"operator","password":"nope"}`)
	if code := loginFrom(a, "203.0.113.9", `{"username":"operator","password":"s3cret"}`); code != http.StatusNoContent {
		t.Errorf("status %d after a success reset the count, want 204", code)
	}
}

// FS-30: New reads both credentials from the environment.
func TestNewReadsEnvironment(t *testing.T) {
	t.Setenv("ADMIN_USERNAME", "env-user")
	t.Setenv("ADMIN_PASSWORD", "env-pass")
	a := New()
	if !a.Configured() {
		t.Fatal("New with both vars set is not configured")
	}
	if code := loginFrom(a, "192.0.2.1", `{"username":"env-user","password":"env-pass"}`); code != http.StatusNoContent {
		t.Errorf("login with the env credentials: status %d, want 204", code)
	}
	t.Setenv("ADMIN_PASSWORD", "")
	if New().Configured() {
		t.Error("New with an empty password counts as configured")
	}
}

// FS-30: behind the tunnel TLS ends at Cloudflare, so only
// X-Forwarded-Proto says the cookie must be Secure.
func TestIsSecureFromForwardedProto(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/admin/login", nil)
	if isSecure(r) {
		t.Error("plain HTTP request reported secure")
	}
	r.Header.Set("X-Forwarded-Proto", "HTTPS")
	if !isSecure(r) {
		t.Error("X-Forwarded-Proto: HTTPS not treated as secure")
	}
	rec := httptest.NewRecorder()
	a := newTestAuth()
	r = httptest.NewRequest(http.MethodPost, "/admin/login", strings.NewReader(`{"username":"operator","password":"s3cret"}`))
	r.Header.Set("X-Forwarded-Proto", "https")
	a.Login(rec, r)
	if c := sessionCookieFrom(t, rec); !c.Secure {
		t.Error("session cookie behind the tunnel lacks Secure")
	}
}
