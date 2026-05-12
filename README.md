# Claude Code Web UI

[![CI](https://github.com/adeotek/claude-code-webui/actions/workflows/claude-code-webui-ci.yml/badge.svg)](https://github.com/adeotek/claude-code-webui/actions/workflows/claude-code-webui-ci.yml)
[![Docker](https://img.shields.io/badge/docker-ghcr.io-blue)](https://github.com/adeotek/claude-code-webui/pkgs/container/claude-code-webui)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

A browser-based UI for [Claude Code](https://claude.ai/code) — manage sessions, track token usage, and chat with Claude from any device on your network.

## Features

- **Session management** — create, resume, rename, and delete Claude Code sessions
- **Real-time chat** — markdown rendering with syntax-highlighted code blocks
- **Terminal drawer** — integrated xterm.js terminal that persists across view switches
- **Usage dashboard** — daily token usage graph with optional Anthropic billing data
- **Account overview** — Claude version, authentication status, and model info
- **Persistent history** — session messages and token counts stored in SQLite

## Quick Start

### Linux / macOS

Requires Node.js ≥ 20 and the `claude` CLI [installed and authenticated](https://claude.ai/code).

```bash
git clone https://github.com/adeotek/claude-code-webui.git
cd claude-code-webui
./run.sh
```

Open **http://localhost:9998**.

`run.sh` creates `backend/.env` from `.env.example` on first run, installs dependencies, builds both packages, and starts the server.

### Windows (PowerShell 7+)

Requires Node.js ≥ 20 and the `claude` CLI [installed and authenticated](https://claude.ai/code).

```powershell
git clone https://github.com/adeotek/claude-code-webui.git
cd claude-code-webui
.\run.ps1
```

Open **http://localhost:9998**.

### Docker (all platforms)

Requires Docker and the `claude` CLI installed and authenticated on the host.

```bash
git clone https://github.com/adeotek/claude-code-webui.git
cd claude-code-webui
docker-compose up
```

Open **http://localhost:8080**.

`docker-compose.yml` mounts `~/.claude` (read-only) and `~/projects` (read-write) from the host. To build the image locally instead of pulling from the registry:

```bash
docker build -t claude-code-webui .
docker-compose up
```

## Configuration

Copy `.env.example` to `backend/.env` and edit as needed:

```bash
cp .env.example backend/.env
```

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Optional — enables billing data in the Usage view |
| `CLAUDE_BIN` | `claude` | Path to the `claude` binary |
| `PORT` | `9998` | Backend listen port |
| `HOST` | `0.0.0.0` | Backend listen address |
| `FRONTEND_ORIGIN` | `http://localhost:9999` | Allowed CORS origin (dev only) |

## Development

```bash
cp .env.example backend/.env
make install    # npm install in both packages
make dev        # backend :9998 + frontend :9999 with HMR
```

The Vite dev server binds to `0.0.0.0`, so it's reachable from the LAN at `http://<host-ip>:9999`.

## Systemd service (Linux)

Installs the UI as a persistent user-level service that starts automatically at boot:

```bash
make service-install
# Skip the build step if already built:
make service-install ARGS=--skip-build
```

```bash
make service-uninstall
systemctl --user status claude-code-dashboard
journalctl --user -u claude-code-dashboard -f
```

## Commands reference

| Command | Description |
|---|---|
| `make dev` | Start backend + frontend dev servers concurrently |
| `make build` | Compile backend TS + Vite production bundle |
| `make install` | `npm install` in both packages |
| `make lint` | `tsc --noEmit` in both packages |
| `make clean` | Remove `dist/` directories |
| `make run` | Production build + start (wraps `run.sh`) |
| `make service-install` | Install as systemd user service |
| `make service-uninstall` | Stop, disable, and remove the service |
| `make service-test` | Run service install test suite |

## Contributing

Bug reports and pull requests are welcome. Please open an issue first for significant changes so the approach can be discussed before implementation. Run `make lint` before submitting a PR — the CI pipeline will reject builds with type errors.

## License

[MIT](LICENSE)
