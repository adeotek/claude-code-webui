import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useTerminalSession } from '../hooks/useTerminalSession'

export default function TerminalSession() {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

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

  const { send } = useTerminalSession(onOutput, onConnect)
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

  // Re-fit terminal when container dimensions change (window resize, panel resize)
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => fitRef.current?.fit())
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
