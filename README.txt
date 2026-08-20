# Laptop Battery Usage Optimizer — Portable Windows Edition

This version fixes the main portability problem in the previous browser-only project.

## Why the old version showed the wrong data

The old `app.js` generated CPU, RAM, GPU, temperature and power values with JavaScript formulas such as `Math.sin()` and `Math.random()`. Those values were only a demonstration model. A browser cannot directly read most Windows hardware telemetry because of browser sandbox/security restrictions.

Battery percentage looked correct because the browser could read the Battery Status API from the laptop where the page was opened.

## What is changed now

The project now contains a **local, read-only Windows telemetry helper**:

- `server.ps1` reads telemetry from the laptop where it is running.
- `app.js` requests that telemetry from `http://127.0.0.1:8765/api/telemetry`.
- No telemetry is uploaded to the internet.
- The helper does not modify battery settings, power modes, brightness, refresh rate or hardware.
- Unsupported hardware values are displayed as `N/A` rather than invented.

## Folder structure

```text
Laptop_Battery_Usage_Optimizer/
│
├── index.html
├── app.js
├── style.css
├── server.ps1
├── START.bat
├── STOP.bat
├── README.txt
└── assets/
    └── logo.svg
```

## Easiest way to run

### On your laptop

1. Extract the ZIP.
2. Double-click **`START.bat`**.
3. The local helper starts automatically.
4. Chrome/Edge opens the dashboard.
5. Leave the dashboard open while you want live monitoring.


They must repeat the same steps:

1. Extract the same ZIP.
2. Double-click **`START.bat`**.
3. The dashboard opens.
4. The data shown is now from **their Windows laptop**.

They do **not** need to edit `app.js` or enter their laptop specifications.

### To stop monitoring

Double-click **`STOP.bat`**.

## Real telemetry collected

The local helper attempts to read:

- Battery percentage
- Charging/discharging state
- Remaining battery capacity
- Design battery capacity
- Full-charge capacity
- Battery health
- Windows battery discharge power, when exposed by the laptop
- Windows estimated runtime, when available
- CPU utilization
- RAM utilization
- GPU model
- NVIDIA GPU utilization, when `nvidia-smi` is available
- NVIDIA GPU temperature, when available
- Display refresh rate
- Display brightness
- Live Windows process names
- Live process CPU usage
- Live process memory usage

## Important accuracy note

Windows does not provide one universal API for every laptop's CPU temperature, GPU utilization and exact per-process battery watts.

Therefore:

- CPU and RAM are read from Windows telemetry.
- Battery capacity is read from Windows battery information when available.
- Battery discharge power uses the Windows battery discharge-rate field when available.
- NVIDIA GPU utilization/temperature uses `nvidia-smi` when available.
- Per-process **watts are estimates** allocated from the measured battery discharge power using live CPU/memory activity. They are not presented as a physical per-process power meter.
- If a value is unavailable, the project shows `N/A`.

This is much more correct than using fake/simulated values.

## Portability

This edition is designed for Windows 10/11 systems with PowerShell available.

No:

- C++
- Python
- Node.js
- npm
- database
- internet connection
- package installation

is required.

The helper uses Windows/PowerShell built-in capabilities.

## Read-only safety

The telemetry helper only reads system information.

It does **not**:

- change battery health
- charge or discharge the battery
- change Windows power mode
- change brightness
- change refresh rate
- kill processes
- uninstall software
- modify drivers
- modify BIOS
- upload data

The Smart Optimizer now reads the active Windows display brightness and refresh rate directly from the local helper on every live telemetry cycle. The efficiency score and recommendations use those real settings. The What-If controls remain recommendation/model controls and do not directly change Windows hardware settings.

## AOA algorithms

The project demonstrates:

- Greedy Algorithm — prioritizes the highest estimated safe saving.
- Sliding/Rolling Window — maintains recent live samples.
- Running Average — calculates rolling power statistics efficiently.
- Min/Max Tracking — tracks battery extremes.
- Weighted Scoring — calculates system efficiency.
- Rule-Based Decision Algorithm — generates explainable recommendations.
- Sorting/Ranking — ranks live processes by estimated power impact.
- Threshold Classification — classifies process impact as High, Medium or Low.
- Canvas Rendering — renders live graphs from bounded histories.

## If a laptop reports N/A

That does not mean the project is using another laptop's data.

It means Windows or that laptop's hardware driver did not expose that particular metric. The project intentionally shows `N/A` instead of copying or fabricating a value.

## Recommended project demonstration

For college/project presentation:

1. Run `START.bat`.
2. Show the Overview page.
3. Open Task Manager and compare CPU/RAM with the dashboard.
4. Open Power Analysis and show the actual process names from that laptop.
5. Open Battery Health and compare design/full-charge capacity with Windows battery information.
6. Open Analytics and demonstrate that graphs update once per second.
7. Change to another laptop and run the same ZIP. The machine-specific values should change automatically.

## Version



STARTUP FIX (v7)
If START.bat is double-clicked, it now:
- checks whether the local helper is already running;
- starts the helper in a visible PowerShell window so errors are not hidden;
- waits for the /api/health endpoint instead of using a fixed delay;
- opens http://127.0.0.1:8765/ only after the helper is ready;
- shows a clear error and keeps the launcher open if startup fails.

If the dashboard still does not open, run START.bat and read the PowerShell window. Do not close it. The launcher will also show an error instead of silently exiting.

Battery startup behavior
------------------------
The dashboard uses Chrome/Edge's Battery Status API as an instant first source for
battery percentage and charging state. Windows telemetry then fills power, runtime,
capacity and system metrics in the background. Battery level changes are listened for
with the browser's levelchange event, so the displayed percentage updates as soon as
the browser receives the new OS battery state.


FINAL VISUAL THEME (v9)
------------------------
The dashboard uses one consistent "Midnight Neon" theme:
- Background: deep navy
- Cards: midnight blue
- Battery: green
- Power: electric blue
- CPU: purple
- RAM: orange
- GPU: cyan
- Temperature/warnings: red

The live Canvas graphs use matching metric colors, subtle glow, gradient area fill,
explicit Y-axis units and values, elapsed-time X-axis labels, and a highlighted
latest data point. This keeps the charts visually impressive while preserving
meaningful units and readable scaling.
Battery status: shows "Charging" while charging and "On Battery" when the laptop is not connected to charging.


FINAL PATCH — v10.0
--------------------
- Overview display refresh rate now uses Windows' active display mode via EnumDisplaySettings, so a laptop actually running at 60 Hz is shown as 60 Hz instead of the GPU's advertised 144 Hz mode.
- Energy Insights battery-drain chart now has wider Y-axis spacing and cleaner unit formatting so %/min tick labels do not overlap.
- The AOA Project page now ends with an AOA-only Our Team section.
- The team section is not present on Overview, Analytics, Smart Optimizer, Power Analysis, Energy Insights, or Battery Health.


### Project Credit
- Project Developer: Tinkle Jain
- Domain: Analysis of Algorithms
- Platform: Windows
- Project: Laptop Battery Usage Optimizer
