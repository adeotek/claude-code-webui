import { defineConfig, createLogger } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { hostname as getHostname, networkInterfaces } from 'os'

const hostname = getHostname()
const localIps = (Object.values(networkInterfaces()).flat() as { internal: boolean; address: string }[])
  .filter(iface => iface && !iface.internal)
  .map(iface => iface.address)

// Suppress EPIPE / ECONNRESET errors from the WS proxy — these are benign
// "client disconnected while data was in flight" errors, not real failures.
const logger = createLogger()
const baseError = logger.error.bind(logger)
logger.error = (msg, opts) => {
  const code = (opts?.error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'EPIPE' || code === 'ECONNRESET') return
  baseError(msg, opts)
}

export default defineConfig({
  customLogger: logger,
  plugins: [tailwindcss(), react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('react-markdown') || id.includes('react-syntax-highlighter')) return 'vendor-markdown'
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-')) return 'vendor-charts'
          if (id.includes('@xterm')) return 'vendor-xterm'
          if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) return 'vendor-react'
        },
      },
    },
  },
  server: {
    host: true,
    port: 9999,
    allowedHosts: ['localhost', hostname, `${hostname}.lan`, ...localIps],
    proxy: {
      '/api': 'http://localhost:9998',
      '/ws': {
        target: 'ws://localhost:9998',
        ws: true,
      },
    },
  },
})
