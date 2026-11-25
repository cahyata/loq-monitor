// LOQ Monitor | ProcessSampler (the programs that use the most CPU, memory, GPU and disk)
// Author: cahyata
// Copyright (c) 2026 cahyata
using System.Management;
using System.Text.RegularExpressions;

/// <summary>
/// Ranks programs by CPU, memory, GPU and disk use. Windows reports these as ready-made performance
/// counters, which a single WMI query returns for every process. The scan costs a few hundred
/// milliseconds, so it runs only while a client has asked for it and then every three seconds.
/// Instances of one program (for example the many processes of a browser) are added together.
/// </summary>
sealed class ProcessSampler : IDisposable
{
    const int EveryMs = 3000, Top = 5;
    static readonly Regex EngineName = new(@"^pid_(\d+)_.*_engtype_(\w+)$", RegexOptions.Compiled);

    readonly object _gate = new();
    readonly int _cores = Environment.ProcessorCount;
    Timer? _timer;
    int _demand, _busy;
    volatile ProcessInfo? _latest;

    public ProcessInfo? Current => _latest;

    public void Acquire()
    {
        lock (_gate) { _demand++; _timer ??= new Timer(_ => Sample(), null, 0, EveryMs); }
    }

    public void Release()
    {
        lock (_gate)
        {
            if (_demand > 0) _demand--;
            if (_demand == 0) { _timer?.Dispose(); _timer = null; _latest = null; _prevProc.Clear(); _prevGpu.Clear(); }
        }
    }

    void Sample()
    {
        if (Interlocked.Exchange(ref _busy, 1) == 1) return;   // the last scan is still running
        try { _latest = Scan() ?? _latest; }
        catch { /* keep the previous result */ }
        finally { Volatile.Write(ref _busy, 0); }
    }

    static string BaseName(string instance)
    {
        var hash = instance.IndexOf('#');
        return hash > 0 ? instance[..hash] : instance;
    }

    // The last raw counter values, so each scan can turn running totals into rates.
    readonly Dictionary<int, (double Cpu, double Io, double At)> _prevProc = new();
    readonly Dictionary<string, (double Busy, double At)> _prevGpu = new();

    /// <summary>
    /// The formatted counter classes give unreliable CPU figures when a fresh query asks for them, so this reads the
    /// raw counters, which are running totals, and divides the change by the time between two scans. The first scan
    /// has nothing to compare with and returns null.
    /// </summary>
    ProcessInfo? Scan()
    {
        var byName = new Dictionary<string, (int Count, double Cpu, double MemMB, double DiskMBs)>();
        var nameOfPid = new Dictionary<int, string>();
        var seenProc = new Dictionary<int, (double Cpu, double Io, double At)>();
        var comparable = false;

        using (var s = new ManagementObjectSearcher(@"root\CIMV2",
            "SELECT Name, IDProcess, PercentProcessorTime, WorkingSetPrivate, IOReadBytesPersec, IOWriteBytesPersec, Timestamp_Sys100NS FROM Win32_PerfRawData_PerfProc_Process"))
        {
            foreach (ManagementObject o in s.Get())
            {
                using (o)
                {
                    var instance = o["Name"]?.ToString() ?? "";
                    if (instance is "_Total" or "Idle" or "") continue;
                    var name = BaseName(instance);
                    var pid = Convert.ToInt32(o["IDProcess"]);
                    nameOfPid[pid] = name;
                    var cpu = Convert.ToDouble(o["PercentProcessorTime"]);
                    var io = Convert.ToDouble(o["IOReadBytesPersec"]) + Convert.ToDouble(o["IOWriteBytesPersec"]);
                    var at = Convert.ToDouble(o["Timestamp_Sys100NS"]);
                    seenProc[pid] = (cpu, io, at);

                    double cpuPct = 0, diskMBs = 0;
                    if (_prevProc.TryGetValue(pid, out var old) && at > old.At)
                    {
                        comparable = true;
                        var dt = at - old.At;
                        cpuPct = Math.Max(0, (cpu - old.Cpu) / dt * 100) / _cores;   // share of the whole CPU, like Task Manager
                        diskMBs = Math.Max(0, io - old.Io) / (dt / 1e7) / 1048576;
                    }
                    byName.TryGetValue(name, out var v);
                    byName[name] = (v.Count + 1, v.Cpu + cpuPct, v.MemMB + Convert.ToDouble(o["WorkingSetPrivate"]) / 1048576, v.DiskMBs + diskMBs);
                }
            }
        }
        _prevProc.Clear(); foreach (var kv in seenProc) _prevProc[kv.Key] = kv.Value;

        // GPU time per engine. A process counts its busiest engine type, as in Task Manager.
        var gpuByName = new Dictionary<string, double>();
        try
        {
            var perPid = new Dictionary<(int Pid, string Eng), double>();
            var seenGpu = new Dictionary<string, (double Busy, double At)>();
            using var g = new ManagementObjectSearcher(@"root\CIMV2",
                "SELECT Name, UtilizationPercentage, Timestamp_Sys100NS FROM Win32_PerfRawData_GPUPerformanceCounters_GPUEngine");
            foreach (ManagementObject o in g.Get())
            {
                using (o)
                {
                    var inst = o["Name"]?.ToString() ?? "";
                    var m = EngineName.Match(inst);
                    if (!m.Success) continue;
                    var busy = Convert.ToDouble(o["UtilizationPercentage"]);
                    var at = Convert.ToDouble(o["Timestamp_Sys100NS"]);
                    seenGpu[inst] = (busy, at);
                    if (_prevGpu.TryGetValue(inst, out var old) && at > old.At)
                    {
                        var key = (int.Parse(m.Groups[1].Value), m.Groups[2].Value);
                        perPid[key] = perPid.GetValueOrDefault(key) + Math.Max(0, (busy - old.Busy) / (at - old.At) * 100);
                    }
                }
            }
            _prevGpu.Clear(); foreach (var kv in seenGpu) _prevGpu[kv.Key] = kv.Value;
            foreach (var grp in perPid.GroupBy(k => k.Key.Pid))
            {
                if (!nameOfPid.TryGetValue(grp.Key, out var name)) continue;
                gpuByName[name] = gpuByName.GetValueOrDefault(name) + Math.Min(100, grp.Max(x => x.Value));
            }
        }
        catch { /* no GPU counters on this machine */ }

        if (!comparable) return null;

        static ProcRow[] Rank(IEnumerable<(string Name, int Count, double Value)> rows, double min) =>
            rows.Where(r => r.Value >= min).OrderByDescending(r => r.Value).Take(Top)
                .Select(r => new ProcRow(r.Name, r.Count, (float)Math.Round(r.Value, 1))).ToArray();

        return new ProcessInfo(
            Rank(byName.Select(k => (k.Key, k.Value.Count, k.Value.Cpu)), 0.1),
            Rank(byName.Select(k => (k.Key, k.Value.Count, k.Value.MemMB)), 1),
            Rank(gpuByName.Select(k => (k.Key, byName.TryGetValue(k.Key, out var v) ? v.Count : 1, Math.Min(100, k.Value))), 0.1),
            Rank(byName.Select(k => (k.Key, k.Value.Count, k.Value.DiskMBs)), 0.05));
    }

    public void Dispose() { lock (_gate) { _timer?.Dispose(); _timer = null; } }
}

record ProcRow(string Name, int Count, float Value);
record ProcessInfo(ProcRow[] Cpu, ProcRow[] MemMB, ProcRow[] Gpu, ProcRow[] DiskMBs);
