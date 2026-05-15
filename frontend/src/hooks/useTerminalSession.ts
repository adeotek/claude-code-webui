import { useEffect, useRef, useCallback } from 'react'
import { useSession } from '../context/SessionContext'

const MAX_RECONNECT_ATTEMPTS = 5
const BASE_DELAY_MS = 500

export function useTerminalSession(onOutput: (data: string) => void, onConnect?: () => void, onHistory?: (data: string) => void) {
  const { state, dispatch } = useSession()
  const wsRef = useRef<WebSocket | null>(null)
  const attemptsRef = useRef(0)

  useEffect(() => {
    if (!state.sessionId || state.mode !== 'terminal') return
    let closed = false

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const host = window.location.host
      const ws = new WebSocket(`${protocol}://${host}/ws/terminal/${state.sessionId}`)
      wsRef.current = ws
      dispatch({ type: 'WS_STATE', timestamp: Date.now(), state: 'connecting' })

      ws.onopen = () => {
        attemptsRef.current = 0
        onConnect?.()
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string
            data?: string
            state?: string
            contextPct?: number
            contextWindow?: number
            gitBranch?: string | null
            contextInputTokens?: number
            contextOutputTokens?: number
            statuslineData?: {
              contextPct?: number | null
              contextWindowSize?: number | null
              contextInputTokens?: number | null
              contextOutputTokens?: number | null
              costUsd?: number | null
              apiDurationMs?: number | null
              model?: string | null
              effortLevel?: string | null
              thinkingEnabled?: boolean | null
              linesAdded?: number | null
              linesRemoved?: number | null
            }
          }
          if (msg.type === 'output' && msg.data) {
            onOutput(msg.data)
          } else if (msg.type === 'history' && msg.data) {
            onHistory?.(msg.data)
          } else if (msg.type === 'status') {
            if (msg.state === 'connected') {
              dispatch({ type: 'WS_STATE', timestamp: Date.now(), state: 'idle' })
            } else if (msg.state === 'disconnected' || msg.state === 'error') {
              dispatch({ type: 'WS_STATE', timestamp: Date.now(), state: 'disconnected' })
            }
          } else if (msg.type === 'context' && msg.contextPct != null && msg.contextWindow != null) {
            dispatch({ type: 'CONTEXT_UPDATED', contextPct: msg.contextPct, contextWindow: msg.contextWindow })
          } else if (msg.type === 'git_branch') {
            dispatch({ type: 'GIT_BRANCH_SET', gitBranch: msg.gitBranch ?? null })
          } else if (msg.type === 'session_state') {
            const tokens = (msg.contextInputTokens ?? 0) + (msg.contextOutputTokens ?? 0)
            if (tokens > 0) {
              dispatch({ type: 'STATS_RESTORED', totalTokens: 0, workingTimeMs: 0, statuslineTokens: tokens })
            }
          } else if (msg.type === 'statusline' && msg.statuslineData) {
            const d = msg.statuslineData
            dispatch({
              type: 'STATUSLINE_UPDATE',
              contextPct: d.contextPct ?? 0,
              contextWindow: d.contextWindowSize ?? 200_000,
              contextInputTokens: d.contextInputTokens ?? 0,
              contextOutputTokens: d.contextOutputTokens ?? 0,
              costUsd: d.costUsd ?? 0,
              apiDurationMs: d.apiDurationMs ?? null,
              model: d.model ?? null,
              effortLevel: d.effortLevel ?? null,
              thinkingEnabled: d.thinkingEnabled ?? null,
              linesAdded: d.linesAdded ?? null,
              linesRemoved: d.linesRemoved ?? null,
            })
          }
        } catch {
          // ignore malformed frames
        }
      }

      ws.onerror = () => dispatch({ type: 'WS_STATE', timestamp: Date.now(), state: 'error' })

      ws.onclose = () => {
        if (closed) return
        if (attemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = BASE_DELAY_MS * 2 ** attemptsRef.current
          attemptsRef.current++
          setTimeout(() => { if (!closed) connect() }, delay)
        } else {
          dispatch({ type: 'WS_STATE', timestamp: Date.now(), state: 'disconnected' })
          setTimeout(() => {
            if (!closed) { attemptsRef.current = 0; connect() }
          }, 30_000)
        }
      }
    }

    connect()
    return () => {
      closed = true
      attemptsRef.current = 0
      const ws = wsRef.current
      wsRef.current = null
      if (ws) {
        ws.onmessage = null
        ws.onerror = null
        ws.onclose = null
        ws.close()
      }
    }
  }, [state.sessionId, state.mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback((payload: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload))
    }
  }, [])

  return { send }
}
