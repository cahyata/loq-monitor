// LOQ Monitor | HardwarePick (choosing the right sensors on different laptops)
// Author: cahyata
// Copyright (c) 2026 cahyata
using System.Text.Json;
using System.Text.Json.Serialization;
using LibreHardwareMonitor.Hardware;

/// <summary>
/// LOQ models ship with AMD or Intel processors, and LibreHardwareMonitor names their sensors
/// differently. These rules find the readings on both.
/// </summary>
static class HardwarePick
{
    /// <summary>The NVIDIA GPU when there is one. The library lists AMD first, so a Ryzen's built-in graphics would win otherwise.</summary>
    public static IHardware? Gpu(IEnumerable<IHardware> hardware) =>
        hardware.FirstOrDefault(h => h.HardwareType == HardwareType.GpuNvidia)
        ?? hardware.FirstOrDefault(h => h.HardwareType == HardwareType.GpuAmd);

    /// <summary>
    /// The load of every processor thread, in thread order. The names are "CPU Core #3" or, where a core
    /// has two threads, "CPU Core #3 Thread #2", so the order comes from the sensor index and not the name.
    /// </summary>
    public static ISensor[] ThreadLoads(IHardware? cpu) =>
        cpu?.Sensors
            .Where(s => s.SensorType == SensorType.Load && s.Name.StartsWith("CPU Core #", StringComparison.Ordinal))
            .OrderBy(s => s.Index)
            .ToArray() ?? [];

    /// <summary>The first of these sensors that has a value above zero, or null.</summary>
    public static float? Positive(IHardware? hardware, SensorType type, params string[] names)
    {
        foreach (var name in names)
            if (hardware?.Sensors.FirstOrDefault(s => s.SensorType == type && s.Name == name)?.Value is { } v && v > 0) return v;
        return null;
    }
}

/// <summary>
/// A sensor can report infinity or "not a number", which JSON cannot hold. Those are written as null,
/// which the app shows as "--", so that one bad sensor cannot stop the service.
/// </summary>
sealed class FiniteFloatConverter : JsonConverter<float>
{
    public override float Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) => reader.GetSingle();
    public override void Write(Utf8JsonWriter writer, float value, JsonSerializerOptions options)
    {
        if (float.IsFinite(value)) writer.WriteNumberValue(value); else writer.WriteNullValue();
    }
}

/// <summary>The same rule as <see cref="FiniteFloatConverter"/> for the few values held as double.</summary>
sealed class FiniteDoubleConverter : JsonConverter<double>
{
    public override double Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) => reader.GetDouble();
    public override void Write(Utf8JsonWriter writer, double value, JsonSerializerOptions options)
    {
        if (double.IsFinite(value)) writer.WriteNumberValue(value); else writer.WriteNullValue();
    }
}
