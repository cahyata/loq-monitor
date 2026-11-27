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
                           127.0.0.1:47821 (/ws, /snapshot, /system)
```

The split exists because the Lenovo WMI calls and the LibreHardwareMonitor (LHM) driver need administrator rights, and the UI does not.

## Components

| Component | Location | Role |
|---|---|---|
| SensorService | `SensorService/` | Reads sensors, builds a `Snapshot`, broadcasts it. Its manifest requests `requireAdministrator`. |
| SensorProbe | `SensorProbe/` | Diagnostic console tool, run by hand. |
| UI | `ui/` | Tauri v2 app in plain HTML, CSS and JavaScript, with no framework or bundler. |

### SensorService

`SensorReader` opens LHM for CPU, GPU, memory, storage, battery, motherboard, controllers and network adapters. `HardwarePick.cs` holds the rules that differ between laptops: which GPU to show, the order of the processor threads and the sensor names on AMD and Intel. A value that is not a finite number is written as null. It keeps two WMI objects: `LENOVO_OTHER_METHOD` for the Lenovo fan and temperature reads, and `LENOVO_GAMEZONE_DATA` for the power mode. It also reads the ACPI thermal zones (`MSAcpi_ThermalZoneTemperature`). `Read()` updates every hardware item, maps the main sensors to the typed records, and lists every sensor in `hardware` for the Detailed tab. CPU clock and package power need the PawnIO driver (see `docs/SENSORS.md`); without it the clock falls back to Windows performance counters.

A `PeriodicTimer` calls `Read()` every 1000 ms. The service serializes the result with camelCase names, omits null fields, and sends it to every connected client. `HttpListener` binds to `127.0.0.1` only and answers 403 to any request whose `Origin` header is not in the allowlist.

### Game overlay

The overlay is a second Tauri window (`overlay`, page `overlay.html`). Rust creates it the first time it is shown, with no frame, a transparent background, always on top, no taskbar entry, and mouse events ignored, and afterwards only hides and shows it. A global shortcut (`tauri-plugin-global-shortcut`, default Ctrl+Shift+O) and the tray menu toggle it. The overlay page opens its own WebSocket to the service, so it works while the main window is hidden in the tray. `metrics.js` holds the catalog of readings and the function that draws them; both the overlay page and the preview in the Overlay tab use it. Settings live in `localStorage` (key `overlay`), which both windows share, and the overlay re-reads them on every update. The overlay page measures its own content and reports the size to Rust (`overlay_resize`), and Rust places the window in the chosen screen corner on the primary monitor. Drawing over a game depends on how the game presents: windowed and borderless fullscreen work, exclusive fullscreen does not, because the overlay is an ordinary window and does not inject into the game. It has no FPS reading, which would need a frame-timing tool such as PresentMon.

### Startup

`scripts/install-service.ps1` registers the scheduled task "LOQ Monitor Service", which starts SensorService at logon with the highest run level. `scripts/uninstall-service.ps1` removes it. The service allows one instance and has no console window. If the listener cannot start, it writes the reason to `service.log` next to the executable.

### UI

`rules.js` is the one place that judges readings: the level of each temperature, fill, battery and drive value, what a snapshot has that needs attention, the power mode names and which network adapters are virtual. It is pure, so the pages pass in the limits of the user and decide the words and colors. The main window and the overlay load it first, and `npm test` in `ui/` runs its tests in Node. The terms are defined in `GLOSSARY.md`.

`link.js` is the one place that talks to the service, and the main window and the overlay each make one link. It connects to the WebSocket and, after a disconnect, retries after 1 to 5 seconds (the delay grows by 0.5 s per attempt). A page says what it needs with `need` (programs, network, power limits, frame rate); the link sends the on and off commands and asks again after a reconnect. It also reads `/system`, once for all pages until a refresh, and `/events`. `main.js` shows the connection state. Each snapshot goes to `Pages` and to the parts that belong to no page: the tray tooltip, the alerts, the heat banner, the power mode, the status line and mini mode.

`pages.js` owns the pages: one table gives their order, number keys, tabs and panels, and it opens them, remembers the open one and tells each when to work. A page file registers its hooks with `Pages.add`: `collect` receives every snapshot, so history and statistics are recorded also while another page or the tray is showing, and `draw` runs only while the page is open and the window can be seen and is not in mini mode. `show` and `hide` are the other hooks. The code builds DOM nodes with `createElement` and `textContent` and never assigns `innerHTML`. The window has no native frame. `index.html` draws its own title bar (drag region plus minimize, maximize and close buttons that call the Tauri window API), and the page scrolls inside `#scroller`, below the title bar and the row of pages, so the scrollbar starts under both. Closing the window hides it to the system tray instead of exiting. The tray icon shows a tooltip with the CPU and GPU temperatures, and its menu has Show and Quit. When a CPU or GPU temperature stays at or above its limit for 10 seconds, the UI asks the Rust side for a desktop notification (cooldown 10 minutes per sensor). The UI keeps every temperature in degrees Celsius and converts only for display (Celsius or Fahrenheit). The theme (auto follows the system, or dark, or light), FX, alerts, unit, limits, chart range, tab, sort, pinned sensors and network filter preferences go to `localStorage` inside `try/catch`, so the app still renders when storage is blocked.

The UI keeps one hour of history (one sample per second, in memory only). The temperature charts show the last 1 minute, 10 minutes or 1 hour with the warm and hot limit lines and a min, average and max caption. When a CPU or GPU temperature or the GPU hotspot stays at or above its limit for 30 seconds, a banner appears with Snooze and Dismiss buttons.

The window has a title bar and a pinned row of pages. The title bar carries the read only status (service link, Lenovo power mode, alerts, clock) and the window controls. The pinned row holds the pages as one joined control (Overview, Insights, Detailed, System, Diagnosis, Care, then Overlay set apart) and the MINI and SETTINGS buttons. The status summary line sits under it and scrolls with the content, which on Overview shares its row with the chart range. Keys 1 to 7 open the pages in that order.

Overview (`overview.js`) shows the panels. Care (`care.js`) holds the maintenance tips as data, each with its sources; a link opens through the Rust command `open_source`, which accepts only HTTPS addresses on the listed hosts. Diagnosis (`diag.js`) records the heat history in `localStorage` (key `heatlog`, 500 entries), shows `/events`, and keeps one reading per second for 6 hours in memory for the CSV export, which the Rust command `save_csv` writes to the Downloads folder. Insights (`insights.js`) ranks programs, shows power and energy, GPU limits, the network, drive health from the SMART sensors in `hardware`, and session statistics. System (`system.js`) shows the machine facts from `/system`. Overlay (`overlayui.js`) configures the game overlay. Detailed (`detail.js`) lists every sensor in `hardware`, grouped by hardware and sensor type with value, minimum and maximum, a filter box, and expand and collapse controls. It sorts by default order, name or value, hides virtual and idle network adapters on request, and has a Reset min/max button that sends `reset-minmax`. It refreshes only the sections that are open.

`ds-tokens.css` is generated from the NeonNet design system (`neon-design-system`) and must not be edited by hand. `tokens.css` holds only the values that system does not define.

Tauri embeds the frontend files at compile time, so a frontend change in a release build requires a new build. `npm run dev` in `ui/` instead serves `ui/src` from `dev-server.mjs` on `http://localhost:1420` and reloads the window when a file changes.

## Interface

| Endpoint | Behavior |
|---|---|
| `ws://127.0.0.1:47821/ws` | Sends the latest snapshot on connect, then one every 1000 ms. |
| `GET http://127.0.0.1:47821/snapshot` | Returns the latest snapshot as JSON. |
| `GET http://127.0.0.1:47821/system` | Returns the System page data: device, firmware, Windows, processor, graphics, memory modules, drives, volumes, network adapters and battery. It is read from WMI and the registry on the first request (about 1.7 s) and kept. `?refresh=1` reads it again. The response carries `Access-Control-Allow-Origin` for an allowed origin, because the app fetches it. Serial numbers and the user name are not read. |
| `GET http://127.0.0.1:47821/events?days=30` | Returns the Windows Event Log entries of the last 1 to 90 days for the Diagnosis page (`EventHistory.cs`): `events[]` (hardware errors, blue screens and shutdowns without warning, graphics driver and drive errors), `programs[]` (crash and not-responding counts per program) and `failed[]` (logs that could not be read). At most 500 entries of each kind are read, and the answer is kept for a minute (5 seconds with `?refresh=1`). Folder paths and user names are left out. It carries `Access-Control-Allow-Origin` like `/system`. |
| WebSocket text `fps-on`, `fps-off` | Starts or stops PresentMon for this connection. Frame data appears in `fps` while at least one connection wants it. |
| WebSocket text `procs-on`, `procs-off` | Starts or stops the program ranking for this connection. `processes` appears in the snapshot while at least one connection wants it. |
| WebSocket text `net-on`, `net-off` | Starts or stops the network probe for this connection. `network` appears in the snapshot while at least one connection wants it. |
| WebSocket text `limits-on`, `limits-off` | Starts or stops reading the power limits for this connection. `limits` appears in the snapshot while at least one connection wants it, refreshed every 5 s. |
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

`gpu.throttleMask` is the NVIDIA clock throttle reason mask from `nvml.dll` (0x4 power limit, 0x8 hardware slowdown, 0x20 heat limit, 0x40 hardware heat limit, 0x80 power brake), or absent without an NVIDIA driver. `processes` holds the top five programs by CPU, private memory and GPU, summed over all processes of a program, from the raw Windows performance counters (`ProcessSampler.cs`, scanned every 3 s while requested). `processes.disk` holds the eight programs that moved the most data to and from the drives in the last interval (read and write in MB/s, plus the totals in MB since the list was requested), from the kernel's disk events (`DiskTracer.cs`, an ETW session named `LOQMonitorDisk` that exists only while requested); it is null when Windows refuses the trace. The per-process I/O counters are not used for this, because they also count pipes, network and cached reads. `network` (`NetProbe.cs`, every 2 s while requested) holds the Wi-Fi link from the Windows WLAN API (`wlanapi.dll`: network name, signal quality in percent, link speed, standard, channel) and ping statistics (now, average, jitter and loss over the last 30 replies) to the default gateway and to the first IPv4 DNS server of the same connection. It never contacts a host the machine does not already use. `limits` holds the CPU sustained, short-term and peak power limits and the CPU temperature limit from the Lenovo firmware, and the GPU enforced power limit and slowdown temperature from NVML. `battery.acOnline` and `battery.charging` come from the Windows battery status. `/system` also returns `powerModes`, the default limits of each Lenovo power mode. `powerMode` is the Lenovo power mode: 1 Quiet, 2 Balanced, 3 Performance, 224 or 255 Custom. `hardware` carries every sensor (about 17 KB per snapshot on the test machine), so the Detailed tab needs no second request. `min` and `max` for the Lenovo EC and ACPI groups are tracked by the service since it started.

The records in `SensorService/Program.cs` define this schema. A numeric field is absent when its sensor has no value, and the UI then shows `--`.

## Design decisions

| Decision | Reason |
|---|---|
| Tauri v2 for the UI | It renders with the WebView2 runtime installed on Windows and bundles no browser engine. |
| Plain HTML, CSS and JavaScript | The app has few screens, so a framework and a frontend build step add nothing. |
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
- The service ignores incoming WebSocket messages except a close frame and the text messages `reset-minmax`, `fps-on`, `fps-off`, `procs-on`, `procs-off`, `net-on`, `net-off`, `limits-on` and `limits-off`, which restart min and max tracking or ask for frame and program data. No message changes a hardware or power setting.

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
