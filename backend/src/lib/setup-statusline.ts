import fs from 'fs'
import os from 'os'
import path from 'path'

const SCRIPT_SRC = path.join(__dirname, '../../../scripts/webui-statusline.sh')
const SCRIPT_DST = path.join(os.homedir(), '.claude', 'webui-statusline.sh')
const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')
const WEBUI_CMD_PREFIX = 'bash ~/.claude/webui-statusline.sh'

export function setupStatusline(port: number): void {
  // 1. Copy the script to ~/.claude/ substituting __PORT__ with the actual port
  try {
    const src = fs.readFileSync(SCRIPT_SRC, 'utf8')
    const dst = src.replace('__PORT__', String(port))
    fs.writeFileSync(SCRIPT_DST, dst)
    fs.chmodSync(SCRIPT_DST, 0o755)
  } catch (err) {
    console.error('[statusline] failed to copy webui-statusline.sh:', (err as Error).message)
    return
  }

  // 2. Read ~/.claude/settings.json (create empty object if missing or malformed)
  let settings: Record<string, unknown> = {}
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) as Record<string, unknown>
  } catch {
    // file absent or unparseable — start from scratch
  }

  // 3. Check if already configured — idempotent on every restart
  const statusLine = settings.statusLine as { type?: string; command?: string } | undefined
  const existing = statusLine?.command ?? ''
  if (existing.includes('webui-statusline.sh')) return

  // 4. Configure statusLine — only handle 'command' type; skip unknown types to avoid clobbering them
  if (!statusLine) {
    // No statusline configured: install ours as a silent sink
    settings.statusLine = { type: 'command', command: `${WEBUI_CMD_PREFIX} --no-pipe` }
  } else if (statusLine.type !== 'command' || !existing) {
    if (statusLine.type && statusLine.type !== 'command') {
      console.warn(`[statusline] existing statusLine type '${statusLine.type}' is not 'command' — skipping auto-configure`)
      return
    }
    // type is 'command' but command is empty/absent: replace with ours
    settings.statusLine = { type: 'command', command: `${WEBUI_CMD_PREFIX} --no-pipe` }
  } else {
    // Existing 'command' statusline: prepend ours as a pipe
    settings.statusLine = { ...statusLine, command: `${WEBUI_CMD_PREFIX} | ${existing}` }
  }

  // 5. Write back atomically
  const tmp = SETTINGS_PATH + '.tmp'
  try {
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n')
    fs.renameSync(tmp, SETTINGS_PATH)
  } catch (err) {
    console.error('[statusline] failed to write settings.json:', (err as Error).message)
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
}
