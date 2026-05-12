import { ShieldAlert } from 'lucide-react'
import type { PermissionRequest } from '../context/SessionContext'

interface Props {
  permissions: PermissionRequest[]
  onAllow: (tools: string[]) => void
  onDismiss: () => void
}

export default function PermissionDialog({ permissions, onAllow, onDismiss }: Props) {
  const tools = permissions.map((p) => p.tool)

  return (
    <div className="absolute inset-0 z-50 flex items-end justify-center pb-24 px-4 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-md bg-bg-elevated border border-amber-500/40 rounded-lg shadow-xl p-4">
        <div className="flex items-start gap-3 mb-3">
          <ShieldAlert size={18} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-text-base">Permission required</p>
            <p className="text-xs text-text-dim mt-0.5">
              Claude needs to use the following tool{permissions.length > 1 ? 's' : ''}:
            </p>
          </div>
        </div>

        <ul className="mb-4 space-y-1.5">
          {permissions.map((p) => (
            <li key={p.tool} className="flex flex-col gap-0.5 bg-bg-base rounded px-3 py-2">
              <span className="text-xs font-semibold text-amber-400">{p.tool}</span>
              {p.summary && (
                <span className="text-xs text-text-dim font-mono truncate">{p.summary}</span>
              )}
            </li>
          ))}
        </ul>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onDismiss}
            className="px-3 py-1.5 text-xs text-text-dim hover:text-text-base transition-colors"
          >
            Dismiss
          </button>
          <button
            onClick={() => onAllow(tools)}
            className="px-3 py-1.5 text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded transition-colors"
          >
            Allow and retry
          </button>
        </div>
      </div>
    </div>
  )
}
