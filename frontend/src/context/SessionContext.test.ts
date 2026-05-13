import { describe, it, expect } from 'vitest'
import { reducer, initial } from './SessionContext'
import type { SessionState } from './SessionContext'

const makeMessage = (id = '1') => ({
  id,
  role: 'user' as const,
  content: 'hello',
  createdAt: Date.now(),
})

describe('SessionContext reducer', () => {
  describe('SESSION_CREATED', () => {
    it('sets sessionId, mode, clears messages, sets wsState=connecting, resets workingTimeMs', () => {
      const state = reducer(initial, {
        type: 'SESSION_CREATED',
        sessionId: 'abc-123',
        workdir: '/tmp/proj',
        mode: 'chat',
      })
      expect(state.sessionId).toBe('abc-123')
      expect(state.workdir).toBe('/tmp/proj')
      expect(state.mode).toBe('chat')
      expect(state.messages).toEqual([])
      expect(state.wsState).toBe('connecting')
      expect(state.workingTimeMs).toBe(0)
      expect(state.runningStartedAt).toBeNull()
    })

    it('sets mode to terminal when specified', () => {
      const state = reducer(initial, {
        type: 'SESSION_CREATED',
        sessionId: 'xyz',
        workdir: '/tmp',
        mode: 'terminal',
      })
      expect(state.mode).toBe('terminal')
    })

    it('sets name when provided', () => {
      const state = reducer(initial, {
        type: 'SESSION_CREATED',
        sessionId: 'abc',
        workdir: '/tmp',
        mode: 'chat',
        name: 'My Session',
      })
      expect(state.name).toBe('My Session')
    })

    it('sets name to null when not provided', () => {
      const state = reducer(initial, {
        type: 'SESSION_CREATED',
        sessionId: 'abc',
        workdir: '/tmp',
        mode: 'chat',
      })
      expect(state.name).toBeNull()
    })
  })

  describe('SESSION_CLEARED', () => {
    it('returns the exact initial state', () => {
      const dirty: SessionState = {
        ...initial,
        sessionId: 'some-id',
        messages: [makeMessage()],
        totalTokens: 500,
      }
      const state = reducer(dirty, { type: 'SESSION_CLEARED' })
      expect(state).toEqual(initial)
    })
  })

  describe('RESUME_SESSION', () => {
    it('sets id, mode, resets totalTokens to 0, clears messages', () => {
      const dirty: SessionState = {
        ...initial,
        sessionId: 'old-id',
        messages: [makeMessage()],
        totalTokens: 999,
      }
      const state = reducer(dirty, {
        type: 'RESUME_SESSION',
        id: 'new-id',
        workdir: '/tmp/new',
        mode: 'terminal',
      })
      expect(state.sessionId).toBe('new-id')
      expect(state.workdir).toBe('/tmp/new')
      expect(state.mode).toBe('terminal')
      expect(state.totalTokens).toBe(0)
      expect(state.messages).toEqual([])
      expect(state.wsState).toBe('connecting')
    })
  })

  describe('WS_STATE', () => {
    it('idle → running: sets runningStartedAt to timestamp', () => {
      const ts = 1_000_000
      const state = reducer(
        { ...initial, wsState: 'idle' },
        { type: 'WS_STATE', state: 'running', timestamp: ts },
      )
      expect(state.wsState).toBe('running')
      expect(state.runningStartedAt).toBe(ts)
    })

    it('running → idle: accumulates workingTimeMs and clears runningStartedAt', () => {
      const startTs = 1_000_000
      const endTs = 1_005_000
      const intermediate: SessionState = {
        ...initial,
        wsState: 'running',
        runningStartedAt: startTs,
        workingTimeMs: 2000,
      }
      const state = reducer(intermediate, {
        type: 'WS_STATE',
        state: 'idle',
        timestamp: endTs,
      })
      expect(state.wsState).toBe('idle')
      expect(state.workingTimeMs).toBe(7000) // 2000 + (5000ms elapsed)
      expect(state.runningStartedAt).toBeNull()
    })

    it('running → running: no change to timing (stays running)', () => {
      const startTs = 1_000_000
      const intermediate: SessionState = {
        ...initial,
        wsState: 'running',
        runningStartedAt: startTs,
        workingTimeMs: 1000,
      }
      const state = reducer(intermediate, {
        type: 'WS_STATE',
        state: 'running',
        timestamp: 1_003_000,
      })
      expect(state.wsState).toBe('running')
      // runningStartedAt should not change since prev was already running
      expect(state.runningStartedAt).toBe(startTs)
      expect(state.workingTimeMs).toBe(1000)
    })
  })

  describe('TOKENS_ADDED', () => {
    it('adds inputTokens + outputTokens to totalTokens', () => {
      const state = reducer(
        { ...initial, totalTokens: 100 },
        { type: 'TOKENS_ADDED', inputTokens: 50, outputTokens: 30 },
      )
      expect(state.totalTokens).toBe(180)
    })

    it('handles starting from 0', () => {
      const state = reducer(initial, {
        type: 'TOKENS_ADDED',
        inputTokens: 200,
        outputTokens: 100,
      })
      expect(state.totalTokens).toBe(300)
    })
  })

  describe('MESSAGE_ADDED', () => {
    it('appends message to messages array', () => {
      const msg = makeMessage('1')
      const state = reducer(initial, { type: 'MESSAGE_ADDED', message: msg })
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0]).toBe(msg)
    })

    it('preserves existing messages', () => {
      const msg1 = makeMessage('1')
      const msg2 = makeMessage('2')
      const withOne: SessionState = { ...initial, messages: [msg1] }
      const state = reducer(withOne, { type: 'MESSAGE_ADDED', message: msg2 })
      expect(state.messages).toHaveLength(2)
      expect(state.messages[0]).toBe(msg1)
      expect(state.messages[1]).toBe(msg2)
    })
  })

  describe('HISTORY_LOADED', () => {
    it('prepends history messages before current messages', () => {
      const existing = makeMessage('existing')
      const history1 = makeMessage('h1')
      const history2 = makeMessage('h2')
      const withExisting: SessionState = { ...initial, messages: [existing] }
      const state = reducer(withExisting, {
        type: 'HISTORY_LOADED',
        messages: [history1, history2],
      })
      expect(state.messages).toHaveLength(3)
      expect(state.messages[0]).toBe(history1)
      expect(state.messages[1]).toBe(history2)
      expect(state.messages[2]).toBe(existing)
    })
  })

  describe('MODEL_SET', () => {
    it('updates the model field', () => {
      const state = reducer(initial, { type: 'MODEL_SET', model: 'claude-sonnet-4-6' })
      expect(state.model).toBe('claude-sonnet-4-6')
    })
  })

  describe('SESSION_RENAMED', () => {
    it('updates the name field', () => {
      const state = reducer(initial, { type: 'SESSION_RENAMED', name: 'New Name' })
      expect(state.name).toBe('New Name')
    })

    it('sets name to null when null is passed', () => {
      const withName: SessionState = { ...initial, name: 'Old Name' }
      const state = reducer(withName, { type: 'SESSION_RENAMED', name: null })
      expect(state.name).toBeNull()
    })
  })

  describe('PERMISSION_REQUEST', () => {
    it('sets pendingPermissions', () => {
      const permissions = [{ tool: 'bash', summary: 'Run a command' }]
      const state = reducer(initial, { type: 'PERMISSION_REQUEST', permissions })
      expect(state.pendingPermissions).toEqual(permissions)
    })
  })

  describe('PERMISSION_CLEARED', () => {
    it('sets pendingPermissions to null', () => {
      const withPending: SessionState = {
        ...initial,
        pendingPermissions: [{ tool: 'bash', summary: 'test' }],
      }
      const state = reducer(withPending, { type: 'PERMISSION_CLEARED' })
      expect(state.pendingPermissions).toBeNull()
    })
  })
})
