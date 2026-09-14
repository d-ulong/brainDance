[CmdletBinding()]
param(
  [string]$DatabaseName = "braindance_closed_pilot_20260903"
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

$databaseUrl = $env:DATABASE_URL
if (-not $databaseUrl) {
  foreach ($file in @(".env.local", ".env")) {
    if (-not (Test-Path -LiteralPath $file)) {
      continue
    }

    $line = Get-Content -LiteralPath $file |
      Where-Object { $_ -match "^DATABASE_URL=" } |
      Select-Object -First 1
    if ($line) {
      $databaseUrl = $line.Substring("DATABASE_URL=".Length).Trim().Trim('"').Trim("'")
      break
    }
  }
}

if (-not $databaseUrl) {
  throw "DATABASE_URL is required in the environment, .env.local, or .env"
}

$builder = [System.UriBuilder]([System.Uri]$databaseUrl)
$builder.Path = "/$DatabaseName"
$env:DATABASE_URL = $builder.Uri.AbsoluteUri
$env:LOCAL_PILOT_MODE = "true"
$env:NEXT_PUBLIC_APP_URL = "http://localhost:3002"
if (-not $env:BRAIN_DANCE_MEDIA_ROOT) {
  $env:BRAIN_DANCE_MEDIA_ROOT = Join-Path (Get-Location).Path ".braindance-media/closed-pilot"
}
# Explicit local-only policy; never disguise skipped scanning as a clean verdict.
$env:BRAIN_DANCE_MEDIA_SCANNER = "local-no-scan"
& node node_modules/tsx/dist/cli.mjs scripts/check-local-pilot-media.ts
if ($LASTEXITCODE -ne 0) {
  throw "Media storage startup check failed. Fix the configuration or directory permissions and retry."
}

& node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p 3002
exit $LASTEXITCODE
