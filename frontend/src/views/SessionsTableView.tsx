import { useState, useEffect } from 'react'
import { ArrowLeft } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { formatDuration, formatCost, formatTokens } from '../utils/format'

interface TableSession {
  id: string
  workdir: string
  name: string | null
  model: string | null
  mode: string
  started_at: number
  ended_at: number | null
  claude_session_id: string | null
  is_active: number
  total_tokens: number
  working_time_ms: number
  message_count: number
  cost_usd: number | null
  api_duration_ms: number | null
  lines_added: number | null
  lines_removed: number | null
  context_input_tokens: number | null
  context_output_tokens: number | null
  context_window_size: number | null
  context_pct: number | null
  effort_level: string | null
  thinking_enabled: number | null
  rate_limit_5h_pct: number | null
  rate_limit_5h_resets_at: number | null
  rate_limit_7d_pct: number | null
  rate_limit_7d_resets_at: number | null
  last_used: number | null
}

function formatTs(ts: number | null): string {
  if (ts == null) return '—'
  return new Date(ts).toLocaleString([], {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function Cell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 text-xs whitespace-nowrap border-b border-border-subtle ${className}`}>
      {children}
    </td>
  )
}

function Null() {
  return <span className="text-text-dim">—</span>
}

export default function SessionsTableView() {
  const [sessions, setSessions] = useState<TableSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/sessions/table')
      .then((r) => r.json() as Promise<TableSession[]>)
      .then((data) => { setSessions(data); setLoading(false) })
      .catch((e: Error) => { setError(e.message); setLoading(false) })
  }, [])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle bg-bg-surface flex-shrink-0">
        <span className="text-text-primary text-xs font-medium uppercase tracking-widest">Sessions</span>
        {!loading && (
          <span className="text-text-dim text-xs">{sessions.length} rows</span>
        )}
        <NavLink
          to="/"
          className="flex items-center gap-1.5 text-text-muted hover:text-text-primary text-xs transition-colors ml-auto"
        >
          <ArrowLeft size={14} />
          Back
        </NavLink>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">Loading…</div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-status-red text-sm">{error}</div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-bg-surface z-10">
              <tr className="text-left">
                {[
                  'Status', 'ID', 'Name', 'Workdir', 'Mode', 'Model',
                  'Started', 'Last Used', 'Ended',
                  'Cost', 'API Dur', 'Lines',
                  'Ctx %', 'Ctx In', 'Ctx Out', 'Ctx Window',
                  'Effort', 'Thinking',
                  'Rate 5h %', 'Rate 5h Resets',
                  'Rate 7d %', 'Rate 7d Resets',
                  'WS Tokens', 'Working Time', 'Messages',
                  'Claude Session ID',
                ].map((h) => (
                  <th key={h} className="px-3 py-2 text-xs text-text-dim uppercase tracking-wider font-medium border-b border-border-subtle whitespace-nowrap bg-bg-surface">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="hover:bg-bg-elevated transition-colors">
                  <Cell>
                    {s.is_active ? (
                      <span className="px-1.5 py-0.5 bg-status-green/10 text-status-green border border-status-green/20 rounded text-xs">active</span>
                    ) : (
                      <span className="px-1.5 py-0.5 bg-bg-panel text-text-dim border border-border-subtle rounded text-xs">ended</span>
                    )}
                  </Cell>
                  <Cell className="text-text-dim font-mono">{s.id.slice(0, 8)}…</Cell>
                  <Cell className="text-text-primary">{s.name ?? <Null />}</Cell>
                  <Cell className="text-text-secondary max-w-[200px] truncate">{s.workdir}</Cell>
                  <Cell className="text-text-secondary">{s.mode}</Cell>
                  <Cell className="text-accent">{s.model ?? <Null />}</Cell>
                  <Cell className="text-text-secondary">{formatTs(s.started_at)}</Cell>
                  <Cell className="text-text-secondary">{formatTs(s.last_used)}</Cell>
                  <Cell className="text-text-secondary">{formatTs(s.ended_at)}</Cell>
                  <Cell className="text-text-primary">{s.cost_usd != null ? formatCost(s.cost_usd) : <Null />}</Cell>
                  <Cell className="text-text-secondary">{s.api_duration_ms != null ? formatDuration(s.api_duration_ms) : <Null />}</Cell>
                  <Cell>
                    {s.lines_added != null && s.lines_removed != null ? (
                      <span>
                        <span className="text-status-green">+{s.lines_added}</span>
                        <span className="text-text-dim">/</span>
                        <span className="text-status-red">-{s.lines_removed}</span>
                      </span>
                    ) : <Null />}
                  </Cell>
                  <Cell className={s.context_pct != null ? (s.context_pct >= 80 ? 'text-status-red' : s.context_pct >= 50 ? 'text-yellow-400' : 'text-status-green') : ''}>
                    {s.context_pct != null ? `${Math.round(s.context_pct)}%` : <Null />}
                  </Cell>
                  <Cell className="text-text-secondary">{s.context_input_tokens != null ? formatTokens(s.context_input_tokens) : <Null />}</Cell>
                  <Cell className="text-text-secondary">{s.context_output_tokens != null ? formatTokens(s.context_output_tokens) : <Null />}</Cell>
                  <Cell className="text-text-secondary">{s.context_window_size != null ? formatTokens(s.context_window_size) : <Null />}</Cell>
                  <Cell className="text-text-secondary">{s.effort_level ?? <Null />}</Cell>
                  <Cell className="text-text-secondary">
                    {s.thinking_enabled != null ? (s.thinking_enabled ? 'on' : 'off') : <Null />}
                  </Cell>
                  <Cell className={s.rate_limit_5h_pct != null ? (s.rate_limit_5h_pct >= 80 ? 'text-status-red' : s.rate_limit_5h_pct >= 50 ? 'text-yellow-400' : 'text-status-green') : ''}>
                    {s.rate_limit_5h_pct != null ? `${s.rate_limit_5h_pct}%` : <Null />}
                  </Cell>
                  <Cell className="text-text-secondary">{formatTs(s.rate_limit_5h_resets_at)}</Cell>
                  <Cell className={s.rate_limit_7d_pct != null ? (s.rate_limit_7d_pct >= 80 ? 'text-status-red' : s.rate_limit_7d_pct >= 50 ? 'text-yellow-400' : 'text-status-green') : ''}>
                    {s.rate_limit_7d_pct != null ? `${s.rate_limit_7d_pct}%` : <Null />}
                  </Cell>
                  <Cell className="text-text-secondary">{formatTs(s.rate_limit_7d_resets_at)}</Cell>
                  <Cell className="text-text-secondary">{s.total_tokens > 0 ? formatTokens(s.total_tokens) : <Null />}</Cell>
                  <Cell className="text-text-secondary">{s.working_time_ms > 0 ? formatDuration(s.working_time_ms) : <Null />}</Cell>
                  <Cell className="text-text-secondary">{s.message_count}</Cell>
                  <Cell className="text-text-dim font-mono">{s.claude_session_id ? `${s.claude_session_id.slice(0, 8)}…` : <Null />}</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
