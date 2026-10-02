# Starts the speech sidecar and the bot together; Ctrl+C stops both.
# Usage (from the repo root, in PowerShell): .\start.ps1 [-Fake] [-Port 8765]
#   -Fake  use fake speech engines (no models needed; only for trying the plumbing)
param(
  [switch]$Fake,
  [int]$Port = 8765
)
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$sidecarDir = Join-Path $PSScriptRoot 'services\speech'
$venv = Join-Path $sidecarDir '.venv'
$python = Join-Path $venv 'Scripts\python.exe'

if (-not (Test-Path (Join-Path $PSScriptRoot '.env'))) {
  throw 'Missing .env. Copy .env.example to .env and fill it in (see SETUP.md).'
}

# 1. Sidecar virtualenv, created once; requirements reinstalled only when they change.
if (-not (Test-Path $python)) {
  Write-Host 'Creating the sidecar virtualenv...'
  python -m venv $venv
}
$reqs = @('requirements.txt')
if (-not $Fake) { $reqs += 'requirements-real.txt' }
$stamp = Join-Path $venv '.installed'
$hash = (($reqs | ForEach-Object { (Get-FileHash (Join-Path $sidecarDir $_)).Hash }) -join '')
if (-not (Test-Path $stamp) -or (Get-Content $stamp -Raw) -ne $hash) {
  Write-Host 'Installing sidecar requirements (first run can take several minutes)...'
  $pipArgs = @('-m', 'pip', 'install', '-q')
  foreach ($r in $reqs) { $pipArgs += @('-r', (Join-Path $sidecarDir $r)) }
  & $python @pipArgs
  if ($LASTEXITCODE -ne 0) { throw 'pip install failed' }
  Set-Content -Path $stamp -Value $hash -NoNewline
}
if (-not $Fake -and -not (Test-Path (Join-Path $sidecarDir 'models\en_US-lessac-medium.onnx'))) {
  Write-Host 'Downloading the Piper voice...'
  Push-Location $sidecarDir
  try { & $python download_models.py } finally { Pop-Location }
}

# 2. Node dependencies.
if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules'))) { npm ci }

# 3. Start the sidecar, wait for /health, then run the bot in this window.
if (-not $Fake) { $env:SPEECH_ENGINES = 'real' }
$env:SIDECAR_URL = "http://127.0.0.1:$Port"
$sidecar = Start-Process -FilePath $python -WorkingDirectory $sidecarDir -PassThru -NoNewWindow `
  -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$Port")
try {
  $ready = $false
  for ($i = 0; $i -lt 60 -and -not $ready; $i++) {
    if ($sidecar.HasExited) { throw 'The sidecar exited during startup. Read the messages above.' }
    try { $ready = (Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2).ok } catch { Start-Sleep -Seconds 1 }
  }
  if (-not $ready) { throw 'The sidecar did not become healthy within 60 seconds.' }
  Write-Host 'Sidecar is up. Starting the bot (Ctrl+C to stop both)...'
  npm start
} finally {
  # Runs on Ctrl+C, on a crash and on a normal exit: never leave the sidecar running in the background.
  if ($sidecar -and -not $sidecar.HasExited) {
    Stop-Process -Id $sidecar.Id -Force -ErrorAction SilentlyContinue
    Write-Host 'Sidecar stopped.'
  }
}
