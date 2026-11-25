# Third-party notices

LOQ Monitor is released under the MIT License (see `LICENSE`). It uses the components below, each under its own license. This list is a summary. The license text of each package applies, and the packages are the authority.

## Shipped with the installer

| Component | Used for | License |
|---|---|---|
| [LibreHardwareMonitorLib](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) 0.9.6 | Sensor readings in SensorService | MPL-2.0 |
| [PresentMon](https://github.com/GameTechDev/PresentMon) 2.6.0 | Frame rate and frame time for the overlay | MIT, Copyright (C) 2017-2024 Intel Corporation |
| Packages that LibreHardwareMonitorLib depends on (for example BlackSharp.Core, DiskInfoToolkit, HidSharp, RAMSPDToolkit) | Hardware access | See each package |
| `System.Management`, `System.Diagnostics.PerformanceCounter` and the .NET 8 runtime | WMI, performance counters, runtime | MIT |
| [Tauri](https://tauri.app) 2 and its plugins | Desktop shell | MIT or Apache-2.0 |
| Rust crates that Tauri depends on | Desktop shell | See `cargo license` for the full list |

LibreHardwareMonitorLib is used unmodified, as a library. MPL-2.0 is a file-level license: its source files stay under MPL-2.0, and the rest of this project is not affected. The source is at the link above.

## Installed separately

| Component | Used for | License |
|---|---|---|
| [PawnIO](https://github.com/namazso/PawnIO) driver | CPU package power and effective clock | GPL-2.0-or-later with a linking exception for independent modules that talk to the driver only through its device IO control interface. Not bundled: the installer fetches it with `winget`, and LOQ Monitor reaches it only through LibreHardwareMonitorLib. The license text is in the `COPYING` file of the repository. |

## Design

The interface follows the NeonNet design system, which is a separate project of the author.
