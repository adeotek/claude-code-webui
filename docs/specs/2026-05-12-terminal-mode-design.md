# Terminal Mode Design

**Date:** 2026-05-12  
**Branch:** feat/terminal  
**Status:** Approved

## Context

The session view currently shows only a chat interface (MessageList + TerminalDrawer drawer + ChatInput). The TerminalDrawer renders PTY output from the claude CLI spawned in non-interactive, structured-JSON mode (`--print --output-format stream-json`). There is no way to interact with the Claude Code CLI as a real terminal.

This feature adds a global `session_mode` setting (`chat` | `terminal`) that switches the session view between the existing chat layout and a full terminal experience backed by a proper interactive PTY.

## Approach

Separate WebSocket endpoint (`/ws/terminal/:id`) alongside the existing `/ws/session/:id`. The two paths are fully independent — no changes to the existing chat session handler. Sessions carry their mode in the database so resuming always uses the correct endpoint.

## Architecture

```
CHAT MODE                          TERMINAL MODE
─────────────────────────────      ─────────────────────────────
POST /api/sessions                 POST /api/sessions
  → mode: 'chat' stored in DB        → mode: 'terminal' stored in DB
  ↓                                  ↓
WS /ws/session/:id                 WS /ws/terminal/:id  (NEW)
  → claude --print                   → claude  (interactive PTY)
    --output-format stream-json      → raw I/O passthrough, no JSON
  → structured message parsing       → no parsing
  ↓                                  ↓
DashboardView                      DashboardView
  → SessionHeader (shared)           → SessionHeader (shared)
  → MessageList                      → TerminalSession.tsx  (NEW)
  → TerminalDrawer                     (full-height xterm.js)
  → ChatInput
```

## Backend Changes

### `backend/src/routes/settings.ts`
Add `session_mode` to DEFAULTS and ALLOWED set:
```typescript
const DEFAULTS = { bypass_permissions: 'true', session_mode: 'chat' }
```

### `backend/src/db/schema.ts`
Add `mode` column to sessions table in CREATE TABLE statement:
```sql
mode TEXT NOT NULL DEFAULT 'chat'
```
Add a migration guard at DB init time:
```sql
ALTER TABLE sessions ADD COLUMN mode TEXT DEFAULT 'chat'
-- guarded by checking existing columns first
```

### `backend/src/routes/sessions.ts`
- **POST** `/api/sessions`: read `session_mode` from settings at creation time, store as `mode` on the new session row
- **GET** `/api/sessions`: include `mode` field in each session object returned
- **POST** `/api/sessions/:id/stop`: after existing SessionManager check, also call `terminalManager.stop(id)` to kill a running terminal PTY

### `backend/src/ws/terminal.ts` (NEW, ~120 lines)

`TerminalManager` singleton — tracks active terminal PTYs by session ID (mirrors the existing `SessionManager` pattern).

WebSocket handler for `/ws/terminal/:id`:
- On connect: look up session from DB; spawn `claude` as persistent interactive PTY
  - Args: `--dangerously-skip-permissions` when bypass_permissions=true, nothing else
  - PTY config: `xterm-256color`, cols=220, rows=50, cwd=session workdir, inherits env
- Messages **in**:
  - `{ type: 'input', data: string }` → write to PTY stdin
  - `{ type: 'resize', cols: number, rows: number }` → resize PTY
- Messages **out**:
  - `{ type: 'output', data: string }` → raw PTY bytes (ANSI preserved)
  - `{ type: 'status', state: 'connected' | 'disconnected' }`
- On PTY exit: broadcast `status: disconnected`, mark session `ended_at` in DB
- Idle timeout: 30 minutes (same as chat sessions)

### `backend/src/server.ts`
Register new WS route: `server.register(terminalWsPlugin)` alongside existing session WS.

## Frontend Changes

### `frontend/src/views/SettingsView.tsx`
Add a "Session Mode" toggle row using the same pattern as the `bypass_permissions` toggle. Two options: **Chat** (default) | **Terminal**. POSTs `{ session_mode: 'chat' | 'terminal' }` to `/api/settings` on change. Applies to all new sessions.

### `frontend/src/context/SessionContext.tsx`
Add `mode: 'chat' | 'terminal'` to `SessionState`. Populate it via:
- `SESSION_CREATED` action (includes mode from global setting at creation time)
- `RESUME_SESSION` action (includes mode from the session's DB record)

This is the source of truth for which UI to render — not the global setting directly.

### `frontend/src/hooks/useDashboard.ts`
Extend the existing parallel fetch to also load `GET /api/settings`. Return `defaultSessionMode: 'chat' | 'terminal'` (used only when creating new sessions to pre-populate the mode).

### `frontend/src/views/DashboardView.tsx`
Two targeted changes:
1. Pass `null` to `useWebSocket` when `state.mode === 'terminal'` to prevent the chat WS from connecting
2. Swap session content based on `state.mode` — SessionHeader is always rendered:
```tsx
{state.mode === 'terminal'
  ? <TerminalSession sessionId={state.sessionId} />
  : <>
      <MessageList … />
      <TerminalDrawer … />
      <ChatInput … />
    </>
}
```

### `frontend/src/hooks/useTerminalSession.ts` (NEW)
Mirrors `useWebSocket` structure but targets `/ws/terminal/:id`:
- Connects on mount when `sessionId` is set
- Sends `{ type: 'input', data }` and `{ type: 'resize', cols, rows }`
- On `status: connected` → dispatch `WS_STATE('idle')` to SessionContext
- On `status: disconnected` → dispatch `WS_STATE('disconnected')`
- On `output` → call `onOutput(data)` callback for xterm write
- Reconnect: exponential backoff up to 5 attempts, then 30s polling (same as useWebSocket)

### `frontend/src/components/TerminalSession.tsx` (NEW)
Full-height xterm.js terminal filling the space between SessionHeader and viewport bottom:
- Same xterm theme and FitAddon config as existing `TerminalDrawer`
- All keystrokes → `type: 'input'` via useTerminalSession
- ResizeObserver on container → `type: 'resize'`
- `onOutput` callback writes raw data to xterm instance
- No MessageList, no ChatInput — the terminal IS the interface

### `SessionHeader` (unchanged)
Works for both modes. In terminal mode naturally shows fewer stats (no tokens counter, no running spinner — status is connected/idle). Session name, workdir, stop button, new session button, rename all function identically.

## Session Resumption

Sessions carry `mode` in the DB. The session list (`GET /api/sessions`) returns `mode` per session. When `DashboardView.handleResume()` is called, it dispatches `RESUME_SESSION` with the session's stored `mode` — this updates `SessionContext.state.mode` and the correct UI renders automatically. The global setting (`defaultSessionMode`) only determines the mode stored when a **new** session is created; it does not affect resumed sessions.

## Files to Create
- `backend/src/ws/terminal.ts`
- `frontend/src/hooks/useTerminalSession.ts`
- `frontend/src/components/TerminalSession.tsx`

## Files to Modify
- `backend/src/routes/settings.ts`
- `backend/src/db/schema.ts` (or wherever migrations run)
- `backend/src/routes/sessions.ts`
- `backend/src/server.ts`
- `frontend/src/context/SessionContext.tsx`
- `frontend/src/hooks/useDashboard.ts`
- `frontend/src/views/DashboardView.tsx`
- `frontend/src/views/SettingsView.tsx`

## Verification

1. **Settings**: Open `/settings`, confirm new "Session Mode" toggle appears and saves (Chat ↔ Terminal)
2. **Terminal session creation**: Switch to Terminal mode, create a new session — confirm PTY spawns `claude` interactively, full terminal renders in session view
3. **Chat session creation**: Switch back to Chat mode, create a session — confirm existing chat layout is untouched
4. **I/O passthrough**: In terminal mode, type a prompt directly in the terminal, confirm response renders with ANSI formatting
5. **Resize**: Resize browser window, confirm PTY cols/rows update
6. **Stop**: Click Stop in session header while terminal is active — confirm PTY is killed, session marked ended
7. **Session list**: Confirm both chat and terminal sessions appear in the list and resume correctly
8. **Idle timeout**: Verify terminal PTY is killed after 30 min of inactivity (same as chat)
9. **Lint**: `make lint` passes in both packages
