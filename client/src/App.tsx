import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import GameCanvas from './game/GameCanvas'
import ErrorBoundary from './ui/ErrorBoundary'
import SettingsMenu from './ui/SettingsMenu'
import AccountDialog from './ui/AccountDialog'
import LeaderboardDialog from './ui/LeaderboardDialog'
import AchievementsDialog from './ui/AchievementsDialog'
import { Account, fetchMe } from './account/api'
import { readFurthestBeaten } from './game/progress'
import { useWebSocket } from './hooks/useWebSocket'
import { Difficulty, GameState, SaveSummary, newPlacementCheckStore } from './types/game'
import { sound } from './audio/sound'
import { RESET_GUARD_MS, isFreshRun, readRoomCode, writeRoomCode } from './session'

// Dev: Vite serves the client on 5173, Go server runs separately on 8080.
// Production build: the Go server serves the client itself, so derive the
// WebSocket URL from wherever the page was loaded from.
const WS_URL = import.meta.env.DEV
  ? 'ws://localhost:8080/ws'
  : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`


// The server broadcasts 60 snapshots/sec. The canvas reads every one through
// liveStateRef, but React (header, panels, buttons) only needs event-frequency
// updates, so commits are throttled to this interval with a trailing edge —
// the newest snapshot always lands within one interval, and phase changes
// (game over, wave transitions) commit immediately. Set to 0 to disable.
const UI_UPDATE_INTERVAL_MS = 100

const defaultGameState: GameState = {
  towers: [],
  enemies: [],
  projectiles: [],
  muzzle_flashes: [],
  explosions: [],
  gold: 200,
  health: 100,
  score: 0,
  wave: 1,
  phase: 'waiting',
  enemies_remaining: 0,
  game_time: 0,
  spawn_point: { x: 0, y: 7 },
  goal_point: { x: 19, y: 7 },
}

function App() {
  const { status, subscribe, sendMessage, reconnectNow, restart } = useWebSocket(WS_URL)
  // Optional player account (null = guest). Loaded once; sign-in and
  // sign-out restart the socket so the server sees the new identity.
  const [account, setAccount] = useState<Account | null>(null)
  const [showAccount, setShowAccount] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [showAchievements, setShowAchievements] = useState(false)
  // Unlock toasts from the server, each shown for a few seconds.
  const [toasts, setToasts] = useState<{ key: number; name: string; description: string }[]>([])
  const toastKeyRef = useRef(0)
  // The account's autosaved run (from the join reply), offered as Continue
  // on the map screen; loadError explains a refused load.
  const [savedRun, setSavedRun] = useState<SaveSummary | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hasJoined, setHasJoined] = useState(false)
  // The server says (in the join reply) whether debug spawns are enabled;
  // the DEBUG button only exists when they are.
  const [debugAllowed, setDebugAllowed] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [showDebug, setShowDebug] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [gameState, setGameState] = useState<GameState>(defaultGameState)

  // Newest server snapshot, updated on every message for the canvas loop.
  const liveStateRef = useRef<GameState>(defaultGameState)
  const lastCommitRef = useRef(0)
  const pendingCommitRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Highest explosion effect ID heard so far — new IDs above it trigger the
  // explosion SFX (effect IDs are a monotonic per-game counter).
  const lastExplosionIdRef = useRef(0)
  // check_placement answers, shared with GameCanvas: App writes replies here,
  // the canvas requests, reads and invalidates. See PlacementCheckStore.
  const placementChecksRef = useRef(newPlacementCheckStore())
  // Set by New Game; see RESET_GUARD_MS.
  const resetGuardUntilRef = useRef(0)

  // Browsers only allow audio after a user gesture: the first pointer/key
  // input unlocks the AudioContext and starts the ambient music loop.
  useEffect(() => {
    // Listeners stay until audio is really running: Chrome doesn't count
    // some first keys (Esc, Tab) as a gesture.
    const unlock = () => {
      void sound.unlock().then(running => {
        if (!running) return
        window.removeEventListener('pointerdown', unlock)
        window.removeEventListener('keydown', unlock)
      })
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchMe().then(a => { if (!cancelled) setAccount(a) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const handleSignedIn = useCallback((a: Account) => {
    setAccount(a)
    restart()
  }, [restart])

  const handleSignedOut = useCallback(() => {
    setAccount(null)
    restart()
  }, [restart])

  const closeAccount = useCallback(() => setShowAccount(false), [])
  const closeLeaderboard = useCallback(() => setShowLeaderboard(false), [])
  const closeAchievements = useCallback(() => setShowAchievements(false), [])

  // Join on every new connection (connectionId bumps per connect): the
  // server forgets a socket's room the moment it drops, so a reconnect must
  // rejoin, resuming this tab's room when the server still has it.
  useEffect(() => {
    if (!status.isConnected) {
      setHasJoined(false)
      return
    }
    const resume = readRoomCode()
    sendMessage({ type: 'join_room', ...(resume ? { payload: { resume } } : {}) })
  }, [status.isConnected, status.connectionId, sendMessage])

  // A full server refuses the join; try again every 10 s while connected.
  useEffect(() => {
    if (!joinError || !status.isConnected) return
    const retry = setTimeout(() => {
      setJoinError(null)
      sendMessage({ type: 'join_room' })
    }, 10000)
    return () => clearTimeout(retry)
  }, [joinError, status.isConnected, sendMessage])

  useEffect(() => {
    const commitNow = () => {
      if (pendingCommitRef.current) {
        clearTimeout(pendingCommitRef.current)
        pendingCommitRef.current = null
      }
      lastCommitRef.current = Date.now()
      const incoming = liveStateRef.current
      setGameState(prev => ({
        ...incoming,
        // The server includes spawn/goal in every snapshot; this fallback
        // only guards the theoretical missing case.
        spawn_point: incoming.spawn_point || prev.spawn_point,
        goal_point: incoming.goal_point || prev.goal_point,
      }))
    }

    const scheduleTrailingCommit = () => {
      if (pendingCommitRef.current) return // a pending commit will pick up liveStateRef
      const elapsed = Date.now() - lastCommitRef.current
      const delay = Math.max(0, UI_UPDATE_INTERVAL_MS - elapsed)
      pendingCommitRef.current = setTimeout(() => {
        pendingCommitRef.current = null
        commitNow()
      }, delay)
    }

    const unsubscribe = subscribe(message => {
      if (message.type === 'join_room') {
        const p = message.payload ?? {}
        if (p.status !== 'joined') {
          setHasJoined(false)
          setJoinError('The server is full right now. Retrying…')
          return
        }
        if (typeof p.room_code === 'string') writeRoomCode(p.room_code)
        setSavedRun((p.save as SaveSummary | null | undefined) ?? null)
        setLoadError(null)
        setDebugAllowed(p.debug_spawn === true)
        setJoinError(null)
        setHasJoined(true)
        resetGuardUntilRef.current = 0
        if (p.state) {
          liveStateRef.current = p.state
          lastExplosionIdRef.current = 0
          commitNow()
        }
        return
      }

      if (message.type === 'achievement') {
        const { name, description } = (message.payload ?? {}) as { name?: string; description?: string }
        if (typeof name !== 'string') return
        const key = ++toastKeyRef.current
        setToasts(t => [...t, { key, name, description: description ?? '' }])
        sound.evolveConfirm()
        setTimeout(() => setToasts(t => t.filter(x => x.key !== key)), 5000)
        return
      }

      if (message.type === 'load_save') {
        const status = message.payload?.status
        if (status === 'loaded') {
          setSavedRun(null)
          setLoadError(null)
        } else {
          setLoadError(status === 'not_fresh'
            ? 'A saved run can only be continued on a fresh board. Start a new game first.'
            : status === 'no_save' ? 'That save is gone.' : 'The save could not be loaded.')
        }
        return
      }

      // Evolve confirm SFX rides the existing server ack — no new messages.
      if (message.type === 'evolve_tower' && message.payload?.status === 'evolved') {
        sound.evolveConfirm()
        return
      }

      // Path-block preview reply for one hovered cell. The pending entry is
      // the ticket: GameCanvas drops it whenever the tower layout changes,
      // so a reply that outlived its board finds nothing to match and is
      // discarded instead of being cached as fact. Cells the cursor has
      // since left are still cached — the answer is about the cell, not the
      // cursor, and staying cached is what makes moving back instant.
      if (message.type === 'check_placement') {
        const { x, y, blocks_path: blocks } = (message.payload ?? {}) as
          { x?: number; y?: number; blocks_path?: boolean }
        if (typeof x !== 'number' || typeof y !== 'number' || typeof blocks !== 'boolean') return
        const store = placementChecksRef.current
        const key = `${x},${y}`
        if (store.pending.get(key) !== store.epoch) return // stale board
        store.pending.delete(key)
        store.results.set(key, blocks)
        return
      }

      if (message.type === 'game_state' && message.payload?.state) {
        const incoming: GameState = message.payload.state
        if (resetGuardUntilRef.current) {
          if (!isFreshRun(incoming) && Date.now() < resetGuardUntilRef.current) return
          resetGuardUntilRef.current = 0
        }
        const prevPhase = liveStateRef.current.phase
        const phaseChanged = incoming.phase !== prevPhase

        // Sound triggers are client-side reactions to server state changes.
        if (phaseChanged) {
          if (prevPhase === 'waiting' && incoming.phase === 'active') {
            sound.waveStart()
          } else if (prevPhase === 'active' && incoming.phase === 'game_over') {
            sound.gameOver()
          }
        }
        const explosions = incoming.explosions ?? []
        let maxId = 0
        for (const e of explosions) {
          if (e.id > maxId) maxId = e.id
        }
        if (maxId > lastExplosionIdRef.current) {
          sound.explosion()
          lastExplosionIdRef.current = maxId
        } else if (maxId > 0 && maxId < lastExplosionIdRef.current) {
          // Effect IDs restarted (new game) — resync without playing.
          lastExplosionIdRef.current = maxId
        }

        liveStateRef.current = incoming
        if (phaseChanged || showDebug || UI_UPDATE_INTERVAL_MS <= 0) {
          commitNow()
        } else {
          scheduleTrailingCommit()
        }
      }
    })

    return () => {
      unsubscribe()
      if (pendingCommitRef.current) {
        clearTimeout(pendingCommitRef.current)
        pendingCommitRef.current = null
      }
    }
  }, [subscribe, showDebug])

  // Handlers are useCallback'd so GameCanvas effects can list them as honest
  // dependencies without re-running on every throttled state commit.
  const handlePlaceTower = useCallback((x: number, y: number, towerType: string) => {
    if (!hasJoined) return
    sendMessage({
      type: 'place_tower',
      payload: { x, y, tower_type: towerType }
    })
  }, [hasJoined, sendMessage])

  // Hover preview only — AddTower re-checks server-side and is the real
  // gate, so a dropped or slow reply can never let a sealing tower through.
  const handleCheckPlacement = useCallback((x: number, y: number) => {
    if (!hasJoined) return
    sendMessage({
      type: 'check_placement',
      payload: { x, y }
    })
  }, [hasJoined, sendMessage])

  const handleSellTower = useCallback((towerId: number) => {
    if (!hasJoined) return
    sendMessage({
      type: 'remove_tower',
      payload: { tower_id: towerId }
    })
  }, [hasJoined, sendMessage])

  const handleUpgradeTower = useCallback((towerId: number) => {
    if (!hasJoined) return
    sendMessage({
      type: 'upgrade_tower',
      payload: { tower_id: towerId }
    })
  }, [hasJoined, sendMessage])

  const handleEvolveTower = useCallback((towerId: number, evolution: string) => {
    if (!hasJoined) return
    sendMessage({
      type: 'evolve_tower',
      payload: { tower_id: towerId, evolution }
    })
  }, [hasJoined, sendMessage])

  const handleStartWave = useCallback(() => {
    if (!hasJoined || liveStateRef.current.phase !== 'waiting') return
    sendMessage({ type: 'start_wave' })
  }, [hasJoined, sendMessage])

  // mapId (optional) selects the map for the fresh run; omitted = keep the
  // room's current map. difficulty/endless configure the run (both optional;
  // the server defaults to normal survival when absent) — REDEPLOY passes
  // the dying run's settings through so a Harder run redeploys as Harder.
  const handleNewGame = useCallback((mapId?: string, difficulty?: Difficulty, endless?: boolean) => {
    if (!hasJoined) return
    const payload: Record<string, unknown> = {}
    if (mapId) payload.map_id = mapId
    if (difficulty) payload.difficulty = difficulty
    if (endless !== undefined) payload.endless = endless
    sendMessage({
      type: 'new_game',
      ...(Object.keys(payload).length ? { payload } : {}),
    })
    liveStateRef.current = defaultGameState
    lastExplosionIdRef.current = 0 // effect IDs restart, so the first boom plays
    resetGuardUntilRef.current = Date.now() + RESET_GUARD_MS
    setGameState(defaultGameState)
  }, [hasJoined, sendMessage])

  const handleLoadSave = useCallback(() => {
    if (!hasJoined) return
    setLoadError(null)
    sendMessage({ type: 'load_save' })
  }, [hasJoined, sendMessage])

  // Victory screen: continue the same run past the win wave in Endless.
  // No local state reset — the run carries on from exactly where it is.
  const handleContinueEndless = useCallback(() => {
    if (!hasJoined) return
    sendMessage({ type: 'continue_endless' })
  }, [hasJoined, sendMessage])

  // Debug-panel helper: the server computes the spawn path itself.
  const handleSpawnEnemy = useCallback(() => {
    if (!hasJoined) return
    sendMessage({
      type: 'spawn_enemy',
      payload: { enemy_type: 'basic' }
    })
  }, [hasJoined, sendMessage])

  // Speed and pause are server state; deriving them from the snapshot keeps
  // the controls truthful across page reloads mid-game.
  const speed = gameState.speed_multiplier ?? 1
  const paused = gameState.paused ?? false

  const handleSetSpeed = useCallback((s: number) => {
    if (!hasJoined) return
    sendMessage({ type: 'set_speed', payload: { speed: s } })
  }, [hasJoined, sendMessage])

  const handleTogglePause = useCallback(() => {
    if (!hasJoined) return
    sendMessage({ type: 'pause_game', payload: { paused: !liveStateRef.current.paused } })
  }, [hasJoined, sendMessage])

  // Stable, so SettingsMenu's Escape listener isn't re-bound on every
  // throttled state commit.
  const closeSettings = useCallback(() => setShowSettings(false), [])

  const connectionLabel = status.isConnected
    ? (hasJoined ? 'ONLINE' : (joinError ? 'SERVER FULL' : 'JOINING…'))
    : (status.connectionId > 0 ? 'OFFLINE' : 'CONNECTING…')

  return (
    <div className="App">
      <header className="App-header">
        <h1>🦀 Rust Rush — Tower Defense</h1>
        <div className="status">
          <span className={status.isConnected && hasJoined ? 'connected' : 'disconnected'} role="status" aria-live="polite">
            ● {connectionLabel}
            {(status.error || joinError) && <span className="connection-note"> {joinError ?? status.error}</span>}
          </span>
          {!status.isConnected && status.struggling && (
            <button className="btn btn-inline" onClick={reconnectNow} title="Try to reconnect right now">
              RECONNECT
            </button>
          )}
          {debugAllowed && (
            <button
              className={`btn btn-inline ${showDebug ? 'btn-toggled' : ''}`}
              onClick={() => setShowDebug(!showDebug)}
              aria-pressed={showDebug}
            >
              DEBUG
            </button>
          )}
          <span className="speed-control">
            {[1, 2, 3].map(s => (
              <button
                key={s}
                className={`btn btn-inline ${speed === s ? 'btn-toggled' : ''}`}
                onClick={() => handleSetSpeed(s)}
                disabled={!hasJoined}
                aria-pressed={speed === s}
                aria-label={`${s}x speed`}
                title={`Run the game at ${s}x speed`}
              >
                ×{s}
              </button>
            ))}
            <button
              className={`btn btn-inline ${paused ? 'btn-toggled' : ''}`}
              onClick={handleTogglePause}
              disabled={!hasJoined}
              aria-pressed={paused}
              aria-label={paused ? 'Resume' : 'Pause'}
              title={paused ? 'Resume the game' : 'Pause — freezes everything in place'}
            >
              {paused ? '▶' : '⏸'}
            </button>
          </span>
          <button
            className="btn btn-inline"
            onClick={() => setShowSettings(true)}
            title="Effect and audio settings"
          >
            ⚙ SETTINGS
          </button>
          <button
            className="btn btn-inline"
            onClick={() => setShowLeaderboard(true)}
            title="Top players per zone"
          >
            LEADERBOARD
          </button>
          <button
            className="btn btn-inline"
            onClick={() => setShowAchievements(true)}
            title="Your achievements"
          >
            ACHIEVEMENTS
          </button>
          <button
            className={`btn btn-inline ${account ? 'btn-toggled' : ''}`}
            onClick={() => setShowAccount(true)}
            title={account ? 'Your account' : 'Sign in or create an account (optional)'}
          >
            {account ? `◆ ${account.username}` : 'SIGN IN'}
          </button>
        </div>

        {showDebug && debugAllowed && (
          <div className="debug-info" style={{
            fontSize: '11px',
            marginTop: '10px',
            background: 'rgba(0,0,0,0.6)',
            padding: '12px',
            borderRadius: '5px',
            fontFamily: 'monospace',
            display: 'flex',
            gap: '20px',
            flexWrap: 'wrap',
            justifyContent: 'center',
            alignItems: 'flex-start'
          }}>
            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px 12px', borderRadius: '4px', minWidth: '200px' }}>
              <strong style={{ display: 'block', marginBottom: '5px', color: '#4CAF50' }}>📊 Game State</strong>
              <div>Phase: {gameState.phase}</div>
              <div>🗼 Towers: {gameState.towers?.length ?? 0}</div>
              <div>🦀 Enemies: {gameState.enemies?.length ?? 0}</div>
              <div>💥 Projectiles: {gameState.projectiles?.length ?? 0}</div>
              <div>💰 Gold: {gameState.gold ?? 0}</div>
              <div>❤️ Health: {gameState.health ?? 0}</div>
              <div>⭐ Score: {gameState.score ?? 0}</div>
              <div>🌊 Wave: {gameState.wave}</div>
              <div>👾 Remaining: {gameState.enemies_remaining}</div>
            </div>

            {gameState.towers && gameState.towers.length > 0 && (
              <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px 12px', borderRadius: '4px', maxWidth: '400px', maxHeight: '150px', overflowY: 'auto' }}>
                <strong style={{ display: 'block', marginBottom: '5px', color: '#2196F3' }}>🗼 Towers ({gameState.towers.length})</strong>
                <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
                  {gameState.towers.map((tower, idx) => (
                    <div key={tower.id} style={{ fontSize: '10px', minWidth: '120px' }}>
                      <strong>#{idx + 1}</strong> {tower.tower_type}<br />
                      Rot: {tower.rotation?.toFixed(2) ?? 'N/A'}<br />
                      CD: {tower.cooldown?.toFixed(2) ?? 'N/A'}<br />
                      Target: {tower.current_target || 'None'}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {gameState.enemies && gameState.enemies.length > 0 && (
              <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px 12px', borderRadius: '4px', maxWidth: '300px' }}>
                <strong style={{ display: 'block', marginBottom: '5px', color: '#ff4444' }}>🦀 Enemies ({gameState.enemies.length})</strong>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {gameState.enemies.map(enemy => (
                    <div key={enemy.id} style={{ fontSize: '10px' }}>
                      #{enemy.id} ({enemy.enemy_type}): {enemy.health.toFixed(0)}/{enemy.max_health}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      {showAccount && (
        <ErrorBoundary section="ACCOUNT">
          <AccountDialog
            account={account}
            localFurthest={readFurthestBeaten()}
            onClose={closeAccount}
            onSignedIn={handleSignedIn}
            onSignedOut={handleSignedOut}
          />
        </ErrorBoundary>
      )}

      {showAchievements && (
        <ErrorBoundary section="ACHIEVEMENTS">
          <AchievementsDialog onClose={closeAchievements} />
        </ErrorBoundary>
      )}

      {toasts.length > 0 && (
        <div className="achievement-toasts" role="status" aria-live="polite">
          {toasts.map(t => (
            <div key={t.key} className="achievement-toast">
              <div className="achievement-toast-title">ACHIEVEMENT UNLOCKED</div>
              <div className="achievement-toast-name">{t.name}</div>
              <div className="achievement-toast-desc">{t.description}</div>
            </div>
          ))}
        </div>
      )}

      {showLeaderboard && (
        <ErrorBoundary section="LEADERBOARD">
          <LeaderboardDialog
            initialMap={gameState.map_id ?? 'open'}
            initialDifficulty={gameState.difficulty === 'harder' ? 'harder' : 'normal'}
            signedIn={account !== null}
            username={account?.username ?? null}
            onClose={closeLeaderboard}
          />
        </ErrorBoundary>
      )}

      {showSettings && (
        <ErrorBoundary section="SETTINGS">
          <SettingsMenu onClose={closeSettings} />
        </ErrorBoundary>
      )}

      <main>
        <ErrorBoundary section="GAME VIEW">
          <GameCanvas
          isConnected={status.isConnected && hasJoined}
          gameState={gameState}
          liveStateRef={liveStateRef}
          onPlaceTower={handlePlaceTower}
          onSellTower={handleSellTower}
          onUpgradeTower={handleUpgradeTower}
          onEvolveTower={handleEvolveTower}
          onStartWave={handleStartWave}
          onNewGame={handleNewGame}
          onContinueEndless={handleContinueEndless}
          onSpawnEnemy={handleSpawnEnemy}
          onCheckPlacement={handleCheckPlacement}
          placementChecksRef={placementChecksRef}
          showDebug={showDebug && debugAllowed}
          accountFurthest={account?.furthest_beaten ?? 0}
          savedRun={savedRun}
          loadError={loadError}
          onLoadSave={handleLoadSave}
          />
        </ErrorBoundary>
      </main>

      <footer>
        <p>🦀 Rust Rush - Built with Go 🐹 and React ⚛️</p>
        {/* Plain link, not a client-side route: the admin UI is a separate
            tree mounted by main.tsx, so a full navigation is the point. */}
        <p><a className="footer-admin" href="/admin/login">Admin</a></p>
      </footer>
    </div>
  )
}

export default App
