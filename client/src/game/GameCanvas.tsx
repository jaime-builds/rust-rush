import { useEffect, useRef, useState, useCallback } from 'react'
import './GameCanvas.css'
import { Tower, TowerType, Enemy, GameState, TOWER_COSTS } from '../types/game'

const GRID_WIDTH = 20
const GRID_HEIGHT = 15
const CELL_SIZE = 40

interface Position {
  x: number
  y: number
}

interface GameCanvasProps {
  isConnected: boolean
  onPlaceTower: (x: number, y: number, towerType: string) => void
  onSellTower: (towerId: number) => void
  onStartWave: () => void
  onNewGame: () => void
  onClearTowers: () => void
  onSpawnEnemy?: () => void
  gameState?: GameState
  showDebug?: boolean
}

const TOWER_COLORS: Record<string, string> = {
  basic: '#4CAF50',
  sniper: '#2196F3',
  splash: '#FF9800',
  slow: '#9C27B0',
}

const TOWER_RANGES: Record<string, number> = {
  basic: 3.0,
  sniper: 6.0,
  splash: 2.5,
  slow: 3.5,
}

const TOWER_LABELS: Record<string, string> = {
  basic: '🗼 Basic',
  sniper: '🎯 Sniper',
  splash: '💥 Splash',
  slow: '❄️ Slow',
}

const GameCanvas = ({
  isConnected,
  onPlaceTower,
  onSellTower,
  onStartWave,
  onNewGame,
  onClearTowers,
  onSpawnEnemy,
  gameState,
  showDebug,
}: GameCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number>()
  const gameStateRef = useRef<GameState | undefined>(gameState)
  const hoveredCellRef = useRef<Position | null>(null)
  const selectedTowerTypeRef = useRef<TowerType | null>('basic')
  const selectedTowerRef = useRef<Tower | null>(null)

  const [hoveredCell, setHoveredCell] = useState<Position | null>(null)
  const [selectedTowerType, setSelectedTowerType] = useState<TowerType | null>('basic')
  const [selectedTower, setSelectedTower] = useState<Tower | null>(null)
  const [autoWave, setAutoWave] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const countdownRef = useRef<NodeJS.Timeout | null>(null)

  // Sync refs
  gameStateRef.current = gameState
  hoveredCellRef.current = hoveredCell
  selectedTowerTypeRef.current = selectedTowerType
  selectedTowerRef.current = selectedTower

  const phase = gameState?.phase || 'waiting'
  const gold = gameState?.gold ?? 200
  const isWaveActive = phase === 'active'
  const isGameOver = phase === 'game_over'

  // Auto wave countdown logic
  useEffect(() => {
    if (!autoWave || isWaveActive || isGameOver || !isConnected) return

    // Start countdown when wave clears and auto is on
    setCountdown(5)
    const tick = setInterval(() => {
      setCountdown(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(tick)
          setCountdown(null)
          onStartWave()
          return null
        }
        return prev - 1
      })
    }, 1000)

    countdownRef.current = tick
    return () => clearInterval(tick)
  }, [autoWave, isWaveActive, isGameOver, isConnected])

  // Clear countdown if wave starts manually or game over
  useEffect(() => {
    if (isWaveActive || isGameOver) {
      if (countdownRef.current) clearInterval(countdownRef.current)
      setCountdown(null)
    }
  }, [isWaveActive, isGameOver])

  // Deselect tower if it no longer exists (was sold or cleared)
  useEffect(() => {
    if (selectedTower) {
      const still = gameState?.towers.find(t => t.id === selectedTower.id)
      if (!still) setSelectedTower(null)
    }
  }, [gameState?.towers])

  // Animation loop
  useEffect(() => {
    const animate = () => {
      render()
      animationFrameRef.current = requestAnimationFrame(animate)
    }
    animationFrameRef.current = requestAnimationFrame(animate)
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
    }
  }, [])

  const render = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const gs = gameStateRef.current
    const hovered = hoveredCellRef.current
    const selType = selectedTowerTypeRef.current
    const selTower = selectedTowerRef.current
    const currentTowers = gs?.towers || []
    const currentEnemies = gs?.enemies || []
    const currentProjectiles = gs?.projectiles || []
    const currentFlashes = gs?.muzzle_flashes || []
    const currentExplosions = gs?.explosions || []
    const currentGold = gs?.gold ?? 200
    const currentPhase = gs?.phase || 'waiting'
    const currentIsGameOver = currentPhase === 'game_over'

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    drawGrid(ctx)

    if (gs?.spawn_point) drawSpawnPoint(ctx, gs.spawn_point)
    if (gs?.goal_point) drawGoalPoint(ctx, gs.goal_point)

    currentTowers.forEach(tower => { if (tower.current_target) drawTowerRange(ctx, tower) })
    currentProjectiles.forEach(p => drawProjectile(ctx, p))
    currentTowers.forEach(tower => drawTower(ctx, tower, selTower?.id === tower.id))
    currentEnemies.forEach(enemy => drawEnemy(ctx, enemy))
    currentFlashes.forEach(flash => drawMuzzleFlash(ctx, flash))
    currentExplosions.forEach(explosion => drawExplosion(ctx, explosion))

    // Draw selected tower highlight and range
    if (selTower) {
      const t = currentTowers.find(t => t.id === selTower.id)
      if (t) drawSelectedTowerHighlight(ctx, t)
    }

    const isOccupied = (pos: Position) => currentTowers.some(t => t.position.x === pos.x && t.position.y === pos.y)

    if (hovered && !isOccupied(hovered) && !currentIsGameOver && !selTower && selType !== null) {
      drawHighlight(ctx, hovered)
      drawTowerPreview(ctx, hovered, selType, currentGold)
    }
  }

  const drawGrid = (ctx: CanvasRenderingContext2D) => {
    ctx.strokeStyle = '#444'
    ctx.lineWidth = 1
    for (let x = 0; x <= GRID_WIDTH; x++) {
      ctx.beginPath()
      ctx.moveTo(x * CELL_SIZE, 0)
      ctx.lineTo(x * CELL_SIZE, GRID_HEIGHT * CELL_SIZE)
      ctx.stroke()
    }
    for (let y = 0; y <= GRID_HEIGHT; y++) {
      ctx.beginPath()
      ctx.moveTo(0, y * CELL_SIZE)
      ctx.lineTo(GRID_WIDTH * CELL_SIZE, y * CELL_SIZE)
      ctx.stroke()
    }
  }

  const drawSpawnPoint = (ctx: CanvasRenderingContext2D, pos: Position) => {
    const x = pos.x * CELL_SIZE + CELL_SIZE / 2
    const y = pos.y * CELL_SIZE + CELL_SIZE / 2
    ctx.fillStyle = 'rgba(255, 100, 100, 0.3)'
    ctx.fillRect(pos.x * CELL_SIZE, pos.y * CELL_SIZE, CELL_SIZE, CELL_SIZE)
    ctx.fillStyle = '#ff6464'
    ctx.font = 'bold 20px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('S', x, y)
  }

  const drawGoalPoint = (ctx: CanvasRenderingContext2D, pos: Position) => {
    const x = pos.x * CELL_SIZE + CELL_SIZE / 2
    const y = pos.y * CELL_SIZE + CELL_SIZE / 2
    ctx.fillStyle = 'rgba(100, 255, 100, 0.3)'
    ctx.fillRect(pos.x * CELL_SIZE, pos.y * CELL_SIZE, CELL_SIZE, CELL_SIZE)
    ctx.fillStyle = '#64ff64'
    ctx.font = 'bold 20px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('G', x, y)
  }

  const drawHighlight = (ctx: CanvasRenderingContext2D, pos: Position) => {
    ctx.fillStyle = 'rgba(100, 200, 255, 0.3)'
    ctx.fillRect(pos.x * CELL_SIZE, pos.y * CELL_SIZE, CELL_SIZE, CELL_SIZE)
  }

  const drawTowerRange = (ctx: CanvasRenderingContext2D, tower: Tower) => {
    const x = tower.position.x * CELL_SIZE + CELL_SIZE / 2
    const y = tower.position.y * CELL_SIZE + CELL_SIZE / 2
    ctx.strokeStyle = 'rgba(255, 100, 100, 0.3)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x, y, tower.range * CELL_SIZE, 0, Math.PI * 2)
    ctx.stroke()
  }

  const drawSelectedTowerHighlight = (ctx: CanvasRenderingContext2D, tower: Tower) => {
    const x = tower.position.x * CELL_SIZE + CELL_SIZE / 2
    const y = tower.position.y * CELL_SIZE + CELL_SIZE / 2
    // Pulsing white ring
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(x, y, CELL_SIZE / 2 + 2, 0, Math.PI * 2)
    ctx.stroke()
    // Range circle
    ctx.strokeStyle = 'rgba(100, 200, 255, 0.5)'
    ctx.lineWidth = 2
    ctx.setLineDash([6, 3])
    ctx.beginPath()
    ctx.arc(x, y, tower.range * CELL_SIZE, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
  }

  const drawTower = (ctx: CanvasRenderingContext2D, tower: Tower, isSelected: boolean) => {
    const x = tower.position.x * CELL_SIZE + CELL_SIZE / 2
    const y = tower.position.y * CELL_SIZE + CELL_SIZE / 2

    ctx.fillStyle = isSelected ? '#ffffff' : (TOWER_COLORS[tower.tower_type] || '#4CAF50')
    ctx.beginPath()
    ctx.arc(x, y, CELL_SIZE / 3, 0, Math.PI * 2)
    ctx.fill()

    if (isSelected) {
      ctx.strokeStyle = TOWER_COLORS[tower.tower_type] || '#4CAF50'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(x, y, CELL_SIZE / 3, 0, Math.PI * 2)
      ctx.stroke()
    }

    const rotation = tower.rotation || 0
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rotation)
    ctx.fillStyle = '#FFF'
    ctx.fillRect(0, -4, CELL_SIZE / 2.5, 8)
    ctx.fillStyle = '#CCC'
    ctx.fillRect(CELL_SIZE / 3, -3, CELL_SIZE / 6, 6)
    ctx.restore()

    if (tower.current_target && !isSelected) {
      ctx.strokeStyle = '#ff0000'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y, CELL_SIZE / 2.5, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  const drawEnemy = (ctx: CanvasRenderingContext2D, enemy: Enemy) => {
    const x = enemy.position.x * CELL_SIZE + CELL_SIZE / 2
    const y = enemy.position.y * CELL_SIZE + CELL_SIZE / 2
    const colors: Record<string, string> = {
      basic: '#ff4444', fast: '#ff9944', tank: '#994444', flying: '#44ff99', boss: '#ff0000'
    }
    const sizes: Record<string, number> = {
      basic: CELL_SIZE / 4, fast: CELL_SIZE / 5, tank: CELL_SIZE / 2.5, flying: CELL_SIZE / 4.5, boss: CELL_SIZE / 2
    }
    const size = sizes[enemy.enemy_type] || CELL_SIZE / 4
    const isSlowed = (enemy.slow_duration ?? 0) > 0

    // Slowed enemies render in blue; normal enemies use their type color
    ctx.fillStyle = isSlowed ? '#42A5F5' : (colors[enemy.enemy_type] || '#ff4444')
    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fill()

    // Blue ring on slowed enemies so it's readable at a glance
    if (isSlowed) {
      ctx.strokeStyle = '#90CAF9'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y, size + 3, 0, Math.PI * 2)
      ctx.stroke()
    }

    const barWidth = CELL_SIZE * 0.8
    const barHeight = 4
    const barX = x - barWidth / 2
    const barY = y - size - 8
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(barX, barY, barWidth, barHeight)
    ctx.fillStyle = '#00ff00'
    ctx.fillRect(barX, barY, barWidth * (enemy.health / enemy.max_health), barHeight)
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1
    ctx.strokeRect(barX, barY, barWidth, barHeight)
  }

  const drawProjectile = (ctx: CanvasRenderingContext2D, projectile: any) => {
    const x = projectile.position.x * CELL_SIZE + CELL_SIZE / 2
    const y = projectile.position.y * CELL_SIZE + CELL_SIZE / 2
    const isAOE = !!projectile.is_aoe
    const color = isAOE ? '#FF9800' : '#ffff00'

    ctx.fillStyle = color
    ctx.shadowBlur = 15
    ctx.shadowColor = color
    ctx.beginPath()
    ctx.arc(x, y, isAOE ? 6 : 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.strokeStyle = isAOE ? 'rgba(255, 152, 0, 0.6)' : 'rgba(255, 255, 0, 0.6)'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x - 10, y)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  const drawMuzzleFlash = (ctx: CanvasRenderingContext2D, flash: any) => {
    const x = flash.position.x * CELL_SIZE + CELL_SIZE / 2
    const y = flash.position.y * CELL_SIZE + CELL_SIZE / 2
    const intensity = Math.min(flash.duration / 0.1, 1)
    ctx.fillStyle = `rgba(255, 255, 150, ${intensity})`
    ctx.shadowBlur = 25
    ctx.shadowColor = '#ffff00'
    ctx.beginPath()
    ctx.arc(x, y, 12 * intensity, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
  }

  const drawExplosion = (ctx: CanvasRenderingContext2D, explosion: any) => {
    const x = explosion.position.x * CELL_SIZE + CELL_SIZE / 2
    const y = explosion.position.y * CELL_SIZE + CELL_SIZE / 2
    const progress = 1 - (explosion.duration / 0.3)
    const radius = explosion.radius * CELL_SIZE * (0.5 + progress * 0.5)
    ctx.strokeStyle = `rgba(255, 100, 0, ${1 - progress})`
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = `rgba(255, 200, 0, ${(1 - progress) * 0.7})`
    ctx.beginPath()
    ctx.arc(x, y, radius * 0.6, 0, Math.PI * 2)
    ctx.fill()
  }

  const drawTowerPreview = (ctx: CanvasRenderingContext2D, pos: Position, towerType: TowerType, currentGold: number) => {
    const x = pos.x * CELL_SIZE + CELL_SIZE / 2
    const y = pos.y * CELL_SIZE + CELL_SIZE / 2
    const canAfford = currentGold >= TOWER_COSTS[towerType]

    ctx.globalAlpha = 0.5
    ctx.fillStyle = canAfford ? TOWER_COLORS[towerType] : '#666'
    ctx.beginPath()
    ctx.arc(x, y, CELL_SIZE / 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1.0

    ctx.strokeStyle = canAfford ? 'rgba(100, 200, 255, 0.4)' : 'rgba(200,50,50,0.3)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x, y, TOWER_RANGES[towerType] * CELL_SIZE, 0, Math.PI * 2)
    ctx.stroke()
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = Math.floor((e.clientX - rect.left) / CELL_SIZE)
    const y = Math.floor((e.clientY - rect.top) / CELL_SIZE)
    if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
      setHoveredCell({ x, y })
    } else {
      setHoveredCell(null)
    }
  }

  const handleMouseLeave = () => setHoveredCell(null)

  const handleClick = () => {
    if (isGameOver) return
    const hovered = hoveredCellRef.current
    const gs = gameStateRef.current
    const selType = selectedTowerTypeRef.current
    const currentTowers = gs?.towers || []
    const currentGold = gs?.gold ?? 0

    if (!hovered) return

    // Check if clicking an existing tower
    const clickedTower = currentTowers.find(
      t => t.position.x === hovered.x && t.position.y === hovered.y
    )

    if (clickedTower) {
      // Select or deselect tower
      setSelectedTower(prev => prev?.id === clickedTower.id ? null : clickedTower)
      return
    }

    // Clicking empty cell — deselect if something selected, otherwise place tower
    if (selectedTowerRef.current) {
      setSelectedTower(null)
      return
    }

    if (isConnected && selType !== null && currentGold >= TOWER_COSTS[selType]) {
      onPlaceTower(hovered.x, hovered.y, selType)
    }
  }

  const handleSellSelected = () => {
    if (selectedTower) {
      onSellTower(selectedTower.id)
      setSelectedTower(null)
    }
  }

  const handleStartWave = () => {
    if (countdownRef.current) clearInterval(countdownRef.current)
    setCountdown(null)
    onStartWave()
  }

  // Wave status line
  const waveStatusLabel = () => {
    if (isGameOver) return null
    if (isWaveActive) {
      const alive = gameState?.enemies.length ?? 0
      const remaining = gameState?.enemies_remaining ?? 0
      return <span style={{ color: '#ff9800' }}>⚔️ Wave {gameState?.wave} in progress — {alive + remaining} enemies left</span>
    }
    if (countdown !== null) {
      return <span style={{ color: '#2196F3' }}>⏱ Next wave in {countdown}s... <button onClick={handleStartWave} style={{ marginLeft: 8, padding: '2px 10px', fontSize: 12, cursor: 'pointer', background: '#4CAF50', border: 'none', borderRadius: 4, color: 'white' }}>Send Now</button></span>
    }
    return <span style={{ color: '#4CAF50' }}>✅ Wave {gameState?.wave} — ready to start</span>
  }

  const towerButtons: { type: TowerType, icon: string, label: string }[] = [
    { type: 'basic', icon: '🗼', label: 'Basic' },
    { type: 'sniper', icon: '🎯', label: 'Sniper' },
    { type: 'splash', icon: '💥', label: 'Splash' },
    { type: 'slow', icon: '❄️', label: 'Slow' },
  ]

  const sellPrice = selectedTower ? Math.floor(TOWER_COSTS[selectedTower.tower_type as TowerType] * 0.7) : 0

  return (
    <div className="game-canvas-container">
      {/* Game Over Overlay */}
      {isGameOver && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          zIndex: 10, borderRadius: '8px',
        }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>💀</div>
          <h2 style={{ color: '#ff4444', fontSize: '36px', margin: '0 0 8px 0' }}>Game Over</h2>
          <p style={{ color: '#ccc', fontSize: '18px', margin: '0 0 24px 0' }}>
            You survived {(gameState?.wave ?? 1) - 1} wave{(gameState?.wave ?? 1) - 1 !== 1 ? 's' : ''}
          </p>
          <button onClick={onNewGame} style={{
            padding: '14px 32px', fontSize: '18px', fontWeight: 'bold',
            background: '#4CAF50', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer',
          }}>
            🔄 Play Again
          </button>
        </div>
      )}

      <div className="game-info">
        <div className="info-item">💰 Gold: <strong>${gold}</strong></div>
        <div className="info-item">❤️ Health: <strong style={{ color: (gameState?.health ?? 100) <= 30 ? '#ff4444' : undefined }}>{gameState?.health ?? 100}</strong></div>
        <div className="info-item">🌊 Wave: <strong>{gameState?.wave ?? 1}</strong></div>
        <div className="info-item">🔌 Server: <strong className={isConnected ? 'connected' : 'disconnected'}>{isConnected ? 'Connected' : 'Disconnected'}</strong></div>
      </div>

      <div style={{ textAlign: 'center', margin: '6px 0', fontSize: '14px', minHeight: '24px' }}>
        {waveStatusLabel()}
      </div>

      <div className="tower-selection">
        {towerButtons.map(({ type, icon, label }) => {
          const cost = TOWER_COSTS[type]
          const canAfford = gold >= cost
          return (
            <button
              key={type}
              className={`tower-btn ${selectedTowerType === type ? 'selected' : ''} ${!canAfford ? 'cannot-afford' : ''}`}
              onClick={() => { setSelectedTowerType(type); setSelectedTower(null) }}
              disabled={isGameOver}
              title={canAfford ? `Select ${label} tower` : `Not enough gold (need ${cost})`}
            >
              {icon} {label} Tower
              <span className="cost" style={{ color: canAfford ? '#ffd700' : '#ff6666' }}>${cost}</span>
            </button>
          )
        })}
        <button
          className={`tower-btn ${selectedTowerType === null ? 'selected' : ''}`}
          onClick={() => { setSelectedTowerType(null); setSelectedTower(null) }}
          disabled={isGameOver}
          title="Deselect tower — cursor mode"
          style={{ minWidth: '60px', opacity: 0.7 }}
        >
          🚫 None
        </button>
      </div>

      {/* Selected tower info panel */}
      {selectedTower && (
        <div style={{
          margin: '6px auto',
          padding: '10px 16px',
          background: 'rgba(255,255,255,0.08)',
          border: `2px solid ${TOWER_COLORS[selectedTower.tower_type] || '#4CAF50'}`,
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
          justifyContent: 'center',
          fontSize: '13px',
          maxWidth: '600px',
        }}>
          <div style={{ color: TOWER_COLORS[selectedTower.tower_type], fontWeight: 'bold', fontSize: '15px' }}>
            {TOWER_LABELS[selectedTower.tower_type]} Tower #{selectedTower.id}
          </div>
          <div>🎯 Range: <strong>{selectedTower.range}</strong></div>
          <div>⚔️ Damage: <strong>{selectedTower.damage}</strong></div>
          <div>⚡ Fire Rate: <strong>{selectedTower.fire_rate}/s</strong></div>
          <button
            onClick={handleSellSelected}
            style={{
              padding: '6px 16px',
              background: '#e53935',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '13px',
            }}
          >
            💰 Sell for ${sellPrice}
          </button>
          <button
            onClick={() => setSelectedTower(null)}
            style={{
              padding: '6px 10px',
              background: '#555',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          width={GRID_WIDTH * CELL_SIZE}
          height={GRID_HEIGHT * CELL_SIZE}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          style={{ cursor: isGameOver ? 'default' : 'crosshair', display: 'block' }}
        />
      </div>

      <div className="controls">
        <button
          className="btn btn-primary"
          onClick={handleStartWave}
          disabled={!isConnected || isWaveActive || isGameOver || countdown !== null}
          title={isWaveActive ? 'Wave already in progress' : 'Start the next wave'}
        >
          {isWaveActive ? '⚔️ Wave Active...' : '▶️ Start Wave'}
        </button>
        <button
          className="btn"
          onClick={() => {
            setAutoWave(prev => {
              if (prev) {
                // Turning off — cancel any active countdown
                if (countdownRef.current) clearInterval(countdownRef.current)
                setCountdown(null)
              }
              return !prev
            })
          }}
          disabled={isGameOver}
          style={{
            background: autoWave ? '#1565C0' : '#555',
            color: 'white',
            border: autoWave ? '2px solid #42A5F5' : '2px solid transparent',
          }}
          title="Automatically start next wave after 5 seconds"
        >
          {autoWave ? '⏱ Auto: ON' : '⏱ Auto: OFF'}
        </button>
        <button
          className="btn btn-success"
          onClick={onNewGame}
          disabled={!isConnected}
        >
          🔄 New Game
        </button>
        <button
          className="btn btn-danger"
          onClick={onClearTowers}
          disabled={!isConnected || isWaveActive}
          title={isWaveActive ? 'Cannot clear during a wave' : 'Clear all towers and enemies'}
        >
          Clear All
        </button>
        {showDebug && (
          <button className="btn" style={{ background: '#555' }} onClick={onSpawnEnemy} disabled={!isConnected}>
            🦀 Spawn Test
          </button>
        )}
      </div>

      <div className="info-box">
        <p>
          <strong>Towers:</strong> {gameState?.towers.length ?? 0} |
          <strong> Enemies:</strong> {gameState?.enemies.length ?? 0} |
          <strong> Projectiles:</strong> {gameState?.projectiles.length ?? 0}
        </p>
        <p className="hint">
          {selectedTower
            ? '👆 Click elsewhere to deselect tower'
            : selectedTowerType === null
            ? '🖱️ Cursor mode — click a tower to select it'
            : '💡 Click a tower to select and sell it, or click the grid to place'}
        </p>
      </div>
    </div>
  )
}

export default GameCanvas
