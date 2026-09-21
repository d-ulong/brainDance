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
REM Use PORT/HOSTNAME env vars — do NOT pass -H/-p through pnpm (Windows treats -H as a dir).
set "MODE=%~1"
if "%MODE%"=="" set "MODE=start"

if /I "%MODE%"=="start" (
  set "PORT=80"
  set "HOSTNAME=0.0.0.0"
  set "WEB_CMD=pnpm start"
  set "APP_URL=http://localhost/"
) else if /I "%MODE%"=="dev" (
  set "PORT=3002"
  set "HOSTNAME=127.0.0.1"
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
echo Web:  %WEB_CMD%  ^(PORT=%PORT% HOSTNAME=%HOSTNAME%^)
echo Worker: pnpm worker:lifecycle
echo URL:  %APP_URL%
echo.
echo Note: port 80 on Windows usually needs "Run as administrator".
echo Close each window to stop that process.
echo.

if /I "%MODE%"=="start" (
  echo [INFO] Applying database migrations...
  echo.
  call pnpm db:migrate
  if errorlevel 1 (
    echo.
    echo [ERROR] Database migration failed. Web and worker were not started.
    pause
    exit /b 1
  )

  echo.
  echo [INFO] Building the current checkout...
  echo.
  call pnpm build
  if errorlevel 1 (
    echo.
    echo [ERROR] pnpm build failed. Web and worker were not started.
    pause
    exit /b 1
  )
  if not exist "%ROOT%\.next\BUILD_ID" (
    echo [ERROR] Build finished but .next\BUILD_ID is missing.
    pause
    exit /b 1
  )
  echo.
  echo [INFO] Migration and build OK. Starting web + worker...
  echo.
)

start "BrainDance Web" /D "%ROOT%" cmd /k "chcp 65001 >nul && set PORT=%PORT%&& set HOSTNAME=%HOSTNAME%&& %WEB_CMD%"
start "BrainDance Worker" /D "%ROOT%" cmd /k "chcp 65001 >nul && pnpm worker:lifecycle"

echo Started. You can close this window.
pause
endlocal
