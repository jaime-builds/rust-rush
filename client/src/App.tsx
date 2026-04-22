import { useEffect, useState } from 'react'
import './App.css'
import GameCanvas from './game/GameCanvas'
import { useWebSocket } from './hooks/useWebSocket'
import { GameState, Position } from './types/game'

const WS_URL = 'ws://localhost:8080/ws'
const ROOM_ID = 'game-1'
const GRID_WIDTH = 20
const GRID_HEIGHT = 15

const defaultGameState: GameState = {
  towers: [],
  enemies: [],
  projectiles: [],
  muzzle_flashes: [],
  explosions: [],
  gold: 200,
  health: 100,
  wave: 1,
  phase: 'waiting',
  enemies_remaining: 0,
  game_time: 0,
  spawn_point: { x: 0, y: 7 },
  goal_point: { x: 19, y: 7 },
}

function App() {
  const { status, lastMessage, sendMessage } = useWebSocket(WS_URL)
  const [hasJoined, setHasJoined] = useState(false)
  const [showDebug, setShowDebug] = useState(false)
  const [gameState, setGameState] = useState<GameState>(defaultGameState)
  const [fastForward, setFastForward] = useState(false)

  useEffect(() => {
    if (status.isConnected && !hasJoined) {
      sendMessage({
        type: 'join_room',
        room_id: ROOM_ID,
      })
    }
  }, [status.isConnected, hasJoined, sendMessage])

  useEffect(() => {
    if (!lastMessage) return

    if (lastMessage.type === 'join_room') {
      setHasJoined(true)
      if (lastMessage.payload?.state) {
        setGameState(lastMessage.payload.state)
      }
    }

    if (lastMessage.type === 'game_state') {
      if (lastMessage.payload?.state) {
        const incoming = lastMessage.payload.state
        setGameState({
          ...incoming,
          spawn_point: incoming.spawn_point || gameState.spawn_point,
          goal_point: incoming.goal_point || gameState.goal_point,
        })
      }
    }
  }, [lastMessage])

  const findPath = (start: Position, goal: Position, towers: any[]): Position[] | null => {
    const blocked = new Set<string>()
    towers.forEach(t => {
      const tx = Math.round(t.position.x)
      const ty = Math.round(t.position.y)
      blocked.add(`${tx},${ty}`)
    })

    const queue: { pos: Position, path: Position[] }[] = [{ pos: start, path: [start] }]
    const visited = new Set<string>()
    visited.add(`${Math.round(start.x)},${Math.round(start.y)}`)

    while (queue.length > 0) {
      const { pos, path } = queue.shift()!

      const px = Math.round(pos.x)
      const py = Math.round(pos.y)
      const gx = Math.round(goal.x)
      const gy = Math.round(goal.y)

      if (px === gx && py === gy) return path

      const neighbors = [
        { x: px + 1, y: py },
        { x: px - 1, y: py },
        { x: px, y: py + 1 },
        { x: px, y: py - 1 }
      ]

      for (const next of neighbors) {
        const key = `${next.x},${next.y}`
        if (next.x < 0 || next.x >= GRID_WIDTH || next.y < 0 || next.y >= GRID_HEIGHT) continue
        if (blocked.has(key) || visited.has(key)) continue
        visited.add(key)
        queue.push({ pos: next, path: [...path, next] })
      }
    }

    return null
  }

  const handlePlaceTower = (x: number, y: number, towerType: string) => {
    if (!hasJoined) return
    sendMessage({
      type: 'place_tower',
      room_id: ROOM_ID,
      payload: { x, y, tower_type: towerType }
    })
  }

  const handleSellTower = (towerId: number) => {
    if (!hasJoined) return
    sendMessage({
      type: 'remove_tower',
      room_id: ROOM_ID,
      payload: { tower_id: towerId }
    })
  }

  const handleUpgradeTower = (towerId: number) => {
    if (!hasJoined) return
    sendMessage({
      type: 'upgrade_tower',
      room_id: ROOM_ID,
      payload: { tower_id: towerId }
    })
  }

  const handleStartWave = () => {
    if (!hasJoined || gameState.phase !== 'waiting') return
    sendMessage({ type: 'start_wave', room_id: ROOM_ID })
  }

  const handleNewGame = () => {
    if (!hasJoined) return
    sendMessage({ type: 'new_game', room_id: ROOM_ID })
    setGameState(defaultGameState)
    setFastForward(false)
  }

  // Keep spawn enemy for debug purposes
  const handleSpawnEnemy = () => {
    if (!hasJoined) return
    const spawn = gameState.spawn_point || { x: 0, y: 7 }
    const goal = gameState.goal_point || { x: 19, y: 7 }
    const path = findPath(spawn, goal, gameState.towers)
    if (!path) {
      alert('Path is completely blocked!')
      return
    }
    sendMessage({
      type: 'spawn_enemy',
      room_id: ROOM_ID,
      payload: { enemy_type: 'basic', path }
    })
  }

  return (
    <div className="App">
      <header className="App-header">
        <h1>🦀 Rust Rush - Tower Defense</h1>
        <div className="status">
          <span className={status.isConnected ? 'status-dot connected' : 'status-dot disconnected'}>●</span>
          <span style={{ color: status.isConnected ? '#4CAF50' : '#999' }}>
            {status.isConnected ? 'Connected' : 'Connecting...'}
          </span>
          <button
            onClick={() => setShowDebug(!showDebug)}
            style={{
              marginLeft: '15px',
              padding: '5px 10px',
              fontSize: '12px',
              cursor: 'pointer',
              background: showDebug ? '#4CAF50' : '#666',
              border: 'none',
              borderRadius: '4px',
              color: 'white'
            }}
          >
            {showDebug ? '🐛 Hide Debug' : '🐛 Show Debug'}
          </button>
          <button
            onClick={() => {
              const next = !fastForward
              setFastForward(next)
              sendMessage({ type: 'set_speed', room_id: ROOM_ID, payload: { fast_forward: next } })
            }}
            style={{
              marginLeft: '8px',
              padding: '5px 10px',
              fontSize: '12px',
              cursor: 'pointer',
              background: fastForward ? '#FF9800' : '#666',
              border: 'none',
              borderRadius: '4px',
              color: 'white'
            }}
            title="Fast forward: 3x game speed for testing"
          >
            {fastForward ? '⏩ FF: ON' : '⏩ FF: OFF'}
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
          onPlaceTower={handlePlaceTower}
          onSellTower={handleSellTower}
          onUpgradeTower={handleUpgradeTower}
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
