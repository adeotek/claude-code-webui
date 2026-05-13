import * as fs from 'fs'
import * as path from 'path'

// node-pty on Windows uses CreateProcessW, which does not honor PATHEXT.
// Spawning a bare name like "claude" fails with "File not found: claude"
// even though `claude.cmd` is on PATH. Resolve PATH + PATHEXT explicitly here.
// On POSIX this is a no-op — node-pty's own PATH search works fine there.
export function resolveBin(bin: string): string {
  if (process.platform !== 'win32') return bin

  const exts = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((e) => e.trim())
    .filter(Boolean)

  if (path.win32.isAbsolute(bin)) {
    if (path.win32.extname(bin) && fs.existsSync(bin)) return bin
    for (const ext of exts) {
      const candidate = bin + ext
      if (fs.existsSync(candidate)) return candidate
    }
    return bin
  }

  const dirs = (process.env.PATH ?? '').split(';').filter(Boolean)
  const hasExt = !!path.win32.extname(bin)
  for (const dir of dirs) {
    if (hasExt) {
      const candidate = path.win32.join(dir, bin)
      if (fs.existsSync(candidate)) return candidate
    } else {
      for (const ext of exts) {
        const candidate = path.win32.join(dir, bin + ext)
        if (fs.existsSync(candidate)) return candidate
      }
    }
  }
  return bin
}
