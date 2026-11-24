# Sensors

This document lists the source of each reading and its status on the test machine, a Lenovo LOQ 83JC (Ryzen 7 7435HS, RTX 4060 Laptop, Windows 11). Other models can behave differently.

## Status by reading

| Reading | Source | Status |
|---|---|---|
| CPU temperature | Lenovo EC (WMI), fallback LHM `Core (Tctl/Tdie)` | Works |
| CPU total load and load per thread | LHM | Works |
| CPU fan | Lenovo EC (WMI) | Works |
| CPU clock and power | LHM | Reads 0 |
| GPU temperature, hotspot, VRAM temperature | LHM | Works |
| GPU load, power, core clock, memory clock | LHM | Works |
| VRAM used and total | LHM | Works |
| GPU PCIe RX and TX | LHM | Works |
| GPU fan | Lenovo EC (WMI) | Works |
| RAM used, available, load | LHM, hardware item `Total Memory` | Works |
| SSD temperature, used space, remaining life, read and write rate | LHM | Works |
| Battery level, health, capacity | LHM | Works |
| Battery charge/discharge rate | LHM | Works, sign unverified |
| Motherboard temperature, system fan | Lenovo EC | Reads 0 |
| Lenovo power/thermal mode | WMI `LENOVO_GAMEZONE_DATA` | Returns 255 |

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

## Limitations

### CPU clock and power

LHM returns 0 for CPU clock and power. LHM 0.9.6 reads CPU registers through the PawnIO driver, which is not installed on the test machine, and Memory Integrity (HVCI) is on. The probable cause is the missing driver, but the combination was not tested one factor at a time. These options remain:

1. Install PawnIO.
2. Turn off Memory Integrity, which lowers system security.
3. Read `LENOVO_GAMEZONE_DATA.GetCpuFrequency`. It returned the raw value 298193350 and its unit is unknown.

The CPU temperature does not depend on this, because it comes from the Lenovo EC.

### Power and thermal mode

`LENOVO_GAMEZONE_DATA.GetThermalMode` returns 255. No other read path for the mode has been tested.

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
- [Legion Toolkit](https://github.com/LenovoLegionToolkit-Team/LenovoLegionToolkit), GPL-3.0. The WMI class names and capability IDs come from reading its source. No code was copied.
