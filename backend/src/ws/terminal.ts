import * as pty from 'node-pty'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import type { WebSocket } from 'ws'
import type { FastifyInstance } from 'fastify'
import { db } from '../db/schema'
import { resolveBin } from '../utils/resolveBin'
import type { StatuslinePayload } from './session'
import { getGitBranch } from '../utils/getGitBranch'

const IDLE_TIMEOUT_MS = 30 * 60 * 1000

function getBypassPermissions(): boolean {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('bypass_permissions') as { value: string } | undefined
  return row ? row.value === 'true' : true
}

type TerminalServerMessage =
  | { type: 'output'; data: string }
  | { type: 'history'; data: string }
  | { type: 'status'; state: string }
  | { type: 'context'; contextPct: number; contextWindow: number }
  | { type: 'statusline'; statuslineData: StatuslinePayload }

const CONTEXT_WINDOW = 200_000
const CONTEXT_POLL_INTERVAL_MS = 10_000
const CONTEXT_POLL_INITIAL_DELAY_MS = 3_000

const MAX_SCROLLBACK_BYTES = 256 * 1024

class ActiveTerminalSession {
  private ptyProc: pty.IPty | null = null
  private ptyPid: number | null = null
  private sockets = new Set<WebSocket>()
  private idleTimer: NodeJS.Timeout | null = null
  private flushTimer: NodeJS.Timeout | null = null
  private contextPollTimer: NodeJS.Timeout | null = null
  private spawnError: string | null = null
  private spawned = false
  private scrollback = ''
  private lastContextKey = ''

  constructor(
    readonly id: string,
    private readonly workdir: string,
    private readonly onCleanup: (id: string) => void,
  ) {
    const row = db
      .prepare('SELECT terminal_scrollback FROM sessions WHERE id = ?')
      .get(id) as { terminal_scrollback: string | null } | undefined
    this.scrollback = row?.terminal_scrollback ?? ''
  }

  private scheduleFlush() {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => this.flushScrollback(), 500)
  }

  private flushScrollback() {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null }
    db.prepare('UPDATE sessions SET terminal_scrollback = ? WHERE id = ?').run(this.scrollback, this.id)
  }

  private spawnPty(cols: number, rows: number) {
    const claudeBin = resolveBin(process.env.CLAUDE_BIN?.trim() || 'claude')
    const bypassPermissions = getBypassPermissions()
    const args: string[] = []
    if (bypassPermissions) args.push('--dangerously-skip-permissions')

    const resolvedCwd = this.workdir.startsWith('~')
      ? path.join(os.homedir(), this.workdir.slice(1))
      : this.workdir

    try {
      this.ptyProc = pty.spawn(claudeBin, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: resolvedCwd,
        env: { ...process.env } as Record<string, string>,
      })
    } catch (err) {
      this.spawnError = (err as Error).message
      this.broadcast({ type: 'output', data: `\r\nError starting terminal: ${this.spawnError}\r\n` })
      this.broadcast({ type: 'status', state: 'disconnected' })
      for (const ws of this.sockets) ws.close()
      this.sockets.clear()
      this.onCleanup(this.id)
      return
    }

    this.spawned = true
    this.ptyPid = this.ptyProc.pid
    this.resetIdle()
    this.broadcast({ type: 'status', state: 'connected' })
    this.startContextPolling()

    this.ptyProc.onData((data) => {
      this.resetIdle()
      this.scrollback += data
      if (this.scrollback.length > MAX_SCROLLBACK_BYTES) {
        this.scrollback = this.scrollback.slice(this.scrollback.length - MAX_SCROLLBACK_BYTES)
      }
      this.broadcast({ type: 'output', data })
      this.scheduleFlush()
    })

    this.ptyProc.onExit(() => {
      this.ptyProc = null
      this.flushScrollback()
      db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(Date.now(), this.id)
      this.broadcast({ type: 'status', state: 'disconnected' })
      if (this.idleTimer) clearTimeout(this.idleTimer)
      if (this.contextPollTimer) { clearInterval(this.contextPollTimer); this.contextPollTimer = null }
      this.onCleanup(this.id)
      // Close sockets so the frontend reconnect loop fires and spawns a fresh PTY.
      for (const ws of this.sockets) ws.close()
      this.sockets.clear()
    })
  }

  attach(ws: WebSocket) {
    this.sockets.add(ws)
    ws.on('close', () => this.sockets.delete(ws))
    // If PTY already running (reconnect), confirm immediately.
    // If not yet spawned, wait for the first resize message to spawn with correct dimensions.
    if (this.spawned) {
      if (this.scrollback) {
        ws.send(JSON.stringify({ type: 'history', data: this.scrollback }))
      }
      ws.send(JSON.stringify({ type: 'status', state: 'connected' }))
      if (this.lastContextKey) {
        const [pctStr, windowStr] = this.lastContextKey.split('/')
        ws.send(JSON.stringify({ type: 'context', contextPct: parseInt(pctStr, 10), contextWindow: parseInt(windowStr, 10) }))
      }
    }
  }

  writeInput(data: string) {
    this.resetIdle()
    this.ptyProc?.write(data)
  }

  resize(cols: number, rows: number) {
    if (!this.spawned) {
      this.spawnPty(cols, rows)
    } else {
      this.ptyProc?.resize(cols, rows)
    }
  }

  broadcastStatusline(data: StatuslinePayload) {
    this.broadcast({ type: 'statusline', statuslineData: data })
  }

  kill() {
    this.flushScrollback()
    db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(Date.now(), this.id)
    if (this.ptyProc) {
      this.ptyProc.kill()
      this.ptyProc = null
    }
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (this.contextPollTimer) { clearInterval(this.contextPollTimer); this.contextPollTimer = null }
    this.broadcast({ type: 'status', state: 'disconnected' })
    for (const ws of this.sockets) ws.close()
    this.sockets.clear()
  }

  private startContextPolling() {
    setTimeout(() => {
      this.pollContext()
      this.contextPollTimer = setInterval(() => this.pollContext(), CONTEXT_POLL_INTERVAL_MS)
    }, CONTEXT_POLL_INITIAL_DELAY_MS)
  }

  private pollContext() {
    if (!this.ptyPid) return
    try {
      const sessFile = path.join(os.homedir(), '.claude', 'sessions', `${this.ptyPid}.json`)
      const sessJson = JSON.parse(fs.readFileSync(sessFile, 'utf8')) as { sessionId: string; cwd?: string }
      const claudeSessionId = sessJson.sessionId
      // Persist so the statusline route can match this session by claude_session_id
      db.prepare('UPDATE sessions SET claude_session_id = ? WHERE id = ? AND claude_session_id IS NULL')
        .run(claudeSessionId, this.id)
      const cwd = sessJson.cwd ?? this.workdir

      const absCwd = cwd.startsWith('~') ? path.join(os.homedir(), cwd.slice(1)) : cwd
      const encoded = absCwd.replace(/[/.]/g, '-')
      const jsonlPath = path.join(os.homedir(), '.claude', 'projects', encoded, `${claudeSessionId}.jsonl`)

      // Read last ~20 KB from the end to find the most recent usage entry
      const stat = fs.statSync(jsonlPath)
      const readSize = Math.min(stat.size, 20_480)
      const buf = Buffer.alloc(readSize)
      const fd = fs.openSync(jsonlPath, 'r')
      fs.readSync(fd, buf, 0, readSize, stat.size - readSize)
      fs.closeSync(fd)

      const tail = buf.toString('utf8')
      const lines = tail.split('\n').filter((l) => l.trim())

      let contextTokens = 0
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]) as { message?: { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } } }
          const usage = entry?.message?.usage
          if (usage && (usage.input_tokens != null || usage.cache_read_input_tokens != null)) {
            contextTokens = (usage.input_tokens ?? 0)
              + (usage.cache_read_input_tokens ?? 0)
              + (usage.cache_creation_input_tokens ?? 0)
            break
          }
        } catch {
          // skip malformed line
        }
      }

      const contextPct = Math.round(contextTokens / CONTEXT_WINDOW * 100)
      const key = `${contextPct}/${CONTEXT_WINDOW}`
      if (key !== this.lastContextKey) {
        this.lastContextKey = key
        this.broadcast({ type: 'context', contextPct, contextWindow: CONTEXT_WINDOW })
      }
    } catch {
      // session file or JSONL not available yet — ignore
    }
  }

  private broadcast(msg: TerminalServerMessage) {
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
      this.sessions.set(id, new ActiveTerminalSession(id, workdir, (cleanupId) => {
        this.sessions.delete(cleanupId)
      }))
    }
    return this.sessions.get(id)!
  }

  get(id: string): ActiveTerminalSession | undefined {
    return this.sessions.get(id)
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

      // Clear ended_at so resumed sessions show as active; stamp last_used
      db.prepare('UPDATE sessions SET last_used = ?, ended_at = NULL WHERE id = ?').run(Date.now(), id)

      const session = terminalManager.getOrCreate(id, row.workdir)
      session.attach(socket)

      const gitBranch = getGitBranch(row.workdir)
      socket.send(JSON.stringify({ type: 'git_branch', gitBranch }))

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
