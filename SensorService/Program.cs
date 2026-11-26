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
var clients = new ConcurrentDictionary<WebSocket, byte>();
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
        if (!clients.IsEmpty) await Broadcast(latestJson);
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
            var ws = wsCtx.WebSocket;
            clients[ws] = 0;
            await Send(ws, latestJson);
            var buf = new byte[256];
            var wantsFps = false;
            var wantsProcs = false;
            var wantsNet = false;
            var wantsLimits = false;
            try
            {
                while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
                {
                    var r = await ws.ReceiveAsync(buf, ct);
                    if (r.MessageType == WebSocketMessageType.Close) break;
                    if (r.MessageType != WebSocketMessageType.Text || !r.EndOfMessage) continue;
                    // Commands: restart min and max tracking, and ask for or release frame rate data.
                    // None of them touches hardware settings.
                    var command = Encoding.UTF8.GetString(buf, 0, r.Count);
                    switch (command)
                    {
                        case "reset-minmax": reader.RequestMinMaxReset(); break;
                        case "fps-on": if (!wantsFps) { wantsFps = true; fps.Acquire(); } break;
                        case "fps-off": if (wantsFps) { wantsFps = false; fps.Release(); } break;
                        case "procs-on": if (!wantsProcs) { wantsProcs = true; procs.Acquire(); } break;
                        case "procs-off": if (wantsProcs) { wantsProcs = false; procs.Release(); } break;
                        case "net-on": if (!wantsNet) { wantsNet = true; net.Acquire(); } break;
                        case "net-off": if (wantsNet) { wantsNet = false; net.Release(); } break;
                        case "limits-on": if (!wantsLimits) { wantsLimits = true; reader.WantLimits(true); } break;
                        case "limits-off": if (wantsLimits) { wantsLimits = false; reader.WantLimits(false); } break;
                    }
                }
            }
            finally { if (wantsFps) fps.Release(); if (wantsProcs) procs.Release(); if (wantsNet) net.Release(); if (wantsLimits) reader.WantLimits(false); }
            clients.TryRemove(ws, out _);
            ws.Dispose();
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

async Task Broadcast(string json)
{
    foreach (var ws in clients.Keys)
    {
        try { await Send(ws, json); }
        catch { clients.TryRemove(ws, out _); }
    }
}

static Task Send(WebSocket ws, string json) =>
    ws.State == WebSocketState.Open
        ? ws.SendAsync(Encoding.UTF8.GetBytes(json), WebSocketMessageType.Text, true, CancellationToken.None)
        : Task.CompletedTask;

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
    int _limitsWanted;

    /// <summary>Asks for the limits to be read (true) or lets go (false). They are read only while someone shows them.</summary>
    public void WantLimits(bool want)
    {
        if (want) Interlocked.Increment(ref _limitsWanted);
        else if (Volatile.Read(ref _limitsWanted) > 0) Interlocked.Decrement(ref _limitsWanted);
    }

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

    static float? Val(IHardware hw, SensorType t, string name) =>
        hw.Sensors.FirstOrDefault(s => s.SensorType == t && s.Name == name)?.Value;

    static float? MBs(float? v) => v.HasValue ? MathF.Round(v.Value / 1_000_000f, 1) : null;

    static float? Round(float? v) => v.HasValue ? MathF.Round(v.Value, 1) : null;

    /// Every LHM sensor, grouped by hardware, for the Detailed tab.
    List<HwInfo> AllHardware()
    {
        var list = new List<HwInfo>();
        void Add(IHardware hw, string name)
        {
            var sensors = hw.Sensors
                .Select(x => new SensorInfo(x.SensorType.ToString(), x.Name, x.Value, x.Min, x.Max)).ToArray();
            if (sensors.Length > 0) list.Add(new HwInfo(name, hw.HardwareType.ToString(), sensors));
            foreach (var sub in hw.SubHardware) Add(sub, name + " / " + sub.Name);
        }
        foreach (var hw in _pc.Hardware) Add(hw, hw.Name);

        var acpi = AcpiZones();
        if (acpi.Length > 0) list.Insert(0, new HwInfo("ACPI thermal zones", "Acpi", acpi));
        var ec = new List<SensorInfo>();
        void Ec(string type, string name, float? v) { if (v is > 0) ec.Add(Track(type, name, v.Value)); }
        Ec("Temperature", "CPU", Feature(CpuTemp)); Ec("Temperature", "GPU", Feature(GpuTemp));
        Ec("Fan", "CPU fan", Feature(CpuFan)); Ec("Fan", "GPU fan", Feature(GpuFan));
        if (ec.Count > 0) list.Insert(0, new HwInfo("Lenovo embedded controller", "Lenovo", ec.ToArray()));
        return list;
    }

    // Min and max since start for sensors LHM does not own.
    readonly Dictionary<string, (float Min, float Max)> _range = new();
    SensorInfo Track(string type, string name, float v)
    {
        var key = type + "|" + name;
        var r = _range.TryGetValue(key, out var old) ? (Math.Min(old.Min, v), Math.Max(old.Max, v)) : (v, v);
        _range[key] = r;
        return new SensorInfo(type, name, v, r.Item1, r.Item2);
    }

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
                return Track("Temperature", name, MathF.Round(Convert.ToInt32(m["CurrentTemperature"]) / 10f - 273.15f, 1));
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

    public Snapshot Read()
    {
        if (_resetMinMax) ApplyMinMaxReset();
        _features.Clear();
        foreach (var hw in _pc.Hardware) { hw.Update(); foreach (var sub in hw.SubHardware) sub.Update(); }

        var cpu = _pc.Hardware.FirstOrDefault(h => h.HardwareType == HardwareType.Cpu);
        var gpu = HardwarePick.Gpu(_pc.Hardware);
        var mem = _pc.Hardware.FirstOrDefault(h => h.HardwareType == HardwareType.Memory && h.Name == "Total Memory");
        var bat = _pc.Hardware.FirstOrDefault(h => h.HardwareType == HardwareType.Battery);

        // CPU temp: Lenovo EC first (works with Memory Integrity on), LHM (AMD Tctl, Intel package) as fallback.
        float? cpuTemp = Feature(CpuTemp);
        if (cpuTemp is null or <= 0) cpuTemp = HardwarePick.Positive(cpu, SensorType.Temperature, "Core (Tctl/Tdie)", "CPU Package");

        float? gpuTemp = gpu is null ? null : Val(gpu, SensorType.Temperature, "GPU Core");
        gpuTemp ??= Feature(GpuTemp);

        var cpuLoads = HardwarePick.ThreadLoads(cpu).Select(s => Round(s.Value) ?? 0).ToArray();

        var storage = _pc.Hardware.Where(h => h.HardwareType == HardwareType.Storage).Select(h => new StorageInfo(
            h.Name,
            Round(Val(h, SensorType.Temperature, "Composite Temperature") ?? Val(h, SensorType.Temperature, "Temperature #1")),
            Round(Val(h, SensorType.Load, "Used Space")),
            Round(Val(h, SensorType.Level, "Life")),
            MBs(Val(h, SensorType.Throughput, "Read Rate")),
            MBs(Val(h, SensorType.Throughput, "Write Rate")),
            Round(Val(h, SensorType.Load, "Total Activity")))).ToArray();

        float? designed = bat is null ? null : Val(bat, SensorType.Energy, "Designed Capacity");
        float? full = bat is null ? null : Val(bat, SensorType.Energy, "Fully-Charged Capacity");

        return new Snapshot(
            Ts: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Cpu: new CpuInfo(
                cpu?.Name, Round(cpu is null ? null : Val(cpu, SensorType.Load, "CPU Total")),
                Round(cpuTemp), Feature(CpuFan),
                // Average effective clock from LHM (needs PawnIO); Windows counters as fallback.
                Round(cpu is null ? null : Val(cpu, SensorType.Clock, "Cores (Average Effective)")) ?? CpuClockMHz(),
                Round(HardwarePick.Positive(cpu, SensorType.Power, "Package", "CPU Package")), cpuLoads),   // AMD, Intel
            Gpu: new GpuInfo(
                gpu?.Name,
                Round(gpu is null ? null : Val(gpu, SensorType.Load, "GPU Core")),
                Round(gpuTemp),
                Round(gpu is null ? null : Val(gpu, SensorType.Temperature, "GPU Hot Spot")),
                Round(gpu is null ? null : Val(gpu, SensorType.Temperature, "GPU Memory Junction")),
                Feature(GpuFan),
                Round(gpu is null ? null : Val(gpu, SensorType.Power, "GPU Package")),
                Round(gpu is null ? null : Val(gpu, SensorType.Clock, "GPU Core")),
                Round(gpu is null ? null : Val(gpu, SensorType.Clock, "GPU Memory")),
                Round(gpu is null ? null : Val(gpu, SensorType.SmallData, "GPU Memory Used")),
                Round(gpu is null ? null : Val(gpu, SensorType.SmallData, "GPU Memory Total")),
                MBs(gpu is null ? null : Val(gpu, SensorType.Throughput, "GPU PCIe Rx")),
                MBs(gpu is null ? null : Val(gpu, SensorType.Throughput, "GPU PCIe Tx")),
                gpu is null ? null : _nvml.ThrottleMask()),
            Ram: new RamInfo(
                Round(mem is null ? null : Val(mem, SensorType.Load, "Memory")),
                Round(mem is null ? null : Val(mem, SensorType.Data, "Memory Used")),
                Round(mem is null ? null : Val(mem, SensorType.Data, "Memory Available"))),
            Storage: storage,
            Battery: bat is null ? null : new BatteryInfo(
                Round(Val(bat, SensorType.Level, "Charge Level")),
                Round(BatteryNow()?.RateW ?? Val(bat, SensorType.Power, "Charge/Discharge Rate")),
                Round(Val(bat, SensorType.Level, "Degradation Level")),
                Round(designed / 1000), Round(full / 1000), BatteryNow()?.AcOnline, BatteryNow()?.Charging),
            PowerMode: PowerMode(),
            Limits: Volatile.Read(ref _limitsWanted) > 0 ? _limits.Get() : null,
            Hardware: AllHardware());
    }

    /// <summary>
    /// Battery power in watts: positive while charging, negative while discharging, 0 when idle on AC.
    /// Windows reports it in milliwatts through root\WMI BatteryStatus. LibreHardwareMonitor leaves its
    /// rate sensor empty while the battery discharges on this machine, so this is the primary source.
    /// </summary>
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
