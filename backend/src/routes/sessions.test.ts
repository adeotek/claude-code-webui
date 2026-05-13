import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../ws/session', () => ({ sessionManager: { kill: vi.fn() } }))
vi.mock('../ws/terminal', () => ({ terminalManager: { kill: vi.fn() } }))
vi.mock('../db/schema', async () => {
  const { createTestDb } = await import('../test/db')
  return { db: createTestDb() }
})

const { db } = await import('../db/schema')
const { sessionManager } = await import('../ws/session')
const { terminalManager } = await import('../ws/terminal')

describe('sessions routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    db.prepare('DELETE FROM messages').run()
    db.prepare('DELETE FROM sessions').run()
    db.prepare('DELETE FROM settings').run()

    vi.clearAllMocks()

    app = Fastify()
    const { sessionRoutes } = await import('./sessions')
    await app.register(sessionRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  describe('POST /api/sessions', () => {
    it('creates a session and returns 201 with a sessionId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { workdir: '/tmp/test' },
      })
      expect(res.statusCode).toBe(201)
      const body = res.json()
      expect(body).toHaveProperty('sessionId')
      expect(typeof body.sessionId).toBe('string')
      expect(body.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      )
    })

    it('returns 400 if workdir is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {},
      })
      expect(res.statusCode).toBe(400)
    })

    it('uses session_mode from settings when creating session', async () => {
      db.prepare("INSERT INTO settings (key, value) VALUES ('session_mode', 'chat')").run()

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { workdir: '/tmp/test' },
      })
      expect(res.statusCode).toBe(201)
      const { sessionId } = res.json()
      const row = db.prepare('SELECT mode FROM sessions WHERE id = ?').get(sessionId) as { mode: string }
      expect(row.mode).toBe('chat')
    })
  })

  describe('GET /api/sessions', () => {
    it('returns an empty array when no sessions exist', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/sessions' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual([])
    })

    it('returns sessions after they are created', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { workdir: '/tmp/proj1' },
      })
      await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { workdir: '/tmp/proj2' },
      })

      const res = await app.inject({ method: 'GET', url: '/api/sessions' })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(Array.isArray(body)).toBe(true)
      expect(body.length).toBe(2)
    })
  })

  describe('PATCH /api/sessions/:id', () => {
    it('renames a session and returns { ok: true }', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { workdir: '/tmp/test' },
      })
      const { sessionId } = createRes.json()

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/sessions/${sessionId}`,
        payload: { name: 'My Session' },
      })
      expect(patchRes.statusCode).toBe(200)
      expect(patchRes.json()).toEqual({ ok: true })

      const row = db.prepare('SELECT name FROM sessions WHERE id = ?').get(sessionId) as { name: string }
      expect(row.name).toBe('My Session')
    })

    it('returns 404 for unknown session id', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/sessions/non-existent-id',
        payload: { name: 'Test' },
      })
      expect(res.statusCode).toBe(404)
    })
  })

  describe('DELETE /api/sessions/:id', () => {
    it('deletes a session and returns { ok: true }', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { workdir: '/tmp/test' },
      })
      const { sessionId } = createRes.json()

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/sessions/${sessionId}`,
      })
      expect(deleteRes.statusCode).toBe(200)
      expect(deleteRes.json()).toEqual({ ok: true })

      const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId)
      expect(row).toBeUndefined()
    })

    it('returns 404 for unknown session id', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/sessions/non-existent-id',
      })
      expect(res.statusCode).toBe(404)
    })

    it('calls sessionManager.kill and terminalManager.kill on delete', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { workdir: '/tmp/test' },
      })
      const { sessionId } = createRes.json()

      await app.inject({
        method: 'DELETE',
        url: `/api/sessions/${sessionId}`,
      })

      expect(sessionManager.kill).toHaveBeenCalledWith(sessionId)
      expect(terminalManager.kill).toHaveBeenCalledWith(sessionId)
    })

    it('handles session with ~ workdir without crashing', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { workdir: '~' },
      })
      const { sessionId } = createRes.json()

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/sessions/${sessionId}`,
      })
      expect(deleteRes.statusCode).toBe(200)
      expect(deleteRes.json()).toEqual({ ok: true })

      expect(sessionManager.kill).toHaveBeenCalledWith(sessionId)
    })
  })

  describe('POST /api/sessions/:id/stop', () => {
    it('stops a session and returns { ok: true }', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { workdir: '/tmp/test' },
      })
      const { sessionId } = createRes.json()

      const stopRes = await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/stop`,
      })
      expect(stopRes.statusCode).toBe(200)
      expect(stopRes.json()).toEqual({ ok: true })

      expect(sessionManager.kill).toHaveBeenCalledWith(sessionId)
      expect(terminalManager.kill).toHaveBeenCalledWith(sessionId)
    })
  })
})
