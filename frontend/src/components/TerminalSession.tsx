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

  const onOutput = useCallback((data: string) => {
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

  // Replay scrollback from the backend on reconnect (covers page refresh).
  // Clears first so history isn't duplicated on top of live content from CSS-toggle sessions.
  const onHistory = useCallback((data: string) => {
    if (!termRef.current) return
    termRef.current.clear()
    termRef.current.write(data)
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

  // Clear xterm when switching to a different session so stale output isn't shown.
  // Navigating to the sessions list and back to the SAME session skips the clear.
  useEffect(() => {
    if (!state.sessionId) return
    if (lastSessionIdRef.current !== null && lastSessionIdRef.current !== state.sessionId) {
      termRef.current?.clear()
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
