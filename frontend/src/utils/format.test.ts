import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  formatTokens,
  formatDuration,
  formatModelName,
  formatRelativeTime,
  lastSegment,
} from './format'

describe('formatTokens', () => {
  it('returns "0" for 0', () => {
    expect(formatTokens(0)).toBe('0')
  })

  it('returns "500" for 500', () => {
    expect(formatTokens(500)).toBe('500')
  })

  it('returns "1K" for 1000', () => {
    expect(formatTokens(1000)).toBe('1K')
  })

  it('returns "2K" for 1500 (rounds)', () => {
    expect(formatTokens(1500)).toBe('2K')
  })

  it('returns "1.5M" for 1_500_000', () => {
    expect(formatTokens(1_500_000)).toBe('1.5M')
  })
})

describe('formatDuration', () => {
  it('returns "0s" for 0ms', () => {
    expect(formatDuration(0)).toBe('0s')
  })

  it('returns "5s" for 5000ms', () => {
    expect(formatDuration(5000)).toBe('5s')
  })

  it('returns "1m 5s" for 65_000ms', () => {
    expect(formatDuration(65_000)).toBe('1m 5s')
  })

  it('returns "1h 1m 1s" for 3_661_000ms', () => {
    expect(formatDuration(3_661_000)).toBe('1h 1m 1s')
  })
})

describe('formatModelName', () => {
  it('formats claude-opus-4-7-20251001 as "Opus 4.7"', () => {
    expect(formatModelName('claude-opus-4-7-20251001')).toBe('Opus 4.7')
  })

  it('formats claude-sonnet-4-6 as "Sonnet 4.6"', () => {
    expect(formatModelName('claude-sonnet-4-6')).toBe('Sonnet 4.6')
  })

  it('formats claude-haiku-4-5 as "Haiku 4.5"', () => {
    expect(formatModelName('claude-haiku-4-5')).toBe('Haiku 4.5')
  })

  it('uppercases first char for unknown format', () => {
    const result = formatModelName('unknown-model')
    expect(result.charAt(0)).toBe(result.charAt(0).toUpperCase())
  })
})

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "just now" for 30s ago', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    expect(formatRelativeTime(now - 30_000)).toBe('just now')
  })

  it('returns "1m ago" for 90s ago', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    expect(formatRelativeTime(now - 90_000)).toBe('1m ago')
  })

  it('returns "2h ago" for 7_200_000ms ago', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    expect(formatRelativeTime(now - 7_200_000)).toBe('2h ago')
  })

  it('returns "2 days ago" for 2 days ago', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    expect(formatRelativeTime(now - 2 * 24 * 60 * 60 * 1000)).toBe('2 days ago')
  })

  it('returns "1 day ago" for exactly 1 day ago', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    expect(formatRelativeTime(now - 24 * 60 * 60 * 1000)).toBe('1 day ago')
  })
})

describe('lastSegment', () => {
  it('returns "project" for "/home/user/project"', () => {
    expect(lastSegment('/home/user/project')).toBe('project')
  })

  it('returns "dir" for "/path/to/dir/"', () => {
    expect(lastSegment('/path/to/dir/')).toBe('dir')
  })

  it('returns "app" for "~/work/app"', () => {
    expect(lastSegment('~/work/app')).toBe('app')
  })

  it('returns "single" for "/single"', () => {
    expect(lastSegment('/single')).toBe('single')
  })
})
