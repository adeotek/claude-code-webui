import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useSession } from '../context/SessionContext'
import { useTerminalSession } from '../hooks/useTerminalSession'

export default function TerminalSession() {
  const { state } = useSession()
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const lastSessionIdRef = useRef<string | null>(null)

  // Output arriving while history is being replayed is buffered here and flushed
  // after the replay write completes, preserving correct ordering.
  const pendingOutputRef = useRef<string[]>([])
  const replayingRef = useRef(false)

  const onOutput = useCallback((data: string) => {
    if (replayingRef.current) {
      pendingOutputRef.current.push(data)
      return
    }
    termRef.current?.write(data)
  }, [])

  // Stable ref so onConnect can call send without a declaration-order cycle.
  const sendRef = useRef<(payload: object) => void>(() => {})

  // Called when WS opens. fit.fit() measures the container; we always send the resulting
  // dimensions explicitly because xterm only fires onResize when size *changes* — on
  // reconnect the terminal is already the right size and onResize would be skipped.
  const onConnect = useCallback(() => {
    requestAnimationFrame(() => {
      if (!fitRef.current || !termRef.current) return
      fitRef.current.fit()
      sendRef.current({ type: 'resize', cols: termRef.current.cols, rows: termRef.current.rows })
    })
  }, [])

  // Replay scrollback from the backend on reconnect.
  // write() is async (goes through xterm's write queue via setTimeout). reset() is
  // synchronous — it resets parser state but does NOT flush or clear the pending write
  // queue. Any onOutput writes already queued would therefore be processed BEFORE the
  // history write, producing partial/garbled display.
  // Fix: write('', callback) to drain the queue first, then reset + write history.
  // Output that arrives from the new connection during this async wait is buffered and
  // flushed after the history write completes.
  const onHistory = useCallback((data: string) => {
    const term = termRef.current
    if (!term) return
    replayingRef.current = true
    pendingOutputRef.current = []
    term.write('', () => {
      term.reset()
      term.write(data, () => {
        replayingRef.current = false
        const pending = pendingOutputRef.current
        pendingOutputRef.current = []
        for (const chunk of pending) term.write(chunk)
      })
    })
  }, [])

  const { send } = useTerminalSession(onOutput, onConnect, onHistory)
  sendRef.current = send

  useEffect(() => {
    const term = new Terminal({
      theme: {
        background: '#050505',
        foreground: '#e2e2e2',
        cursor: '#d97706',
        selectionBackground: '#d9770640',
      },
      fontFamily: 'JetBrains Mono, Fira Code, monospace',
      fontSize: 12,
      lineHeight: 1.4,
      cursorBlink: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    termRef.current = term
    fitRef.current = fit

    if (containerRef.current) {
      term.open(containerRef.current)
      requestAnimationFrame(() => fit.fit())
      term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }))
      term.onData((data) => send({ type: 'input', data }))
    }

    return () => term.dispose()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset xterm when switching to a different session so stale VT state isn't carried over.
  // Navigating to the sessions list and back to the SAME session skips the reset.
  useEffect(() => {
    if (!state.sessionId) return
    if (lastSessionIdRef.current !== null && lastSessionIdRef.current !== state.sessionId) {
      termRef.current?.reset()
    }
    lastSessionIdRef.current = state.sessionId
  }, [state.sessionId])

  // Re-fit terminal when container dimensions change (window resize, panel resize).
  // Guard against zero-size: when the terminal block is CSS-hidden its dimensions
  // report as 0, and fit.fit() would corrupt the PTY size.
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        const el = containerRef.current
        if (el && el.offsetWidth > 0 && el.offsetHeight > 0) fitRef.current?.fit()
      })
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="flex-1 overflow-hidden bg-[#050505]">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  )
}
