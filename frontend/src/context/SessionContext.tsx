import { createContext, useContext, useReducer, type ReactNode } from 'react'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

export interface PermissionRequest {
  tool: string
  summary: string
}

export interface SessionState {
  sessionId: string | null
  workdir: string | null
  name: string | null
  model: string | null
  mode: 'chat' | 'terminal'
  wsState: 'disconnected' | 'connecting' | 'running' | 'idle' | 'error'
  messages: Message[]
  workingTimeMs: number       // cumulative ms spent in 'running' state
  runningStartedAt: number | null  // timestamp when current run period began
  totalTokens: number         // cumulative input+output tokens for this session
  contextTokens: number       // input tokens from the most recent turn (chat mode)
  contextPct: number          // context usage 0-100; set from API tokens (chat) or PTY parse (terminal)
  contextWindow: number       // context window size in tokens (default 200 000)
  costUsd: number
  effortLevel: string | null
  pendingPermissions: PermissionRequest[] | null
}

type Action =
  | { type: 'SESSION_CREATED'; sessionId: string; workdir: string; name?: string; mode: 'chat' | 'terminal' }
  | { type: 'SESSION_CLEARED' }
  | { type: 'RESUME_SESSION'; id: string; workdir: string; name?: string; mode: 'chat' | 'terminal' }
  | { type: 'WS_STATE'; state: SessionState['wsState']; timestamp: number }
  | { type: 'MESSAGE_ADDED'; message: Message }
  | { type: 'HISTORY_LOADED'; messages: Message[] }
  | { type: 'MODEL_SET'; model: string }
  | { type: 'SESSION_RENAMED'; name: string | null }
  | { type: 'TOKENS_ADDED'; inputTokens: number; outputTokens: number; contextTokens?: number }
  | { type: 'CONTEXT_UPDATED'; contextPct: number; contextWindow: number }
  | { type: 'STATS_RESTORED'; totalTokens: number; workingTimeMs: number }
  | { type: 'STATUSLINE_UPDATE'; contextPct: number; contextWindow: number; contextInputTokens: number; costUsd: number; model: string | null; effortLevel: string | null }
  | { type: 'PERMISSION_REQUEST'; permissions: PermissionRequest[] }
  | { type: 'PERMISSION_CLEARED' }

export const initial: SessionState = {
  sessionId: null,
  workdir: null,
  name: null,
  model: null,
  mode: 'chat',
  wsState: 'disconnected',
  messages: [],
  workingTimeMs: 0,
  runningStartedAt: null,
  totalTokens: 0,
  contextTokens: 0,
  contextPct: 0,
  contextWindow: 200_000,
  costUsd: 0,
  effortLevel: null,
  pendingPermissions: null,
}

export function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case 'SESSION_CREATED':
      return { ...state, sessionId: action.sessionId, workdir: action.workdir, name: action.name ?? null, mode: action.mode, messages: [], wsState: 'connecting', workingTimeMs: 0, runningStartedAt: null, totalTokens: 0, contextTokens: 0, contextPct: 0, contextWindow: 200_000, costUsd: 0, effortLevel: null, pendingPermissions: null }
    case 'SESSION_CLEARED':
      return { ...initial }
    case 'RESUME_SESSION':
      return { ...state, sessionId: action.id, workdir: action.workdir, name: action.name ?? null, mode: action.mode, messages: [], wsState: 'connecting', workingTimeMs: 0, runningStartedAt: null, totalTokens: 0, contextTokens: 0, contextPct: 0, contextWindow: 200_000, costUsd: 0, effortLevel: null, pendingPermissions: null }
    case 'WS_STATE': {
      const prev = state.wsState
      const next = action.state
      let { workingTimeMs, runningStartedAt } = state
      if (next === 'running' && prev !== 'running') {
        runningStartedAt = action.timestamp
      } else if (prev === 'running' && next !== 'running' && runningStartedAt != null) {
        workingTimeMs += action.timestamp - runningStartedAt
        runningStartedAt = null
      }
      return { ...state, wsState: next, workingTimeMs, runningStartedAt }
    }
    case 'MESSAGE_ADDED':
      return { ...state, messages: [...state.messages, action.message] }
    case 'HISTORY_LOADED':
      return { ...state, messages: [...action.messages, ...state.messages] }
    case 'MODEL_SET':
      return { ...state, model: action.model }
    case 'SESSION_RENAMED':
      return { ...state, name: action.name }
    case 'TOKENS_ADDED': {
      const contextTokens = action.contextTokens ?? state.contextTokens
      const contextPct = contextTokens > 0 && state.contextWindow > 0
        ? Math.round(contextTokens / state.contextWindow * 100)
        : state.contextPct
      return { ...state, totalTokens: state.totalTokens + action.inputTokens + action.outputTokens, contextTokens, contextPct }
    }
    case 'CONTEXT_UPDATED':
      return {
        ...state,
        contextPct: action.contextPct,
        contextWindow: action.contextWindow,
        contextTokens: Math.round(action.contextPct / 100 * action.contextWindow),
      }
    case 'STATS_RESTORED':
      return { ...state, totalTokens: action.totalTokens, workingTimeMs: action.workingTimeMs }
    case 'STATUSLINE_UPDATE':
      return {
        ...state,
        contextPct: action.contextPct,
        contextWindow: action.contextWindow,
        contextTokens: Math.round(action.contextPct / 100 * action.contextWindow),
        costUsd: action.costUsd,
        effortLevel: action.effortLevel,
        ...(action.model != null ? { model: action.model } : {}),
      }
    case 'PERMISSION_REQUEST':
      return { ...state, pendingPermissions: action.permissions }
    case 'PERMISSION_CLEARED':
      return { ...state, pendingPermissions: null }
    default:
      return state
  }
}

const SessionContext = createContext<{
  state: SessionState
  dispatch: React.Dispatch<Action>
} | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial)
  return <SessionContext.Provider value={{ state, dispatch }}>{children}</SessionContext.Provider>
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}
