// LOQ Monitor | SensorService (what a snapshot holds)
// Author: cahyata
// Copyright (c) 2026 cahyata

// The records the service serializes. They define the schema the app reads.

record Snapshot(long Ts, CpuInfo Cpu, GpuInfo Gpu, RamInfo Ram, StorageInfo[] Storage, BatteryInfo? Battery, int? PowerMode, List<HwInfo> Hardware, FpsInfo? Fps = null, ProcessInfo? Processes = null, NetworkInfo? Network = null, PowerLimits? Limits = null);
record HwInfo(string Name, string Type, SensorInfo[] Sensors);
record SensorInfo(string Type, string Name, float? Value, float? Min, float? Max);
record CpuInfo(string? Name, float? Load, float? TempC, int? FanRpm, float? ClockMHz, float? PowerW, float[] CoreLoads);
record GpuInfo(string? Name, float? Load, float? TempC, float? HotspotC, float? VramTempC, int? FanRpm,
               float? PowerW, float? CoreClockMHz, float? MemClockMHz, float? VramUsedMB, float? VramTotalMB,
               float? PcieRxMBs, float? PcieTxMBs, int? ThrottleMask = null);
record RamInfo(float? LoadPct, float? UsedGB, float? AvailableGB);
record StorageInfo(string Name, float? TempC, float? UsedPct, float? LifePct, float? ReadMBs, float? WriteMBs, float? ActivityPct);
record BatteryInfo(float? LevelPct, float? RateW, float? DegradationPct, float? DesignedWh, float? FullWh, bool? AcOnline = null, bool? Charging = null);
record BatteryPower(float RateW, bool? AcOnline, bool? Charging);
/// <summary>Limits in watts and degrees: the CPU from the Lenovo firmware, the GPU from the NVIDIA driver.</summary>
record PowerLimits(int? CpuSustainedW, int? CpuShortW, int? CpuPeakW, int? CpuTempC, int? GpuW, int? GpuTempC);

record FpsInfo(string? Process, float? Fps, float? FrameMs, float? Low1Fps);
record ProcRow(string Name, int Count, float Value);
/// <summary>Data a program moves to and from the drives now (MB/s) and since the list was opened (MB).</summary>
record DiskRow(string Name, int Count, float ReadMBs, float WriteMBs, double ReadMB, double WrittenMB);
record ProcessInfo(ProcRow[] Cpu, ProcRow[] MemMB, ProcRow[] Gpu, DiskRow[]? Disk);
record WifiInfo(string Ssid, int SignalPct, int RxMbps, int TxMbps, string Standard, int? Channel, string? Band);
record PingInfo(string Ip, int? RttMs, float? AvgMs, float? JitterMs, float LossPct);
record NetworkInfo(string? Adapter, WifiInfo? Wifi, PingInfo? Gateway, PingInfo? Dns);
