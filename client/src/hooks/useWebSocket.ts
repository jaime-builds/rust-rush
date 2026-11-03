import { useEffect, useRef, useState, useCallback } from 'react'

export type MessageType =
  | 'join_room' // join a private room; payload.resume = the code from the last join
  | 'leave_room' // recognized by the server; not currently sent by the UI
  | 'game_state'
  | 'place_tower'
  | 'remove_tower'
  | 'upgrade_tower'
  | 'evolve_tower'
  | 'set_speed'
  | 'start_wave'
  | 'pause_game' // freezes the room's simulation; payload.paused
  | 'spawn_enemy' // debug only: ignored unless the server runs with DEBUG_SPAWN=1
  | 'new_game'
  | 'continue_endless' // victory screen: keep the run going past the win wave
  | 'check_placement' // hover preview: would a tower here seal the lane?
  | 'load_save' // continue the signed-in player's saved run (fresh board only)
  | 'achievement' // server to client: an achievement just unlocked

export interface WebSocketMessage {
  type: MessageType
  room_id?: string
  payload?: Record<string, unknown> & { state?: import('../types/game').GameState }
}

export interface ConnectionStatus {
  isConnected: boolean
  // Set while the connection is down; the UI shows it. Cleared on connect.
  error: string | null
  // True once several reconnect attempts have failed in a row; the UI then
  // offers a manual Reconnect (retries continue in the background anyway).
  struggling: boolean
  // Increments on every successful connect, so the app can rejoin its room
  // on each new socket (the server forgets a connection the moment it drops).
  connectionId: number
}

export type MessageListener = (message: WebSocketMessage) => void

// Backoff: 1 s, 2 s, 4 s, 8 s, then every 10 s for as long as it takes. The
// old hook stopped after 5 attempts (about 34 s), which left tabs dead after
// any rebuild that took longer.
const MAX_BACKOFF_MS = 10000
const STRUGGLING_AFTER = 4

// Messages are delivered to subscribers via a stable callback instead of
// React state: the server streams 60 snapshots/sec, and routing each one
// through setState forced two full App re-renders per message. Subscribers
// decide what (and how often) to commit to React.
export const useWebSocket = (url: string) => {
  const [status, setStatus] = useState<ConnectionStatus>({
    isConnected: false,
    error: null,
    struggling: false,
    connectionId: 0,
  })

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const listenersRef = useRef<Set<MessageListener>>(new Set())

  const connect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      setStatus(s => ({ ...s, isConnected: false, error: 'Could not open a connection' }))
      return
    }

    ws.onopen = () => {
      reconnectAttemptsRef.current = 0
      setStatus(s => ({ isConnected: true, error: null, struggling: false, connectionId: s.connectionId + 1 }))
    }

    ws.onmessage = (event) => {
      let message: WebSocketMessage
      try {
        message = JSON.parse(event.data)
      } catch (error) {
        console.error('Failed to parse message:', error)
        return
      }
      // Deliberately no per-message console.log here: at 60 msgs/sec the
      // console retains every snapshot object and dominates client CPU.
      // Each listener runs on its own, so one throwing can't starve the rest.
      listenersRef.current.forEach(listener => {
        try {
          listener(message)
        } catch (error) {
          console.error('Message listener failed:', error)
        }
      })
    }

    // onerror always precedes onclose; onclose does the bookkeeping.
    ws.onerror = () => {}

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null
      reconnectAttemptsRef.current++
      const attempt = reconnectAttemptsRef.current
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), MAX_BACKOFF_MS)
      setStatus(s => ({
        ...s,
        isConnected: false,
        error: 'Connection lost. Reconnecting…',
        struggling: attempt >= STRUGGLING_AFTER,
      }))
      reconnectTimeoutRef.current = setTimeout(connect, delay)
    }

    wsRef.current = ws
  }, [url])

  // Intentional close (unmount, StrictMode remount): detach the handlers
  // BEFORE closing so the async onclose can never schedule a reconnect — the
  // old behavior leaked a second live socket per dev session.
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    const ws = wsRef.current
    if (ws) {
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      ws.close()
      wsRef.current = null
    }
  }, [])

  // restart drops the current socket and opens a fresh one right away. The
  // server reads the account from the session cookie at the handshake, so
  // signing in or out restarts the connection to change who we are.
  const restart = useCallback(() => {
    disconnect()
    reconnectAttemptsRef.current = 0
    setStatus(s => ({ ...s, isConnected: false }))
    connect()
  }, [connect, disconnect])

  // reconnectNow skips the backoff wait (the Reconnect button).
  const reconnectNow = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return
    reconnectAttemptsRef.current = 0
    connect()
  }, [connect])

  // subscribe registers a message listener; returns the unsubscribe function.
  const subscribe = useCallback((listener: MessageListener) => {
    listenersRef.current.add(listener)
    return () => {
      listenersRef.current.delete(listener)
    }
  }, [])

  // sendMessage returns false when the socket isn't open; the header's
  // offline notice already tells the player why nothing happened.
  const sendMessage = useCallback((message: WebSocketMessage): boolean => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify(message))
    return true
  }, [])

  useEffect(() => {
    connect()

    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  return {
    status,
    subscribe,
    sendMessage,
    reconnectNow,
    restart,
  }
}
