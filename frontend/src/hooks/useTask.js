import { useState, useEffect, useRef, useCallback } from 'react'
import { connectToTask, fetchTask } from '../utils/api'

/**
 * Hook that manages a single task's live state.
 * Connects via WebSocket, accumulates log messages,
 * and updates task state in real-time.
 */
export function useTask(taskId) {
  const [task, setTask]     = useState(null)
  const [logs, setLogs]     = useState([])
  const [connected, setConnected] = useState(false)
  const wsRef = useRef(null)

  const addLog = useCallback((message, level = 'info') => {
    setLogs(prev => [
      ...prev,
      { id: Date.now() + Math.random(), message, level, ts: new Date().toISOString() }
    ])
  }, [])

  useEffect(() => {
    if (!taskId) return

    // Initial state fetch
    fetchTask(taskId).then(setTask).catch(() => {})

    // WebSocket connection
    const ws = connectToTask(
      taskId,
      (msg) => {
        if (msg.type === 'state' || msg.type === 'update') {
          setTask(msg.data)
        }
        if (msg.type === 'log') {
          addLog(msg.data.message, msg.data.level)
        }
        if (msg.type === 'update' && msg.data.steps) {
          // Sync step-level status messages into logs
        }
      },
      () => setConnected(false)
    )

    wsRef.current = ws
    setConnected(true)

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [taskId, addLog])

  return { task, logs, connected }
}
