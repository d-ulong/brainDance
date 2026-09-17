@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
set "ROOT=%CD%"

where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm 未在 PATH 中。请先安装 Node.js 20+ 和 pnpm，再运行本脚本。
  pause
  exit /b 1
)

set "MODE=%~1"
if "%MODE%"=="" set "MODE=dev"

if /I "%MODE%"=="dev" (
  set "WEB_CMD=pnpm dev"
) else if /I "%MODE%"=="start" (
  set "WEB_CMD=pnpm start -- -p 3002"
) else (
  echo 用法:
  echo   双击或: scripts\start-web-and-worker.bat
  echo   生产已构建后: scripts\start-web-and-worker.bat start
  pause
  exit /b 1
)

echo 仓库: %ROOT%
echo 将打开两个窗口：网站 ^(%WEB_CMD%^) 和 Worker ^(pnpm worker:lifecycle^)
echo 关掉对应窗口即停止该进程。网站地址: http://localhost:3002
echo.

start "BrainDance Web" cmd /k "cd /d "%ROOT%" && %WEB_CMD%"
start "BrainDance Worker" cmd /k "cd /d "%ROOT%" && pnpm worker:lifecycle"

echo 两个窗口已启动。本窗口可以关闭。
pause
endlocal
