import type { FastifyInstance } from 'fastify'
import { DB_PATH } from '../db/schema'

export async function systemRoutes(fastify: FastifyInstance) {
  fastify.get('/api/system', async (_req, reply) => {
    return reply.send({ db_path: DB_PATH })
  })
}
