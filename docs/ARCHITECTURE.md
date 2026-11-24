# Architecture

LOQ Monitor is two processes. SensorService runs as administrator, reads the hardware, and publishes a JSON snapshot once per second on a loopback WebSocket. The Tauri app runs with normal rights, receives the snapshots, and draws them.

```
 Hardware                      Admin process                    User process
┌────────────────┐        ┌──────────────────────┐        ┌───────────────────────┐
│ CPU/GPU/RAM/   │  LHM   │                      │        │  LOQ Monitor (Tauri)  │
│ SSD/Battery    │───────▶│                      │  WS    │  WebView2             │
├────────────────┤        │    SensorService     │───────▶│  index.html           │
│ Lenovo EC      │  WMI   │    (.NET 8)          │  JSON  │  main.js (render)     │
│ (temps, fans)  │───────▶│                      │ 1 Hz   │  style.css/tokens.css │
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

`SensorReader` opens LHM for CPU, GPU, memory, storage and battery, and keeps one WMI object (`LENOVO_OTHER_METHOD`) for the Lenovo fan and temperature reads. Its `Read()` method updates every hardware item and maps the sensors to the `Snapshot` record.

A `PeriodicTimer` calls `Read()` every 1000 ms. The service serializes the result with camelCase names, omits null fields, and sends it to every connected client. `HttpListener` binds to `127.0.0.1` only and answers 403 to any request whose `Origin` header is not in the allowlist.

### UI

`main.js` connects to the WebSocket and, after a disconnect, retries after 1 to 5 seconds (the delay grows by 0.5 s per attempt). `render(s)` updates the DOM and skips drawing while the window is hidden, though it still records the history. The code builds DOM nodes with `createElement` and `textContent` and never assigns `innerHTML`. The theme and FX preferences go to `localStorage` inside `try/catch`, so the app still renders when storage is blocked.

Tauri embeds the frontend files at compile time, so a frontend change requires a new build.

## Interface

| Endpoint | Behavior |
|---|---|
| `ws://127.0.0.1:47821/ws` | Sends the latest snapshot on connect, then one every 1000 ms. |
| `GET http://127.0.0.1:47821/snapshot` | Returns the latest snapshot as JSON. |

The allowed origins are the empty origin (non-browser clients), `tauri://localhost`, `http://tauri.localhost`, `https://tauri.localhost` and `http://localhost:1420`.

```
Snapshot { ts, cpu, gpu, ram, storage[], battery? }
cpu     { name, load, tempC, fanRpm, coreLoads[] }
gpu     { name, load, tempC, hotspotC, vramTempC, fanRpm, powerW, coreClockMHz,
          memClockMHz, vramUsedMB, vramTotalMB, pcieRxMBs, pcieTxMBs }
ram     { loadPct, usedGB, availableGB }
storage { name, tempC, usedPct, lifePct, readMBs, writeMBs, activityPct }
battery { levelPct, rateW, degradationPct, designedWh, fullWh }
```

The records in `SensorService/Program.cs` define this schema. A numeric field is absent when its sensor has no value, and the UI then shows `--`.

## Design decisions

| Decision | Reason |
|---|---|
| Tauri v2 for the UI | It renders with the WebView2 runtime installed on Windows and bundles no browser engine. |
| Plain HTML, CSS and JavaScript | The app has one screen, so a framework and a frontend build step add nothing. |
| Separate service and UI processes | Only the service needs administrator rights, so the UI runs without them. |
| WebSocket on loopback | Further clients, such as an overlay or a tray icon, can read the same stream without changes to the service. |
| Port 47821 | Port 8765 is in use by another program on the development machine. |
| CPU temperature from the Lenovo EC first | LHM returns 0 for CPU temperature on the test machine (see `docs/SENSORS.md`), while the EC value works. |
| Read-only service | No endpoint changes fan or power settings. |
| Origin allowlist | A web page in a browser cannot read the stream through `ws://127.0.0.1`. |

## Security

- The listener binds to `127.0.0.1`, so the network cannot reach it.
- Every request is checked against the origin allowlist.
- The app CSP is `default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src ws://127.0.0.1:47821 http://127.0.0.1:47821`.
- The service ignores incoming WebSocket messages except a close frame.

## Build and run

Build the service into a separate folder, because a running administrator process locks the files in its own output folder.

```powershell
dotnet build SensorService -c Release -o SensorService\out
# run SensorService\out\SensorService.exe as administrator

cd ui
npm install
npx tauri build --debug --no-bundle
# output: ui\src-tauri\target\debug\app.exe
```
