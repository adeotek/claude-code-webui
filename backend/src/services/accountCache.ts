import { getAccountInfo } from './claudeAccount'
import type { AccountInfo } from './claudeAccount'

const REFRESH_MS = 60_000

let cached: AccountInfo | null = null

export async function initAccountCache(): Promise<void> {
  cached = await getAccountInfo()
  setInterval(async () => {
    cached = await getAccountInfo()
  }, REFRESH_MS).unref()
}

export function getCachedAccount(): AccountInfo | null {
  return cached
}
