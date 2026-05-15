#!/usr/bin/env bash
set -euo pipefail

SCRIPT_FILE="$HOME/.claude/webui-statusline.sh"
SETTINGS_FILE="$HOME/.claude/settings.json"
WEBUI_CMD_PREFIX="bash ~/.claude/webui-statusline.sh"

echo "Removing Claude Code webui statusline hook..."

# 1. Remove the script file
if [[ -f "$SCRIPT_FILE" ]]; then
  rm "$SCRIPT_FILE"
  echo "Removed: $SCRIPT_FILE"
else
  echo "Script not found (already removed?): $SCRIPT_FILE"
fi

# 2. Patch settings.json — requires node (part of the app's prerequisites)
if [[ ! -f "$SETTINGS_FILE" ]]; then
  echo "Settings file not found: $SETTINGS_FILE — nothing to patch."
  echo "Done."
  exit 0
fi

node <<NODEJS
const fs = require('fs')
const settingsPath = ${SETTINGS_FILE@Q}
const prefix = ${WEBUI_CMD_PREFIX@Q}

let settings
try {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
} catch {
  console.error('Could not parse settings.json — skipping.')
  process.exit(0)
}

const sl = settings.statusLine
if (!sl || sl.type !== 'command' || typeof sl.command !== 'string') {
  console.log('No command-type statusLine in settings.json — nothing to change.')
  process.exit(0)
}

const cmd = sl.command
const pipePrefix = prefix + ' | '

if (cmd.startsWith(pipePrefix)) {
  // Our script was prepended as a pipe — restore the original downstream command.
  const original = cmd.slice(pipePrefix.length)
  settings.statusLine = { ...sl, command: original }
  console.log('Restored statusLine command to:', original)
} else if (cmd.startsWith(prefix)) {
  // Our script was the only entry — remove statusLine entirely.
  delete settings.statusLine
  console.log('Removed statusLine from settings.json.')
} else {
  console.log('webui-statusline.sh not present in statusLine command — nothing to change.')
  process.exit(0)
}

const tmp = settingsPath + '.tmp'
fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n')
fs.renameSync(tmp, settingsPath)
console.log('Updated:', settingsPath)
NODEJS

echo "Done."
