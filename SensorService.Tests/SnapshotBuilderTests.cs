// LOQ Monitor | Tests of how readings become a snapshot
// Author: cahyata
// Copyright (c) 2026 cahyata
using System.Text.Json;
using System.Text.Json.Serialization;
using LibreHardwareMonitor.Hardware;
using Xunit;

/// <summary>
/// Two kinds of test data. Fixtures/loq-83jc.json was recorded on a LOQ 83JC (Ryzen and RTX 4060); its network
/// adapters are left out and its drive usage numbers are made up. The Intel and Radeon hardware further down is
/// made up as a whole: it follows the sensor names LibreHardwareMonitor uses, and no such laptop was tested.
/// </summary>
public sealed class SnapshotBuilderTests
{
    // ---------- the recorded laptop ----------
    sealed record Recording(HardwareData[] Hardware, int? EcCpuTemp, int? EcGpuTemp, int? EcCpuFan, int? EcGpuFan, int? PowerMode,
                            SensorInfo[] AcpiZones, BatteryPower? BatteryNow, int? ThrottleMask, float? CounterClockMHz);

    static Snapshot Recorded()
    {
        var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true, Converters = { new JsonStringEnumConverter() } };
        var r = JsonSerializer.Deserialize<Recording>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "loq-83jc.json")), options)!;
        return SnapshotBuilder.Build(new Readings(1, r.Hardware, r.EcCpuTemp, r.EcGpuTemp, r.EcCpuFan, r.EcGpuFan, r.PowerMode, r.AcpiZones,
            () => r.CounterClockMHz, () => r.BatteryNow, () => r.ThrottleMask, null), new MinMax());
    }

    [Fact]
    public void Recorded_laptop_processor()
    {
        var cpu = Recorded().Cpu;
        Assert.Equal(("AMD Ryzen 7 7435HS", 19.9f, 79f, 3700, 691f, 28.6f), (cpu.Name, cpu.Load, cpu.TempC, cpu.FanRpm, cpu.ClockMHz, cpu.PowerW));
        Assert.Equal(16, cpu.CoreLoads.Length);
        Assert.Equal((56.2f, 14.1f, 10.9f), (cpu.CoreLoads[0], cpu.CoreLoads[1], cpu.CoreLoads[15]));
    }

    [Fact]
    public void Recorded_laptop_graphics_and_memory()
    {
        var s = Recorded();
        Assert.Equal(new GpuInfo("NVIDIA GeForce RTX 4060 Laptop GPU", 40, 63, 70.1f, 64, 4000, 52.8f, s.Gpu.CoreClockMHz, s.Gpu.MemClockMHz,
            6919, 8188, 43.5f, s.Gpu.PcieTxMBs, 0), s.Gpu);
        Assert.Equal(new RamInfo(98, 27.1f, 0.5f), s.Ram);
    }

    [Fact]
    public void Recorded_laptop_drives_and_battery()
    {
        var s = Recorded();
        Assert.Equal(new StorageInfo("PNY CS2241 500GB SSD", 58, 89.8f, 91, 0, 0, 0), s.Storage[0]);
        Assert.Equal(new StorageInfo("Micron MTFDKCD512QFM-1BD1AABLA", 55, 95.3f, 79, 0.1f, 0.2f, 0.5f), s.Storage[1]);
        Assert.Equal(new BatteryInfo(97.7f, 0, 9.3f, 60, 54.4f, true, false), s.Battery);
        Assert.Equal(2, s.PowerMode);
    }

    [Fact]
    public void Recorded_laptop_sensor_list_starts_with_the_lenovo_and_acpi_groups()
    {
        var list = Recorded().Hardware;
        Assert.Equal(new[] { "Lenovo embedded controller", "ACPI thermal zones" }, list.Take(2).Select(h => h.Name));
        Assert.Equal(new[] { ("CPU", 79f), ("GPU", 68f), ("CPU fan", 3700f), ("GPU fan", 4000f) }, list[0].Sensors.Select(x => (x.Name, x.Value!.Value)));
        Assert.DoesNotContain(list, h => h.Sensors.Length == 0);
        Assert.Contains(list, h => h.Name == "NVIDIA GeForce RTX 4060 Laptop GPU" && h.Type == "GpuNvidia");
    }

    // ---------- made-up hardware ----------
    static SensorData Sensor(SensorType type, string name, float? value, int index = 0) => new(type, name, index, value, value, value);
    static HardwareData Part(HardwareType type, string name, params SensorData[] sensors) => new(type, name, sensors, []);

    static readonly HardwareData Intel = Part(HardwareType.Cpu, "Made-up Intel processor",
        Sensor(SensorType.Temperature, "CPU Package", 71),
        Sensor(SensorType.Power, "CPU Package", 45),
        // listed out of order on purpose: the sensor index gives the thread order
        Sensor(SensorType.Load, "CPU Core #2", 30, index: 3),
        Sensor(SensorType.Load, "CPU Core #1 Thread #2", 20, index: 2),
        Sensor(SensorType.Load, "CPU Core #1 Thread #1", 10, index: 1),
        Sensor(SensorType.Load, "CPU Total", 20, index: 0));

    static readonly HardwareData Radeon = Part(HardwareType.GpuAmd, "Made-up Radeon", Sensor(SensorType.Temperature, "GPU Core", 55));

    static Snapshot Build(HardwareData[] hardware, int? ecCpu = null, int? ecGpu = null, Func<float?>? clock = null,
                          Func<BatteryPower?>? battery = null, int? throttle = null, MinMax? range = null) =>
        SnapshotBuilder.Build(new Readings(1, hardware, ecCpu, ecGpu, null, null, null, [],
            clock ?? (() => null), battery ?? (() => null), () => throttle, null), range ?? new MinMax());

    [Fact]
    public void Intel_sensor_names_are_found_without_a_lenovo_controller()
    {
        var s = Build([Intel]);
        Assert.Equal((71f, 45f), (s.Cpu.TempC, s.Cpu.PowerW));
        Assert.Equal(new[] { 10f, 20f, 30f }, s.Cpu.CoreLoads);
        Assert.DoesNotContain(s.Hardware, h => h.Type == "Lenovo");
    }

    [Theory]
    [InlineData(null, 71)]
    [InlineData(0, 71)]
    [InlineData(66, 66)]
    public void The_lenovo_cpu_temperature_wins_when_it_has_one(int? ec, float expected) =>
        Assert.Equal(expected, Build([Intel], ecCpu: ec).Cpu.TempC);

    [Fact]
    public void Nvidia_is_shown_although_the_amd_graphics_are_listed_first()
    {
        var nvidia = Part(HardwareType.GpuNvidia, "Made-up GeForce", Sensor(SensorType.Temperature, "GPU Core", 60));
        Assert.Equal("Made-up GeForce", Build([Radeon, nvidia]).Gpu.Name);
        Assert.Equal(("Made-up Radeon", 55f), (Build([Radeon]).Gpu.Name, Build([Radeon]).Gpu.TempC));
    }

    [Fact]
    public void The_lenovo_gpu_temperature_stands_in_for_a_missing_one()
    {
        Assert.Equal(48f, Build([Part(HardwareType.GpuNvidia, "Silent GeForce")], ecGpu: 48).Gpu.TempC);
        Assert.Equal(55f, Build([Radeon], ecGpu: 48).Gpu.TempC);
    }

    [Fact]
    public void The_windows_clock_is_read_only_when_the_library_has_none()
    {
        Assert.Equal(1234f, Build([Intel], clock: () => 1234).Cpu.ClockMHz);
        var own = Part(HardwareType.Cpu, "With a clock", Sensor(SensorType.Clock, "Cores (Average Effective)", 800));
        Assert.Equal(800f, Build([own], clock: () => throw new InvalidOperationException("not needed")).Cpu.ClockMHz);
    }

    [Fact]
    public void Battery_power_comes_from_windows_and_falls_back_to_the_library()
    {
        var battery = Part(HardwareType.Battery, "Made-up battery",
            Sensor(SensorType.Power, "Charge/Discharge Rate", 12.34f), Sensor(SensorType.Energy, "Designed Capacity", 60_000));
        Assert.Equal((-20f, false), (Build([battery], battery: () => new(-20, false, false)).Battery!.RateW, Build([battery], battery: () => new(-20, false, false)).Battery!.AcOnline));
        var alone = Build([battery]).Battery!;
        Assert.Equal((12.3f, 60f, null), (alone.RateW, alone.DesignedWh, alone.AcOnline));
    }

    [Fact]
    public void Without_a_battery_windows_is_not_asked() =>
        Assert.Null(Build([Intel], battery: () => throw new InvalidOperationException("not needed")).Battery);

    [Fact]
    public void A_drive_without_a_composite_temperature_uses_the_first_one()
    {
        var drive = Part(HardwareType.Storage, "Plain drive",
            Sensor(SensorType.Temperature, "Temperature #1", 41.26f), Sensor(SensorType.Throughput, "Read Rate", 2_550_000));
        Assert.Equal(new StorageInfo("Plain drive", 41.3f, null, null, 2.6f, null, null), Build([drive]).Storage[0]);
    }

    [Fact]
    public void Sub_hardware_is_listed_under_its_parent()
    {
        var board = new HardwareData(HardwareType.Motherboard, "Board", [], [Part(HardwareType.SuperIO, "Chip", Sensor(SensorType.Fan, "Fan #1", 900))]);
        Assert.Equal(("Board / Chip", "SuperIO"), Build([board]).Hardware.Select(h => (h.Name, h.Type)).Single());
    }

    [Fact]
    public void Nothing_to_read_gives_an_empty_snapshot()
    {
        var s = Build([]);
        Assert.Equal((null, null, null, null), (s.Cpu.Name, s.Cpu.TempC, s.Gpu.Name, s.Ram.LoadPct));
        Assert.Empty(s.Cpu.CoreLoads);
        Assert.Empty(s.Storage);
        Assert.Empty(s.Hardware);
        Assert.Null(s.Battery);
    }

    [Fact]
    public void Lenovo_values_keep_their_minimum_and_maximum_until_a_reset()
    {
        var range = new MinMax();
        SensorInfo Cpu(int value) => Build([], ecCpu: value, range: range).Hardware[0].Sensors[0];
        Cpu(70); Cpu(85);
        Assert.Equal((75f, 70f, 85f), (Cpu(75).Value, Cpu(75).Min, Cpu(75).Max));
        range.Clear();
        Assert.Equal((60f, 60f), (Cpu(60).Min, Cpu(60).Max));
    }
}
