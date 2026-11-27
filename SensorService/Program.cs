// LOQ Monitor | SensorService (sensor reader and WebSocket server)
// Author: cahyata
// Copyright (c) 2026 cahyata
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Management;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using LibreHardwareMonitor.Hardware;

const int Port = 47821;
const int IntervalMs = 1000;

// Origins allowed to open the WebSocket (Tauri production + dev server). Empty origin = non-browser client.
var allowedOrigins = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
{
    "", "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://localhost:1420",
};

var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    Converters = { new FiniteFloatConverter(), new FiniteDoubleConverter() },
};

// One instance only: a second copy (for example a manual start while the scheduled task runs) exits quietly.
using var singleInstance = new Mutex(true, @"Global\LOQMonitor.SensorService", out var firstInstance);
if (!firstInstance) return;

using var cts = new CancellationTokenSource();
try { Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); }; } catch { /* no console (windowless run) */ }

DiskTracer.StopLeftover();
var reader = new SensorReader();
var fps = new FpsMeter();
var procs = new ProcessSampler();
var net = new NetProbe();
var clients = new ConcurrentDictionary<ClientSession, byte>();
// What a client can ask for with "<name>-on" and release with "<name>-off".
var onDemand = new Dictionary<string, IOnDemand> { ["fps"] = fps, ["procs"] = procs, ["net"] = net, ["limits"] = reader.LimitsDemand };
var sendLimit = TimeSpan.FromSeconds(10);
string latestJson = "{}";
string? systemJson = null;      // the System page data, read once because it takes a second or two
var systemGate = new object();
var eventCache = new Dictionary<int, (long At, string Json)>();   // Event Log reads, per number of days

var listener = new HttpListener();
listener.Prefixes.Add($"http://127.0.0.1:{Port}/");
try { listener.Start(); }
catch (Exception e)
{
    // Windowless run has no console, so record the failure next to the executable.
    File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "service.log"), $"{DateTime.Now:s} listener start failed: {e.Message}{Environment.NewLine}");
    return;
}
Console.WriteLine($"SensorService listening on ws://127.0.0.1:{Port}/ws  (Ctrl+C to stop)");

_ = Task.Run(() => AcceptLoop(cts.Token));

var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(IntervalMs));
try
{
    do
    {
        fps.Tick();
        var snap = reader.Read() with { Fps = fps.Current(), Processes = procs.Current, Network = net.Current };
        latestJson = JsonSerializer.Serialize(snap, jsonOptions);
        if (!clients.IsEmpty)
        {
            var bytes = Encoding.UTF8.GetBytes(latestJson);
            foreach (var client in clients.Keys) client.Post(bytes);   // queued only: the sensor loop never waits for a client
        }
    }
    while (await timer.WaitForNextTickAsync(cts.Token));
}
catch (OperationCanceledException) { }

listener.Stop();
reader.Dispose();
fps.Dispose();
procs.Dispose();
net.Dispose();
return;

async Task AcceptLoop(CancellationToken ct)
{
    while (!ct.IsCancellationRequested)
    {
        HttpListenerContext ctx;
        try { ctx = await listener.GetContextAsync(); }
        catch { return; }
        _ = Task.Run(() => Handle(ctx, ct));
    }
}

async Task Handle(HttpListenerContext ctx, CancellationToken ct)
{
    try
    {
        var origin = ctx.Request.Headers["Origin"] ?? "";
        if (!allowedOrigins.Contains(origin)) { ctx.Response.StatusCode = 403; ctx.Response.Close(); return; }

        var path = ctx.Request.Url?.AbsolutePath ?? "/";
        if (ctx.Request.IsWebSocketRequest && path == "/ws")
        {
            var wsCtx = await ctx.AcceptWebSocketAsync(null);
            using var ws = wsCtx.WebSocket;
            var session = new ClientSession(ws, onDemand, reader.RequestMinMaxReset, sendLimit);
            session.Post(Encoding.UTF8.GetBytes(latestJson));          // the latest snapshot on connect
            clients[session] = 0;
            try { await session.Run(ct); }
            finally { clients.TryRemove(session, out _); }
        }
        else if (path == "/system")
        {
            string json;
            lock (systemGate)
            {
                if (systemJson is null || ctx.Request.QueryString["refresh"] == "1")
                    systemJson = JsonSerializer.Serialize(SystemInfo.Collect(), jsonOptions);
                json = systemJson;
            }
            var bytes = Encoding.UTF8.GetBytes(json);
            ctx.Response.ContentType = "application/json";
            if (origin != "") ctx.Response.Headers["Access-Control-Allow-Origin"] = origin;   // the app fetches this from its own origin
            ctx.Response.OutputStream.Write(bytes);
            ctx.Response.Close();
        }
        else if (path == "/events")
        {
            var days = int.TryParse(ctx.Request.QueryString["days"], out var d) ? Math.Clamp(d, 1, 90) : 30;
            string json;
            lock (eventCache)
            {
                // A minute-old answer is good enough, and it stops repeated requests from reading the log again and again.
                var fresh = eventCache.TryGetValue(days, out var hit) && Environment.TickCount64 - hit.At < (ctx.Request.QueryString["refresh"] == "1" ? 5_000 : 60_000);
                json = fresh ? hit.Json : JsonSerializer.Serialize(EventHistory.Collect(days), jsonOptions);
                if (!fresh) eventCache[days] = (Environment.TickCount64, json);
            }
            var bytes = Encoding.UTF8.GetBytes(json);
            ctx.Response.ContentType = "application/json";
            if (origin != "") ctx.Response.Headers["Access-Control-Allow-Origin"] = origin;   // the app fetches this from its own origin
            ctx.Response.OutputStream.Write(bytes);
            ctx.Response.Close();
        }
        else if (path == "/snapshot")
        {
            var bytes = Encoding.UTF8.GetBytes(latestJson);
            ctx.Response.ContentType = "application/json";
            ctx.Response.OutputStream.Write(bytes);
            ctx.Response.Close();
        }
        else { ctx.Response.StatusCode = 404; ctx.Response.Close(); }
    }
    catch { try { ctx.Response.Abort(); } catch { } }
}

// ============================================================================

/// <summary>Runs a slow read at most once per interval and hands back the last result in between.</summary>
sealed class Throttled<T>(Func<T> read, int everyMs)
{
    bool _has;
    long _at;
    T _value = default!;
    public T Get()
    {
        var now = Environment.TickCount64;
        if (!_has || now - _at >= everyMs) { _value = read(); _at = now; _has = true; }
        return _value;
    }
}

sealed class SensorReader : IDisposable
{
    // Lenovo capability IDs for LENOVO_OTHER_METHOD.GetFeatureValue (read-only).
    const int CpuFan = 0x04030001, GpuFan = 0x04030002, CpuTemp = 0x05040000, GpuTemp = 0x05050000;

    readonly Computer _pc = new()
    {
        IsCpuEnabled = true, IsGpuEnabled = true, IsMemoryEnabled = true,
        IsStorageEnabled = true, IsBatteryEnabled = true,
        IsMotherboardEnabled = true, IsControllerEnabled = true, IsNetworkEnabled = true,
    };
    readonly Nvml _nvml = new();
    ManagementObject? _other, _zone;
    PerformanceCounter? _cpuFreq, _cpuPerf;
    ManagementBaseObject? _featureArgs;                 // reused for every GetFeatureValue call
    readonly Dictionary<int, int?> _features = new();   // Lenovo readings of the current tick, so each is read once
    // The Lenovo power mode and the ACPI zones change slowly and each read costs tens of milliseconds, so they refresh less often.
    readonly Throttled<int?> _mode;
    readonly Throttled<SensorInfo[]> _acpi;
    readonly Throttled<BatteryPower?> _batteryRate;

    public SensorReader()
    {
        _mode = new(ReadPowerMode, 3000);
        _acpi = new(ReadAcpiZones, 3000);
        _batteryRate = new(ReadBatteryRateW, 2000);
        _limits = new(ReadLimits, 5000);
        Open();
    }

    void Open()
    {
        try { _pc.Open(); } catch (Exception e) { Console.WriteLine("LHM open failed: " + e.Message); }
        try
        {
            using var s = new ManagementObjectSearcher(@"root\WMI", "SELECT * FROM LENOVO_OTHER_METHOD");
            _other = s.Get().Cast<ManagementObject>().FirstOrDefault();
        }
        catch (Exception e) { Console.WriteLine("Lenovo WMI unavailable: " + e.Message); }
        try
        {
            using var z = new ManagementObjectSearcher(@"root\WMI", "SELECT * FROM LENOVO_GAMEZONE_DATA");
            _zone = z.Get().Cast<ManagementObject>().FirstOrDefault();
        }
        catch (Exception e) { Console.WriteLine("Lenovo GameZone unavailable: " + e.Message); }
        try
        {
            // Windows counters work with Memory Integrity on, unlike the LHM CPU driver.
            _cpuFreq = new PerformanceCounter("Processor Information", "Processor Frequency", "_Total");
            _cpuPerf = new PerformanceCounter("Processor Information", "% Processor Performance", "_Total");
            _cpuFreq.NextValue(); _cpuPerf.NextValue(); // first sample of a rate counter is always 0
        }
        catch (Exception e) { Console.WriteLine("CPU clock counters unavailable: " + e.Message); }
    }

    /// Approximate CPU clock: nominal frequency scaled by the performance percentage.
    float? CpuClockMHz()
    {
        try
        {
            if (_cpuFreq is null || _cpuPerf is null) return null;
            var mhz = _cpuFreq.NextValue() * _cpuPerf.NextValue() / 100f;
            return mhz > 0 ? MathF.Round(mhz) : null;
        }
        catch { return null; }
    }

    /// Lenovo power mode (Fn+Q): 1 quiet, 2 balanced, 3 performance, 255 custom (224 on some models). Read-only.
    int? PowerMode() => _mode.Get();

    int? ReadPowerMode()
    {
        if (_zone is null) return null;
        foreach (var m in new[] { "GetSmartFanMode", "GetThermalMode" })
        {
            try
            {
                var v = Convert.ToInt32(_zone.InvokeMethod(m, null, null)?["Data"]);
                if (v is 1 or 2 or 3 or 224 or 255) return v;
            }
            catch { }
        }
        return null;
    }

    int? Feature(int id)
    {
        if (_other is null) return null;
        if (_features.TryGetValue(id, out var cached)) return cached;
        return _features[id] = ReadFeature(id);
    }

    int? ReadFeature(int id)
    {
        if (_other is null) return null;
        try
        {
            _featureArgs ??= _other.GetMethodParameters("GetFeatureValue");
            _featureArgs["IDs"] = id;
            var r = _other.InvokeMethod("GetFeatureValue", _featureArgs, null);
            return Convert.ToInt32(r?["value"]);
        }
        catch { return null; }
    }

    // ---- power limits: what the laptop firmware and the GPU driver allow right now ----
    // Lenovo capability IDs, the values of the active power mode (the FF suffix). Read only.
    const int CpuShortTermW = 0x0101FF00, CpuLongTermW = 0x0102FF00, CpuPeakW = 0x0103FF00, CpuTempLimitC = 0x0104FF00;
    readonly Throttled<PowerLimits?> _limits;
    /// <summary>The limits are read only while a client shows them.</summary>
    public DemandCount LimitsDemand { get; } = new();

    PowerLimits? ReadLimits()
    {
        var cpuLong = ReadFeature(CpuLongTermW);
        var cpuShort = ReadFeature(CpuShortTermW);
        var cpuPeak = ReadFeature(CpuPeakW);
        var cpuTemp = ReadFeature(CpuTempLimitC);
        var gpuW = _nvml.PowerLimitW();
        var gpuTemp = _nvml.SlowdownTempC();
        if (cpuLong is null && gpuW is null) return null;
        return new PowerLimits(cpuLong, cpuShort, cpuPeak, cpuTemp, gpuW, gpuTemp);
    }

    // Minimum and maximum since start for the Lenovo and ACPI values, which LHM does not own.
    readonly MinMax _range = new();

    /// ACPI thermal zones (tenths of a kelvin), the same source HWMonitor shows as \_TZ.TZxx.
    SensorInfo[] AcpiZones() => _acpi.Get();

    SensorInfo[] ReadAcpiZones()
    {
        try
        {
            using var s = new ManagementObjectSearcher(@"root\WMI", "SELECT InstanceName, CurrentTemperature FROM MSAcpi_ThermalZoneTemperature");
            return s.Get().Cast<ManagementObject>().Select(m =>
            {
                var name = Convert.ToString(m["InstanceName"]) ?? "zone";
                name = name.Split((char)92).Last().Replace("_0", "");
                return _range.Track("Temperature", name, MathF.Round(Convert.ToInt32(m["CurrentTemperature"]) / 10f - 273.15f, 1));
            }).ToArray();
        }
        catch { return []; }
    }

    volatile bool _resetMinMax;
    public void RequestMinMaxReset() => _resetMinMax = true;

    void ApplyMinMaxReset()
    {
        _resetMinMax = false;
        void Reset(IHardware hw)
        {
            foreach (var x in hw.Sensors) { x.ResetMin(); x.ResetMax(); }
            foreach (var sub in hw.SubHardware) Reset(sub);
        }
        foreach (var hw in _pc.Hardware) Reset(hw);
        _range.Clear();
    }

    /// <summary>Reads the hardware once. <see cref="SnapshotBuilder"/> decides what the snapshot says.</summary>
    public Snapshot Read()
    {
        if (_resetMinMax) ApplyMinMaxReset();
        _features.Clear();
        foreach (var hw in _pc.Hardware) { hw.Update(); foreach (var sub in hw.SubHardware) sub.Update(); }

        return SnapshotBuilder.Build(new Readings(
            Ts: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Hardware: _pc.Hardware.Select(Copy).ToArray(),
            EcCpuTemp: Feature(CpuTemp), EcGpuTemp: Feature(GpuTemp), EcCpuFan: Feature(CpuFan), EcGpuFan: Feature(GpuFan),
            PowerMode: PowerMode(),
            AcpiZones: AcpiZones(),
            CounterClockMHz: CpuClockMHz, BatteryNow: BatteryNow, ThrottleMask: _nvml.ThrottleMask,
            Limits: LimitsDemand.Wanted ? _limits.Get() : null), _range);
    }

    static HardwareData Copy(IHardware hw) => new(
        hw.HardwareType, hw.Name,
        hw.Sensors.Select(x => new SensorData(x.SensorType, x.Name, x.Index, x.Value, x.Min, x.Max)).ToArray(),
        hw.SubHardware.Select(Copy).ToArray());

    /// <summary>The battery power and charger state Windows reports in root\WMI BatteryStatus, in milliwatts.</summary>
    BatteryPower? BatteryNow() => _batteryRate.Get();

    static BatteryPower? ReadBatteryRateW()
    {
        try
        {
            using var s = new ManagementObjectSearcher(@"root\WMI", "SELECT PowerOnline, Charging, Discharging, ChargeRate, DischargeRate FROM BatteryStatus");
            foreach (ManagementObject o in s.Get())
            {
                using (o)
                {
                    var ac = o["PowerOnline"] as bool?;
                    var charging = o["Charging"] as bool?;
                    if (charging is true) return new(Convert.ToInt32(o["ChargeRate"]) / 1000f, ac, charging);
                    if (o["Discharging"] is true) return new(-Convert.ToInt32(o["DischargeRate"]) / 1000f, ac, charging);
                    return new(0f, ac, charging);
                }
            }
        }
        catch { /* no battery or WMI unavailable: fall back to LibreHardwareMonitor */ }
        return null;
    }

    public void Dispose() { try { _pc.Close(); } catch { } _featureArgs?.Dispose(); _nvml.Dispose(); _other?.Dispose(); _zone?.Dispose(); _cpuFreq?.Dispose(); _cpuPerf?.Dispose(); }
}
