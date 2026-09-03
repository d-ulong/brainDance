[CmdletBinding()]
param(
  [string]$DatabaseName = "braindance_closed_pilot_20260903"
)

$ErrorActionPreference = "Stop"

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

& pnpm.cmd dev
exit $LASTEXITCODE
