import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import NewSessionModal from '../components/NewSessionModal'
import type { AccountInfo } from '../hooks/useAccount'

export default function NewSessionView() {
  const { dispatch } = useSession()
  const navigate = useNavigate()
  const [account, setAccount] = useState<AccountInfo | null>(null)

  useEffect(() => {
    fetch('/api/account')
      .then((r) => (r.ok ? (r.json() as Promise<AccountInfo>) : null))
      .then((data) => { if (data) setAccount(data) })
      .catch(() => {})
  }, [])

  function handleStart(sessionId: string, workdir: string, name: string | null, mode: 'chat' | 'terminal') {
    dispatch({ type: 'SESSION_CREATED', sessionId, workdir, mode, ...(name ? { name } : {}) })
    if (account?.model) dispatch({ type: 'MODEL_SET', model: account.model })
    navigate(`/session/${sessionId}`, { replace: true })
  }

  return (
    <NewSessionModal
      onStart={handleStart}
      onCancel={() => navigate(-1)}
    />
  )
}
