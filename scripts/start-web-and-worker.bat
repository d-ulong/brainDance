@echo off
setlocal EnableExtensions
chcp 65001 >nul
REM Pull first; the PowerShell launcher safely restarts its own process trees.
set "MODE=%~1"
if "%MODE%"=="" set "MODE=start"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-web-and-worker.ps1" -Mode "%MODE%"
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" pause
exit /b %RESULT%
