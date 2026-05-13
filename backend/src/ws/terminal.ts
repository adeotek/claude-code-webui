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

type TerminalServerMessage =
  | { type: 'output'; data: string }
  | { type: 'status'; state: string }

class ActiveTerminalSession {
  private ptyProc: pty.IPty | null = null
  private sockets = new Set<WebSocket>()
  private idleTimer: NodeJS.Timeout | null = null
  private spawnError: string | null = null
  private spawned = false

  constructor(
    readonly id: string,
    private readonly workdir: string,
    private readonly onCleanup: (id: string) => void,
  ) {}

  private spawnPty(cols: number, rows: number) {
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
    this.resetIdle()
    this.broadcast({ type: 'status', state: 'connected' })

    this.ptyProc.onData((data) => {
      this.resetIdle()
      this.broadcast({ type: 'output', data })
    })

    this.ptyProc.onExit(() => {
      this.ptyProc = null
      db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(Date.now(), this.id)
      this.broadcast({ type: 'status', state: 'disconnected' })
      if (this.idleTimer) clearTimeout(this.idleTimer)
      this.onCleanup(this.id)
    })
  }

  attach(ws: WebSocket) {
    this.sockets.add(ws)
    ws.on('close', () => this.sockets.delete(ws))
    // If PTY already running (reconnect), confirm immediately.
    // If not yet spawned, wait for the first resize message to spawn with correct dimensions.
    if (this.spawned) {
      ws.send(JSON.stringify({ type: 'status', state: 'connected' }))
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

  kill() {
    db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(Date.now(), this.id)
    if (this.ptyProc) {
      this.ptyProc.kill()
      this.ptyProc = null
    }
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.broadcast({ type: 'status', state: 'disconnected' })
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
