import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Save } from 'lucide-react'
import { NavLink } from 'react-router-dom'

export default function SettingsView() {
  const [bypassPermissions, setBypassPermissions] = useState(true)
  const [sessionMode, setSessionMode] = useState<'chat' | 'terminal'>('chat')
  const [saved, setSaved] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [statuslineUnmatched, setStatuslineUnmatched] = useState<'ignore' | 'create'>('ignore')
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [dbPath, setDbPath] = useState<string | null>(null)

  useEffect(() => {
    return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current) }
  }, [])

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json() as Promise<Record<string, string>>)
      .then((data) => {
        setBypassPermissions(data.bypass_permissions !== 'false')
        setSessionMode(data.session_mode === 'terminal' ? 'terminal' : 'chat')
        setStatuslineUnmatched(data.statusline_unmatched === 'create' ? 'create' : 'ignore')
        setSettingsLoaded(true)
      })
      .catch(() => setSettingsLoaded(true))

    fetch('/api/system')
      .then((r) => r.json() as Promise<{ db_path: string }>)
      .then((data) => setDbPath(data.db_path))
      .catch(() => {})
  }, [])

  async function handleSave() {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bypass_permissions: String(bypassPermissions),
        session_mode: sessionMode,
        statusline_unmatched: statuslineUnmatched,
      }),
    }).catch(() => {})

    setSaved(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle bg-bg-surface flex-shrink-0">
        <span className="text-text-primary text-xs font-medium uppercase tracking-widest">Settings</span>
        <NavLink
          to="/"
          className="flex items-center gap-1.5 text-text-muted hover:text-text-primary text-xs transition-colors ml-auto"
        >
          <ArrowLeft size={14} />
          Back
        </NavLink>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 w-full">
      {/* Session mode toggle */}
      <div className="space-y-2">
        <label className="text-text-secondary text-xs uppercase tracking-widest block">
          Session Mode
        </label>
        <p className="text-text-muted text-xs">
          Controls the interface for new sessions. <strong className="text-text-secondary">Chat</strong> uses the structured message view. <strong className="text-text-secondary">Terminal</strong> opens a full interactive terminal connected directly to Claude Code.
        </p>
        <button
          onClick={() => setSessionMode((m) => (m === 'chat' ? 'terminal' : 'chat'))}
          disabled={!settingsLoaded}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded border transition-colors disabled:opacity-40 ${
            sessionMode === 'terminal'
              ? 'border-status-green text-status-green bg-status-green/10'
              : 'border-border-subtle text-text-muted bg-bg-elevated'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${sessionMode === 'terminal' ? 'bg-status-green' : 'bg-text-dim'}`} />
          {sessionMode === 'terminal' ? 'Session mode: terminal' : 'Session mode: chat'}
        </button>
      </div>

      {/* Bypass permissions toggle */}
      <div className="space-y-2">
        <label className="text-text-secondary text-xs uppercase tracking-widest block">
          Tool Permissions
        </label>
        <p className="text-text-muted text-xs">
          When enabled, Claude Code runs with <code className="text-text-secondary">--dangerously-skip-permissions</code> — the same trust level as running <code className="text-text-secondary">claude</code> directly in your terminal. When disabled, writes outside the workspace are sandboxed.
        </p>
        <button
          onClick={() => setBypassPermissions((v) => !v)}
          disabled={!settingsLoaded}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded border transition-colors disabled:opacity-40 ${
            bypassPermissions
              ? 'border-status-green text-status-green bg-status-green/10'
              : 'border-border-subtle text-text-muted bg-bg-elevated'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${bypassPermissions ? 'bg-status-green' : 'bg-text-dim'}`} />
          {bypassPermissions ? 'Bypass permissions: on' : 'Bypass permissions: off'}
        </button>
      </div>

      {/* Auto-track unregistered sessions toggle */}
      <div className="space-y-2">
        <label className="text-text-secondary text-xs uppercase tracking-widest block">
          Statusline: Unregistered Sessions
        </label>
        <p className="text-text-muted text-xs">
          When enabled, sessions started outside the webui (e.g. directly in a terminal) are automatically added to the session list when their statusline data arrives.
        </p>
        <button
          onClick={() => setStatuslineUnmatched((v) => (v === 'ignore' ? 'create' : 'ignore'))}
          disabled={!settingsLoaded}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded border transition-colors disabled:opacity-40 ${
            statuslineUnmatched === 'create'
              ? 'border-status-green text-status-green bg-status-green/10'
              : 'border-border-subtle text-text-muted bg-bg-elevated'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${statuslineUnmatched === 'create' ? 'bg-status-green' : 'bg-text-dim'}`} />
          {statuslineUnmatched === 'create' ? 'Auto-track: on' : 'Auto-track: off'}
        </button>
      </div>

      <button
        onClick={handleSave}
        className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-black text-sm font-medium px-4 py-2 rounded-md transition-colors"
      >
        <Save size={14} />
        {saved ? 'Saved!' : 'Save'}
      </button>

      {/* System info — read-only */}
      <div className="space-y-2 pt-4 border-t border-border-subtle">
        <label className="text-text-secondary text-xs uppercase tracking-widest block">
          Database Location
        </label>
        <p className="text-text-muted text-xs">
          Read-only. Path to the SQLite database file storing sessions, messages, settings, and caches.
        </p>
        <div className="text-text-secondary text-xs font-mono bg-bg-elevated border border-border-subtle rounded px-3 py-2 break-all select-all">
          {dbPath ?? 'Loading…'}
        </div>
      </div>
      </div>
    </div>
  )
}
