import * as pty from 'node-pty'
import * as os from 'os'
import * as path from 'path'
import type { WebSocket } from 'ws'
import type { FastifyInstance } from 'fastify'
import { db } from '../db/schema'
import { resolveBin } from '../utils/resolveBin'
import { getGitBranch } from '../utils/getGitBranch'

const IDLE_TIMEOUT_MS = 30 * 60 * 1000

// ─── Types ────────────────────────────────────────────────────────────────────

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | ContentBlock[]; is_error?: boolean }

interface StreamEvent {
  type: string
  subtype?: string
  session_id?: string
  model?: string
  result?: string
  is_error?: boolean
  message?: {
    id?: string
    content?: ContentBlock[]
    stop_reason?: string | null
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
  }
}

export type StatuslinePayload = {
  model: string | null
  costUsd: number | null
  apiDurationMs: number | null
  linesAdded: number | null
  linesRemoved: number | null
  contextInputTokens: number | null
  contextOutputTokens: number | null
  contextWindowSize: number | null
  contextPct: number | null
  effortLevel: string | null
  thinkingEnabled: boolean | null
  rateLimits: {
    fiveHour?: { pct: number; resetsAt: number }
    sevenDay?: { pct: number; resetsAt: number }
  } | null
}

interface ServerMessage {
  type: 'output' | 'message' | 'status' | 'history' | 'tokens' | 'session_state' | 'permission_request' | 'model' | 'statusline'
  data?: string
  role?: string
  content?: string
  state?: string
  model?: string
  messages?: Array<{ role: string; content: string; created_at: number }>
  inputTokens?: number
  outputTokens?: number
  contextTokens?: number
  totalTokens?: number
  workingTimeMs?: number
  gitBranch?: string | null
  permissions?: Array<{ tool: string; summary: string }>
  statuslineData?: StatuslinePayload
}

interface ClientMessage {
  type: 'chat' | 'input' | 'resize' | 'interrupt' | 'permission_set'
  data?: string
  allowedTools?: string[]
  persist?: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getBypassPermissions(): boolean {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('bypass_permissions') as { value: string } | undefined
  return row ? row.value === 'true' : false
}

function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash') return String(input.command ?? '').slice(0, 120)
  if (name === 'Read') return String(input.file_path ?? '')
  if (name === 'Write' || name === 'Edit') return String(input.file_path ?? '')
  if (name === 'Glob') return String(input.pattern ?? '')
  if (name === 'Grep') return String(input.pattern ?? '')
  return JSON.stringify(input).slice(0, 120)
}

function parseEvent(line: string): StreamEvent | null {
  try {
    return JSON.parse(line) as StreamEvent
  } catch {
    return null
  }
}

function toCRLF(s: string): string {
  return s.replace(/\r?\n/g, '\r\n')
}

// Strip ANSI escape codes before JSON.parse so color codes in PTY output don't
// break structured event parsing.
const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g

// ─── ActiveSession ────────────────────────────────────────────────────────────

class ActiveSession {
  private claudeSessionId: string | null
  private currentPty: pty.IPty | null = null
  private isRunning = false
  private allowedTools = new Set<string>()
  private runStartedAt: number | null = null
  private sockets = new Set<WebSocket>()
  private idleTimer: NodeJS.Timeout | null = null

  constructor(
    readonly id: string,
    private readonly workdir: string,
    claudeSessionId: string | null = null,
  ) {
    this.claudeSessionId = claudeSessionId
    this.resetIdle()
  }

  attach(ws: WebSocket) {
    this.sockets.add(ws)
    ws.send(JSON.stringify({ type: 'status', state: this.isRunning ? 'running' : 'idle' }))
    ws.on('close', () => this.sockets.delete(ws))
  }

  sendMessage(text: string, { persistUserMsg = true }: { persistUserMsg?: boolean } = {}) {
    if (this.isRunning) {
      this.broadcast({ type: 'status', state: 'running' })
      return
    }
    this.resetIdle()
    this.isRunning = true
    this.runStartedAt = Date.now()
    this.broadcast({ type: 'status', state: 'running' })

    // Show user prompt in terminal log
    this.broadcast({ type: 'output', data: `\r\n❯ ${text}\r\n` })

    if (persistUserMsg) {
      db.prepare(
        'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
      ).run(this.id, 'user', text, Date.now())
    }

    const claudeBin = resolveBin(process.env.CLAUDE_BIN?.trim() || 'claude')
    const bypassPermissions = getBypassPermissions()

    // --print + -p: non-interactive print mode with the prompt passed as a CLI
    // argument. --include-partial-messages is omitted because it requires --print
    // AND --output-format=stream-json together and was removed to try interactive
    // mode (which turned out to be incompatible with stream-json output).
    // Permission handling is done via a custom web UI dialog instead of Claude's
    // native terminal dialog (which only works without --print).
    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--verbose',
      '-p', text,
    ]
    if (this.claudeSessionId) args.push('--resume', this.claudeSessionId)
    if (bypassPermissions) args.push('--dangerously-skip-permissions')
    if (!bypassPermissions && this.allowedTools.size > 0) {
      args.push('--allowedTools', [...this.allowedTools].join(','))
    }

    const resolvedCwd = this.workdir.startsWith('~')
      ? path.join(os.homedir(), this.workdir.slice(1))
      : this.workdir

    let ptyProc: pty.IPty
    try {
      ptyProc = pty.spawn(claudeBin, args, {
        name: 'xterm-256color',
        cols: 220,
        rows: 50,
        cwd: resolvedCwd,
        env: { ...process.env } as Record<string, string>,
      })
    } catch (err) {
      this.isRunning = false
      this.broadcast({ type: 'output', data: `\r\nError: ${(err as Error).message}\r\n` })
      this.broadcast({ type: 'status', state: 'error' })
      return
    }
    this.currentPty = ptyProc

    // Track per-message text position to emit incremental chunks (partial messages
    // from --include-partial-messages are cumulative, not incremental)
    let lastMsgId = ''
    let lastEmittedLen = 0
    let thinkingEmitted = false
    const emittedToolIds = new Set<string>()
    let lastUsage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | null = null

    let resultReceived = false
    let resumeFailedRetry = false
    // Map tool_use id → {name, summary} so we can correlate permission errors in tool_result
    const pendingToolUses = new Map<string, { name: string; summary: string }>()
    const permissionsRequested: Array<{ tool: string; summary: string }> = []

    let lineBuffer = ''
    ptyProc.onData((chunk) => {
      this.resetIdle()
      lineBuffer += chunk
      const lines = lineBuffer.split(/\r?\n/)
      lineBuffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trimEnd()
        const event = parseEvent(trimmed.replace(ANSI_RE, ''))

        if (event) {
          // Structured JSON event — process for chat interface (do not echo raw JSON to terminal)
          if (event.type === 'system' && event.subtype === 'init') {
            const sid = event.session_id?.slice(0, 8) ?? '?'
            this.broadcast({ type: 'output', data: `[session ${sid}]\r\n` })
            if (event.model) this.broadcast({ type: 'model', model: event.model })
            // Claude is now ready for input. Write the user message as if typed
            // in the terminal. Claude Code puts stdin in raw mode (no echo), so
            // this won't produce a duplicate line in the terminal output.
            ptyProc.write(text + '\r')
          }

          if (event.type === 'assistant' && event.message?.content) {
            if (event.message.usage) lastUsage = event.message.usage
            const msgId = event.message.id ?? ''
            if (msgId !== lastMsgId) {
              lastMsgId = msgId
              lastEmittedLen = 0
              thinkingEmitted = false
              emittedToolIds.clear()
            }
            for (const block of event.message.content) {
              if (block.type === 'thinking') {
                if (!thinkingEmitted) {
                  thinkingEmitted = true
                  const preview = toCRLF(block.thinking.slice(0, 300))
                  this.broadcast({ type: 'output', data: `\x1b[2m💭 ${preview}\x1b[0m\r\n` })
                }
              } else if (block.type === 'tool_use') {
                if (!emittedToolIds.has(block.id)) {
                  emittedToolIds.add(block.id)
                  const summary = toCRLF(summarizeToolInput(block.name, block.input ?? {}))
                  this.broadcast({ type: 'output', data: `⚙ ${block.name}: ${summary}\r\n` })
                  pendingToolUses.set(block.id, { name: block.name, summary })
                }
              } else if (block.type === 'text') {
                const fullText = block.text
                const chunk = fullText.slice(lastEmittedLen)
                if (chunk) this.broadcast({ type: 'output', data: toCRLF(chunk) })
                lastEmittedLen = fullText.length
              }
            }
          }

          if (event.type === 'user' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'tool_result') {
                const raw = block.content
                const content = toCRLF((typeof raw === 'string' ? raw : JSON.stringify(raw)).slice(0, 500))
                this.broadcast({ type: 'output', data: `→ ${content}\r\n` })
                if (block.is_error) {
                  const rawStr = typeof raw === 'string' ? raw : JSON.stringify(raw)
                  if (/permission|allowedTools|not allowed/i.test(rawStr)) {
                    const tool = pendingToolUses.get(block.tool_use_id)
                    if (tool && !permissionsRequested.some(p => p.tool === tool.name)) {
                      permissionsRequested.push({ tool: tool.name, summary: tool.summary })
                    }
                  }
                }
              }
            }
          }

          if (event.type === 'result') {
            resultReceived = true
            if (event.session_id) {
              this.claudeSessionId = event.session_id
              db.prepare('UPDATE sessions SET claude_session_id = ? WHERE id = ?').run(
                event.session_id,
                this.id,
              )
            }
            const inputTokens = (lastUsage?.input_tokens ?? 0)
              + (lastUsage?.cache_read_input_tokens ?? 0)
              + (lastUsage?.cache_creation_input_tokens ?? 0)
            const outputTokens = lastUsage?.output_tokens ?? 0
            const elapsed = this.runStartedAt != null ? Date.now() - this.runStartedAt : 0
            this.runStartedAt = null
            db.prepare(
              'UPDATE sessions SET total_tokens = total_tokens + ?, working_time_ms = working_time_ms + ? WHERE id = ?',
            ).run(inputTokens + outputTokens, elapsed, this.id)
            if (inputTokens > 0 || outputTokens > 0) {
              const contextTokens = (lastUsage?.input_tokens ?? 0)
                + (lastUsage?.cache_read_input_tokens ?? 0)
                + (lastUsage?.cache_creation_input_tokens ?? 0)
              this.broadcast({ type: 'tokens', inputTokens, outputTokens, contextTokens })
            }
            const finalText = event.result ?? ''
            this.broadcast({ type: 'message', role: 'assistant', content: finalText })
            if (finalText) {
              db.prepare(
                'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
              ).run(this.id, 'assistant', finalText, Date.now())
            }
            this.isRunning = false
            this.broadcast({ type: 'status', state: 'idle' })
            if (permissionsRequested.length > 0) {
              this.broadcast({ type: 'permission_request', permissions: permissionsRequested })
            }
            this.resetIdle()
            // Interactive mode (no --print) doesn't exit after responding.
            // Kill the PTY explicitly; clear our ref first so onExit can detect
            // it's this ptyProc (not a newer one) that exited.
            if (this.currentPty === ptyProc) this.currentPty = null
            process.nextTick(() => ptyProc.kill())
          }
        } else if (trimmed) {
          // Non-JSON line = permission prompt or other interactive Claude output
          // Forward directly to the terminal so the user can see and respond
          this.broadcast({ type: 'output', data: trimmed + '\r\n' })

          // --resume in PTY mode only works for deferred (mid-tool) sessions.
          // When it fails for a normally-completed session, auto-retry without it.
          if (
            this.claudeSessionId &&
            !resultReceived &&
            trimmed.includes('No deferred tool marker found')
          ) {
            resumeFailedRetry = true
          }
        }
      }
    })

    ptyProc.onExit(() => {
      // Only clear the class ref if it still points to this specific PTY process.
      // After a successful result we already cleared it; after a fast retry a new
      // PTY may already be stored — don't clobber that.
      if (this.currentPty === ptyProc) this.currentPty = null

      if (!resultReceived) {
        // Clear stale session ID so the next message starts a fresh Claude session
        // rather than repeating the same --resume failure.
        this.claudeSessionId = null
        db.prepare('UPDATE sessions SET claude_session_id = NULL WHERE id = ?').run(this.id)
      }

      if (resumeFailedRetry) {
        // --resume failed for a completed (non-deferred) session. claudeSessionId was
        // already cleared above. Retry the message without --resume; skip re-inserting
        // the user message since we already recorded it in this call.
        this.isRunning = false
        this.runStartedAt = null
        this.sendMessage(text, { persistUserMsg: false })
        return
      }

      if (this.isRunning) {
        this.isRunning = false
        this.broadcast({ type: 'status', state: 'error' })
      }
    })

  }

  addAllowedTool(tool: string) {
    this.allowedTools.add(tool)
  }

  writeToPty(data: string) {
    this.currentPty?.write(data)
  }

  broadcastStatusline(data: StatuslinePayload) {
    this.broadcast({ type: 'statusline', statuslineData: data })
  }

  resizePty(cols: number, rows: number) {
    this.currentPty?.resize(cols, rows)
  }

  kill() {
    db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(Date.now(), this.id)
    if (this.currentPty) {
      this.currentPty.kill()
      this.currentPty = null
    }
    if (this.idleTimer) clearTimeout(this.idleTimer)
  }

  private broadcast(msg: ServerMessage) {
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

// ─── SessionManager ───────────────────────────────────────────────────────────

class SessionManager {
  private sessions = new Map<string, ActiveSession>()

  getOrCreate(id: string, workdir: string, claudeSessionId: string | null = null): ActiveSession {
    if (!this.sessions.has(id)) {
      this.sessions.set(id, new ActiveSession(id, workdir, claudeSessionId))
    }
    return this.sessions.get(id)!
  }

  get(id: string): ActiveSession | undefined {
    return this.sessions.get(id)
  }

  kill(id: string) {
    this.sessions.get(id)?.kill()
    this.sessions.delete(id)
  }
}

export const sessionManager = new SessionManager()

// ─── WebSocket Route ──────────────────────────────────────────────────────────

export async function sessionWsRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { id: string } }>(
    '/ws/session/:id',
    { websocket: true },
    (socket, req) => {
      const { id } = req.params

      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
        | {
            workdir: string; ended_at: number | null; claude_session_id: string | null
            total_tokens: number; working_time_ms: number; model: string | null
            cost_usd: number | null; api_duration_ms: number | null
            lines_added: number | null; lines_removed: number | null
            context_input_tokens: number | null; context_output_tokens: number | null
            context_window_size: number | null; context_pct: number | null
            effort_level: string | null; thinking_enabled: number | null
          }
        | undefined

      if (!row) {
        socket.send(JSON.stringify({ type: 'status', state: 'error', data: 'session not found' }))
        socket.close()
        return
      }

      // Send message history on connect
      const history = db
        .prepare(
          'SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC',
        )
        .all(id)
      if (history.length > 0) {
        socket.send(JSON.stringify({ type: 'history', messages: history }))
      }

      // Send persisted stats so the frontend can restore duration and token count
      socket.send(JSON.stringify({
        type: 'session_state',
        totalTokens: row.total_tokens ?? 0,
        workingTimeMs: row.working_time_ms ?? 0,
        gitBranch: getGitBranch(row.workdir),
      }))

      // Replay last statusline data so reconnecting clients see up-to-date header stats
      // (cost, API duration, effort, etc.) without waiting for the next statusline push.
      socket.send(JSON.stringify({
        type: 'statusline',
        statuslineData: {
          model: row.model ?? null,
          costUsd: row.cost_usd ?? null,
          apiDurationMs: row.api_duration_ms ?? null,
          linesAdded: row.lines_added ?? null,
          linesRemoved: row.lines_removed ?? null,
          contextInputTokens: row.context_input_tokens ?? null,
          contextOutputTokens: row.context_output_tokens ?? null,
          contextWindowSize: row.context_window_size ?? null,
          contextPct: row.context_pct ?? null,
          effortLevel: row.effort_level ?? null,
          thinkingEnabled: row.thinking_enabled !== null ? row.thinking_enabled === 1 : null,
          rateLimits: null,
        } satisfies StatuslinePayload,
      }))

      // Clear ended_at so resumed sessions show as active; stamp last_used
      db.prepare('UPDATE sessions SET last_used = ?, ended_at = NULL WHERE id = ?').run(Date.now(), id)

      const session = sessionManager.getOrCreate(id, row.workdir, row.claude_session_id ?? null)
      session.attach(socket)

      socket.on('message', (raw: Buffer | string) => {
        try {
          const msg = JSON.parse(raw.toString()) as ClientMessage
          if (msg.type === 'chat' && msg.data) {
            session.sendMessage(msg.data.replace(/\n$/, ''), { persistUserMsg: msg.persist !== false })
          } else if (msg.type === 'permission_set' && Array.isArray(msg.allowedTools)) {
            msg.allowedTools.forEach((t: string) => session.addAllowedTool(t))
          } else if (msg.type === 'input' && msg.data) {
            session.writeToPty(msg.data)
          } else if (msg.type === 'resize') {
            const { cols, rows } = msg as unknown as { cols: number; rows: number }
            if (cols > 0 && rows > 0) session.resizePty(cols, rows)
          }
        } catch {
          // ignore malformed frames
        }
      })
    },
  )
}
