import { useEffect, useRef, useState, useCallback } from 'react'

export type MessageType =
  | 'join_room'
  | 'leave_room'
  | 'game_state'
  | 'place_tower'
  | 'remove_tower'
  | 'upgrade_tower'
  | 'set_speed'
  | 'start_wave'
  | 'pause_game'
  | 'spawn_enemy'
  | 'new_game'
  | 'clear_all'

export interface WebSocketMessage {
  type: MessageType
  room_id?: string
  payload?: any
}

export interface ConnectionStatus {
  isConnected: boolean
  error: string | null
}

export const useWebSocket = (url: string) => {
  const [status, setStatus] = useState<ConnectionStatus>({
    isConnected: false,
    error: null,
  })
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null)
  
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptsRef = useRef(0)
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
          console.log('Received message:', message)
          setLastMessage(message)
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

        // Attempt to reconnect
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
            error: 'Failed to connect after multiple attempts' 
          })
        }
      }

      wsRef.current = ws
    } catch (error) {
      console.error('Failed to create WebSocket:', error)
      setStatus({ isConnected: false, error: 'Failed to create connection' })
    }
  }, [url])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
    
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
  }, [])

  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
      console.log('Sent message:', message)
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
    lastMessage,
    sendMessage,
    reconnect: connect,
    disconnect,
  }
}