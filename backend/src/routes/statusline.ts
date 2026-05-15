import { randomUUID } from 'crypto'
import os from 'os'
import type { FastifyInstance } from 'fastify'
import { db } from '../db/schema'
import { sessionManager } from '../ws/session'
import type { StatuslinePayload } from '../ws/session'
import { terminalManager } from '../ws/terminal'

export async function statuslineRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/api/statusline',
    {
      schema: {
        body: { type: 'object', additionalProperties: true },
      },
    },
    async (req, reply) => {
      const body = req.body as {
        session_id?: string
        session_name?: string
        model?: { display_name?: string }
        workspace?: { current_dir?: string }
        cost?: {
          total_cost_usd?: number
          total_api_duration_ms?: number
          total_lines_added?: number
          total_lines_removed?: number
        }
        context_window?: {
          total_input_tokens?: number
          total_output_tokens?: number
          context_window_size?: number
          used_percentage?: number
        }
        effort?: { level?: string }
        thinking?: { enabled?: boolean }
        rate_limits?: {
          five_hour?: { used_percentage?: number; resets_at?: number }
          seven_day?: { used_percentage?: number; resets_at?: number }
        }
      }

      const sessionId = body.session_id ?? null
      const sessionName = body.session_name ?? null
      const modelName = body.model?.display_name ?? null
      const cwd = body.workspace?.current_dir || os.homedir()
      const costUsd = body.cost?.total_cost_usd ?? null
      const apiDurationMs = body.cost?.total_api_duration_ms ?? null
      const linesAdded = body.cost?.total_lines_added ?? null
      const linesRemoved = body.cost?.total_lines_removed ?? null
      const contextInputTokens = body.context_window?.total_input_tokens ?? null
      const contextOutputTokens = body.context_window?.total_output_tokens ?? null
      const contextWindowSize = body.context_window?.context_window_size ?? null
      const contextPct = body.context_window?.used_percentage ?? null
      const effortLevel = body.effort?.level ?? null
      const thinkingEnabled =
        body.thinking?.enabled != null ? (body.thinking.enabled ? 1 : 0) : null
      const rateLimitFiveHourPct = body.rate_limits?.five_hour?.used_percentage ?? null
      const rateLimitFiveHourResetsAt = body.rate_limits?.five_hour?.resets_at ?? null
      const rateLimitSevenDayPct = body.rate_limits?.seven_day?.used_percentage ?? null
      const rateLimitSevenDayResetsAt = body.rate_limits?.seven_day?.resets_at ?? null

      // Nothing to match without a session_id
      if (!sessionId) {
        return reply.status(200).send({ ok: true })
      }

      // Look up the webui session
      let dbRow = db
        .prepare('SELECT id, mode, name FROM sessions WHERE claude_session_id = ?')
        .get(sessionId) as { id: string; mode: string; name: string | null } | undefined

      if (!dbRow) {
        // Fallback: find an active webui session with a matching workdir that hasn't been
        // linked to a Claude session yet. This covers the first-response race where
        // claude_session_id hasn't been persisted to the DB before the statusline fires.
        // Use RTRIM to normalize trailing slashes on both sides (DB may store with slash,
        // statusline payload omits it, or vice versa).
        const normalizedCwd = cwd.replace(/\/+$/, '')
        const candidate = db
          .prepare(
            `SELECT id, mode, name FROM sessions
             WHERE RTRIM(workdir, '/') = ? AND claude_session_id IS NULL
             ORDER BY COALESCE(last_used, started_at) DESC LIMIT 1`,
          )
          .get(normalizedCwd) as { id: string; mode: string; name: string | null } | undefined

        if (candidate) {
          db.prepare('UPDATE sessions SET claude_session_id = ? WHERE id = ?').run(sessionId, candidate.id)
          dbRow = candidate
        }
      }

      if (!dbRow) {
        // Read the statusline_unmatched setting
        const settingRow = db
          .prepare('SELECT value FROM settings WHERE key = ?')
          .get('statusline_unmatched') as { value: string } | undefined
        const unmatched = settingRow?.value ?? 'ignore'

        if (unmatched !== 'create') {
          return reply.status(200).send({ ok: true })
        }

        // Auto-create a new session row
        const newId = randomUUID()
        const now = Date.now()
        db.prepare(
          `INSERT INTO sessions (id, workdir, name, mode, started_at, last_used, claude_session_id, model)
           VALUES (?, ?, ?, 'terminal', ?, ?, ?, ?)`,
        ).run(newId, cwd, sessionName, now, now, sessionId, modelName)

        dbRow = { id: newId, mode: 'terminal', name: sessionName }
      }

      const webuiSessionId = dbRow.id

      // Build the SET clauses dynamically — only include non-null values
      const setClauses: string[] = []
      const setValues: unknown[] = []

      if (modelName !== null) {
        setClauses.push('model = ?')
        setValues.push(modelName)
      }
      if (costUsd !== null) { setClauses.push('cost_usd = ?'); setValues.push(costUsd) }
      if (apiDurationMs !== null) { setClauses.push('api_duration_ms = ?'); setValues.push(apiDurationMs) }
      if (linesAdded !== null) { setClauses.push('lines_added = ?'); setValues.push(linesAdded) }
      if (linesRemoved !== null) { setClauses.push('lines_removed = ?'); setValues.push(linesRemoved) }
      if (contextInputTokens !== null) { setClauses.push('context_input_tokens = ?'); setValues.push(contextInputTokens) }
      if (contextOutputTokens !== null) { setClauses.push('context_output_tokens = ?'); setValues.push(contextOutputTokens) }
      if (contextWindowSize !== null) { setClauses.push('context_window_size = ?'); setValues.push(contextWindowSize) }
      if (contextPct !== null) { setClauses.push('context_pct = ?'); setValues.push(contextPct) }
      if (effortLevel !== null) { setClauses.push('effort_level = ?'); setValues.push(effortLevel) }
      if (thinkingEnabled !== null) { setClauses.push('thinking_enabled = ?'); setValues.push(thinkingEnabled) }
      if (rateLimitFiveHourPct !== null) { setClauses.push('rate_limit_5h_pct = ?'); setValues.push(rateLimitFiveHourPct) }
      if (rateLimitFiveHourResetsAt !== null) { setClauses.push('rate_limit_5h_resets_at = ?'); setValues.push(rateLimitFiveHourResetsAt) }
      if (rateLimitSevenDayPct !== null) { setClauses.push('rate_limit_7d_pct = ?'); setValues.push(rateLimitSevenDayPct) }
      if (rateLimitSevenDayResetsAt !== null) { setClauses.push('rate_limit_7d_resets_at = ?'); setValues.push(rateLimitSevenDayResetsAt) }

      // Only update name if incoming session_name is non-null AND current DB name is null
      if (sessionName !== null && dbRow.name === null) {
        setClauses.push('name = ?')
        setValues.push(sessionName)
      }

      if (setClauses.length > 0) {
        setValues.push(webuiSessionId)
        db.prepare(`UPDATE sessions SET ${setClauses.join(', ')} WHERE id = ?`).run(setValues)
      }

      // Build the StatuslinePayload and broadcast to any active session
      const payload: StatuslinePayload = {
        model: modelName,
        costUsd,
        apiDurationMs,
        linesAdded,
        linesRemoved,
        contextInputTokens,
        contextOutputTokens,
        contextWindowSize,
        contextPct,
        effortLevel,
        thinkingEnabled: thinkingEnabled !== null ? thinkingEnabled === 1 : null,
        rateLimits:
          rateLimitFiveHourPct !== null ||
          rateLimitFiveHourResetsAt !== null ||
          rateLimitSevenDayPct !== null ||
          rateLimitSevenDayResetsAt !== null
            ? {
                ...(rateLimitFiveHourPct !== null || rateLimitFiveHourResetsAt !== null
                  ? { fiveHour: { pct: rateLimitFiveHourPct ?? 0, resetsAt: rateLimitFiveHourResetsAt ?? 0 } }
                  : {}),
                ...(rateLimitSevenDayPct !== null || rateLimitSevenDayResetsAt !== null
                  ? { sevenDay: { pct: rateLimitSevenDayPct ?? 0, resetsAt: rateLimitSevenDayResetsAt ?? 0 } }
                  : {}),
              }
            : null,
      }

      sessionManager.get(webuiSessionId)?.broadcastStatusline(payload)
      terminalManager.get(webuiSessionId)?.broadcastStatusline(payload)

      return reply.status(200).send({ ok: true })
    },
  )
}
