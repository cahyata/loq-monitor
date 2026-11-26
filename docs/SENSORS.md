# Sensors

This document lists the source of each reading and its status on the test machine, a Lenovo LOQ 83JC (Ryzen 7 7435HS, RTX 4060 Laptop, Windows 11). Other models can behave differently.

## Status by reading

| Reading | Source | Status |
|---|---|---|
| CPU temperature | Lenovo EC (WMI), fallback LHM `Core (Tctl/Tdie)` (AMD) or `CPU Package` (Intel) | Works |
| CPU total load and load per thread | LHM | Works |
| CPU fan | Lenovo EC (WMI) | Works |
| CPU package power | LHM `Package` (AMD) or `CPU Package` (Intel), needs PawnIO | Works |
| CPU clock | LHM `Cores (Average Effective)` (needs PawnIO), fallback Windows counters | Works |
| GPU temperature, hotspot, VRAM temperature | LHM | Works |
| GPU load, power, core clock, memory clock | LHM | Works |
| VRAM used and total | LHM | Works |
| GPU PCIe RX and TX | LHM | Works |
| GPU fan | Lenovo EC (WMI) | Works |
| RAM used, available, load | LHM, hardware item `Total Memory` | Works |
| SSD temperature, used space, remaining life, read and write rate | LHM | Works |
| Battery level, health, capacity | LHM | Works |
| Battery charge/discharge rate | Windows WMI `root\WMI` `BatteryStatus` (mW), fallback LHM | Works on battery (negative); the charging sign (positive) is by convention, not yet seen |
| Motherboard temperature, system fan | Lenovo EC | Reads 0 |
| Lenovo power mode | WMI `LENOVO_GAMEZONE_DATA.GetSmartFanMode` | Works (read-only; mapping unverified, see below) |

## Read paths

### LibreHardwareMonitorLib 0.9.6

LHM supplies the GPU, load, RAM, SSD and battery readings. It needs administrator rights. The service enables the CPU, GPU, memory, storage and battery hardware types.

### Lenovo WMI

The service calls `GetFeatureValue` on `LENOVO_OTHER_METHOD` in the `root\WMI` namespace, passing a capability ID in `IDs` and reading the result from `value`. Without administrator rights the call fails with "Access denied".

| Capability | ID |
|---|---|
| CPU fan (RPM) | `0x04030001` |
| GPU fan (RPM) | `0x04030002` |
| CPU temperature (°C) | `0x05040000` |
| GPU temperature (°C) | `0x05050000` |

The service uses the GPU temperature from LHM and falls back to the EC value. All four calls only read values.

### Lenovo power limits

`LENOVO_OTHER_METHOD.GetFeatureValue` returns the limits of the active power mode when asked for these IDs (the `FF` suffix). `LENOVO_CAPABILITY_DATA_01` lists the same features with a default and a range per mode (the second byte of the ID: 1 quiet, 2 balanced, 3 performance, `E0` custom). Both are read only. The meaning of each ID follows the community documentation of the Lenovo WMI interface (Legion Toolkit) and the ranges on this machine fit it. The values were not checked against a second tool.

| ID prefix | Meaning | Active value on the test machine (Balanced) |
|---|---|---|
| `0x0101` | CPU short-term power limit, 45 to 100 W | 54 W |
| `0x0102` | CPU long-term (sustained) power limit, 40 to 75 W | 54 W |
| `0x0103` | CPU peak power limit, 55 to 125 W | 65 W |
| `0x0104` | CPU temperature limit, 85 to 100 degrees | 95 degrees |
| `0x0201` | GPU power boost, 10 to 25 W | 15 W |
| `0x0202` | GPU base power (TGP), 55 to 105 W | the active value reads 105 W, which does not match the 69 W the driver enforces, so the app does not show it |

The GPU limit and its slowdown temperature come from NVML instead (`nvmlDeviceGetEnforcedPowerLimit`, `nvmlDeviceGetTemperatureThreshold`), which report what the driver enforces: 69 W and 91 degrees on the test machine. The NVML limit moves a little with Dynamic Boost.

## Not available on this model

| Feature | Finding |
|---|---|
| GPU mode (hybrid or discrete) | `IsSupportIGPUMode` and `IsSupportGSync` return 0 on the 83JC, so the switch is not exposed through WMI. |
| Battery conservation mode, Rapid Charge | No WMI class or capability ID for them was found (`Lenovo_BiosSetting` does not exist, `LENOVO_FEATURE_STATUS_DATA` reports "Not supported", and the capability list has no entry that can be named with confidence). Lenovo Vantage reads them through an ACPI driver that this app does not use. The app shows what can be measured instead: whether the charger is connected and whether charging is paused. |

## Limitations

### PawnIO driver

LHM 0.9.6 reads CPU power and per-core clocks through the PawnIO driver ([namazso/PawnIO](https://github.com/namazso/PawnIO), version 2.2.0 on the test machine). Before PawnIO was installed, LHM returned 0 for both with Memory Integrity (HVCI) on; after installing it, with Memory Integrity still on, `Package` power read 44.1 W and the clocks were non-zero. Without PawnIO the service falls back to the Windows performance counters `Processor Frequency` and `% Processor Performance` for the clock, and CPU power is absent.

Install it with `winget install --id namazso.PawnIO` from an administrator shell. The CPU temperature does not depend on the driver, because it comes from the Lenovo EC.

`LENOVO_GAMEZONE_DATA.GetCpuFrequency` returned the raw value 298193350 and its unit is unknown. The service does not use it.

### Power and thermal mode

`GetSmartFanMode` and `GetThermalMode` returned 255 in the first probe and 2 in a later one. The service reads `GetSmartFanMode` and falls back to `GetThermalMode`. It maps 1 to Quiet, 2 to Balanced, 3 to Performance, and 224 or 255 to Custom (Legion Toolkit uses 224; this machine reports 255 in Custom, which explains the first probe). The mapping was confirmed on this machine by switching modes with Fn+Q. The service only reads the mode and never sets it.

### Fan and motherboard readings

`LENOVO_FAN_METHOD` exposes only `Fan_Get_Table` and `Fan_Set_Table` on this model, and the method `Fan_Get_CurrentFanSpeed` is not implemented. The fan getters in `LENOVO_GAMEZONE_DATA` return 0. The EC capabilities for motherboard temperature and system fan return 0.

### Battery rate

The service assumes that a positive rate means charging and a negative rate means discharging. The test machine was plugged in and fully charged, so the rate was 0.0 W. Unplugging the charger confirms or refutes the assumption.

## UI thresholds

| Metric | Warning | Critical |
|---|---|---|
| CPU and GPU temperature | 75 °C or more (yellow) | 90 °C or more (pink, HOT tag) |
| GPU hotspot | 90 °C or more | 95 °C or more (CRIT log line) |
| RAM and VRAM load | 90 % or more (WARN log line) | none |
| SSD temperature | 70 °C or more (WARN log line) | none |
| SSD remaining life | 80 % or less (yellow) | none |
| SSD used space | none | 90 % or more (pink) |
| Battery level | below 20 % (WARN log line) | none |

## Investigating a new sensor

1. Run `SensorProbe` as administrator. It prints every LHM sensor, the WMI class list, the `LENOVO_GAMEZONE_DATA` getters and `GetFeatureValue` probes.
2. Run it again under load, for example during a game, and compare the two outputs.
3. Add the read to `SensorReader.Read()` and the field to the records in `SensorService/Program.cs`, then update this document and `CHANGELOG.md`.

## References

- [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor), MPL-2.0.
- [Legion Toolkit](https://github.com/LenovoLegionToolkit-Team/LenovoLegionToolkit), GPL-3.0. The WMI class names and capability IDs come from reading its source. No code was copied, and none may be: see `THIRD-PARTY-NOTICES.md`. Confirm interface facts on a real machine (the firmware describes its own WMI classes) and write the code from those findings.
