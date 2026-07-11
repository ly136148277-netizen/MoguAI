# Butler smoke wrapper (see scripts/butler_smoke.js)
param(
  [string]$ApiUrl = "http://127.0.0.1:8765",
  [string]$PaiRoot = "E:\projects\PAI",
  [switch]$StartPai
)

$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent

if ($StartPai) {
  $python = Join-Path $PaiRoot ".venv\Scripts\python.exe"
  if (-not (Test-Path $python)) { throw "PAI venv not found: $python" }
  $port = ([uri]$ApiUrl.TrimEnd("/")).Port
  if (-not $port) { $port = "8765" }
  Write-Host "Starting PAI serve on port $port ..."
  Start-Process -FilePath $python -ArgumentList @("-m", "gateway.cli", "serve", "--port", $port) -WorkingDirectory $PaiRoot -WindowStyle Hidden
  Start-Sleep -Seconds 3
}

node (Join-Path $repo "scripts\butler_smoke.js") --api $ApiUrl
exit $LASTEXITCODE
