# Changelog

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- System tray icon with a Show and Quit menu and a tooltip with the CPU and GPU temperatures. The close button hides the window to the tray.
- Desktop notification when CPU or GPU temperature stays at 90 °C or more, or the GPU hotspot at 95 °C or more, for 10 seconds. An ALERTS button toggles it.
- `scripts/install-service.ps1` and `scripts/uninstall-service.ps1` register or remove a scheduled task that starts SensorService at logon with the highest run level.
- CPU clock and CPU package power in the CPU panel. Power needs the PawnIO driver (see `docs/SENSORS.md`).
- DETAILED tab next to OVERVIEW: every sensor (LibreHardwareMonitor, Lenovo EC, ACPI thermal zones, network) grouped by hardware with value, min and max, a filter box, and expand or collapse controls. The snapshot gains a `hardware` array.
- Plain-language hints in the Detailed tab: hover a sensor row, a hardware section, a group heading or a column title (`ui/src/help.js`).
- Temperature unit switch, degrees Celsius or Fahrenheit, in SETTINGS or with the U key. The service and all limits stay in Celsius.
- Pin sensors with the star in the Detailed tab. Pinned sensors appear in a Favorites section at the top of the Detailed tab and in a Favorites panel in Overview.
- Keyboard shortcuts (1, 2, /, F, T, U, M, S, ?) and a KEYS button that lists them.
- Theme can follow the operating system. THEME now cycles AUTO, DARK and LIGHT, and AUTO is the default.
- Banner when the CPU, GPU or GPU hotspot stays at or above its limit for 30 seconds, with Snooze (30 minutes) and Dismiss.
- Chart range switch (1 minute, 10 minutes, 1 hour), warm and hot limit lines, and a min, average and max caption.
- Detailed tab: sort by default, name or value, a switch that hides virtual and idle network adapters, and a RESET MIN/MAX button. The service accepts the WebSocket message `reset-minmax`.
- Status chip next to each temperature (NORMAL, WARM, HOT) so state does not depend on colour alone.
- Tooltips on the CPU and GPU labels that explain each reading.
- SETTINGS dialog for the warm, hot and GPU hotspot limits and the alert delay, saved between launches.
- MINI button: a small always-on-top window with CPU, GPU and RAM, and a FULL VIEW button to return.
- Offline screen with START SERVICE (runs the scheduled task without elevation) and RETRY NOW.
- Lenovo power mode (Quiet, Balanced, Performance, Custom) in the top bar, read-only.
- Dev mode with live reload: `npm run dev` in `ui/`.

### Changed
- SensorService runs without a console window and allows one instance.
- The UI text is in English.
- Labels are at least 11 px, as the design system requires.
- The window uses a custom NeonNet title bar and scrolls below it.

## [0.1.0] - 2026-11-24

First release. Tested on a Lenovo LOQ 83JC (Ryzen 7 7435HS, RTX 4060 Laptop, Windows 11).

### Added
- SensorService, a .NET 8 program that runs as administrator and sends a JSON snapshot every 1000 ms over `ws://127.0.0.1:47821/ws`. `GET /snapshot` returns the latest snapshot.
- SensorProbe, a console tool that lists LibreHardwareMonitor sensors and Lenovo WMI classes.
- LOQ Monitor, a Tauri v2 desktop app that reconnects to the service automatically.
- CPU panel: temperature, total load, load per thread, fan speed.
- GPU panel: temperature, hotspot, VRAM temperature, load, power, core and memory clocks, fan speed, PCIe RX/TX throughput, VRAM used and total.
- RAM, VRAM and battery panels. The battery panel shows level, charge/discharge rate, health, and design and full-charge capacity in Wh.
- Storage panel with one card per disk: temperature, used space, remaining life, read and write speed.
- Temperature history charts (90 seconds) for CPU and GPU.
- System log panel with OK, INFO, WARN and CRIT lines derived from the thresholds in `docs/SENSORS.md`.
- NeonNet cyberwave design with Dark and Light themes, plus FX and THEME toggles that persist between launches.
- Application icon and logo in `ui/branding/`.
- Origin allowlist on the WebSocket and a Content Security Policy in the app.

### Known issues
- CPU clock and CPU power are unavailable.
- Motherboard temperature and system fan speed always read 0.
- The sign of the battery rate is unverified, and the Light theme has not been checked on screen.

See `docs/SENSORS.md` for the causes.

[Unreleased]: #
[0.1.0]: #
