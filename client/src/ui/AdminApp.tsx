import { useCallback, useEffect, useState } from 'react'
import AdminLogin from './AdminLogin'
import AdminStats from './AdminStats'
import ErrorBoundary from './ErrorBoundary'
import { ADMIN_LOGIN_PATH, ADMIN_STATS_PATH } from '../types/stats'
import './Admin.css'

// The admin area is two pages, so it routes itself off the pathname rather
// than pulling in a router dependency for the app's only client-side routes.
// navigate() pushes history so the back button behaves; popstate syncs back.
export default function AdminApp() {
  const [path, setPath] = useState(window.location.pathname)

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((to: string) => {
    if (window.location.pathname !== to) {
      window.history.pushState({}, '', to)
    }
    setPath(to)
  }, [])

  // Anything under /admin that isn't the stats page lands on login — an
  // unauthenticated visitor has nowhere else to be.
  return (
    <div className="admin">
      <ErrorBoundary section="ADMIN">
        {path === ADMIN_STATS_PATH
          ? <AdminStats navigate={navigate} />
          : <AdminLogin navigate={navigate} />}
      </ErrorBoundary>
      <footer className="admin-footer">
        <a href="/">← Back to the game</a>
        <span className="admin-footer-path">{path === ADMIN_STATS_PATH ? ADMIN_STATS_PATH : ADMIN_LOGIN_PATH}</span>
      </footer>
    </div>
  )
}
