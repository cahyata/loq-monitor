# Changelog

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [0.5.0] - 2026-11-26

### Added

- A Diagnosis tab.
- Heat history: when a CPU, GPU or GPU hotspot temperature passed its limit, how high it went, how long it lasted and the power mode. It is kept across restarts.
- Windows problems from the Event Log for the last 7, 30 or 90 days: hardware errors (WHEA), blue screens and shutdowns without warning, graphics driver and drive errors, and programs that crashed or stopped responding.
- Export of the sensor readings of the last 6 hours to a CSV file in the Downloads folder, with a decimal point or a decimal comma.
- A Care tab: what shortens the life of the battery, cooling, SSD and adapter and what helps, with a link to the source of each tip, and advice drawn from the current readings.
- The installer includes the MIT license of LOQ Monitor and the license texts of the software it ships.

### Changed

- Key 5 opens Diagnosis, key 6 opens Care, and the Overlay tab moved to key 7.
- The row of pages stays fixed, and the scrollbar starts under it.
- A tidier layout: Overview fits the default window without scrolling and keeps the CPU and GPU side by side in the smallest window, Settings keeps CLOSE in view, the program crash list starts with eight entries, and the Care cards fill their columns.

### Fixed

- The sensor service no longer stops on processors whose threads are named by core and thread, which is expected on Intel models with Hyper-Threading.
- On laptops with both a built-in AMD graphics processor and an NVIDIA GPU, the GPU panel uses the NVIDIA GPU.
- CPU power and the fallback CPU temperature are read on Intel processors.
- The window can be dragged by the status text in the title bar (service, power mode, alerts and clock).
- A sensor that reports infinity or no number no longer stops the service. The value shows as `--`.

The processor, graphics and sensor fixes are tested with simulated sensors, not on Intel or Radeon hardware.

## [0.4.0] - 2026-11-26

### Added

- A Storage card on the Insights tab: life left, total data written and read, data written this session and today, power-on hours, power cycles, spare blocks and temperature for each drive, from its SMART health report.
- A table of the programs using the drives, with reading and writing speed and the totals since the tab was opened.

### Changed

- The disk ranking moved from Top programs to the Storage card.
- Settings are saved and applied as soon as you change them. The Save and Cancel buttons are gone.

### Fixed

- Using a control in Settings or Help with the keyboard no longer closes the window.
- The disk ranking counted pipes, network traffic and cached reads as disk use, and could show tens of MB/s while the drives were idle. It now counts only data that goes to or from a drive.

## [0.3.0] - 2026-11-25

### Added
- A POWER LIMITS card on the Insights tab. It shows the CPU and GPU power and temperature against their limits (CPU from the Lenovo firmware, GPU from the NVIDIA driver) and a table of what each Lenovo power mode allows, with the active mode highlighted. The service reads the limits only while the Insights tab is open.
- The battery panel says whether the charger is connected and whether charging is paused.
- Not added, because this model does not expose them through WMI: the GPU mode switch, Battery Conservation Mode and Rapid Charge. See `docs/SENSORS.md`.
- A NETWORK card on the Insights tab. It graphs download and upload speed for the last five minutes, shows the Wi-Fi network, signal strength (with bars and a word), link speed, standard and channel, and measures ping to the router and the DNS server (now, average, jitter, loss). A verdict says whether the router connection looks good, is unsteady or has a problem, and explains the likely cause. The network name and addresses are hidden by default. The service reads the Wi-Fi link from the Windows WLAN API and pings only the router and DNS server it already uses, and only while the Insights tab is open.
- An INSIGHTS tab (key 2). TOP PROGRAMS ranks programs by CPU, memory, GPU or disk. POWER shows the current draw, the energy used this session and today, and an optional cost. With the charger plugged in it adds an estimate for the rest of the laptop, learned from the difference between the battery reading and CPU plus GPU while the laptop ran on battery, and marks the number with a tilde. GPU LIMITS says why the GPU is held back and for how long. THIS SESSION shows the lowest, average and highest values since the app opened.
- A chip next to the GPU temperature says when the GPU is held back (power limit, heat limit, power brake or hardware slowdown) and explains it on hover. A heat limit or hardware slowdown also appears in the status line.
- The battery panel shows the time left on battery, or the time to full while charging.
- SETTINGS has an electricity price and currency for the cost estimate.
- The service reads the GPU throttle reasons from NVML and ranks programs from the raw Windows performance counters. The ranking runs only while the Insights tab is open.
- A SYSTEM tab (key 4) with the facts about the machine: device and mainboard, BIOS and Secure Boot, Windows version and uptime, processor, graphics and driver, memory modules, drives and volumes, network adapters, and battery capacity and cycles. It can hide the host name, IP and MAC addresses, which is on by default, and COPY REPORT puts the page in the clipboard as plain text. The service reads Windows once and serves it at `GET /system`. Serial numbers and the user name are never read.

### Changed
- With visual effects on, the default, the window used about half a core while it had focus, because the moving grid ran as a 60 Hz CSS animation. A timer now steps it ten times a second and stops it on battery power. It uses about a tenth of that.
- A hot temperature chip blinks with a class flipped twice a second instead of a CSS animation, which cost about 6 points of CPU on the Overview.
- The program scan on the Insights tab skips GPU engines that were never used, which lowers the service CPU by about a quarter while the tab is open.
- The header is sorted by purpose. Read only status (service, power mode, alerts, clock) moved to the title bar, next to the window controls. Below it, the pages are one joined control in the order Overview, Insights, Detailed, System, with Overlay set apart because it is a feature and shows a dot while the overlay is on. MINI and SETTINGS are separate buttons with icons on the right. The status line moved under the pages and scrolls away, so only one row stays pinned. The keys 1 to 5 follow the new order.
- Layout pass over every page. The tabs stay in view while a page scrolls, and each page opens at its top. The history selector moved from the tab bar to the top of the Overview charts. The CPU and GPU panel titles lost their brackets to match the other panels. Tabs show their key in a tooltip.
- The Overlay page puts the preview and the appearance settings side by side, with the preview pinned while the settings scroll, and groups the settings into Placement, Look and Style. The page is a third shorter.
- On the System page paired cards share a height, and the battery sits next to the graphics card instead of leaving a gap.

## [0.2.0] - 2026-11-25

### Changed
- The window uses about one eighth of the CPU on the Overview tab (40 % of a core before, about 5 % now). The bars grow with `transform` and no longer animate, which stops the layout and GPU work that ran on every frame.
- The service reads the Lenovo values once per tick and refreshes the power mode, the ACPI zones and the battery power less often. One tick takes 159 ms instead of 260 ms. See `docs/PERFORMANCE.md`.

### Added
- FPS, frame time and 1% low readings in the game overlay, measured by PresentMon for the program that has the focus. The service starts PresentMon only while the overlay is visible and shows one of these readings. `scripts/get-presentmon.ps1` downloads it, and the release workflow adds it to the installer.
- More overlay settings: eight positions including top center, bottom center and the middle of each side, separate horizontal and vertical offsets, a choice of display, an accent color, three fonts, three spacings, a corner radius, a switch for status colors, and a list that sets the order of the readings.

## [0.1.2] - 2026-11-25

### Fixed
- The battery power was blank while the laptop ran on battery, because LibreHardwareMonitor leaves its rate sensor empty while discharging. The service now reads it from Windows (`BatteryStatus` in `root\WMI`), so the battery panel and the overlay show the drain in watts.

## [0.1.1] - 2026-11-25

### Added
- Auto update from GitHub Releases. The app checks at start, shows a banner when a newer version exists, and installs it on request. SETTINGS has an Updates group. Releases are built and signed by a GitHub Actions workflow when a version tag is pushed (see `docs/RELEASING.md`).
- The NSIS installer bundles the sensor service (self-contained), asks whether it starts at sign in, installs the PawnIO driver with winget when missing, and registers the scheduled task. `install-service.ps1` has a new `-NoAutoStart` switch.
- System tray icon with a Show and Quit menu and a tooltip with the CPU and GPU temperatures. The close button hides the window to the tray.
- Desktop notification when CPU or GPU temperature stays at 90 °C or more, or the GPU hotspot at 95 °C or more, for 10 seconds. An ALERTS button toggles it.
- `scripts/install-service.ps1` and `scripts/uninstall-service.ps1` register or remove a scheduled task that starts SensorService at logon with the highest run level.
- CPU clock and CPU package power in the CPU panel. Power needs the PawnIO driver (see `docs/SENSORS.md`).
- DETAILED tab next to OVERVIEW: every sensor (LibreHardwareMonitor, Lenovo EC, ACPI thermal zones, network) grouped by hardware with value, min and max, a filter box, and expand or collapse controls. The snapshot gains a `hardware` array.
- Plain-language hints in the Detailed tab: hover a sensor row, a hardware section, a group heading or a column title (`ui/src/help.js`).
- Temperature unit switch, degrees Celsius or Fahrenheit, in SETTINGS or with the U key. The service and all limits stay in Celsius.
- Pin sensors with the star in the Detailed tab. Pinned sensors appear in a Favorites section at the top of the Detailed tab and in a Favorites panel in Overview.
- Keyboard shortcuts (1, 2, /, F, T, U, M, S, ?) with a list in SETTINGS.
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
- The game overlay uses a rounded card with a soft highlight, status colors for normal, warm and hot values, and a lighter halo in text-only mode. The preview shrinks to fit.
- SensorService runs without a console window and allows one instance.
- The UI text is in English.
- Overview layout: the large page title is replaced by a compact header (the brand stays in the title bar), and a summary under the tabs says whether anything needs attention. It always reserves two lines, so a longer message does not move the panels. The history range moved next to it.
- The bar under each temperature is now labelled LOAD and stays cyan. Bar colours carry status instead: cyan normal, green healthy battery, yellow high, pink critical. A full battery no longer shows as an alarm.
- RAM, VRAM, battery and drives show status chips (OK, HIGH, LOW, CRITICAL). Drive temperature now uses its own limits (70 and 80 degrees Celsius) in the card, the log and the summary. Only the temperature chips blink.
- Temperature charts scale to the data and always include both limits. Axis labels sit in a left gutter and no longer overlap the line.
- CPU and GPU cards are balanced: the per-thread load bars fill the free space, and secondary text is larger.
- Game overlay: a transparent, always-on-top window that ignores the mouse, so clicks pass through to the game. The new OVERLAY tab turns it on or off, picks what it shows from 22 readings in four groups (CPU, GPU, Memory, System), sets the layout (vertical list or horizontal bar), screen corner, distance from the edge, size, opacity, background and labels, and previews the result live. A global hotkey (default Ctrl+Shift+O, changeable) and a tray menu item show or hide it while a game has focus. It works over windowed and borderless fullscreen games. It cannot draw over exclusive fullscreen and does not show FPS.
- The top bar keeps only MINI and SETTINGS. Theme, visual effects, desktop notifications and the shortcut list moved into SETTINGS, which is now grouped into Appearance, Alerts and Keyboard. The T and U keys show a short message, and the bar shows ALERTS OFF while notifications are disabled.
- The browser right-click menu (Back, Reload, Inspect) is disabled. Text fields keep their menu so Paste still works.
- Accessibility pass against WCAG 2.2 AA: tabs report their selected state and control their panels, the toggle buttons report pressed state, panel titles are real headings, sensors in the Detailed tab are exposed as tables, the charts have a text summary, and the sustained-heat banner is announced once instead of every second.
- Click targets are at least 24 by 24 px, and the outlines of inputs and buttons reach 3:1 contrast against the page.
- The offline screen moves focus to START SERVICE and blocks the page behind it. Dialogs close when you click outside them.
- Single-key shortcuts can be turned off in SETTINGS.
- Labels are at least 11 px, as the design system requires.
- The window uses a custom NeonNet title bar and scrolls below it.

### Fixed
- The SHOW OVERLAY button did nothing, because the window was built on the main thread. The command is now async and reports an error when the window cannot be created.
- CPU clock and CPU package power are available. They need the PawnIO driver, which the installer now installs.

### Known issues
- Motherboard temperature and system fan speed always read 0 on the test machine.
- The sign of the battery charge and discharge rate is unverified.
- The game overlay does not draw over exclusive fullscreen games, and it shows no FPS.

See `docs/SENSORS.md` for the causes of the sensor issues.

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
