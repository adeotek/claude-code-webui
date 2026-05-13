# Terminal Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global `session_mode` setting (`chat` | `terminal`) that switches the session content area between the existing chat layout and a full interactive PTY terminal backed by a new `/ws/terminal/:id` WebSocket endpoint.

**Architecture:** A separate `ws/terminal.ts` module handles interactive PTY sessions (no JSON parsing, raw I/O passthrough) alongside the untouched `ws/session.ts`. Sessions carry their mode in the DB; `SessionContext` holds `mode` for the active session, and `DashboardView` renders either `TerminalSession` (new) or the existing chat layout based on it.

**Tech Stack:** node-pty, better-sqlite3, Fastify WebSocket, xterm.js + FitAddon, React + TypeScript, Tailwind CSS

---

## File Map

**Create:**
- `backend/src/ws/terminal.ts` — TerminalManager singleton + `/ws/terminal/:id` WS handler
- `frontend/src/hooks/useTerminalSession.ts` — WS hook for `/ws/terminal/:id`
- `frontend/src/components/TerminalSession.tsx` — full-height xterm.js terminal component

**Modify:**
- `backend/src/db/schema.ts` — add `mode` column migration guard to sessions table
- `backend/src/routes/settings.ts` — add `session_mode` to DEFAULTS/ALLOWED
- `backend/src/routes/sessions.ts` — POST stores mode; stop+delete kill terminal PTY
- `backend/src/server.ts` — register `terminalWsRoutes`
- `frontend/src/context/SessionContext.tsx` — add `mode` to SessionState + actions
- `frontend/src/hooks/useDashboard.ts` — add `mode` to Session type; fetch settings; return `defaultSessionMode`
- `frontend/src/hooks/useWebSocket.ts` — skip connecting when `state.mode === 'terminal'`
- `frontend/src/views/DashboardView.tsx` — dispatch mode on create/resume; swap content area
- `frontend/src/views/SettingsView.tsx` — add Session Mode toggle

---

## Task 1: DB migration + settings key

**Files:**
- Modify: `backend/src/db/schema.ts`
- Modify: `backend/src/routes/settings.ts`

- [ ] **Step 1: Add `mode` column migration guard to `schema.ts`**

  In `backend/src/db/schema.ts`, add this block after the existing `working_time_ms` migration guard (after line 69):

  ```typescript
  if (!sessionCols.find((c) => c.name === 'mode')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'chat'").run()
  }
  ```

- [ ] **Step 2: Add `session_mode` to settings DEFAULTS**

  In `backend/src/routes/settings.ts`, replace lines 4-6:

  ```typescript
  const DEFAULTS: Record<string, string> = {
    bypass_permissions: 'true',
    session_mode: 'chat',
  }
  ```

- [ ] **Step 3: Lint backend**

  ```bash
  cd backend && npm run lint
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add backend/src/db/schema.ts backend/src/routes/settings.ts
  git commit -m "feat: add session mode DB column and settings key"
  ```

---

## Task 2: Terminal WebSocket handler

**Files:**
- Create: `backend/src/ws/terminal.ts`

- [ ] **Step 1: Create `backend/src/ws/terminal.ts`**

  ```typescript
  import * as pty from 'node-pty'
  import * as os from 'os'
  import * as path from 'path'
  import type { WebSocket } from 'ws'
  import type { FastifyInstance } from 'fastify'
  import { db } from '../db/schema'

  const IDLE_TIMEOUT_MS = 30 * 60 * 1000

  function getBypassPermissions(): boolean {
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('bypass_permissions') as { value: string } | undefined
    return row ? row.value === 'true' : true
  }

  class ActiveTerminalSession {
    private ptyProc: pty.IPty | null = null
    private sockets = new Set<WebSocket>()
    private idleTimer: NodeJS.Timeout | null = null

    constructor(
      readonly id: string,
      private readonly workdir: string,
    ) {
      this.spawnPty()
      this.resetIdle()
    }

    private spawnPty() {
      const claudeBin = process.env.CLAUDE_BIN ?? 'claude'
      const bypassPermissions = getBypassPermissions()
      const args: string[] = []
      if (bypassPermissions) args.push('--dangerously-skip-permissions')

      const resolvedCwd = this.workdir.startsWith('~')
        ? path.join(os.homedir(), this.workdir.slice(1))
        : this.workdir

      try {
        this.ptyProc = pty.spawn(claudeBin, args, {
          name: 'xterm-256color',
          cols: 220,
          rows: 50,
          cwd: resolvedCwd,
          env: { ...process.env } as Record<string, string>,
        })
      } catch (err) {
        this.broadcast({ type: 'output', data: `\r\nError starting terminal: ${(err as Error).message}\r\n` })
        this.broadcast({ type: 'status', state: 'disconnected' })
        return
      }

      this.ptyProc.onData((data) => {
        this.resetIdle()
        this.broadcast({ type: 'output', data })
      })

      this.ptyProc.onExit(() => {
        this.ptyProc = null
        db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(Date.now(), this.id)
        this.broadcast({ type: 'status', state: 'disconnected' })
        if (this.idleTimer) clearTimeout(this.idleTimer)
      })
    }

    attach(ws: WebSocket) {
      this.sockets.add(ws)
      ws.send(JSON.stringify({ type: 'status', state: 'connected' }))
      ws.on('close', () => this.sockets.delete(ws))
    }

    writeInput(data: string) {
      this.resetIdle()
      this.ptyProc?.write(data)
    }

    resize(cols: number, rows: number) {
      this.ptyProc?.resize(cols, rows)
    }

    kill() {
      db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(Date.now(), this.id)
      if (this.ptyProc) {
        this.ptyProc.kill()
        this.ptyProc = null
      }
      if (this.idleTimer) clearTimeout(this.idleTimer)
      this.broadcast({ type: 'status', state: 'disconnected' })
    }

    private broadcast(msg: { type: string; data?: string; state?: string }) {
      const payload = JSON.stringify(msg)
      for (const ws of this.sockets) {
        if (ws.readyState === ws.OPEN) ws.send(payload)
      }
    }

    private resetIdle() {
      if (this.idleTimer) clearTimeout(this.idleTimer)
      this.idleTimer = setTimeout(() => this.kill(), IDLE_TIMEOUT_MS)
    }
  }

  class TerminalManager {
    private sessions = new Map<string, ActiveTerminalSession>()

    getOrCreate(id: string, workdir: string): ActiveTerminalSession {
      if (!this.sessions.has(id)) {
        this.sessions.set(id, new ActiveTerminalSession(id, workdir))
      }
      return this.sessions.get(id)!
    }

    kill(id: string) {
      this.sessions.get(id)?.kill()
      this.sessions.delete(id)
    }
  }

  export const terminalManager = new TerminalManager()

  export async function terminalWsRoutes(fastify: FastifyInstance) {
    fastify.get<{ Params: { id: string } }>(
      '/ws/terminal/:id',
      { websocket: true },
      (socket, req) => {
        const { id } = req.params

        const row = db.prepare('SELECT workdir, ended_at FROM sessions WHERE id = ?').get(id) as
          | { workdir: string; ended_at: number | null }
          | undefined

        if (!row) {
          socket.send(JSON.stringify({ type: 'status', state: 'error', data: 'session not found' }))
          socket.close()
          return
        }

        if (row.ended_at !== null) {
          db.prepare('UPDATE sessions SET ended_at = NULL WHERE id = ?').run(id)
        }

        const session = terminalManager.getOrCreate(id, row.workdir)
        session.attach(socket)

        socket.on('message', (raw: Buffer | string) => {
          try {
            const msg = JSON.parse(raw.toString()) as {
              type: string
              data?: string
              cols?: number
              rows?: number
            }
            if (msg.type === 'input' && msg.data) {
              session.writeInput(msg.data)
            } else if (msg.type === 'resize' && msg.cols && msg.rows) {
              session.resize(msg.cols, msg.rows)
            }
          } catch {
            // ignore malformed frames
          }
        })
      },
    )
  }
  ```

- [ ] **Step 2: Lint backend**

  ```bash
  cd backend && npm run lint
  ```
  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add backend/src/ws/terminal.ts
  git commit -m "feat: add terminal WS handler and TerminalManager"
  ```

---

## Task 3: Sessions routes + server registration

**Files:**
- Modify: `backend/src/routes/sessions.ts`
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Import `terminalManager` in `sessions.ts`**

  Replace the import block at the top of `backend/src/routes/sessions.ts` (lines 1-8):

  ```typescript
  import type { FastifyInstance } from 'fastify'
  import { v4 as uuidv4 } from 'uuid'
  import fs from 'fs'
  import os from 'os'
  import path from 'path'
  import { db } from '../db/schema'
  import { sessionManager } from '../ws/session'
  import { terminalManager } from '../ws/terminal'
  ```

- [ ] **Step 2: Store mode in POST `/api/sessions`**

  Replace the POST handler body (lines 45-57):

  ```typescript
  fastify.post<{ Body: { workdir: string; name?: string } }>('/api/sessions', async (req, reply) => {
    const { workdir, name } = req.body
    if (!workdir || typeof workdir !== 'string') {
      return reply.status(400).send({ error: 'workdir is required' })
    }

    const modeRow = db
      .prepare("SELECT value FROM settings WHERE key = 'session_mode'")
      .get() as { value: string } | undefined
    const mode = modeRow?.value === 'terminal' ? 'terminal' : 'chat'

    const id = uuidv4()
    db.prepare(
      'INSERT INTO sessions (id, workdir, name, mode, started_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, workdir, name?.trim() || null, mode, Date.now())

    return reply.status(201).send({ sessionId: id })
  })
  ```

- [ ] **Step 3: Kill terminal PTY on stop**

  Replace the stop handler body (lines 59-63):

  ```typescript
  fastify.post<{ Params: { id: string } }>('/api/sessions/:id/stop', async (req, reply) => {
    const { id } = req.params
    sessionManager.kill(id)
    terminalManager.kill(id)
    db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(Date.now(), id)
    return reply.send({ ok: true })
  })
  ```

- [ ] **Step 4: Kill terminal PTY on delete**

  Replace the delete handler body (lines 94-105):

  ```typescript
  fastify.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id)
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' })
    }
    sessionManager.kill(id)
    terminalManager.kill(id)
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(id)
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
    return reply.send({ ok: true })
  })
  ```

- [ ] **Step 5: Register `terminalWsRoutes` in `server.ts`**

  In `backend/src/server.ts`, add the import at line 10 (after the existing `sessionWsRoutes` import):

  ```typescript
  import { terminalWsRoutes } from './ws/terminal'
  ```

  And register the route after the existing `sessionWsRoutes` registration (after line 36):

  ```typescript
  await fastify.register(terminalWsRoutes)
  ```

- [ ] **Step 6: Lint backend**

  ```bash
  cd backend && npm run lint
  ```
  Expected: no errors.

- [ ] **Step 7: Commit**

  ```bash
  git add backend/src/routes/sessions.ts backend/src/server.ts
  git commit -m "feat: wire terminal WS route and mode into sessions API"
  ```

---

## Task 4: SessionContext mode field

**Files:**
- Modify: `frontend/src/context/SessionContext.tsx`

- [ ] **Step 1: Add `mode` to `SessionState`**

  In `frontend/src/context/SessionContext.tsx`, replace the `SessionState` interface (lines 15-26):

  ```typescript
  export interface SessionState {
    sessionId: string | null
    workdir: string | null
    name: string | null
    model: string | null
    mode: 'chat' | 'terminal'
    wsState: 'disconnected' | 'connecting' | 'running' | 'idle' | 'error'
    messages: Message[]
    workingTimeMs: number
    runningStartedAt: number | null
    totalTokens: number
    pendingPermissions: PermissionRequest[] | null
  }
  ```

- [ ] **Step 2: Add `mode` to `SESSION_CREATED` and `RESUME_SESSION` action types**

  Replace the `Action` type definition (lines 28-41):

  ```typescript
  type Action =
    | { type: 'SESSION_CREATED'; sessionId: string; workdir: string; name?: string; mode: 'chat' | 'terminal' }
    | { type: 'SESSION_CLEARED' }
    | { type: 'RESUME_SESSION'; id: string; workdir: string; name?: string; mode: 'chat' | 'terminal' }
    | { type: 'WS_STATE'; state: SessionState['wsState']; timestamp: number }
    | { type: 'MESSAGE_ADDED'; message: Message }
    | { type: 'HISTORY_LOADED'; messages: Message[] }
    | { type: 'MODEL_SET'; model: string }
    | { type: 'SESSION_RENAMED'; name: string | null }
    | { type: 'TOKENS_ADDED'; inputTokens: number; outputTokens: number }
    | { type: 'STATS_RESTORED'; totalTokens: number; workingTimeMs: number }
    | { type: 'PERMISSION_REQUEST'; permissions: PermissionRequest[] }
    | { type: 'PERMISSION_CLEARED' }
  ```

- [ ] **Step 3: Add `mode` to the initial state**

  Replace the `initial` constant (lines 43-53):

  ```typescript
  const initial: SessionState = {
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
    pendingPermissions: null,
  }
  ```

- [ ] **Step 4: Update reducer cases for `SESSION_CREATED` and `RESUME_SESSION`**

  Replace the two reducer cases (lines 57-62):

  ```typescript
  case 'SESSION_CREATED':
    return { ...state, sessionId: action.sessionId, workdir: action.workdir, name: action.name ?? null, mode: action.mode, messages: [], wsState: 'connecting', workingTimeMs: 0, runningStartedAt: null, pendingPermissions: null }
  case 'SESSION_CLEARED':
    return { ...initial }
  case 'RESUME_SESSION':
    return { ...state, sessionId: action.id, workdir: action.workdir, name: action.name ?? null, mode: action.mode, messages: [], wsState: 'connecting', workingTimeMs: 0, runningStartedAt: null, totalTokens: 0, pendingPermissions: null }
  ```

- [ ] **Step 5: Lint frontend**

  ```bash
  cd frontend && npm run lint
  ```
  Expected: errors about callers of `SESSION_CREATED`/`RESUME_SESSION` missing `mode` — these will be fixed in Task 9. The important thing is no errors in `SessionContext.tsx` itself.

  > Note: TypeScript errors in `DashboardView.tsx` about missing `mode` property are expected at this stage. They confirm the type change propagated correctly and will be resolved in Task 9.

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/src/context/SessionContext.tsx
  git commit -m "feat: add mode field to SessionContext state and actions"
  ```

---

## Task 5: useDashboard — Session type + settings fetch

**Files:**
- Modify: `frontend/src/hooks/useDashboard.ts`

- [ ] **Step 1: Add `mode` to the `Session` interface and add settings to the fetch**

  Replace the entire `useDashboard.ts` file:

  ```typescript
  import { useState, useEffect, useCallback } from 'react'
  import type { AccountInfo } from './useAccount'
  import type { UsageData } from './useUsage'

  export interface Session {
    id: string
    workdir: string
    name: string | null
    model: string | null
    started_at: number
    ended_at: number | null
    is_active: boolean
    message_count: number
    mode: 'chat' | 'terminal'
  }

  export interface DashboardData {
    account: AccountInfo | null
    usage: UsageData | null
    sessions: Session[]
    activeSessions: number
    defaultSessionMode: 'chat' | 'terminal'
    loading: boolean
    error: string | null
  }

  export function useDashboard(month?: string): DashboardData & { refresh: () => void } {
    const [account, setAccount] = useState<AccountInfo | null>(null)
    const [usage, setUsage] = useState<UsageData | null>(null)
    const [sessions, setSessions] = useState<Session[]>([])
    const [defaultSessionMode, setDefaultSessionMode] = useState<'chat' | 'terminal'>('chat')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const target = month ?? new Date().toISOString().slice(0, 7)

    const fetchAll = useCallback(() => {
      setLoading(true)
      setError(null)

      Promise.all([
        fetch('/api/account').then((r) => r.json() as Promise<AccountInfo>),
        fetch(`/api/usage?month=${target}`).then((r) => r.json() as Promise<UsageData>),
        fetch('/api/sessions').then((r) => r.json() as Promise<Session[]>),
        fetch('/api/settings').then((r) => r.json() as Promise<Record<string, string>>),
      ])
        .then(([acc, usg, sess, settings]) => {
          setAccount(acc)
          setUsage(usg)
          setSessions(Array.isArray(sess) ? sess : [])
          setDefaultSessionMode(settings.session_mode === 'terminal' ? 'terminal' : 'chat')
          setLoading(false)
        })
        .catch((e: Error) => {
          setError(e.message)
          setLoading(false)
        })
    }, [target])

    useEffect(() => {
      fetchAll()
      const timer = setInterval(fetchAll, 60_000)
      return () => clearInterval(timer)
    }, [fetchAll])

    const activeSessions = sessions.filter((s) => s.is_active).length

    return { account, usage, sessions, activeSessions, defaultSessionMode, loading, error, refresh: fetchAll }
  }
  ```

- [ ] **Step 2: Lint frontend**

  ```bash
  cd frontend && npm run lint
  ```
  Expected: same `DashboardView.tsx` errors from Task 4 (still missing `mode` in dispatches). No new errors.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/hooks/useDashboard.ts
  git commit -m "feat: add mode to Session type and fetch settings in useDashboard"
  ```

---

## Task 6: useWebSocket mode guard

**Files:**
- Modify: `frontend/src/hooks/useWebSocket.ts`

- [ ] **Step 1: Add `state.mode` guard to prevent chat WS connecting in terminal mode**

  In `frontend/src/hooks/useWebSocket.ts`, replace lines 12-14 (the start of the useEffect):

  ```typescript
  useEffect(() => {
    if (!state.sessionId || state.mode === 'terminal') return
    let closed = false
  ```

  Also update the dependency array at line 95 to include `state.mode`:

  ```typescript
  }, [state.sessionId, state.mode]) // eslint-disable-line react-hooks/exhaustive-deps
  ```

- [ ] **Step 2: Lint frontend**

  ```bash
  cd frontend && npm run lint
  ```
  Expected: same existing `DashboardView.tsx` errors only. No new errors.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/hooks/useWebSocket.ts
  git commit -m "feat: skip chat WS connection when session mode is terminal"
  ```

---

## Task 7: useTerminalSession hook

**Files:**
- Create: `frontend/src/hooks/useTerminalSession.ts`

- [ ] **Step 1: Create `frontend/src/hooks/useTerminalSession.ts`**

  ```typescript
  import { useEffect, useRef, useCallback } from 'react'
  import { useSession } from '../context/SessionContext'

  const MAX_RECONNECT_ATTEMPTS = 5
  const BASE_DELAY_MS = 500

  export function useTerminalSession(onOutput: (data: string) => void) {
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
        }

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string) as {
              type: string
              data?: string
              state?: string
            }
            if (msg.type === 'output' && msg.data) {
              onOutput(msg.data)
            } else if (msg.type === 'status') {
              if (msg.state === 'connected') {
                dispatch({ type: 'WS_STATE', timestamp: Date.now(), state: 'idle' })
              } else if (msg.state === 'disconnected' || msg.state === 'error') {
                dispatch({ type: 'WS_STATE', timestamp: Date.now(), state: 'disconnected' })
              }
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
            setTimeout(connect, delay)
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
        wsRef.current?.close()
        wsRef.current = null
      }
    }, [state.sessionId, state.mode]) // eslint-disable-line react-hooks/exhaustive-deps

    const send = useCallback((payload: object) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(payload))
      }
    }, [])

    return { send }
  }
  ```

- [ ] **Step 2: Lint frontend**

  ```bash
  cd frontend && npm run lint
  ```
  Expected: same existing `DashboardView.tsx` errors only.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/hooks/useTerminalSession.ts
  git commit -m "feat: add useTerminalSession hook for /ws/terminal/:id"
  ```

---

## Task 8: TerminalSession component

**Files:**
- Create: `frontend/src/components/TerminalSession.tsx`

- [ ] **Step 1: Create `frontend/src/components/TerminalSession.tsx`**

  ```typescript
  import { useEffect, useRef, useCallback } from 'react'
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import '@xterm/xterm/css/xterm.css'
  import { useTerminalSession } from '../hooks/useTerminalSession'

  export default function TerminalSession() {
    const containerRef = useRef<HTMLDivElement>(null)
    const termRef = useRef<Terminal | null>(null)
    const fitRef = useRef<FitAddon | null>(null)

    const onOutput = useCallback((data: string) => {
      termRef.current?.write(data)
    }, [])

    const { send } = useTerminalSession(onOutput)

    useEffect(() => {
      const term = new Terminal({
        theme: {
          background: '#050505',
          foreground: '#e2e2e2',
          cursor: '#d97706',
          selectionBackground: '#d9770640',
        },
        fontFamily: 'JetBrains Mono, Fira Code, monospace',
        fontSize: 12,
        lineHeight: 1.4,
        cursorBlink: true,
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      termRef.current = term
      fitRef.current = fit

      if (containerRef.current) {
        term.open(containerRef.current)
        requestAnimationFrame(() => fit.fit())
        term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }))
        term.onData((data) => send({ type: 'input', data }))
      }

      return () => term.dispose()
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Re-fit terminal when container dimensions change (window resize, panel resize)
    useEffect(() => {
      if (!containerRef.current) return
      const observer = new ResizeObserver(() => {
        requestAnimationFrame(() => fitRef.current?.fit())
      })
      observer.observe(containerRef.current)
      return () => observer.disconnect()
    }, [])

    return (
      <div className="flex-1 overflow-hidden bg-[#050505]">
        <div ref={containerRef} className="h-full w-full" />
      </div>
    )
  }
  ```

- [ ] **Step 2: Lint frontend**

  ```bash
  cd frontend && npm run lint
  ```
  Expected: same existing `DashboardView.tsx` errors only. No errors in `TerminalSession.tsx`.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/components/TerminalSession.tsx
  git commit -m "feat: add full-height TerminalSession component"
  ```

---

## Task 9: DashboardView wiring

**Files:**
- Modify: `frontend/src/views/DashboardView.tsx`

- [ ] **Step 1: Import `TerminalSession` and destructure `defaultSessionMode`**

  Add the import at the top of `DashboardView.tsx` (after the existing imports, before line 17):

  ```typescript
  import TerminalSession from '../components/TerminalSession'
  ```

  Update the `useDashboard` destructure (line 23) to include `defaultSessionMode`:

  ```typescript
  const { account, usage, sessions, activeSessions, loading, refresh, defaultSessionMode } = useDashboard()
  ```

- [ ] **Step 2: Add `mode` to `handleSessionStart` dispatch**

  Replace `handleSessionStart` (lines 54-59):

  ```typescript
  function handleSessionStart(sessionId: string, workdir: string, name: string | null) {
    dispatch({ type: 'SESSION_CREATED', sessionId, workdir, ...(name ? { name } : {}), mode: defaultSessionMode })
    if (account?.model) dispatch({ type: 'MODEL_SET', model: account.model })
    setShowModal(false)
    refresh()
  }
  ```

- [ ] **Step 3: Add `mode` to `handleResume` dispatch**

  Replace `handleResume` (lines 97-100):

  ```typescript
  function handleResume(session: Session) {
    dispatch({ type: 'RESUME_SESSION', id: session.id, workdir: session.workdir, ...(session.name ? { name: session.name } : {}), mode: session.mode ?? 'chat' })
    if (account?.model) dispatch({ type: 'MODEL_SET', model: account.model })
  }
  ```

- [ ] **Step 4: Guard the PTY resize registration for chat mode only**

  Replace the resize `useEffect` (lines 47-51):

  ```typescript
  useEffect(() => {
    if (state.mode === 'terminal') return
    terminalRef.current?.sendResize((cols, rows) => {
      send({ type: 'resize', cols, rows })
    })
  }, [send, state.mode])
  ```

- [ ] **Step 5: Swap session content area based on `state.mode`**

  Replace the inner session layout (lines 162-185) — the block between `<div className="flex flex-col flex-1 overflow-hidden relative">` and its closing tag:

  ```tsx
  {state.sessionId ? (
    <div className="flex flex-col flex-1 overflow-hidden relative">
      {state.pendingPermissions && (
        <PermissionDialog
          permissions={state.pendingPermissions}
          onAllow={handlePermissionAllow}
          onDismiss={handlePermissionDismiss}
        />
      )}
      <SessionHeader
        onNewSession={handleNewSession}
        onStopSession={handleStopSession}
        onSessionsList={handleSessionsList}
        onRename={handleRenameSession}
        sessionName={state.name}
        totalTokens={state.totalTokens}
        sessionStartedAt={activeSession?.started_at ?? null}
      />
      {state.mode === 'terminal' ? (
        <TerminalSession />
      ) : (
        <>
          <MessageList messages={state.messages} />
          <TerminalDrawer ref={terminalRef} wsState={state.wsState} onInput={handleTerminalInput} />
          <ChatInput
            onSend={handleSend}
            disabled={state.wsState === 'disconnected' || state.wsState === 'error'}
          />
        </>
      )}
    </div>
  ) : showModal ? (
    <NewSessionModal onStart={handleSessionStart} />
  ) : (
    <SessionList
      sessions={displaySessions}
      onResume={handleResume}
      onStop={handleStopListSession}
      onDelete={handleDelete}
      onNewSession={() => setShowModal(true)}
    />
  )}
  ```

- [ ] **Step 6: Lint frontend — should now be clean**

  ```bash
  cd frontend && npm run lint
  ```
  Expected: **no errors**. This is the step where all previously expected TypeScript errors resolve.

- [ ] **Step 7: Commit**

  ```bash
  git add frontend/src/views/DashboardView.tsx
  git commit -m "feat: wire terminal mode into DashboardView session layout"
  ```

---

## Task 10: SettingsView session mode toggle

**Files:**
- Modify: `frontend/src/views/SettingsView.tsx`

- [ ] **Step 1: Add `sessionMode` state and load it from settings**

  In `frontend/src/views/SettingsView.tsx`, add the new state variable after the `bypassPermissions` state (line 9):

  ```typescript
  const [sessionMode, setSessionMode] = useState<'chat' | 'terminal'>('chat')
  ```

  In the `useEffect` fetch callback, add parsing for `session_mode` (after the `setBypassPermissions` line):

  ```typescript
  .then((data) => {
    setBypassPermissions(data.bypass_permissions !== 'false')
    setSessionMode(data.session_mode === 'terminal' ? 'terminal' : 'chat')
    setSettingsLoaded(true)
  })
  ```

- [ ] **Step 2: Include `session_mode` in `handleSave`**

  Replace the `await fetch('/api/settings', ...)` call in `handleSave`:

  ```typescript
  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bypass_permissions: String(bypassPermissions),
      session_mode: sessionMode,
    }),
  }).catch(() => {})
  ```

- [ ] **Step 3: Add the Session Mode toggle UI**

  Add this block in the JSX, after the "Tool Permissions" section and before the Save button:

  ```tsx
  {/* Session mode toggle */}
  <div className="space-y-2">
    <label className="text-text-secondary text-xs uppercase tracking-widest block">
      Session Mode
    </label>
    <p className="text-text-muted text-xs">
      Chat mode shows a structured conversation with a collapsible terminal drawer. Terminal mode replaces the chat view with a full interactive terminal — interact with Claude Code exactly as you would in your local terminal.
    </p>
    <button
      onClick={() => setSessionMode((m) => (m === 'chat' ? 'terminal' : 'chat'))}
      disabled={!settingsLoaded}
      className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded border transition-colors disabled:opacity-40 ${
        sessionMode === 'terminal'
          ? 'border-accent text-accent bg-accent/10'
          : 'border-border-subtle text-text-muted bg-bg-elevated'
      }`}
    >
      <span className={`w-2 h-2 rounded-full ${sessionMode === 'terminal' ? 'bg-accent' : 'bg-text-dim'}`} />
      {sessionMode === 'terminal' ? 'Session mode: terminal' : 'Session mode: chat'}
    </button>
  </div>
  ```

- [ ] **Step 4: Lint frontend**

  ```bash
  cd frontend && npm run lint
  ```
  Expected: no errors.

- [ ] **Step 5: Full lint check (both packages)**

  ```bash
  make lint
  ```
  Expected: no errors in either package.

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/src/views/SettingsView.tsx
  git commit -m "feat: add session mode toggle to SettingsView"
  ```

---

## Verification

Run `make dev` (backend on :9998, frontend on :9999) and verify:

1. **Settings toggle**: Navigate to `/settings` — confirm "Session Mode" toggle appears alongside Tool Permissions, can be switched between chat/terminal, and saves correctly.

2. **Chat mode (default)**: With mode=chat, create a new session — confirm existing chat layout (MessageList + TerminalDrawer + ChatInput) renders unchanged.

3. **Terminal mode**: Switch to terminal mode, create a new session — confirm the session view shows only a full-height xterm.js terminal (no chat input, no message list, no terminal drawer header).

4. **I/O passthrough**: In terminal mode, type a prompt into the terminal — confirm keystrokes appear in the terminal and Claude Code responds with ANSI-formatted output.

5. **Resize**: Resize the browser window — confirm the terminal re-fits and PTY cols/rows update (visible when claude CLI redraws its prompt).

6. **Stop session**: Click "Stop session" in the header while a terminal session is active — confirm PTY is killed, session shows as ended in the sessions list.

7. **Session list + resume**: Both chat and terminal sessions appear in the sessions list. Resuming a terminal session reconnects to `/ws/terminal/:id`; resuming a chat session reconnects to `/ws/session/:id`.

8. **Chat mode unaffected**: Switch back to chat mode, confirm the existing chat experience is identical to before.
