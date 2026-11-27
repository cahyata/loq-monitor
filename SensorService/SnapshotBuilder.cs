// LOQ Monitor | SensorService (from readings to a snapshot)
// Author: cahyata
// Copyright (c) 2026 cahyata
using LibreHardwareMonitor.Hardware;

/// <summary>One sensor as it was read. <see cref="Index"/> is its place among the sensors of its type.</summary>
record SensorData(SensorType Type, string Name, int Index, float? Value, float? Min, float? Max);

/// <summary>One piece of hardware as LibreHardwareMonitor reported it, copied into plain data.</summary>
record HardwareData(HardwareType Type, string Name, SensorData[] Sensors, HardwareData[] Sub);

/// <summary>
/// Everything one snapshot is built from. The three functions are called only when their value is needed,
/// because reading it costs time.
/// </summary>
/// <param name="Hardware">What LibreHardwareMonitor reports.</param>
/// <param name="EcCpuTemp">Temperatures and fan speeds from the Lenovo embedded controller, null without it.</param>
/// <param name="AcpiZones">The ACPI thermal zones, already with their minimum and maximum.</param>
/// <param name="CounterClockMHz">The processor clock from the Windows performance counters.</param>
/// <param name="BatteryNow">Power and charger state from Windows.</param>
/// <param name="ThrottleMask">Why the NVIDIA driver holds the GPU back.</param>
/// <param name="Limits">Power limits, null while no client asks for them.</param>
record Readings(
    long Ts, IReadOnlyList<HardwareData> Hardware,
    int? EcCpuTemp, int? EcGpuTemp, int? EcCpuFan, int? EcGpuFan, int? PowerMode,
    SensorInfo[] AcpiZones,
    Func<float?> CounterClockMHz, Func<BatteryPower?> BatteryNow, Func<int?> ThrottleMask,
    PowerLimits? Limits);

/// <summary>Minimum and maximum since the last reset, for the values LibreHardwareMonitor does not track itself.</summary>
sealed class MinMax
{
    readonly Dictionary<string, (float Min, float Max)> _range = new();

    public SensorInfo Track(string type, string name, float value)
    {
        var key = type + "|" + name;
        var (min, max) = _range.TryGetValue(key, out var old) ? (Math.Min(old.Min, value), Math.Max(old.Max, value)) : (value, value);
        _range[key] = (min, max);
        return new SensorInfo(type, name, value, min, max);
    }

    public void Clear() => _range.Clear();
}

/// <summary>
/// Decides what a snapshot says: which GPU to show, which sensor stands for each reading on AMD, Intel and
/// Lenovo hardware, what to use when it is missing, and the units. It reads no hardware itself.
/// </summary>
static class SnapshotBuilder
{
    public static Snapshot Build(Readings r, MinMax range)
    {
        var cpu = First(r.Hardware, HardwareType.Cpu);
        // The NVIDIA GPU when there is one. The library lists AMD first, so a Ryzen's built-in graphics would win otherwise.
        var gpu = First(r.Hardware, HardwareType.GpuNvidia) ?? First(r.Hardware, HardwareType.GpuAmd);
        var mem = r.Hardware.FirstOrDefault(h => h.Type == HardwareType.Memory && h.Name == "Total Memory");
        var bat = First(r.Hardware, HardwareType.Battery);

        // CPU temp: Lenovo EC first (works with Memory Integrity on), LHM (AMD Tctl, Intel package) as fallback.
        float? cpuTemp = r.EcCpuTemp;
        if (cpuTemp is null or <= 0) cpuTemp = Positive(cpu, SensorType.Temperature, "Core (Tctl/Tdie)", "CPU Package");

        return new Snapshot(
            Ts: r.Ts,
            Cpu: new CpuInfo(
                cpu?.Name, Round(Val(cpu, SensorType.Load, "CPU Total")),
                Round(cpuTemp), r.EcCpuFan,
                // Average effective clock from LHM (needs PawnIO); Windows counters as fallback.
                Round(Val(cpu, SensorType.Clock, "Cores (Average Effective)")) ?? r.CounterClockMHz(),
                Round(Positive(cpu, SensorType.Power, "Package", "CPU Package")),   // AMD, Intel
                ThreadLoads(cpu)),
            Gpu: new GpuInfo(
                gpu?.Name,
                Round(Val(gpu, SensorType.Load, "GPU Core")),
                Round(Val(gpu, SensorType.Temperature, "GPU Core") ?? r.EcGpuTemp),
                Round(Val(gpu, SensorType.Temperature, "GPU Hot Spot")),
                Round(Val(gpu, SensorType.Temperature, "GPU Memory Junction")),
                r.EcGpuFan,
                Round(Val(gpu, SensorType.Power, "GPU Package")),
                Round(Val(gpu, SensorType.Clock, "GPU Core")),
                Round(Val(gpu, SensorType.Clock, "GPU Memory")),
                Round(Val(gpu, SensorType.SmallData, "GPU Memory Used")),
                Round(Val(gpu, SensorType.SmallData, "GPU Memory Total")),
                MBs(Val(gpu, SensorType.Throughput, "GPU PCIe Rx")),
                MBs(Val(gpu, SensorType.Throughput, "GPU PCIe Tx")),
                gpu is null ? null : r.ThrottleMask()),
            Ram: new RamInfo(
                Round(Val(mem, SensorType.Load, "Memory")),
                Round(Val(mem, SensorType.Data, "Memory Used")),
                Round(Val(mem, SensorType.Data, "Memory Available"))),
            Storage: r.Hardware.Where(h => h.Type == HardwareType.Storage).Select(Drive).ToArray(),
            Battery: bat is null ? null : Battery(bat, r.BatteryNow()),
            PowerMode: r.PowerMode,
            Limits: r.Limits,
            Hardware: AllHardware(r, range));
    }

    static StorageInfo Drive(HardwareData h) => new(
        h.Name,
        Round(Val(h, SensorType.Temperature, "Composite Temperature") ?? Val(h, SensorType.Temperature, "Temperature #1")),
        Round(Val(h, SensorType.Load, "Used Space")),
        Round(Val(h, SensorType.Level, "Life")),
        MBs(Val(h, SensorType.Throughput, "Read Rate")),
        MBs(Val(h, SensorType.Throughput, "Write Rate")),
        Round(Val(h, SensorType.Load, "Total Activity")));

    /// <summary>
    /// Battery power in watts is positive while charging, negative while discharging and 0 when idle on AC.
    /// Windows is the primary source: LibreHardwareMonitor leaves its rate sensor empty while the battery
    /// discharges on the test machine.
    /// </summary>
    static BatteryInfo Battery(HardwareData bat, BatteryPower? now) => new(
        Round(Val(bat, SensorType.Level, "Charge Level")),
        Round(now?.RateW ?? Val(bat, SensorType.Power, "Charge/Discharge Rate")),
        Round(Val(bat, SensorType.Level, "Degradation Level")),
        Round(Val(bat, SensorType.Energy, "Designed Capacity") / 1000),
        Round(Val(bat, SensorType.Energy, "Fully-Charged Capacity") / 1000),
        now?.AcOnline, now?.Charging);

    /// <summary>Every sensor grouped by hardware for the Detailed tab, with the Lenovo and ACPI groups first.</summary>
    static List<HwInfo> AllHardware(Readings r, MinMax range)
    {
        var list = new List<HwInfo>();

        var ec = new List<SensorInfo>();
        void Ec(string type, string name, int? v) { if (v is > 0) ec.Add(range.Track(type, name, v.Value)); }
        Ec("Temperature", "CPU", r.EcCpuTemp); Ec("Temperature", "GPU", r.EcGpuTemp);
        Ec("Fan", "CPU fan", r.EcCpuFan); Ec("Fan", "GPU fan", r.EcGpuFan);
        if (ec.Count > 0) list.Add(new HwInfo("Lenovo embedded controller", "Lenovo", ec.ToArray()));
        if (r.AcpiZones.Length > 0) list.Add(new HwInfo("ACPI thermal zones", "Acpi", r.AcpiZones));

        void Add(HardwareData hw, string name)
        {
            var sensors = hw.Sensors.Select(x => new SensorInfo(x.Type.ToString(), x.Name, x.Value, x.Min, x.Max)).ToArray();
            if (sensors.Length > 0) list.Add(new HwInfo(name, hw.Type.ToString(), sensors));
            foreach (var sub in hw.Sub) Add(sub, name + " / " + sub.Name);
        }
        foreach (var hw in r.Hardware) Add(hw, hw.Name);
        return list;
    }

    /// <summary>
    /// The load of every processor thread, in thread order. The names are "CPU Core #3" or, where a core
    /// has two threads, "CPU Core #3 Thread #2", so the order comes from the sensor index and not the name.
    /// </summary>
    static float[] ThreadLoads(HardwareData? cpu) =>
        cpu?.Sensors
            .Where(s => s.Type == SensorType.Load && s.Name.StartsWith("CPU Core #", StringComparison.Ordinal))
            .OrderBy(s => s.Index)
            .Select(s => Round(s.Value) ?? 0)
            .ToArray() ?? [];

    static HardwareData? First(IReadOnlyList<HardwareData> hardware, HardwareType type) => hardware.FirstOrDefault(h => h.Type == type);

    static float? Val(HardwareData? hw, SensorType type, string name) =>
        hw?.Sensors.FirstOrDefault(s => s.Type == type && s.Name == name)?.Value;

    /// <summary>The first of these sensors that has a value above zero, or null.</summary>
    static float? Positive(HardwareData? hw, SensorType type, params string[] names)
    {
        foreach (var name in names)
            if (Val(hw, type, name) is { } v && v > 0) return v;
        return null;
    }

    static float? MBs(float? v) => v.HasValue ? MathF.Round(v.Value / 1_000_000f, 1) : null;

    static float? Round(float? v) => v.HasValue ? MathF.Round(v.Value, 1) : null;
}
