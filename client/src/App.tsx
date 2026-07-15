import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import GameCanvas from './game/GameCanvas'
import { useWebSocket } from './hooks/useWebSocket'
import { GameState } from './types/game'
import { sound } from './audio/sound'

// Dev: Vite serves the client on 5173, Go server runs separately on 8080.
// Production build: the Go server serves the client itself, so derive the
// WebSocket URL from wherever the page was loaded from.
const WS_URL = import.meta.env.DEV
  ? 'ws://localhost:8080/ws'
  : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
const ROOM_ID = 'game-1'

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
  const { status, subscribe, sendMessage } = useWebSocket(WS_URL)
  const [hasJoined, setHasJoined] = useState(false)
  const [showDebug, setShowDebug] = useState(false)
  const [muted, setMuted] = useState(sound.isMuted())
  const [gameState, setGameState] = useState<GameState>(defaultGameState)

  // Newest server snapshot, updated on every message for the canvas loop.
  const liveStateRef = useRef<GameState>(defaultGameState)
  const lastCommitRef = useRef(0)
  const pendingCommitRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Highest explosion effect ID heard so far — new IDs above it trigger the
  // explosion SFX (effect IDs are a monotonic per-game counter).
  const lastExplosionIdRef = useRef(0)

  // Browsers only allow audio after a user gesture: the first pointer/key
  // input unlocks the AudioContext and starts the ambient music loop.
  useEffect(() => {
    const unlock = () => {
      sound.unlock()
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    if (status.isConnected && !hasJoined) {
      sendMessage({
        type: 'join_room',
        room_id: ROOM_ID,
      })
    }
  }, [status.isConnected, hasJoined, sendMessage])

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
        setHasJoined(true)
        if (message.payload?.state) {
          liveStateRef.current = message.payload.state
          commitNow()
        }
        return
      }

      // Evolve confirm SFX rides the existing server ack — no new messages.
      if (message.type === 'evolve_tower' && message.payload?.status === 'evolved') {
        sound.evolveConfirm()
        return
      }

      if (message.type === 'game_state' && message.payload?.state) {
        const incoming: GameState = message.payload.state
        const prevPhase = liveStateRef.current.phase
        const phaseChanged = incoming.phase !== prevPhase

        // Sound triggers are client-side reactions to server state changes.
        if (phaseChanged) {
          if (prevPhase === 'waiting' && incoming.phase === 'active') {
            sound.waveStart()
          } else if (incoming.phase === 'game_over') {
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
      room_id: ROOM_ID,
      payload: { x, y, tower_type: towerType }
    })
  }, [hasJoined, sendMessage])

  const handleSellTower = useCallback((towerId: number) => {
    if (!hasJoined) return
    sendMessage({
      type: 'remove_tower',
      room_id: ROOM_ID,
      payload: { tower_id: towerId }
    })
  }, [hasJoined, sendMessage])

  const handleUpgradeTower = useCallback((towerId: number) => {
    if (!hasJoined) return
    sendMessage({
      type: 'upgrade_tower',
      room_id: ROOM_ID,
      payload: { tower_id: towerId }
    })
  }, [hasJoined, sendMessage])

  const handleEvolveTower = useCallback((towerId: number, evolution: string) => {
    if (!hasJoined) return
    sendMessage({
      type: 'evolve_tower',
      room_id: ROOM_ID,
      payload: { tower_id: towerId, evolution }
    })
  }, [hasJoined, sendMessage])

  const handleStartWave = useCallback(() => {
    if (!hasJoined || liveStateRef.current.phase !== 'waiting') return
    sendMessage({ type: 'start_wave', room_id: ROOM_ID })
  }, [hasJoined, sendMessage])

  // mapId (optional) selects the map for the fresh run; omitted = keep the
  // room's current map.
  const handleNewGame = useCallback((mapId?: string) => {
    if (!hasJoined) return
    sendMessage({
      type: 'new_game',
      room_id: ROOM_ID,
      ...(mapId ? { payload: { map_id: mapId } } : {}),
    })
    liveStateRef.current = defaultGameState
    setGameState(defaultGameState)
  }, [hasJoined, sendMessage])

  // Debug-panel helper: the server computes the spawn path itself.
  const handleSpawnEnemy = useCallback(() => {
    if (!hasJoined) return
    sendMessage({
      type: 'spawn_enemy',
      room_id: ROOM_ID,
      payload: { enemy_type: 'basic' }
    })
  }, [hasJoined, sendMessage])

  // Fast forward is server state; deriving it from the snapshot keeps the
  // button truthful across page reloads mid-game.
  const fastForward = gameState.fast_forward ?? false

  return (
    <div className="App">
      <header className="App-header">
        <h1>🦀 Rust Rush — Tower Defense</h1>
        <div className="status">
          <span className={status.isConnected ? 'connected' : 'disconnected'}>
            ● {status.isConnected ? 'ONLINE' : 'CONNECTING…'}
          </span>
          <button
            className={`btn btn-inline ${showDebug ? 'btn-toggled' : ''}`}
            onClick={() => setShowDebug(!showDebug)}
          >
            DEBUG
          </button>
          <button
            className={`btn btn-inline ${fastForward ? 'btn-toggled' : ''}`}
            onClick={() => {
              sendMessage({ type: 'set_speed', room_id: ROOM_ID, payload: { fast_forward: !fastForward } })
            }}
            title="Fast forward: 3x game speed for testing"
          >
            FF ×3: {fastForward ? 'ON' : 'OFF'}
          </button>
          <button
            className={`btn btn-inline ${muted ? '' : 'btn-toggled'}`}
            onClick={() => setMuted(sound.toggleMute())}
            title={muted ? 'Sound is muted — click to unmute' : 'Click to mute all sound'}
          >
            ♪ {muted ? 'OFF' : 'ON'}
          </button>
        </div>

        {showDebug && (
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

      <main>
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
          onSpawnEnemy={handleSpawnEnemy}
          showDebug={showDebug}
        />
      </main>

      <footer>
        <p>🦀 Rust Rush - Built with Go 🐹 and React ⚛️</p>
      </footer>
    </div>
  )
}

export default App
