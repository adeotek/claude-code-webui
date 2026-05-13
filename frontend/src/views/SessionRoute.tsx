import { useEffect, useState } from 'react'
import { useParams, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import DashboardView from './DashboardView'
import type { Session } from '../hooks/useDashboard'

export default function SessionRoute() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { state, dispatch } = useSession()
  const location = useLocation()
  const navigate = useNavigate()
  // Skip loading state if the session is already in context (e.g. right after SESSION_CREATED).
  const [loading, setLoading] = useState(state.sessionId !== sessionId)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!sessionId) return

    // Already in context — nothing to fetch.
    if (state.sessionId === sessionId) {
      setLoading(false)
      return
    }

    // Fast path: session row passed via Link state (Reconnect button in SessionList).
    const linked = location.state?.session as Session | undefined
    if (linked?.id === sessionId) {
      dispatch({ type: 'RESUME_SESSION', id: linked.id, workdir: linked.workdir, mode: linked.mode, ...(linked.name ? { name: linked.name } : {}) })
      fetchAndSetModel()
      setLoading(false)
      return
    }

    // Slow path: new tab or direct URL — fetch session + account from API.
    Promise.all([
      fetch(`/api/sessions/${sessionId}`).then((r) => (r.ok ? r.json() as Promise<Session> : Promise.reject())),
      fetch('/api/account').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([session, account]) => {
        dispatch({ type: 'RESUME_SESSION', id: session.id, workdir: session.workdir, mode: session.mode, ...(session.name ? { name: session.name } : {}) })
        if (account?.model) dispatch({ type: 'MODEL_SET', model: account.model })
        setLoading(false)
      })
      .catch(() => setError(true))
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep URL and context in sync: clear session state whenever this route unmounts.
  // This handles browser Back/Forward navigation, which bypasses the explicit navigate()
  // calls in the session handlers and would otherwise leave a stale sessionId in context,
  // causing DashboardView at "/" to render the session view instead of the session list.
  useEffect(() => {
    return () => { dispatch({ type: 'SESSION_CLEARED' }) }
  }, [dispatch])

  // Safety net: if session is cleared while mounted (e.g. an explicit navigate call already
  // fired — this effect just cleans up any edge case where it didn't).
  useEffect(() => {
    if (!loading && !state.sessionId) navigate('/', { replace: true })
  }, [loading, state.sessionId, navigate])

  function fetchAndSetModel() {
    fetch('/api/account')
      .then((r) => (r.ok ? r.json() : null))
      .then((account: { model?: string } | null) => { if (account?.model) dispatch({ type: 'MODEL_SET', model: account.model }) })
      .catch(() => {})
  }

  if (error) return <Navigate to="/" replace />

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-dim text-sm">
        Loading session…
      </div>
    )
  }

  return <DashboardView />
}
