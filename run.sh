#!/usr/bin/env bash
set -euo pipefail

DEV_MODE=0
for arg in "$@"; do
  case "$arg" in
    --dev) DEV_MODE=1 ;;
    -h|--help)
      cat <<EOF
Usage: $(basename "$0") [--dev]

  --dev    Run in development mode with hot reload (skips build,
           starts backend via 'tsx watch' on :9998 and Vite dev
           server on :9999).
  default  Production mode: install, build, and serve the bundled
           frontend from the backend on :PORT (default 9998).
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Bootstrap .env on first run
if [[ ! -f "$ROOT_DIR/backend/.env" ]]; then
  echo "backend/.env not found — copying from .env.example"
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/backend/.env"
fi

# Load env vars (sets PORT, CLAUDE_BIN, ANTHROPIC_API_KEY, etc.)
set -a
# shellcheck source=/dev/null
source "$ROOT_DIR/backend/.env"
set +a

echo "Installing dependencies..."
cd "$ROOT_DIR/frontend" && npm install
cd "$ROOT_DIR/backend"  && npm install

if [[ $DEV_MODE -eq 1 ]]; then
  echo "Starting Claude Code Web UI in DEV mode (hot reload)"
  echo "  Backend  → http://localhost:${PORT:-9998}  (tsx watch)"
  echo "  Frontend → http://localhost:9999          (Vite HMR)"

  # Forward SIGINT/SIGTERM/EXIT to the whole process group so both
  # children die when the user hits Ctrl+C.
  trap 'trap - INT TERM EXIT; kill 0' INT TERM EXIT

  (cd "$ROOT_DIR/backend"  && npm run dev) &
  (cd "$ROOT_DIR/frontend" && npm run dev) &
  wait
else
  echo "Building..."
  cd "$ROOT_DIR/frontend" && npm run build
  cd "$ROOT_DIR/backend"  && npm run build

  PORT="${PORT:-9998}"
  echo "Starting Claude Code Web UI → http://localhost:${PORT}"
  exec node "$ROOT_DIR/backend/dist/server.js"
fi
