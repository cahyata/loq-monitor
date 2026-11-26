# Third-party notices

LOQ Monitor is released under the MIT License (see `LICENSE`). It uses the components below, each under its own license. This list is a summary. The full license texts are in `THIRD-PARTY-LICENSES.txt`, which the installer puts next to the app together with this file.

## Shipped with the installer

| Component | Used for | License |
|---|---|---|
| [LibreHardwareMonitorLib](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) 0.9.6 | Sensor readings in SensorService | MPL-2.0 |
| [PresentMon](https://github.com/GameTechDev/PresentMon) 2.6.0 | Frame rate and frame time for the overlay | MIT, Copyright (C) 2017-2024 Intel Corporation |
| [TraceEvent](https://github.com/microsoft/perfview) 3.2.8 (`Microsoft.Diagnostics.Tracing.TraceEvent`) | Disk activity per program | MIT, Microsoft |
| [BlackSharp.Core](https://github.com/Blacktempel/BlackSharp), [DiskInfoToolkit](https://github.com/Blacktempel/DiskInfoToolkit), [RAMSPDToolkit](https://github.com/Blacktempel/RAMSPDToolkit) | Used by LibreHardwareMonitorLib | MPL-2.0 |
| [HidSharp](https://software.seekye.com/hidsharp) | Used by LibreHardwareMonitorLib | Apache-2.0, Copyright James F. Bellinger |
| Mono.Posix.NETStandard | Used by LibreHardwareMonitorLib | MIT, Mono Project |
| Microsoft Edge WebView2 loader | Desktop shell | BSD-3-Clause style, Microsoft |
| `System.Management`, `System.Diagnostics.PerformanceCounter`, `System.Diagnostics.EventLog` and the .NET 8 runtime | WMI, performance counters, Event Log, runtime | MIT |
| [Tauri](https://tauri.app) 2 and its plugins | Desktop shell | MIT or Apache-2.0 |
| Rust crates that Tauri depends on | Desktop shell | Mostly MIT or Apache-2.0, a few MPL-2.0, BSD, ISC, Zlib and Unicode. None is GPL only. |

The MPL-2.0 components are used unmodified, as libraries. MPL-2.0 is a file-level license: their source files stay under MPL-2.0, and the rest of this project is not affected. Their source addresses are listed at the top of `THIRD-PARTY-LICENSES.txt`.

## Installed separately

| Component | Used for | License |
|---|---|---|
| [PawnIO](https://github.com/namazso/PawnIO) driver | CPU package power and effective clock | GPL-2.0-or-later with a linking exception for independent modules that talk to the driver only through its device IO control interface. Not bundled: the installer fetches it with `winget`, and LOQ Monitor reaches it only through LibreHardwareMonitorLib. The license text is in the `COPYING` file of the repository. |

## Used as a reference only

[Lenovo Legion Toolkit](https://github.com/LenovoLegionToolkit-Team/LenovoLegionToolkit) (GPL-3.0) documents, in its source, how the Lenovo WMI interface is used. LOQ Monitor takes interface facts from it, namely WMI class names and capability numbers. It does not include, link or distribute any Legion Toolkit code.

**Rule for contributors:** do not copy or translate code from Legion Toolkit or any other GPL project into this repository.

## Trademarks

Lenovo, LOQ and Legion are trademarks of Lenovo. NVIDIA, AMD, Intel and Windows are trademarks of their owners. LOQ Monitor is an independent project. It is not affiliated with, sponsored by or endorsed by any of them.

## Design

The interface follows the NeonNet design system, which is a separate project of the author.
