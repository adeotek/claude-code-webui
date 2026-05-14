import { useState, useEffect, useCallback } from 'react'
import type { AccountInfo } from './useAccount'
import type { UsageData } from './useUsage'

export interface Session {
  id: string
  workdir: string
  name: string | null
  model: string | null
  started_at: number
  ended_at: number | null
  is_active: boolean
  message_count: number
  mode: 'chat' | 'terminal'
  cost_usd: number | null
  api_duration_ms: number | null
  lines_added: number | null
  lines_removed: number | null
  context_input_tokens: number | null
  context_output_tokens: number | null
  context_window_size: number | null
  context_pct: number | null
  effort_level: string | null
  thinking_enabled: boolean | null
  rate_limit_5h_pct: number | null
  rate_limit_5h_resets_at: number | null
  rate_limit_7d_pct: number | null
  rate_limit_7d_resets_at: number | null
}

export interface DashboardData {
  account: AccountInfo | null
  usage: UsageData | null
  sessions: Session[]
  activeSessions: number
  defaultSessionMode: 'chat' | 'terminal'
  loading: boolean
  error: string | null
}

export function useDashboard(month?: string): DashboardData & { refresh: () => void } {
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [defaultSessionMode, setDefaultSessionMode] = useState<'chat' | 'terminal'>('terminal')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const target = month ?? new Date().toISOString().slice(0, 7)

  const fetchAll = useCallback(() => {
    setLoading(true)
    setError(null)

    // Fast group: account (cached), sessions, settings — unblocks the UI immediately.
    Promise.all([
      fetch('/api/account').then((r) => r.json() as Promise<AccountInfo>),
      fetch('/api/sessions').then((r) => r.json() as Promise<Session[]>),
      fetch('/api/settings').then((r) => r.json() as Promise<Record<string, string>>),
    ])
      .then(([acc, sess, settings]) => {
        setAccount(acc)
        setSessions(Array.isArray(sess) ? sess : [])
        setDefaultSessionMode(settings.session_mode === 'terminal' ? 'terminal' : 'chat')
        setLoading(false)
      })
      .catch((e: Error) => {
        setError(e.message)
        setLoading(false)
      })

    // Slow group: usage (file I/O + optional network) fills in independently.
    fetch(`/api/usage?month=${target}`)
      .then((r) => r.json() as Promise<UsageData>)
      .then(setUsage)
      .catch(() => {})
  }, [target])

  useEffect(() => {
    fetchAll()
    const timer = setInterval(fetchAll, 60_000)
    return () => clearInterval(timer)
  }, [fetchAll])

  const activeSessions = sessions.filter((s) => s.is_active).length

  return { account, usage, sessions, activeSessions, defaultSessionMode, loading, error, refresh: fetchAll }
}
