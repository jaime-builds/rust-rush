// Client entry point: mounts the React app into #root and loads global styles.
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import AdminApp from './ui/AdminApp.tsx'
import './index.css'

// Top-level split: /admin/* is the private operator UI, everything else is the
// game. Two independent trees, so the admin pages never open a game
// WebSocket and the game never carries the admin code path.
const isAdmin = window.location.pathname.startsWith('/admin')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isAdmin ? <AdminApp /> : <App />}
  </React.StrictMode>,
)
