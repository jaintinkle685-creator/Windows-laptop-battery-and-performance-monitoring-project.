@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
set "PORT=8765"
set "URL=http://127.0.0.1:%PORT%/"

echo.
echo ================================================================
echo   LAPTOP BATTERY USAGE OPTIMIZER - STARTING
echo ================================================================
echo.

echo Checking whether the local telemetry service is already running...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%PORT%/api/health' -TimeoutSec 1; if($r.StatusCode -eq 200 -and $r.Content -match 'read-only-local'){ exit 0 } } catch {}; exit 1" >nul 2>&1
if not errorlevel 1 goto :OPEN

if exist ".server.pid" del /q ".server.pid" >nul 2>&1

echo Starting the Windows telemetry helper...
echo.
start "Laptop Battery Optimizer - Local Telemetry" powershell.exe -NoProfile -ExecutionPolicy Bypass -NoLogo -NoExit -File "%~dp0server.ps1"

set "READY=0"
for /L %%I in (1,1,40) do (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%PORT%/api/health' -TimeoutSec 1; if($r.StatusCode -eq 200 -and $r.Content -match 'read-only-local'){ exit 0 } } catch {}; exit 1" >nul 2>&1
    if not errorlevel 1 (
        set "READY=1"
        goto :OPEN
    )
    ping 127.0.0.1 -n 1 -w 150 >nul
)

if "%READY%"=="0" (
    echo.
    echo [ERROR] The telemetry helper did not start.
    echo.
    echo Please look at the PowerShell window for the exact error.
    echo Common causes are:
    echo   - PowerShell is disabled or unavailable
    echo   - Port %PORT% is already being used by another program
    echo   - Windows security software blocked the script
    echo.
    pause
    exit /b 1
)

:OPEN

echo Telemetry helper is ready.
echo Opening the dashboard in Google Chrome/your default browser...
start "" "%URL%"

echo.
echo Dashboard: %URL%
echo Keep the PowerShell telemetry window open while monitoring.
echo Close the dashboard when finished, then run STOP.bat.
echo.
endlocal
exit /b 0
