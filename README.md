# LOQ Monitor

A hardware monitor for the Lenovo LOQ 83JC (Ryzen 7 7435HS, RTX 4060 Laptop, Windows 11), with a NeonNet cyberwave interface and a game overlay.

It reads the CPU, GPU, memory, storage and battery sensors, plus values that only the Lenovo embedded controller exposes, such as the CPU temperature, fan speeds and power mode. Other Lenovo or non-Lenovo machines can work, but some readings will be missing or wrong. See [docs/SENSORS.md](docs/SENSORS.md) for the status of each reading.

## Features

- **Overview:** CPU, GPU, RAM, storage and battery panels with live charts (1, 10 or 60 minutes), a status summary, and a heat warning when a temperature stays high.
- **Detailed:** every sensor grouped by hardware, like HWMonitor, with value, minimum and maximum, a filter, pinned favorites, and a plain-language hint on hover.
- **Game overlay:** a transparent, click-through panel over your game that shows the readings you choose, including FPS, frame time and 1% low. It has presets, an order list, eight positions on any display, offsets, size, opacity, accent color, font, spacing and corner radius, and a global hotkey (default `Ctrl+Shift+O`).
- **System:** device, firmware, Windows, processor, graphics, memory modules, drives, network and battery facts on one page, with a switch that hides addresses and a button that copies a plain text report.
- **Alerts:** desktop notifications when the CPU, GPU or GPU hotspot temperature stays above your limits.
- **Comfort:** °C or °F, dark, light or system theme, a small always-on-top mini mode, a tray icon, and keyboard shortcuts (press `?` in the app).

The overlay works over games in windowed or borderless fullscreen mode. It cannot draw over exclusive fullscreen. The FPS, frame time and 1% low readings come from PresentMon, which measures the program that has the focus.

## Install

Download `LOQ Monitor_0.1.0_x64-setup.exe` and run it. The installer asks for administrator rights, because the sensor service needs them. It:

1. Copies the app and the sensor service to `C:\Program Files\LOQ Monitor`.
2. Installs the [PawnIO](https://github.com/namazso/PawnIO) driver with `winget` when it is missing. CPU package power needs it. If this step fails, that one reading shows `--`.
3. Asks whether the sensor service starts when you sign in, then registers it as a scheduled task and starts it.

The installer is not code signed, so Windows SmartScreen can warn you. Choose **More info**, then **Run anyway**.

## Updates

The app checks GitHub Releases for a newer version a few seconds after it starts. When one exists, a banner offers **INSTALL AND RESTART**. Nothing installs without your click. Turn the check off, or run it by hand, in **SETTINGS > Updates**. The installer keeps the sign-in choice you made for the service. See [docs/RELEASING.md](docs/RELEASING.md) for how a release is published.

To remove it, use **Add or Remove Programs**. This stops the service and deletes the task. PawnIO stays, because other tools can use it.

## How it works

Two programs talk over a local WebSocket:

```
SensorService (C#, .NET 8, elevated)  --ws://127.0.0.1:47821/ws-->  App (Tauri 2, HTML/CSS/JS)
```

- **SensorService** reads the hardware once per second and publishes a JSON snapshot. It runs as a scheduled task with the highest run level, so it starts without a UAC prompt. It listens on localhost only and checks the origin of each connection.
- **The app** shows the snapshot. It never changes your hardware. The one command it can send, `reset-minmax`, only restarts the min and max tracking.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the details.

## Build from source

You need the .NET 8 SDK, Node.js and a Rust toolchain.

```powershell
# Sensor service
dotnet publish SensorService -c Release -r win-x64 --self-contained true -o SensorService\publish

# Register it as a scheduled task (administrator shell), pointing at your build
.\scripts\install-service.ps1 -Exe .\SensorService\publish\SensorService.exe

# App, with live reload of the frontend
cd ui
npm install
npm run dev

# Release installer
npx tauri build --bundles nsis
```

`scripts\install-service.ps1 -NoAutoStart` registers the task without the sign-in trigger. `scripts\uninstall-service.ps1` removes it.

## Project layout

| Path | Contents |
|---|---|
| `SensorService/` | The C# service that reads sensors and serves snapshots |
| `SensorProbe/` | A console tool that prints raw sensor reads for diagnosis |
| `ui/src/` | The interface: plain HTML, CSS and JavaScript, no bundler |
| `ui/src-tauri/` | The Tauri shell in Rust, tray, overlay window and installer hooks |
| `scripts/` | Install and uninstall scripts for the service |
| `docs/` | Architecture and sensor notes |

## Known limits

- The motherboard temperature and system fan read 0 on the test machine.
- No FPS counter. It would need a frame-timing source such as PresentMon.

## License

[MIT](LICENSE). Third-party components and their licenses are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
