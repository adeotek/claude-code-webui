import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import cors from '@fastify/cors'
import staticPlugin from '@fastify/static'
import path from 'path'
import fs from 'fs'
import { accountRoutes } from './routes/account'
import { usageRoutes } from './routes/usage'
import { sessionRoutes } from './routes/sessions'
import { sessionWsRoutes } from './ws/session'
import { terminalWsRoutes } from './ws/terminal'
import { settingsRoutes } from './routes/settings'
import { initAccountCache } from './services/accountCache'

// TODO: add bearer token auth — add @fastify/bearer-auth plugin here
// and set token via DASHBOARD_TOKEN env var
// fastify.addHook('onRequest', async (request, reply) => { ... })

const fastify = Fastify({ logger: true })

async function start() {
  const PORT = Number(process.env.PORT ?? 9998)
  const HOST = process.env.HOST ?? '0.0.0.0'
  await fastify.register(cors, {
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    origin: (origin, cb) => {
      if (!origin) return cb(null, true)                       // same-origin / curl / no-CORS
      try {
        const { port } = new URL(origin)
        if (port === '9999' || port === String(PORT)) return cb(null, true)
      } catch { /* ignore malformed */ }
      cb(new Error('Not allowed by CORS'), false)
    },
  })
  await fastify.register(websocket)

  await fastify.register(accountRoutes)
  await fastify.register(usageRoutes)
  await fastify.register(sessionRoutes)
  await fastify.register(sessionWsRoutes)
  await fastify.register(terminalWsRoutes)
  await fastify.register(settingsRoutes)

  fastify.get('/health', async () => ({ status: 'ok' }))

  // Serve built frontend when dist exists (production / make build).
  // In dev, Vite handles the frontend on its own port.
  // __dirname is backend/src in tsx-watch and backend/dist in compiled mode,
  // so ../../frontend/dist resolves correctly in both cases.
  const frontendDist = path.join(__dirname, '../../frontend/dist')
  if (fs.existsSync(frontendDist)) {
    await fastify.register(staticPlugin, { root: frontendDist, wildcard: false })
    fastify.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/ws/')) {
        reply.code(404)
        return { error: 'Not found' }
      }
      return reply.sendFile('index.html')
    })
  }

  await initAccountCache()

  try {
    await fastify.listen({ port: PORT, host: HOST })
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
