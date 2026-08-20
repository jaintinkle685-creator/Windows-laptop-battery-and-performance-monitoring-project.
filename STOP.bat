@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "PORT=8765"

echo Stopping Laptop Battery Usage Optimizer...
if exist ".server.pid" (
  for /f "usebackq delims=" %%P in (".server.pid") do (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Stop-Process -Id %%P -Force -ErrorAction SilentlyContinue"
  )
  del /q ".server.pid" >nul 2>&1
) else (
  rem No PID file; try to leave unrelated processes alone.
)
echo Local telemetry helper stopped.
echo You can close the PowerShell window if it is still visible.
pause
endlocal
