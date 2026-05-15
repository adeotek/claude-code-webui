# Claude Code Web UI

[![CI](https://github.com/adeotek/claude-code-webui/actions/workflows/claude-code-webui-ci.yml/badge.svg)](https://github.com/adeotek/claude-code-webui/actions/workflows/claude-code-webui-ci.yml)
[![Docker](https://img.shields.io/badge/docker-ghcr.io-blue)](https://github.com/adeotek/claude-code-webui/pkgs/container/claude-code-webui)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

A browser-based UI for [Claude Code](https://claude.ai/code) — manage sessions, track token usage, and interact with Claude from any device on your network.

## Features

- **Session management** — create, resume, rename, and delete Claude Code sessions; sessions are automatically resumed (with `--resume`) when reconnecting to a previous terminal session
- **Terminal mode** — full interactive xterm.js terminal connected directly to Claude Code (default)
- **Chat mode** — structured message view with markdown rendering and syntax-highlighted code blocks
- **Live session stats** — per-turn cost, API duration, context window %, token counts, lines added/removed, effort level, thinking mode, and rate limits — updated automatically via the Claude CLI statusline hook
- **Rich session header** — shows model, working directory, git branch, context %, tokens, cost, working time, and more
- **Usage dashboard** — daily token usage graph
- **Account overview** — Claude version, authentication status, and model info
- **Persistent history** — session messages, token counts, and terminal scrollback stored in SQLite
- **Auto-track external sessions** — optionally auto-add sessions started outside the webui to the session list when their stats arrive

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

`docker-compose.yml` mounts `~/.claude` (read-write — required for session deletion) and `~/projects` (read-write) from the host. To build the image locally instead of pulling from the registry:

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
| `CLAUDE_BIN` | `claude` | Path to the `claude` binary |
| `PORT` | `9998` | Backend listen port |
| `HOST` | `0.0.0.0` | Backend listen address |

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

## Statusline hook

On startup the backend automatically installs `~/.claude/webui-statusline.sh` and configures the `statusLine` entry in `~/.claude/settings.json`. After each assistant turn, Claude Code pipes its stats JSON through the script, which fires a background `curl` to `/api/statusline` without blocking your terminal.

- If no `statusLine` is configured yet, the script is installed as a silent sink.
- If one already exists, the webui script is prepended as a pipe so both run in sequence.
- The hook is idempotent — restarting the server never duplicates the configuration.

**Nothing needs to be done manually.** The hook becomes active the first time you start the server.

### Removing the hook

If you want to uninstall the hook without uninstalling the webui, run the appropriate script for your platform:

**Linux / macOS**
```bash
bash scripts/remove-statusline-hook.sh
```

**Windows (PowerShell 7+)**
```powershell
.\scripts\remove-statusline-hook.ps1
```

Both scripts remove `~/.claude/webui-statusline.sh` and undo the `statusLine` entry in `~/.claude/settings.json`. If the webui script was piped into an existing statusline command, the original downstream command is restored rather than removed.

### Auto-track external sessions

By default, stats arriving for an unrecognised Claude session (one started outside the webui) are silently ignored. Enable **Settings → Statusline: Unregistered Sessions → Auto-track** to have the webui automatically create a session row for it.

## Contributing

Bug reports and pull requests are welcome. Please open an issue first for significant changes so the approach can be discussed before implementation. Run `make lint` before submitting a PR — the CI pipeline will reject builds with type errors.

## License

[MIT](LICENSE)
