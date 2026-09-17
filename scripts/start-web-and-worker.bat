@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0.."
set "ROOT=%CD%"

where pnpm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] pnpm not found in PATH. Install Node.js 20+ and pnpm first.
  pause
  exit /b 1
)

REM Production launcher: web on port 80 + lifecycle worker.
REM Optional: scripts\start-web-and-worker.bat dev  ^(local 3002^)
set "MODE=%~1"
if "%MODE%"=="" set "MODE=start"

if /I "%MODE%"=="start" (
  set "PORT=80"
  set "HOST=0.0.0.0"
  set "WEB_CMD=pnpm start -- -H 0.0.0.0 -p 80"
  set "APP_URL=http://localhost/"
) else if /I "%MODE%"=="dev" (
  set "PORT=3002"
  set "HOST=127.0.0.1"
  set "WEB_CMD=pnpm dev"
  set "APP_URL=http://localhost:3002/"
) else (
  echo Usage:
  echo   scripts\start-web-and-worker.bat
  echo   scripts\start-web-and-worker.bat start
  echo   scripts\start-web-and-worker.bat dev
  pause
  exit /b 1
)

echo Repo: %ROOT%
echo Mode: %MODE%
echo Web:  %WEB_CMD%
echo Worker: pnpm worker:lifecycle
echo URL:  %APP_URL%
echo.
echo Note: port 80 on Windows usually needs "Run as administrator".
echo Close each window to stop that process.
echo.

start "BrainDance Web" cmd /k "chcp 65001 >nul & cd /d "%ROOT%" & set PORT=%PORT% & %WEB_CMD%"
start "BrainDance Worker" cmd /k "chcp 65001 >nul & cd /d "%ROOT%" & pnpm worker:lifecycle"

echo Started. You can close this window.
pause
endlocal
