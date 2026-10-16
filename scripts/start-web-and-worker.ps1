[CmdletBinding()]
param(
  [string]$Mode = "start",
  [ValidateSet("Web", "Worker")][string]$InternalRole
)

$ErrorActionPreference = "Stop"
if (-not $Mode) { $Mode = "start" }
if ($Mode -notin @("start", "dev")) { throw "Usage: start-web-and-worker.bat [start|dev]" }
$repoRoot = Split-Path -Parent $PSScriptRoot
$launcherPath = $PSCommandPath
Set-Location -LiteralPath $repoRoot

# Dedicated wrappers make process ownership verifiable on the next invocation.
if ($InternalRole) {
  if ($InternalRole -eq "Worker") {
    & pnpm worker:lifecycle
  } else {
    $env:PORT = if ($Mode -eq "start") { "80" } else { "3002" }
    $env:HOSTNAME = if ($Mode -eq "start") { "0.0.0.0" } else { "127.0.0.1" }
    & pnpm $Mode
  }
  exit $LASTEXITCODE
}

function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Command $($Arguments -join ' ') failed (exit $LASTEXITCODE)." }
}

function Stop-OwnedService {
  param($Service)
  $running = Get-Process -Id $Service.processId -ErrorAction SilentlyContinue
  if (-not $running) { return }
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($Service.processId)"
  if ($running.StartTime.ToUniversalTime().ToString("o") -ne $Service.startedAt -or
      -not $processInfo.CommandLine -or
      $processInfo.CommandLine.IndexOf($launcherPath, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
      $processInfo.CommandLine -notmatch "-InternalRole\s+(Web|Worker)") {
    throw "Cannot verify ownership of PID $($Service.processId); no signal was sent."
  }
  # Only this verified wrapper and its descendants, never all node.exe or a port owner.
  Invoke-Checked "taskkill.exe" @("/PID", [string]$Service.processId, "/T", "/F")
}

$runtimePath = Join-Path $repoRoot ".review-runtime/windows-launcher"
$statePath = Join-Path $runtimePath "services.json"
$hash = [Security.Cryptography.SHA256]::Create()
try { $repoHash = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($repoRoot.ToUpperInvariant()))).Replace("-", "") }
finally { $hash.Dispose() }
$mutex = New-Object Threading.Mutex($false, "Local\BrainDanceLauncher_$repoHash")
$locked = $false
$started = @()
try {
  try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { throw "Another launcher is already updating this checkout." }
  Get-Command git -ErrorAction Stop | Out-Null
  Get-Command pnpm -ErrorAction Stop | Out-Null
  Invoke-Checked "git" @("symbolic-ref", "--quiet", "--short", "HEAD")
  Invoke-Checked "git" @("rev-parse", "--verify", "@{upstream}")
  $dirty = & git status --porcelain
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect Git status." }
  if ($dirty) { throw "Working tree has uncommitted changes. Commit or move them before restarting; services were left running." }
  Write-Host "[INFO] Pulling the configured upstream (fast-forward only)..."
  Invoke-Checked "git" @("pull", "--ff-only")

  # No stop/build/install occurs before a successful pull.
  if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($state.repoRoot -ne $repoRoot) { throw "Service state belongs to a different checkout." }
    foreach ($service in $state.services) { Stop-OwnedService $service }
    Remove-Item -LiteralPath $statePath
  }
  $port = if ($Mode -eq "start") { 80 } else { 3002 }
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
    throw "Port $port is occupied by an unmanaged process. Close the old service manually; no unrelated process was stopped."
  }
  Invoke-Checked "pnpm" @("install", "--frozen-lockfile")
  Invoke-Checked "pnpm" @("db:migrate")
  if ($Mode -eq "start") {
    Invoke-Checked "pnpm" @("build")
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot ".next/BUILD_ID"))) { throw "Build completed without .next/BUILD_ID." }
  }

  New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
  foreach ($role in @("Web", "Worker")) {
    $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"{0}"' -f $launcherPath), "-Mode", $Mode, "-InternalRole", $role)
    $process = Start-Process powershell.exe -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $runtimePath "$role.stdout.log") -RedirectStandardError (Join-Path $runtimePath "$role.stderr.log")
    $started += [PSCustomObject]@{ processId = $process.Id; startedAt = $process.StartTime.ToUniversalTime().ToString("o"); role = $role }
  }
  @{ repoRoot = $repoRoot; services = $started } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding UTF8
  Start-Sleep -Seconds 2
  foreach ($service in $started) {
    if (-not (Get-Process -Id $service.processId -ErrorAction SilentlyContinue)) { throw "$($service.role) exited at startup. See $runtimePath for logs." }
  }
  Write-Host "[OK] Web and worker started. URL: http://localhost:$port/"
  Write-Host "Logs: $runtimePath"
} catch {
  foreach ($service in $started) { try { Stop-OwnedService $service } catch { Write-Warning $_.Exception.Message } }
  Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
