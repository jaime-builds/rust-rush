// HTTP plumbing for main: security headers, the static client handler, and
// method guards. Kept apart from main.go so it can be tested directly.
package main

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// securityHeaders sets the browser hardening headers on every response.
// The CSP fits the built client exactly: scripts and styles from this origin
// (React style attributes need 'unsafe-inline' for styles only), the inline
// SVG favicon as a data: image, and the game WebSocket on this same host.
// frame-ancestors 'none' stops the admin pages being framed (clickjacking).
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'self'; "+
			"script-src 'self'; "+
			"style-src 'self' 'unsafe-inline'; "+
			"img-src 'self' data:; "+
			"connect-src 'self' ws://"+r.Host+" wss://"+r.Host+"; "+
			"object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

// readOnly limits a handler to GET and HEAD.
func readOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		next(w, r)
	}
}

// staticHandler serves the client build. Unlike http.FileServer it never
// lists a directory, answers unknown paths with the build's 404.html (status
// 404), and sets caching: hashed /assets/ files are immutable, everything
// else (index.html above all) must be revalidated so a deploy shows up on
// the next load.
func staticHandler(dir string) http.HandlerFunc {
	return readOnly(func(w http.ResponseWriter, r *http.Request) {
		clean := path.Clean("/" + r.URL.Path)
		if strings.Contains(clean, "\\") {
			// path.Clean only knows "/"; on a Windows dev box a backslash
			// would let filepath.Join climb out of the build directory.
			notFound(dir, w, r)
			return
		}
		if clean == "/" {
			clean = "/index.html"
		}
		file := filepath.Join(dir, filepath.FromSlash(clean))
		info, err := os.Stat(file)
		if err != nil || info.IsDir() {
			notFound(dir, w, r)
			return
		}
		if strings.HasPrefix(clean, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		http.ServeFile(w, r, file)
	})
}

// notFound serves the client's 404 page with a real 404 status, or a plain
// 404 when the build has none.
func notFound(dir string, w http.ResponseWriter, r *http.Request) {
	page, err := os.ReadFile(filepath.Join(dir, "404.html"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusNotFound)
	if r.Method != http.MethodHead {
		w.Write(page)
	}
}

// serveAdminPage returns index.html for the client-side /admin routes. The
// game itself is a single page, but /admin/login and /admin/stats are routes
// the browser can be pointed at directly (deep link, refresh, the footer
// link), and no such files exist on disk. Without a build (Vite dev
// workflow) this 404s and the dev server handles the route instead.
func serveAdminPage(staticDir string) http.HandlerFunc {
	return readOnly(func(w http.ResponseWriter, r *http.Request) {
		if staticDir == "" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
	})
}
