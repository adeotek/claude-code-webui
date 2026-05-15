import { spawnSync } from 'child_process'
import * as path from 'path'
import * as os from 'os'

export function getGitBranch(workdir: string): string | null {
  const resolvedCwd = workdir.startsWith('~')
    ? path.join(os.homedir(), workdir.slice(1))
    : workdir
  try {
    const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: resolvedCwd,
      encoding: 'utf8',
      timeout: 2000,
    })
    if (result.status === 0) {
      const branch = result.stdout.trim()
      // 'HEAD' means detached HEAD state — not a named branch
      return branch && branch !== 'HEAD' ? branch : null
    }
  } catch {
    // workdir doesn't exist, git not installed, etc.
  }
  return null
}
