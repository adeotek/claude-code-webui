import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const existsSyncMock = vi.hoisted(() => vi.fn<(p: string) => boolean>())

vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs')>()
  return { ...original, existsSync: existsSyncMock, default: { ...original, existsSync: existsSyncMock } }
})

const { resolveBin } = await import('./resolveBin')

const originalPlatform = process.platform
const originalPath = process.env.PATH
const originalPathExt = process.env.PATHEXT

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

describe('resolveBin', () => {
  beforeEach(() => {
    existsSyncMock.mockReset()
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    process.env.PATH = originalPath
    process.env.PATHEXT = originalPathExt
  })

  it('returns input unchanged on POSIX', () => {
    setPlatform('linux')
    expect(resolveBin('claude')).toBe('claude')
    expect(resolveBin('/usr/local/bin/claude')).toBe('/usr/local/bin/claude')
    expect(existsSyncMock).not.toHaveBeenCalled()
  })

  it('on Windows, resolves a bare name to <dir>\\<name>.CMD when only .cmd exists', () => {
    setPlatform('win32')
    process.env.PATH = 'C:\\bin;C:\\other'
    process.env.PATHEXT = '.COM;.EXE;.CMD'
    existsSyncMock.mockImplementation((p) => p === 'C:\\bin\\claude.CMD')

    expect(resolveBin('claude')).toBe('C:\\bin\\claude.CMD')
  })

  it('on Windows, falls back to input when nothing matches on PATH', () => {
    setPlatform('win32')
    process.env.PATH = 'C:\\bin'
    process.env.PATHEXT = '.EXE;.CMD'
    existsSyncMock.mockReturnValue(false)

    expect(resolveBin('claude')).toBe('claude')
  })

  it('on Windows, an absolute path with an existing extension is returned as-is', () => {
    setPlatform('win32')
    existsSyncMock.mockImplementation((p) => p === 'C:\\tools\\claude.cmd')

    expect(resolveBin('C:\\tools\\claude.cmd')).toBe('C:\\tools\\claude.cmd')
  })

  it('on Windows, an absolute path without extension gets PATHEXT appended', () => {
    setPlatform('win32')
    process.env.PATHEXT = '.EXE;.CMD'
    existsSyncMock.mockImplementation((p) => p === 'C:\\tools\\claude.CMD')

    expect(resolveBin('C:\\tools\\claude')).toBe('C:\\tools\\claude.CMD')
  })
})
