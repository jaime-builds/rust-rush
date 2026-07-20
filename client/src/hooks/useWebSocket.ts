import { useEffect, useRef, useState, useCallback } from 'react'

export type MessageType =
  | 'join_room'
  | 'leave_room' // recognized by the server; not currently sent by the UI
  | 'game_state'
  | 'place_tower'
  | 'remove_tower'
  | 'upgrade_tower'
  | 'evolve_tower'
  | 'set_speed'
  | 'start_wave'
  | 'pause_game' // server-side stub, not implemented
  | 'spawn_enemy'
  | 'new_game'
  | 'continue_endless' // victory screen: keep the run going past the win wave

export interface WebSocketMessage {
  type: MessageType
  room_id?: string
  payload?: Record<string, unknown> & { state?: import('../types/game').GameState }
}

export interface ConnectionStatus {
  isConnected: boolean
  error: string | null
}

export type MessageListener = (message: WebSocketMessage) => void

// Messages are delivered to subscribers via a stable callback instead of
// React state: the server streams 60 snapshots/sec, and routing each one
// through setState forced two full App re-renders per message. Subscribers
// decide what (and how often) to commit to React.
export const useWebSocket = (url: string) => {
  const [status, setStatus] = useState<ConnectionStatus>({
    isConnected: false,
    error: null,
  })

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const listenersRef = useRef<Set<MessageListener>>(new Set())
  const maxReconnectAttempts = 5

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url)

      ws.onopen = () => {
        console.log('WebSocket connected')
        setStatus({ isConnected: true, error: null })
        reconnectAttemptsRef.current = 0
      }

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data)
          // Deliberately no per-message console.log here: at 60 msgs/sec the
          // console retains every snapshot object and dominates client CPU.
          listenersRef.current.forEach(listener => listener(message))
        } catch (error) {
          console.error('Failed to parse message:', error)
        }
      }

      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        setStatus({ isConnected: false, error: 'Connection error' })
      }

      ws.onclose = () => {
        console.log('WebSocket disconnected')
        setStatus({ isConnected: false, error: null })

        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000)

          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`)

          reconnectTimeoutRef.current = setTimeout(() => {
            connect()
          }, delay)
        } else {
          setStatus({
            isConnected: false,
            error: 'Failed to connect after multiple attempts',
          })
        }
      }

      wsRef.current = ws
    } catch (error) {
      console.error('Failed to create WebSocket:', error)
      setStatus({ isConnected: false, error: 'Failed to create connection' })
    }
  }, [url])

  // Intentional close (unmount, StrictMode remount): detach the handlers
  // BEFORE closing so the async onclose can never schedule a reconnect — the
  // old behavior leaked a second live socket per dev session.
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
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

  // subscribe registers a message listener; returns the unsubscribe function.
  const subscribe = useCallback((listener: MessageListener) => {
    listenersRef.current.add(listener)
    return () => {
      listenersRef.current.delete(listener)
    }
  }, [])

  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    } else {
      console.error('WebSocket is not connected')
    }
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
  }
}
