# Laptop Battery Usage Optimizer - Portable Windows local telemetry helper
# Read-only: this script NEVER changes battery, brightness, refresh rate, power mode or hardware settings.
$ErrorActionPreference = "SilentlyContinue"
$Port = 8765
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $Root ".server.pid"
Set-Content -Path $PidFile -Value $PID -Encoding ascii

$previousProc = @{}
$previousProcTime = Get-Date
$totalMemoryBytes = 0
$staticCache = [ordered]@{ gpu=$null; display=$null; batteryCapacity=$null; batteryCapacityTime=$null }
$script:processCache = @()
$script:processCacheTime = [datetime]::MinValue
$script:telemetryCache = $null
$script:telemetryCacheTime = [datetime]::MinValue

# Native display-mode reader: Win32_VideoController.CurrentRefreshRate can report
# the adapter's preferred/max mode (for example 144 Hz) instead of the mode that
# Windows is actually using (for example 60 Hz). EnumDisplaySettings with
# ENUM_CURRENT_SETTINGS returns the active mode of the primary display.
try {
    if (-not ("BatteryX.NativeDisplay" -as [type])) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace BatteryX {
    public static class NativeDisplay {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        public struct DEVMODE {
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
            public short dmSpecVersion;
            public short dmDriverVersion;
            public short dmSize;
            public short dmDriverExtra;
            public int dmFields;
            public int dmPositionX;
            public int dmPositionY;
            public int dmDisplayOrientation;
            public int dmDisplayFixedOutput;
            public short dmColor;
            public short dmDuplex;
            public short dmYResolution;
            public short dmTTOption;
            public short dmCollate;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
            public short dmLogPixels;
            public int dmBitsPerPel;
            public int dmPelsWidth;
            public int dmPelsHeight;
            public int dmDisplayFlags;
            public int dmDisplayFrequency;
            public int dmICMMethod;
            public int dmICMIntent;
            public int dmMediaType;
            public int dmDitherType;
            public int dmReserved1;
            public int dmReserved2;
            public int dmPanningWidth;
            public int dmPanningHeight;
        }

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern bool EnumDisplaySettings(
            string lpszDeviceName, int iModeNum, ref DEVMODE lpDevMode);

        public static int GetCurrentRefreshRate() {
            DEVMODE dm = new DEVMODE();
            dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
            if (EnumDisplaySettings(null, -1, ref dm) && dm.dmDisplayFrequency > 0) {
                return dm.dmDisplayFrequency;
            }
            return 0;
        }
    }
}
"@ -ErrorAction Stop
    }
} catch {}

try {
    $cs = Get-CimInstance Win32_ComputerSystem
    $totalMemoryBytes = [double]$cs.TotalPhysicalMemory
} catch {}

function Num($v) {
    if ($null -eq $v) { return $null }
    try { return [double]$v } catch { return $null }
}

function Get-BatteryCapacityFallback {
    # Different laptop vendors expose battery capacity through different WMI classes.
    # Try the live WMI classes first, then use Windows' battery report as a fallback.
    $design = $null
    $full = $null
    $cycle = $null

    try {
        $st = Get-CimInstance -Namespace root\wmi -ClassName BatteryStaticData | Select-Object -First 1
        if ($st) {
            if ($st.DesignedCapacity -ne $null) { $design = Num($st.DesignedCapacity) }
            if ($st.FullChargedCapacity -ne $null) { $full = Num($st.FullChargedCapacity) }
            if ($st.CycleCount -ne $null) { $cycle = Num($st.CycleCount) }
        }
    } catch {}

    try {
        if ($full -eq $null) {
            $fc = Get-CimInstance -Namespace root\wmi -ClassName BatteryFullChargedCapacity | Select-Object -First 1
            if ($fc -and $fc.FullChargedCapacity -ne $null) { $full = Num($fc.FullChargedCapacity) }
        }
    } catch {}

    # Some systems expose capacity directly through Win32_Battery.
    try {
        $wb = Get-CimInstance Win32_Battery | Select-Object -First 1
        foreach ($prop in @('DesignCapacity','DesignedCapacity')) {
            if ($design -eq $null -and $wb -and $wb.PSObject.Properties.Name -contains $prop) {
                $v = Num($wb.$prop); if ($v -gt 0) { $design = $v }
            }
        }
        foreach ($prop in @('FullChargeCapacity','FullChargedCapacity','FullChargedCapacityMWh')) {
            if ($full -eq $null -and $wb -and $wb.PSObject.Properties.Name -contains $prop) {
                $v = Num($wb.$prop); if ($v -gt 0) { $full = $v }
            }
        }
    } catch {}

    # Final fallback: Windows can generate a battery-report.html containing
    # Design Capacity and Full Charge Capacity even when the WMI capacity
    # classes are unavailable. Cache it so this is NOT executed every refresh.
    if ($design -eq $null -or $full -eq $null) {
        try {
            $now = Get-Date
            $cacheFresh = ($script:batteryReportCacheTime -ne $null -and (($now - $script:batteryReportCacheTime).TotalMinutes -lt 5))
            if (-not $cacheFresh) {
                $reportPath = Join-Path $env:TEMP ('BatteryX-' + $env:COMPUTERNAME + '.html')
                & powercfg.exe /batteryreport /output $reportPath /duration 1 2>$null | Out-Null
                if (Test-Path -LiteralPath $reportPath) {
                    $script:batteryReportCache = [IO.File]::ReadAllText($reportPath)
                    $script:batteryReportCacheTime = $now
                    Remove-Item $reportPath -Force -ErrorAction SilentlyContinue
                }
            }
            $html = [string]$script:batteryReportCache
            if ($html) {
                $html = $html -replace '\s+', ' '
                $m = [regex]::Match($html, '(?is)DESIGN CAPACITY.*?<td[^>]*>\s*([0-9,\.]+)\s*mWh')
                if ($m.Success) { $design = Num(($m.Groups[1].Value -replace ',','')) }
                $m = [regex]::Match($html, '(?is)FULL CHARGE CAPACITY.*?<td[^>]*>\s*([0-9,\.]+)\s*mWh')
                if ($m.Success) { $full = Num(($m.Groups[1].Value -replace ',','')) }
                if ($design -eq $null) {
                    $m = [regex]::Match($html, '(?is)DESIGN CAPACITY.{0,500}?([0-9,\.]+)\s*mWh')
                    if ($m.Success) { $design = Num(($m.Groups[1].Value -replace ',','')) }
                }
                if ($full -eq $null) {
                    $m = [regex]::Match($html, '(?is)FULL CHARGE CAPACITY.{0,500}?([0-9,\.]+)\s*mWh')
                    if ($m.Success) { $full = Num(($m.Groups[1].Value -replace ',','')) }
                }
            }
        } catch {}
    }

    [pscustomobject]@{ designMWh=$design; fullChargeMWh=$full; cycleCount=$cycle }
}

function Get-BatteryTelemetry {
    # Fast live battery read. Capacity/health reporting was removed from the UI,
    # so there is deliberately NO powercfg /batteryreport call in the live loop.
    $b = $null
    $bs = $null
    try { $b = Get-CimInstance Win32_Battery | Select-Object -First 1 } catch {}
    try { $bs = Get-CimInstance -Namespace root\wmi -ClassName BatteryStatus | Select-Object -First 1 } catch {}

    $level = if ($b) { Num($b.EstimatedChargeRemaining) } else { $null }
    $charging = $false
    if ($b) { $charging = @('2','6','7','8','9') -contains ([string]$b.BatteryStatus) }
    if ($bs -and $null -ne $bs.Charging) { $charging = [bool]$bs.Charging }

    $remainingMWh = if ($bs) { Num($bs.RemainingCapacity) } else { $null }
    $powerW = $null
    $chargeRateW = $null
    if ($bs) {
        $dr = Num($bs.DischargeRate)
        $cr = Num($bs.ChargeRate)
        if ($dr -ne $null -and $dr -gt 0) { $powerW = [math]::Round($dr / 1000, 2) }
        if ($cr -ne $null -and $cr -gt 0) { $chargeRateW = [math]::Round($cr / 1000, 2) }
    }

    $runtimeMin = $null
    if ($remainingMWh -gt 0 -and $powerW -gt 0) {
        $runtimeMin = [math]::Round(($remainingMWh / ($powerW * 1000)) * 60, 1)
    } elseif ($b -and $b.EstimatedRunTime -ne $null -and [int]$b.EstimatedRunTime -lt 71582) {
        $runtimeMin = [double]$b.EstimatedRunTime
        if ($runtimeMin -gt 0 -and $remainingMWh -gt 0) {
            $powerW = [math]::Round($remainingMWh / ($runtimeMin / 60) / 1000, 2)
        }
    }

    [pscustomobject]@{
        levelPercent=$level
        charging=$charging
        remainingMWh=$remainingMWh
        powerW=$powerW
        chargeRateW=$chargeRateW
        runtimeMin=$runtimeMin
    }
}
function Get-GpuTelemetry {
    if ($staticCache.gpu -ne $null) {
        $model = $staticCache.gpu.model
    } else {
        $model = $null
        $nvidia = Get-Command nvidia-smi -ErrorAction SilentlyContinue
        if ($nvidia) {
            try {
                $line = & nvidia-smi --query-gpu=name --format=csv,noheader,nounits 2>$null | Select-Object -First 1
                if ($line) { $model = [string]$line.Trim() }
            } catch {}
        }
        if (-not $model) {
            try {
                $vc = Get-CimInstance Win32_VideoController | Where-Object { $_.Name } | Select-Object -First 1
                if ($vc) { $model = [string]$vc.Name }
            } catch {}
        }
        $staticCache.gpu = [pscustomobject]@{ model=$model }
    }

    $util = $null
    $temp = $null
    $nvidia = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if ($nvidia) {
        try {
            $line = & nvidia-smi --query-gpu=utilization.gpu,temperature.gpu --format=csv,noheader,nounits 2>$null | Select-Object -First 1
            if ($line) {
                $parts = $line -split ","
                if ($parts.Count -ge 1) { $util = Num($parts[0].Trim()) }
                if ($parts.Count -ge 2) { $temp = Num($parts[1].Trim()) }
            }
        } catch {}
    }
    [pscustomobject]@{ model=$model; utilizationPercent=$util; temperatureC=$temp }
}
function Get-DisplayTelemetry {
    # Refresh-rate is intentionally read on EVERY telemetry request.
    # Windows can change the active display mode while the dashboard is already
    # running (for example 144 Hz -> 60 Hz), so caching this value makes the
    # Overview dashboard show a stale refresh rate.
    $rate = $null
    $brightness = $null

    # Read the refresh rate Windows is actively using, not the GPU adapter's
    # advertised/preferred rate.
    try {
        $nativeRate = [BatteryX.NativeDisplay]::GetCurrentRefreshRate()
        if ($nativeRate -gt 0) { $rate = [int]$nativeRate }
    } catch {}

    # Fallback only if the native Windows call is unavailable.
    if ($null -eq $rate) {
        try {
            $vc = Get-CimInstance Win32_VideoController |
                Where-Object { $_.CurrentRefreshRate -gt 0 } |
                Select-Object -First 1
            if ($vc) { $rate = [int]$vc.CurrentRefreshRate }
        } catch {}
    }

    try {
        $mb = Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorBrightness |
            Select-Object -First 1
        if ($mb) { $brightness = [int]$mb.CurrentBrightness }
    } catch {}

    $staticCache.display = [pscustomobject]@{
        refreshRateHz = $rate
        brightnessPercent = $brightness
    }

    return $staticCache.display
}
function Recommendation([string]$name, [double]$cpu, [double]$mem) {
    $n = $name.ToLower()
    if ($n -match "chrome|msedge|firefox") { return "Close unused tabs and enable the browser's efficiency/energy-saver mode." }
    if ($n -match "code|devenv|idea|pycharm") { return "Close unused workspaces, terminals and heavy extensions on battery." }
    if ($n -match "python|java|node|dotnet") { return "Stop idle scripts, builds or background development jobs." }
    if ($n -match "teams|discord|zoom") { return "Quit or reduce background activity when not in use." }
    if ($n -match "onedrive|dropbox|googledrivesync") { return "Pause large sync jobs while running on battery." }
    if ($cpu -gt 20) { return "High CPU activity detected; inspect or pause this workload if unnecessary." }
    if ($mem -gt 8) { return "High memory usage detected; close unused workloads if battery is critical." }
    return "Monitor this process; no immediate action is required."
}

function Get-ProcessTelemetry([double]$systemPowerW) {
    # Use Windows' formatted per-process performance counters for an immediate
    # CPU reading instead of waiting for a second sample. Join them with the
    # live Get-Process list so only processes that are currently running are shown.
    $live = @{}
    try {
        foreach ($p in @(Get-Process)) { $live[[int]$p.Id] = $p }
    } catch {}

    $perf = @()
    try {
        $perf = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process)
    } catch {}

    $rows = foreach ($pc in $perf) {
        try {
            $id = [int]$pc.IDProcess
            if ($id -le 0 -or -not $live.ContainsKey($id)) { continue }
            $cpuPct = Num($pc.PercentProcessorTime)
            if ($cpuPct -eq $null -or $cpuPct -le 0.1) { continue }
            $p = $live[$id]
            $memBytes = [double]$p.WorkingSet64
            $memPct = if ($script:totalMemoryBytes -gt 0) { ($memBytes / $script:totalMemoryBytes) * 100 } else { 0 }
            [pscustomobject]@{
                name = [string]$p.ProcessName + ".exe"
                cpuPercent = [math]::Min(100,[math]::Max(0,[double]$cpuPct))
                memoryPercent = [math]::Min(100,[math]::Max(0,[double]$memPct))
            }
        } catch {}
    }

    # Fallback if formatted counters are unavailable: use the previous-sample method,
    # but never expose zero-CPU placeholder rows.
    if (-not $rows -or @($rows).Count -eq 0) {
        $now = Get-Date
        $elapsed = [math]::Max(0.5, ($now - $script:previousProcTime).TotalSeconds)
        $current = @{}
        $fallback = foreach ($p in @($live.Values)) {
            try {
                $id=[int]$p.Id; $cpuTime=[double]$p.TotalProcessorTime.TotalSeconds
                $memBytes=[double]$p.WorkingSet64; $cpuPct=0
                if ($script:previousProc.ContainsKey($id)) {
                    $old=$script:previousProc[$id]; $delta=$cpuTime-$old.cpu
                    if ($delta -ge 0) { $cpuPct=($delta/$elapsed/[math]::Max(1,[Environment]::ProcessorCount))*100 }
                }
                $current[$id]=@{cpu=$cpuTime}
                if ($cpuPct -gt 0.1) {
                    $memPct=if($script:totalMemoryBytes -gt 0){($memBytes/$script:totalMemoryBytes)*100}else{0}
                    [pscustomobject]@{name=[string]$p.ProcessName+".exe";cpuPercent=[math]::Min(100,[math]::Max(0,[double]$cpuPct));memoryPercent=[math]::Min(100,[math]::Max(0,[double]$memPct))}
                }
            } catch {}
        }
        $script:previousProc=$current; $script:previousProcTime=$now
        $rows=@($fallback)
    }

    $rows = @($rows | Sort-Object cpuPercent -Descending | Select-Object -First 24)
    $weights = @($rows | ForEach-Object { [math]::Max(0.05, ($_.cpuPercent * 0.85) + ($_.memoryPercent * 0.15)) })
    $weightSum = ($weights | Measure-Object -Sum).Sum
    if (-not $weightSum -or $weightSum -le 0) { $weightSum = 1 }

    $out = @()
    for ($i=0; $i -lt $rows.Count; $i++) {
        $r=$rows[$i]; $w=$weights[$i]
        $watts=if($systemPowerW -gt 0){$systemPowerW*($w/$weightSum)}else{0}
        $impact=if($systemPowerW -gt 0 -and $watts -ge $systemPowerW*.10){"HIGH"}elseif($systemPowerW -gt 0 -and $watts -ge $systemPowerW*.04){"MEDIUM"}else{"LOW"}
        $out += [pscustomobject]@{name=$r.name;cpuPercent=[math]::Round($r.cpuPercent,1);memoryPercent=[math]::Round($r.memoryPercent,1);powerW=[math]::Round($watts,2);impact=$impact;recommendation=Recommendation $r.name $r.cpuPercent $r.memoryPercent}
    }
    return @($out | Sort-Object powerW -Descending)
}
function Get-Telemetry {
    $battery = Get-BatteryTelemetry
    $gpu = Get-GpuTelemetry
    $display = Get-DisplayTelemetry

    $cpu = $null
    try {
        $osPerf = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'"
        if ($osPerf) { $cpu = [math]::Round([double]$osPerf.PercentProcessorTime,1) }
    } catch {}

    $ram = $null
    try {
        $os = Get-CimInstance Win32_OperatingSystem
        if ($os.TotalVisibleMemorySize -gt 0) {
            $ram = [math]::Round((1 - ($os.FreePhysicalMemory / $os.TotalVisibleMemorySize)) * 100,1)
        }
    } catch {}

    $systemPower = $battery.powerW
    $powerForProcesses = if ($null -ne $systemPower) { [double]$systemPower } else { 0 }
    # Process enumeration is the heaviest part of the live request. Keep it
    # fresh for a short window while CPU/GPU/battery/display telemetry remains
    # live on every sample. This removes the visible pause caused by repeatedly
    # enumerating every Windows process.
    $now = Get-Date
    if (($now - $script:processCacheTime).TotalMilliseconds -ge 2000 -or $null -eq $script:processCache) {
        $script:processCache = @(Get-ProcessTelemetry $powerForProcesses)
        $script:processCacheTime = $now
    }
    $processes = @($script:processCache)

    [pscustomobject]@{
        timestamp = (Get-Date).ToString("o")
        machine = $env:COMPUTERNAME
        cpuPercent = $cpu
        ramPercent = $ram
        gpu = $gpu
        temperatureC = $gpu.temperatureC
        powerW = $systemPower
        chargingPowerW = $battery.chargeRateW
        runtimeMin = $battery.runtimeMin
        battery = $battery
        display = $display
        processes = $processes
        telemetrySource = "Windows local read-only helper"
    }
}

function Get-Mime([string]$path) {
    switch -Regex ($path) {
        '\.html?$' { return "text/html; charset=utf-8" }
        '\.js$' { return "application/javascript; charset=utf-8" }
        '\.css$' { return "text/css; charset=utf-8" }
        '\.svg$' { return "image/svg+xml" }
        '\.json$' { return "application/json; charset=utf-8" }
        default { return "application/octet-stream" }
    }
}

function Send-Response($stream, [int]$status, [string]$contentType, [byte[]]$body) {
    $header = "HTTP/1.1 $status " + $(if($status -eq 200){"OK"}elseif($status -eq 404){"Not Found"}else{"Error"}) + "`r`n"
    $header += "Content-Type: $contentType`r`n"
    $header += "Content-Length: $($body.Length)`r`n"
    $header += "Cache-Control: no-store`r`n"
    $header += "Connection: close`r`n`r`n"
    $hb = [Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($hb,0,$hb.Length)
    if ($body.Length -gt 0) { $stream.Write($body,0,$body.Length) }
    $stream.Flush()
}

# Warm one complete, real Windows snapshot BEFORE advertising the server as ready.
# START.bat waits for /api/health, so the browser opens only after CPU, GPU,
# battery, display and process telemetry are already available.
try {
    $script:telemetryCache = Get-Telemetry
    $script:telemetryCacheTime = Get-Date
    Write-Host "Initial live telemetry snapshot ready."
} catch {
    $script:telemetryCache = $null
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $Port)
$listener.Start()
Write-Host "Laptop Battery Usage Optimizer helper running at http://127.0.0.1:$Port/"

try {
    while ($true) {
        if (-not $listener.Pending()) { Start-Sleep -Milliseconds 50; continue }
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $stream.ReadTimeout = 2000
            $reader = [System.IO.StreamReader]::new($stream,[Text.Encoding]::UTF8,$false,4096,$true)
            $requestLine = $reader.ReadLine()
            if (-not $requestLine) { $client.Close(); continue }
            while (($line = $reader.ReadLine()) -ne $null -and $line -ne "") {}
            $parts = $requestLine.Split(" ")
            $method = $parts[0]
            $target = $parts[1]

            if ($method -ne "GET") {
                Send-Response $stream 405 "text/plain; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes("GET only"))
                $client.Close(); continue
            }

            $path = $target.Split("?")[0]
            if ($path -eq "/api/telemetry") {
                # Serve the warmed snapshot immediately. Refresh the snapshot when
                # it is older than 1000 ms; this keeps the UI responsive while still
                # detecting brightness/refresh-rate changes within about a second.
                $now = Get-Date
                if ($null -eq $script:telemetryCache -or (($now - $script:telemetryCacheTime).TotalMilliseconds -ge 1000)) {
                    try {
                        $script:telemetryCache = Get-Telemetry
                        $script:telemetryCacheTime = $now
                    } catch {}
                }
                $json = $script:telemetryCache | ConvertTo-Json -Depth 8 -Compress
                Send-Response $stream 200 "application/json; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes($json))
            } elseif ($path -eq "/api/health") {
                Send-Response $stream 200 "application/json; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes('{"ok":true,"mode":"read-only-local"}'))
            } else {
                $clean = [Uri]::UnescapeDataString($path.TrimStart("/"))
                if ([string]::IsNullOrWhiteSpace($clean)) { $clean = "index.html" }
                $candidate = [IO.Path]::GetFullPath((Join-Path $Root $clean))
                $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd("\") + "\"
                if (-not $candidate.StartsWith($rootFull,[StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
                    Send-Response $stream 404 "text/plain; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes("Not Found"))
                } else {
                    $body = [IO.File]::ReadAllBytes($candidate)
                    Send-Response $stream 200 (Get-Mime $candidate) $body
                }
            }
        } catch {
            try { Send-Response $stream 500 "text/plain; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes("Server error")) } catch {}
        } finally {
            try { $stream.Dispose() } catch {}
            try { $client.Close() } catch {}
        }
    }
} finally {
    try { $listener.Stop() } catch {}
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}
