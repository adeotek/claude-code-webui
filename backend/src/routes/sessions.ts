import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { db } from '../db/schema'
import { sessionManager } from '../ws/session'
import { terminalManager } from '../ws/terminal'

export async function sessionRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { path?: string } }>('/api/directories', async (req, reply) => {
    // Normalise to forward slashes so the frontend can always split on '/'
    const normalised = (req.query.path ?? os.homedir()).replace(/\\/g, '/')
    const resolved =
      normalised === '~' ? os.homedir()
      : normalised.startsWith('~/') ? path.join(os.homedir(), normalised.slice(2))
      : normalised
    try {
      const entries = fs.readdirSync(resolved, { withFileTypes: true })
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => path.join(resolved, e.name).replace(/\\/g, '/'))
        .sort()
      return reply.send(dirs)
    } catch {
      return reply.send([])
    }
  })

  fastify.get('/api/sessions/table', async (_req, reply) => {
    const rows = db
      .prepare(
        `SELECT s.id, s.workdir, s.name, s.model, s.mode,
                s.started_at, s.last_used, s.ended_at, s.claude_session_id,
                CASE WHEN s.ended_at IS NULL THEN 1 ELSE 0 END as is_active,
                s.total_tokens, s.working_time_ms,
                COALESCE(mc.message_count, 0) as message_count,
                s.cost_usd, s.api_duration_ms,
                s.lines_added, s.lines_removed,
                s.context_input_tokens, s.context_output_tokens,
                s.context_window_size, s.context_pct,
                s.effort_level, s.thinking_enabled,
                s.rate_limit_5h_pct, s.rate_limit_5h_resets_at,
                s.rate_limit_7d_pct, s.rate_limit_7d_resets_at
         FROM sessions s
         LEFT JOIN (SELECT session_id, COUNT(*) as message_count FROM messages GROUP BY session_id) mc
           ON mc.session_id = s.id
         ORDER BY s.started_at DESC`,
      )
      .all()
    return reply.send(rows)
  })

  fastify.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params
    const row = db
      .prepare(
        `SELECT s.*,
          CASE WHEN s.ended_at IS NULL THEN 1 ELSE 0 END as is_active,
          COUNT(m.id) as message_count
        FROM sessions s
        LEFT JOIN messages m ON m.session_id = s.id
        WHERE s.id = ?
        GROUP BY s.id`,
      )
      .get(id)
    if (!row) return reply.status(404).send({ error: 'Session not found' })
    return reply.send(row)
  })

  fastify.get('/api/sessions', async (_req, reply) => {
    const rows = db
      .prepare(
        `SELECT s.*,
          CASE WHEN s.ended_at IS NULL THEN 1 ELSE 0 END as is_active,
          COUNT(m.id) as message_count
        FROM sessions s
        LEFT JOIN messages m ON m.session_id = s.id
        GROUP BY s.id
        ORDER BY s.started_at DESC
        LIMIT 50`,
      )
      .all()
    return reply.send(rows)
  })

  fastify.post<{ Body: { workdir: string; name?: string } }>('/api/sessions', async (req, reply) => {
    const { workdir, name } = req.body
    if (!workdir || typeof workdir !== 'string') {
      return reply.status(400).send({ error: 'workdir is required' })
    }

    const modeRow = db
      .prepare("SELECT value FROM settings WHERE key = 'session_mode'")
      .get() as { value: string } | undefined
    const mode = modeRow?.value === 'terminal' ? 'terminal' : 'chat'

    const id = randomUUID()
    const now = Date.now()
    db.prepare(
      'INSERT INTO sessions (id, workdir, name, mode, started_at, last_used) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, workdir, name?.trim() || null, mode, now, now)

    return reply.status(201).send({ sessionId: id })
  })

  fastify.post<{ Params: { id: string } }>('/api/sessions/:id/stop', async (req, reply) => {
    const { id } = req.params
    sessionManager.kill(id)
    terminalManager.kill(id)
    db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(Date.now(), id)
    return reply.send({ ok: true })
  })

  fastify.patch<{ Params: { id: string }; Body: { name: string } }>('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params
    const { name } = req.body

    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id)
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' })
    }

    db.prepare('UPDATE sessions SET name = ? WHERE id = ?').run(
      typeof name === 'string' ? name.trim() || null : null,
      id,
    )
    return reply.send({ ok: true })
  })

  fastify.get<{ Params: { id: string } }>('/api/sessions/:id/messages', async (req, reply) => {
    const { id } = req.params
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id)
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' })
    }
    const messages = db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
      .all(id)
    return reply.send({ messages })
  })

  fastify.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params
    const session = db
      .prepare('SELECT workdir, claude_session_id FROM sessions WHERE id = ?')
      .get(id) as { workdir: string; claude_session_id: string | null } | undefined
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' })
    }
    sessionManager.kill(id)
    terminalManager.kill(id)
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(id)
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id)

    if (session.claude_session_id) {
      const absWorkdir = session.workdir.startsWith('~')
        ? path.join(os.homedir(), session.workdir.slice(1))
        : session.workdir
      const encoded = absWorkdir.replace(/\//g, '-')
      const projectDir = path.join(os.homedir(), '.claude', 'projects', encoded)
      const base = path.join(projectDir, session.claude_session_id)
      try { fs.rmSync(`${base}.jsonl`) } catch { /* already gone */ }
      try { fs.rmSync(base, { recursive: true }) } catch { /* already gone or absent */ }
    }

    return reply.send({ ok: true })
  })
}
