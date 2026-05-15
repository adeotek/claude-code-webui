#!/usr/bin/env bash
DATA=$(cat)

# Launch API call in a detached subshell so it NEVER blocks the downstream pipe.
# Subshell stdin is /dev/null; all output is suppressed so a down backend is
# invisible to the user and does not affect the Claude Code display.
( curl --silent --max-time 1 -X POST \
    "http://localhost:__PORT__/api/statusline" \
    -H "Content-Type: application/json" \
    -d "$DATA" \
    </dev/null >/dev/null 2>&1 ) &
disown $!

# With -n/--no-pipe: act as a silent sink (no downstream statusline script).
# Without the flag: immediately echo JSON to stdout for the next piped script.
if [[ " $* " =~ " --no-pipe " ]] || [[ " $* " =~ " -n " ]]; then
  exit 0
fi
printf '%s\n' "$DATA"
