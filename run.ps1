#Requires -Version 7.0
$ErrorActionPreference = 'Stop'

# Parse args manually so we accept the POSIX-style `--dev` the user typed
# on bash, while still honoring the PowerShell-native `-Dev`.
$Dev = $false
foreach ($arg in $args) {
    switch ($arg) {
        '--dev' { $Dev = $true }
        '-Dev'  { $Dev = $true }
        { $_ -in '-h','--help','-?' } {
            @"
Usage: run.ps1 [--dev]

  --dev    Run in development mode with hot reload (skips build,
           starts backend via 'tsx watch' on :9998 and Vite dev
           server on :9999).
  default  Production mode: install, build, and serve the bundled
           frontend from the backend on :PORT (default 9998).
"@ | Write-Host
            exit 0
        }
        default {
            Write-Error "Unknown argument: $arg (use --help for usage)"
            exit 1
        }
    }
}

$RootDir = $PSScriptRoot

# Bootstrap .env on first run
$EnvFile    = Join-Path $RootDir 'backend\.env'
$EnvExample = Join-Path $RootDir '.env.example'
if (-not (Test-Path $EnvFile)) {
    Write-Host "backend\.env not found — copying from .env.example"
    Copy-Item $EnvExample $EnvFile
}

# Load env vars into the current process (PORT, CLAUDE_BIN, ANTHROPIC_API_KEY, etc.)
foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $key, $value = $line -split '=', 2
    [System.Environment]::SetEnvironmentVariable($key.Trim(), $value.Trim(), 'Process')
}

Write-Host 'Installing dependencies...'
Push-Location (Join-Path $RootDir 'frontend')
npm install
Pop-Location

Push-Location (Join-Path $RootDir 'backend')
npm install
Pop-Location

if ($Dev) {
    $Port = if ($env:PORT) { $env:PORT } else { '9998' }
    Write-Host 'Starting Claude Code Web UI in DEV mode (hot reload)'
    Write-Host "  Backend  → http://localhost:$Port  (tsx watch)"
    Write-Host "  Frontend → http://localhost:9999  (Vite HMR)"

    # Resolve npm to an executable Start-Process can launch directly.
    # On Windows, Get-Command npm often returns npm.ps1 (PowerShell-installed
    # via the Node MSI), which Start-Process cannot execute without an
    # explicit host. Explicitly resolve npm.cmd instead. On Unix, npm is a
    # shell script with a shebang and runs fine as-is.
    $npmPath = if ($IsWindows) {
        (Get-Command npm.cmd -ErrorAction Stop).Source
    } else {
        (Get-Command npm -ErrorAction Stop).Source
    }

    # Start both dev servers with shared console output. -PassThru gives us
    # the Process object so we can kill the tree on exit.
    $backend  = Start-Process -FilePath $npmPath -ArgumentList 'run','dev' `
                              -WorkingDirectory (Join-Path $RootDir 'backend') `
                              -NoNewWindow -PassThru
    $frontend = Start-Process -FilePath $npmPath -ArgumentList 'run','dev' `
                              -WorkingDirectory (Join-Path $RootDir 'frontend') `
                              -NoNewWindow -PassThru

    try {
        # Wait until either process exits; if one dies, tear the other down.
        while (-not $backend.HasExited -and -not $frontend.HasExited) {
            Start-Sleep -Milliseconds 500
        }
    } finally {
        # `npm.cmd` spawns `node` as a child — Stop-Process on the wrapper
        # leaves node orphaned, so we use taskkill /T to kill the tree.
        foreach ($proc in @($backend, $frontend)) {
            if ($proc -and -not $proc.HasExited) {
                taskkill.exe /T /F /PID $proc.Id 2>$null | Out-Null
            }
        }
    }
} else {
    Write-Host 'Building...'
    Push-Location (Join-Path $RootDir 'frontend')
    npm run build
    Pop-Location

    Push-Location (Join-Path $RootDir 'backend')
    npm run build
    Pop-Location

    $Port = if ($env:PORT) { $env:PORT } else { '9998' }
    Write-Host "Starting Claude Code Web UI → http://localhost:$Port"
    node (Join-Path $RootDir 'backend\dist\server.js')
}
