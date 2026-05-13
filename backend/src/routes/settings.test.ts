import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../db/schema', async () => {
  const { createTestDb } = await import('../test/db')
  return { db: createTestDb() }
})

// Import db AFTER mock so we get the test instance
const { db } = await import('../db/schema')

describe('settings routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    // Reset settings table before each test
    db.prepare('DELETE FROM settings').run()

    app = Fastify()
    const { settingsRoutes } = await import('./settings')
    await app.register(settingsRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('GET /api/settings returns defaults when DB is empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({
      bypass_permissions: 'false',
      session_mode: 'terminal',
    })
  })

  it('POST /api/settings updates a valid key and GET reflects it', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/settings',
      payload: { bypass_permissions: 'false' },
    })
    expect(postRes.statusCode).toBe(200)
    expect(postRes.json()).toEqual({ ok: true })

    const getRes = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(getRes.statusCode).toBe(200)
    expect(getRes.json().bypass_permissions).toBe('false')
  })

  it('POST /api/settings with an unknown key returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings',
      payload: { unknown_key: 'value' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'no valid keys' })
  })

  it('POST /api/settings with a mix of valid and invalid keys stores valid ones', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings',
      payload: { bypass_permissions: 'false', bogus_key: 'ignored' },
    })
    // Has at least one valid key → should succeed
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })

    const getRes = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(getRes.json().bypass_permissions).toBe('false')
  })

  it('GET /api/settings returns updated session_mode after POST', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/settings',
      payload: { session_mode: 'chat' },
    })

    const getRes = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(getRes.json().session_mode).toBe('chat')
  })
})
