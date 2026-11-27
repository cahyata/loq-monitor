// LOQ Monitor | SensorService (numbers JSON cannot hold)
// Author: cahyata
// Copyright (c) 2026 cahyata
using System.Text.Json;
using System.Text.Json.Serialization;

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
