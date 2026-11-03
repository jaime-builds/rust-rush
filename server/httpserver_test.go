package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testBuildDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "assets"), 0o755)
	os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>game</html>"), 0o644)
	os.WriteFile(filepath.Join(dir, "404.html"), []byte("<html>lost</html>"), 0o644)
	os.WriteFile(filepath.Join(dir, "assets", "index-abc.js"), []byte("js"), 0o644)
	return dir
}

func get(h http.Handler, method, target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, target, nil))
	return rec
}

// RR-08 and RR-14: no directory listing, a real 404 page, and caching that
// lets a deploy show up on the next load.
func TestStaticHandler(t *testing.T) {
	h := staticHandler(testBuildDir(t))

	if rec := get(h, "GET", "/"); rec.Code != 200 || !strings.Contains(rec.Body.String(), "game") ||
		rec.Header().Get("Cache-Control") != "no-cache" {
		t.Errorf("/: %d %q cache=%q", rec.Code, rec.Body.String(), rec.Header().Get("Cache-Control"))
	}
	if rec := get(h, "GET", "/assets/index-abc.js"); rec.Code != 200 ||
		!strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Errorf("hashed asset: %d cache=%q", rec.Code, rec.Header().Get("Cache-Control"))
	}
	for _, p := range []string{"/assets/", "/assets", "/nope", "/../../etc/passwd"} {
		rec := get(h, "GET", p)
		if rec.Code != 404 || !strings.Contains(rec.Body.String(), "lost") {
			t.Errorf("%s: status %d body %q, want the 404 page", p, rec.Code, rec.Body.String())
		}
	}
	if rec := get(h, "POST", "/"); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST /: status %d, want 405", rec.Code)
	}
}

// RR-08: hardening headers on every response.
func TestSecurityHeaders(t *testing.T) {
	h := securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	rec := get(h, "GET", "/admin/stats")
	csp := rec.Header().Get("Content-Security-Policy")
	for _, want := range []string{"default-src 'self'", "frame-ancestors 'none'", "wss://example.com", "script-src 'self'"} {
		if !strings.Contains(csp, want) {
			t.Errorf("CSP %q lacks %q", csp, want)
		}
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" || rec.Header().Get("X-Frame-Options") != "DENY" {
		t.Errorf("missing nosniff / DENY: %v", rec.Header())
	}
}

// FS-16: admin page routes answer GET and HEAD only.
func TestAdminPageReadOnly(t *testing.T) {
	h := serveAdminPage(testBuildDir(t))
	if rec := get(h, "GET", "/admin/stats"); rec.Code != 200 {
		t.Errorf("GET /admin/stats: %d", rec.Code)
	}
	if rec := get(h, "POST", "/admin/stats"); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST /admin/stats: %d, want 405", rec.Code)
	}
}
