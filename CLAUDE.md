# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

- **Backend**: Fastify + TypeScript (Node.js), `@fastify/websocket`, `@fastify/static`, `node-pty` for PTY process management, `better-sqlite3` for session/usage caching
- **Frontend**: Vite + React + TypeScript, Tailwind CSS (dark theme), `@xterm/xterm` (terminal drawer), `recharts` (usage chart)

In production (Docker or after `make build`), the backend serves the built frontend via `@fastify/static` — single port, no nginx. In development, Vite runs separately with its own dev server (HMR) and proxies API/WS to the backend.

## Prerequisites

- Node.js >= 20
- `claude` CLI installed and authenticated on the host

## Commands

```bash
make install          # npm install in both packages
make dev              # start backend (:9998) and frontend (:9999) concurrently
make build            # compile backend TS + build frontend Vite bundle
make lint             # tsc --noEmit in both packages
make clean            # remove dist/ directories
make run              # install deps, build, and start in production mode (via run.sh)
make service-install  # install as a systemd user service (Linux)
make service-uninstall
make service-test
```

### Running a single lint check

```bash
cd backend && npm run lint
cd frontend && npm run lint
```

## Environment

```bash
cp .env.example backend/.env
```

| Variable | Default | Description |
|---|---|---|
| `CLAUDE_BIN` | `claude` | Path to the `claude` binary |
| `PORT` | `9998` | Backend listen port |
| `HOST` | `0.0.0.0` | Backend listen address |

## Dev ports

| Service | Port |
|---|---|
| Backend (Fastify) | 9998 |
| Frontend (Vite dev server) | 9999 |

Vite proxies `/api` and `/ws` to the backend, and binds to `0.0.0.0` — reachable from LAN at `http://<host-ip>:9999` in dev, or `http://<host-ip>:9998` in production.

## Fedora / RHEL CA bundle workaround

The Makefile's `dev-backend` target and `run.sh` both conditionally set `NODE_EXTRA_CA_CERTS` to `/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem` when that file exists. This is needed on Fedora/RHEL hosts where Node.js doesn't trust the Google Trust Services CA that Anthropic's API uses. It is a no-op on macOS, Ubuntu, and Alpine.

## Architecture

### API routes

| Method | Path | Handler | Description |
|---|---|---|---|
| GET | `/api/account` | `routes/account.ts` | Account info + claude version |
| GET | `/api/usage` | `routes/usage.ts` | Usage stats (local logs) |
| GET/POST | `/api/sessions` | `routes/sessions.ts` | List sessions, create session |
| POST | `/api/sessions/:id/stop` | `routes/sessions.ts` | Stop active session |
| GET/POST | `/api/settings` | `routes/settings.ts` | Persistent key-value settings (SQLite-backed) |
| GET | `/health` | `server.ts` | Health check |
| WS | `/ws/session/:id` | `ws/session.ts` | Chat PTY I/O over WebSocket |
| WS | `/ws/terminal/:id` | `ws/terminal.ts` | Terminal PTY I/O over WebSocket |
| DELETE | `/api/sessions/:id` | `routes/sessions.ts` | Delete session (DB + `~/.claude/projects/` file) |

### Settings route

`routes/settings.ts` stores app settings in the SQLite `settings` table. Keys: `bypass_permissions` (default `true`) and `session_mode` (default `'terminal'`). Only keys in the `ALLOWED` set are accepted — add new keys there before using them.

### Session modes

Two modes are supported per session, stored in the `sessions.mode` column:
- **`chat`** — structured JSON streaming via `/ws/session/:id`; messages stored in `messages` table
- **`terminal`** — raw PTY via `/ws/terminal/:id`; scrollback persisted in `sessions.terminal_scrollback` (256 KB circular buffer, flushed to SQLite on activity with a 500 ms debounce)

### Frontend data flow

- `useHomeData.ts` fetches account + usage + sessions in parallel with a 60s auto-refresh
- `SessionContext.tsx` holds the active session state (including `mode`); `useWebSocket.ts` manages the chat WS connection; `useTerminalSession.ts` manages the terminal WS connection
- `TerminalSession.tsx` and `TerminalDrawer.tsx` are **never unmounted** — both are CSS-toggled (`display: none`) to preserve xterm scroll buffer across navigation

### Syntax highlighting

`AssistantMessage.tsx` uses `PrismLight` (not `Prism`) from `react-syntax-highlighter`. Languages must be explicitly imported and registered — the full `Prism` build was ~750 kB; `PrismLight` with selected languages is ~200 kB. When adding support for a new language, import its grammar from `react-syntax-highlighter/dist/esm/languages/prism/<name>` and call `SyntaxHighlighter.registerLanguage(alias, grammar)`.

### Frontend TypeScript config

`tsconfig.node.json` covers `vite.config.ts` and includes `"types": ["node"]` (required because `vite.config.ts` imports from the `os` module). `@types/node` must be present as a dev dependency in `frontend/`.

## Docker

```bash
docker build -t claude-code-webui .
docker-compose up
# Web UI at http://localhost:8080
```

`docker-compose.yml` mounts `~/.claude` (read-write — required for session deletion) and `~/projects` (read-write) from the host.

## Systemd service (Linux)

`scripts/install-service.sh` generates a systemd user unit from `scripts/claude-code-webui.service.template`, writes an env file to `~/.config/systemd/user/`, builds the project, and enables the service. Run with `--skip-build` to reuse existing `dist/` directories.
