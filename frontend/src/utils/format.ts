export function formatModelName(model: string): string {
  const s = model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
  const m = s.match(/^(opus|sonnet|haiku)-(\d+)-(\d+)/)
  if (m) return `${m[1].charAt(0).toUpperCase() + m[1].slice(1)} ${m[2]}.${m[3]}`
  const m2 = s.match(/^(\d+)-(?:(\d+)-)?(\w+)$/)
  if (m2) {
    const family = m2[3].charAt(0).toUpperCase() + m2[3].slice(1)
    return m2[2] ? `${family} ${m2[1]}.${m2[2]}` : `${family} ${m2[1]}`
  }
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 30) return `${diffD} day${diffD === 1 ? '' : 's'} ago`
  const diffW = Math.floor(diffD / 7)
  if (diffD < 60) return `${diffW} week${diffW === 1 ? '' : 's'} ago`
  const diffMo = Math.floor(diffD / 30)
  return `${diffMo} month${diffMo === 1 ? '' : 's'} ago`
}

export function lastSegment(path: string): string {
  const trimmed = path.replace(/\/$/, '')
  const idx = trimmed.lastIndexOf('/')
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
}
