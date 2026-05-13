import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'

const tmpDir = vi.hoisted(() => {
  // Use require to avoid hoisting issues with ES module imports
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync } = require('fs') as typeof import('fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require('os') as typeof import('os')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join: pathJoin } = require('path') as typeof import('path')
  return mkdtempSync(pathJoin(tmpdir(), 'ccw-test-'))
})

vi.mock('os', async (importOriginal) => {
  const original = await importOriginal<typeof import('os')>()
  return {
    ...original,
    default: { ...original, homedir: () => tmpDir },
    homedir: () => tmpDir,
  }
})

let parseLocalUsage: (month: string) => import('./localLogs').DayUsage[]

beforeAll(async () => {
  ;({ parseLocalUsage } = await import('./localLogs'))
})

afterAll(() => {
  try { rmSync(tmpDir, { recursive: true }) } catch { /* ignore */ }
})

const PROJECTS_DIR = join(tmpDir, '.claude', 'projects')

function makeProjectDir(name: string): string {
  const dir = join(PROJECTS_DIR, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeJsonl(dir: string, filename: string, lines: object[]): void {
  writeFileSync(join(dir, filename), lines.map(l => JSON.stringify(l)).join('\n') + '\n')
}

describe('parseLocalUsage', () => {
  it('returns empty array when projects directory does not exist', () => {
    const result = parseLocalUsage('2024-01')
    expect(result).toEqual([])
  })

  it('returns empty array when projects directory is empty', () => {
    mkdirSync(PROJECTS_DIR, { recursive: true })
    const result = parseLocalUsage('2024-01')
    expect(result).toEqual([])
  })

  it('aggregates token usage by date for matching month', () => {
    const dir = makeProjectDir('proj-a')
    writeJsonl(dir, 'session1.jsonl', [
      {
        type: 'assistant',
        timestamp: '2024-03-15T10:00:00.000Z',
        costUSD: 0.01,
        message: { usage: { input_tokens: 100, output_tokens: 50 } },
      },
      {
        type: 'assistant',
        timestamp: '2024-03-15T11:00:00.000Z',
        costUSD: 0.02,
        message: { usage: { input_tokens: 200, output_tokens: 100 } },
      },
    ])

    const result = parseLocalUsage('2024-03')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      date: '2024-03-15',
      inputTokens: 300,
      outputTokens: 150,
      costUsd: expect.closeTo(0.03, 5),
    })
  })

  it('filters out entries not matching the requested month', () => {
    const dir = makeProjectDir('proj-b')
    writeJsonl(dir, 'session2.jsonl', [
      {
        type: 'assistant',
        timestamp: '2024-04-01T10:00:00.000Z',
        costUSD: 0.05,
        message: { usage: { input_tokens: 500, output_tokens: 250 } },
      },
    ])

    const result = parseLocalUsage('2024-03')
    const april = result.find(r => r.date.startsWith('2024-04'))
    expect(april).toBeUndefined()
  })

  it('skips non-assistant type entries', () => {
    const dir = makeProjectDir('proj-c')
    writeJsonl(dir, 'session3.jsonl', [
      {
        type: 'user',
        timestamp: '2024-05-01T10:00:00.000Z',
        message: { usage: { input_tokens: 999, output_tokens: 999 } },
      },
      {
        type: 'tool_use',
        timestamp: '2024-05-01T10:00:00.000Z',
        message: { usage: { input_tokens: 888, output_tokens: 888 } },
      },
      {
        type: 'assistant',
        timestamp: '2024-05-01T10:00:00.000Z',
        costUSD: 0.01,
        message: { usage: { input_tokens: 10, output_tokens: 5 } },
      },
    ])

    const result = parseLocalUsage('2024-05')
    expect(result).toHaveLength(1)
    expect(result[0].inputTokens).toBe(10)
    expect(result[0].outputTokens).toBe(5)
  })

  it('skips malformed/non-JSON lines gracefully', () => {
    const dir = makeProjectDir('proj-d')
    const content = [
      'not json at all',
      '{broken json',
      JSON.stringify({
        type: 'assistant',
        timestamp: '2024-06-01T10:00:00.000Z',
        costUSD: 0.01,
        message: { usage: { input_tokens: 42, output_tokens: 21 } },
      }),
      '',
    ].join('\n')
    writeFileSync(join(dir, 'session4.jsonl'), content)

    const result = parseLocalUsage('2024-06')
    expect(result).toHaveLength(1)
    expect(result[0].inputTokens).toBe(42)
  })

  it('adds cache_read_input_tokens to inputTokens', () => {
    const dir = makeProjectDir('proj-e')
    writeJsonl(dir, 'session5.jsonl', [
      {
        type: 'assistant',
        timestamp: '2024-07-01T10:00:00.000Z',
        costUSD: 0.01,
        message: {
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 200,
          },
        },
      },
    ])

    const result = parseLocalUsage('2024-07')
    expect(result).toHaveLength(1)
    expect(result[0].inputTokens).toBe(300)
    expect(result[0].outputTokens).toBe(50)
  })

  it('aggregates multiple entries across different dates and sorts by date', () => {
    const dir = makeProjectDir('proj-f')
    writeJsonl(dir, 'session6.jsonl', [
      {
        type: 'assistant',
        timestamp: '2024-08-03T10:00:00.000Z',
        costUSD: 0.01,
        message: { usage: { input_tokens: 10, output_tokens: 5 } },
      },
      {
        type: 'assistant',
        timestamp: '2024-08-01T10:00:00.000Z',
        costUSD: 0.02,
        message: { usage: { input_tokens: 20, output_tokens: 10 } },
      },
      {
        type: 'assistant',
        timestamp: '2024-08-03T11:00:00.000Z',
        costUSD: 0.01,
        message: { usage: { input_tokens: 30, output_tokens: 15 } },
      },
    ])

    const result = parseLocalUsage('2024-08')
    const dates = result.map(r => r.date)
    expect(dates).toEqual([...dates].sort())
    const aug03 = result.find(r => r.date === '2024-08-03')
    expect(aug03?.inputTokens).toBe(40)
    expect(aug03?.outputTokens).toBe(20)
  })

  it('skips entries with missing usage field', () => {
    const dir = makeProjectDir('proj-g')
    writeJsonl(dir, 'session7.jsonl', [
      {
        type: 'assistant',
        timestamp: '2024-09-01T10:00:00.000Z',
        costUSD: 0.01,
        message: {},
      },
    ])

    const result = parseLocalUsage('2024-09')
    expect(result).toHaveLength(0)
  })
})
