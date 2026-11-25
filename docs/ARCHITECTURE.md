# Architecture

LOQ Monitor is two processes. SensorService runs as administrator, reads the hardware, and publishes a JSON snapshot once per second on a loopback WebSocket. The Tauri app runs with normal rights, receives the snapshots, and draws them.

```
 Hardware                      Admin process                    User process
┌────────────────┐        ┌──────────────────────┐        ┌───────────────────────┐
│ CPU/GPU/RAM/   │  LHM   │                      │        │  LOQ Monitor (Tauri)  │
│ SSD/Battery    │───────▶│                      │  WS    │  WebView2             │
├────────────────┤        │    SensorService     │───────▶│  index.html           │
│ Lenovo EC, ACPI│  WMI   │    (.NET 8)          │  JSON  │  main.js, detail.js   │
│ (temps, fans,  │───────▶│                      │ 1 Hz   │  style.css, tokens    │
│  power mode)   │        │                      │        │  tray, notifications  │
└────────────────┘        └──────────────────────┘        └───────────────────────┘
                           127.0.0.1:47821 (/ws, /snapshot)
```

The split exists because the Lenovo WMI calls and the LibreHardwareMonitor (LHM) driver need administrator rights, and the UI does not.

## Components

| Component | Location | Role |
|---|---|---|
| SensorService | `SensorService/` | Reads sensors, builds a `Snapshot`, broadcasts it. Its manifest requests `requireAdministrator`. |
| SensorProbe | `SensorProbe/` | Diagnostic console tool, run by hand. |
| UI | `ui/` | Tauri v2 app in plain HTML, CSS and JavaScript, with no framework or bundler. |

### SensorService

`SensorReader` opens LHM for CPU, GPU, memory, storage, battery, motherboard, controllers and network adapters. It keeps two WMI objects: `LENOVO_OTHER_METHOD` for the Lenovo fan and temperature reads, and `LENOVO_GAMEZONE_DATA` for the power mode. It also reads the ACPI thermal zones (`MSAcpi_ThermalZoneTemperature`). `Read()` updates every hardware item, maps the main sensors to the typed records, and lists every sensor in `hardware` for the Detailed tab. CPU clock and package power need the PawnIO driver (see `docs/SENSORS.md`); without it the clock falls back to Windows performance counters.

A `PeriodicTimer` calls `Read()` every 1000 ms. The service serializes the result with camelCase names, omits null fields, and sends it to every connected client. `HttpListener` binds to `127.0.0.1` only and answers 403 to any request whose `Origin` header is not in the allowlist.

### Game overlay

The overlay is a second Tauri window (`overlay`, page `overlay.html`). Rust creates it the first time it is shown, with no frame, a transparent background, always on top, no taskbar entry, and mouse events ignored, and afterwards only hides and shows it. A global shortcut (`tauri-plugin-global-shortcut`, default Ctrl+Shift+O) and the tray menu toggle it. The overlay page opens its own WebSocket to the service, so it works while the main window is hidden in the tray. `metrics.js` holds the catalog of readings and the function that draws them; both the overlay page and the preview in the Overlay tab use it. Settings live in `localStorage` (key `overlay`), which both windows share, and the overlay re-reads them on every update. The overlay page measures its own content and reports the size to Rust (`overlay_resize`), and Rust places the window in the chosen screen corner on the primary monitor. Drawing over a game depends on how the game presents: windowed and borderless fullscreen work, exclusive fullscreen does not, because the overlay is an ordinary window and does not inject into the game. It has no FPS reading, which would need a frame-timing tool such as PresentMon.

### Startup

`scripts/install-service.ps1` registers the scheduled task "LOQ Monitor Service", which starts SensorService at logon with the highest run level. `scripts/uninstall-service.ps1` removes it. The service allows one instance and has no console window. If the listener cannot start, it writes the reason to `service.log` next to the executable.

### UI

`main.js` connects to the WebSocket and, after a disconnect, retries after 1 to 5 seconds (the delay grows by 0.5 s per attempt). `render(s)` updates the DOM and skips drawing while the window is hidden, though it still records the history. The code builds DOM nodes with `createElement` and `textContent` and never assigns `innerHTML`. The window has no native frame. `index.html` draws its own title bar (drag region plus minimize, maximize and close buttons that call the Tauri window API), and the page scrolls inside `#scroller` so the scrollbar starts below the bar. Closing the window hides it to the system tray instead of exiting. The tray icon shows a tooltip with the CPU and GPU temperatures, and its menu has Show and Quit. When a CPU or GPU temperature stays at or above its limit for 10 seconds, the UI asks the Rust side for a desktop notification (cooldown 10 minutes per sensor). The UI keeps every temperature in degrees Celsius and converts only for display (Celsius or Fahrenheit). The theme (auto follows the system, or dark, or light), FX, alerts, unit, limits, chart range, tab, sort, pinned sensors and network filter preferences go to `localStorage` inside `try/catch`, so the app still renders when storage is blocked.

The UI keeps one hour of history (one sample per second, in memory only). The temperature charts show the last 1 minute, 10 minutes or 1 hour with the warm and hot limit lines and a min, average and max caption. When a CPU or GPU temperature or the GPU hotspot stays at or above its limit for 30 seconds, a banner appears with Snooze and Dismiss buttons.

The app has two tabs. Overview shows the panels. Detailed (`detail.js`) lists every sensor in `hardware`, grouped by hardware and sensor type with value, minimum and maximum, a filter box, and expand and collapse controls. It sorts by default order, name or value, hides virtual and idle network adapters on request, and has a Reset min/max button that sends `reset-minmax`. It refreshes only the sections that are open.

`ds-tokens.css` is generated from the NeonNet design system (`neon-design-system`) and must not be edited by hand. `tokens.css` holds only the values that system does not define.

Tauri embeds the frontend files at compile time, so a frontend change in a release build requires a new build. `npm run dev` in `ui/` instead serves `ui/src` from `dev-server.mjs` on `http://localhost:1420` and reloads the window when a file changes.

## Interface

| Endpoint | Behavior |
|---|---|
| `ws://127.0.0.1:47821/ws` | Sends the latest snapshot on connect, then one every 1000 ms. |
| `GET http://127.0.0.1:47821/snapshot` | Returns the latest snapshot as JSON. |
| WebSocket text `reset-minmax` | Resets the minimum and maximum of every sensor, including the Lenovo EC and ACPI values the service tracks itself. |

The allowed origins are the empty origin (non-browser clients), `tauri://localhost`, `http://tauri.localhost`, `https://tauri.localhost` and `http://localhost:1420`.

```
Snapshot { ts, cpu, gpu, ram, storage[], battery?, powerMode?, hardware[] }
cpu     { name, load, tempC, fanRpm, clockMHz, powerW, coreLoads[] }
gpu     { name, load, tempC, hotspotC, vramTempC, fanRpm, powerW, coreClockMHz,
          memClockMHz, vramUsedMB, vramTotalMB, pcieRxMBs, pcieTxMBs }
ram     { loadPct, usedGB, availableGB }
storage { name, tempC, usedPct, lifePct, readMBs, writeMBs, activityPct }
battery { levelPct, rateW, degradationPct, designedWh, fullWh }
hardware[] { name, type, sensors[] { type, name, value, min, max } }
```

`powerMode` is the Lenovo power mode: 1 Quiet, 2 Balanced, 3 Performance, 224 or 255 Custom. `hardware` carries every sensor (about 17 KB per snapshot on the test machine), so the Detailed tab needs no second request. `min` and `max` for the Lenovo EC and ACPI groups are tracked by the service since it started.

The records in `SensorService/Program.cs` define this schema. A numeric field is absent when its sensor has no value, and the UI then shows `--`.

## Design decisions

| Decision | Reason |
|---|---|
| Tauri v2 for the UI | It renders with the WebView2 runtime installed on Windows and bundles no browser engine. |
| Plain HTML, CSS and JavaScript | The app has one screen, so a framework and a frontend build step add nothing. |
| Separate service and UI processes | Only the service needs administrator rights, so the UI runs without them. |
| WebSocket on loopback | Further clients, such as an overlay, can read the same stream without changes to the service. |
| Everything in the snapshot | The Detailed tab reads `hardware` from the same stream, so the service has one output path and no extra endpoint. |
| Custom title bar and tray | The window looks like the NeonNet design and keeps running in the background for notifications. |
| Port 47821 | Port 8765 is in use by another program on the development machine. |
| CPU temperature from the Lenovo EC first | LHM returns 0 for CPU temperature on the test machine (see `docs/SENSORS.md`), while the EC value works. |
| Read-only service | No endpoint changes fan or power settings. |
| Origin allowlist | A web page in a browser cannot read the stream through `ws://127.0.0.1`. |

## Updates

The Tauri updater plugin (`tauri-plugin-updater`) does the work. `ui/src/updater.js` calls `check()` eight seconds after start, and again from SETTINGS on request. The plugin reads `latest.json` from the latest GitHub Release, compares the version, and verifies the downloaded installer against the public key in `tauri.conf.json` (`plugins.updater.pubkey`) before it runs it. The installer runs in passive mode and needs administrator rights.

Before it copies files, the installer stops the sensor service, because the running service locks its files. After the copy, the hook registers the scheduled task again with `install-service.ps1 -Update`, which keeps the sign-in choice of the existing task. Publishing a release is described in `RELEASING.md`.

## Security

- The listener binds to `127.0.0.1`, so the network cannot reach it.
- Every request is checked against the origin allowlist.
- The app CSP is `default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src ws://127.0.0.1:47821 http://127.0.0.1:47821`.
- The service ignores incoming WebSocket messages except a close frame and the text message `reset-minmax`, which restarts min and max tracking. No message changes a hardware or power setting.

## Build and run

Build the service into a separate folder, because a running administrator process locks the files in its own output folder. To update an installed service, build into `SensorService\out2`, stop the task, copy the files over `out`, and run `scripts\install-service.ps1` from an administrator shell.

```powershell
dotnet build SensorService -c Release -o SensorService\out
# first install: run scripts\install-service.ps1 as administrator

cd ui
npm install
npx tauri build --debug --no-bundle
# output: ui\src-tauri\target\debug\app.exe

# development with live reload
npm run dev
```
