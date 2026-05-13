import type { FastifyInstance } from 'fastify'
import { getCachedAccount } from '../services/accountCache'

export async function accountRoutes(fastify: FastifyInstance) {
  fastify.get('/api/account', async (_req, reply) => {
    return reply.send(getCachedAccount())
  })
}
