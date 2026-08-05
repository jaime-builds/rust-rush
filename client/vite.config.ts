import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev the client is served by Vite on 5173 and the Go server runs on 8080.
// The admin session cookie is HTTP-only and same-origin, so the admin API
// calls have to look like they came from 5173 — hence the proxy. Page
// navigations must NOT be proxied (Vite's SPA fallback serves them from
// source); only the POST to /admin/login and the two API reads go through.
const GO_SERVER = 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/stats': GO_SERVER,
      '/admin/logout': GO_SERVER,
      '/admin/login': {
        target: GO_SERVER,
        // GET /admin/login is the login *page*; only the form POST is the API.
        bypass: req => (req.method === 'POST' ? undefined : '/index.html'),
      },
    },
  },
})
