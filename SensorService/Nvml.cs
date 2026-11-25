// LOQ Monitor | Nvml (why the NVIDIA GPU is held back)
// Author: cahyata
// Copyright (c) 2026 cahyata
using System.Runtime.InteropServices;

/// <summary>
/// Reads the current clock throttle reasons of the first NVIDIA GPU from nvml.dll, the management
/// library that ships with the NVIDIA driver. It only reads. Without an NVIDIA driver the reader
/// stays off and returns null.
/// </summary>
sealed class Nvml : IDisposable
{
    [DllImport("nvml.dll")] static extern int nvmlInit_v2();
    [DllImport("nvml.dll")] static extern int nvmlShutdown();
    [DllImport("nvml.dll")] static extern int nvmlDeviceGetHandleByIndex_v2(uint index, out IntPtr device);
    [DllImport("nvml.dll")] static extern int nvmlDeviceGetCurrentClocksThrottleReasons(IntPtr device, out ulong reasons);
    [DllImport("nvml.dll")] static extern int nvmlDeviceGetEnforcedPowerLimit(IntPtr device, out uint milliwatts);
    [DllImport("nvml.dll")] static extern int nvmlDeviceGetTemperatureThreshold(IntPtr device, int kind, out uint celsius);

    // Bits that matter to the user. Idle, application clocks and sync boost are normal and left out.
    const ulong SwPowerCap = 0x4, HwSlowdown = 0x8, SwThermal = 0x20, HwThermal = 0x40, HwPowerBrake = 0x80;
    public const ulong Mask = SwPowerCap | HwSlowdown | SwThermal | HwThermal | HwPowerBrake;

    IntPtr _device;
    bool _ready;

    public Nvml()
    {
        try
        {
            if (nvmlInit_v2() == 0 && nvmlDeviceGetHandleByIndex_v2(0, out _device) == 0) _ready = true;
        }
        catch (Exception) { /* no NVIDIA driver, or nvml.dll could not load */ }
    }

    /// <summary>The reasons now as a bit mask (see the constants above), or null when unavailable.</summary>
    public int? ThrottleMask()
    {
        if (!_ready) return null;
        try { return nvmlDeviceGetCurrentClocksThrottleReasons(_device, out var r) == 0 ? (int)(r & Mask) : null; }
        catch (Exception) { return null; }
    }

    /// <summary>The power limit the GPU is held to right now, in watts, or null.</summary>
    public int? PowerLimitW()
    {
        if (!_ready) return null;
        try { return nvmlDeviceGetEnforcedPowerLimit(_device, out var mw) == 0 ? (int)Math.Round(mw / 1000.0) : null; }
        catch (Exception) { return null; }
    }

    /// <summary>The temperature at which the GPU starts to slow down, in degrees Celsius, or null.</summary>
    public int? SlowdownTempC()
    {
        if (!_ready) return null;
        try { return nvmlDeviceGetTemperatureThreshold(_device, 1, out var c) == 0 ? (int)c : null; }   // 1 is NVML_TEMPERATURE_THRESHOLD_SLOWDOWN
        catch (Exception) { return null; }
    }

    public void Dispose() { if (_ready) { try { nvmlShutdown(); } catch { } _ready = false; } }
}
