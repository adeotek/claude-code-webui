#Requires -Version 7
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptFile    = Join-Path $HOME '.claude' 'webui-statusline.sh'
$SettingsFile  = Join-Path $HOME '.claude' 'settings.json'
$WebuiPrefix   = 'bash ~/.claude/webui-statusline.sh'
$PipePrefix    = "$WebuiPrefix | "

Write-Host 'Removing Claude Code webui statusline hook...'

# 1. Remove the script file
if (Test-Path $ScriptFile) {
    Remove-Item $ScriptFile -Force
    Write-Host "Removed: $ScriptFile"
} else {
    Write-Host "Script not found (already removed?): $ScriptFile"
}

# 2. Patch settings.json
if (-not (Test-Path $SettingsFile)) {
    Write-Host "Settings file not found: $SettingsFile -- nothing to patch."
    Write-Host 'Done.'
    exit 0
}

$json = Get-Content $SettingsFile -Raw | ConvertFrom-Json -AsHashtable

$sl = $json['statusLine']
if (-not $sl -or $sl['type'] -ne 'command' -or -not $sl['command']) {
    Write-Host 'No command-type statusLine in settings.json -- nothing to change.'
    Write-Host 'Done.'
    exit 0
}

$cmd = $sl['command']

if ($cmd.StartsWith($PipePrefix)) {
    # Our script was prepended as a pipe -- restore the original downstream command.
    $original = $cmd.Substring($PipePrefix.Length)
    $json['statusLine']['command'] = $original
    Write-Host "Restored statusLine command to: $original"
} elseif ($cmd.StartsWith($WebuiPrefix)) {
    # Our script was the only entry -- remove statusLine entirely.
    $json.Remove('statusLine')
    Write-Host 'Removed statusLine from settings.json.'
} else {
    Write-Host 'webui-statusline.sh not present in statusLine command -- nothing to change.'
    Write-Host 'Done.'
    exit 0
}

$tmp = $SettingsFile + '.tmp'
$json | ConvertTo-Json -Depth 10 | Set-Content -Path $tmp -Encoding UTF8
Move-Item -Path $tmp -Destination $SettingsFile -Force
Write-Host "Updated: $SettingsFile"
Write-Host 'Done.'
