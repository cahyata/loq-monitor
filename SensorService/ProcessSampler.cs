// LOQ Monitor | ProcessSampler (the programs that use the most CPU, memory, GPU and disk)
// Author: cahyata
// Copyright (c) 2026 cahyata
using System.Management;
using System.Text.RegularExpressions;

/// <summary>
/// Ranks programs by CPU, memory, GPU and disk use. CPU, memory and GPU come from the Windows performance
/// counters, which a single WMI query returns for every process; disk use comes from <see cref="DiskTracer"/>.
/// The scan costs a few hundred milliseconds, so it runs only while a client has asked for it and then every
/// three seconds.
/// Instances of one program (for example the many processes of a browser) are added together.
/// </summary>
sealed class ProcessSampler : IOnDemand, IDisposable
{
    const int EveryMs = 3000, Top = 5, TopDisk = 8;
    static readonly Regex EngineName = new(@"^pid_(\d+)_.*_engtype_(\w+)$", RegexOptions.Compiled);

    readonly object _gate = new();
    readonly int _cores = Environment.ProcessorCount;
    Timer? _timer;
    int _demand, _busy;
    volatile ProcessInfo? _latest;
    volatile DiskTracer? _disk;

    public ProcessInfo? Current => _latest;

    public void Acquire()
    {
        lock (_gate)
        {
            if (_demand++ == 0) _disk = DiskTracer.Start();
            _timer ??= new Timer(_ => Sample(), null, 0, EveryMs);
        }
    }

    public void Release()
    {
        lock (_gate)
        {
            if (_demand > 0) _demand--;
            if (_demand == 0) { _timer?.Dispose(); _timer = null; _latest = null; _disk?.Dispose(); _disk = null; _prevProc.Clear(); _prevGpu.Clear(); }
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
    readonly Dictionary<int, (double Cpu, double At)> _prevProc = new();
    readonly Dictionary<string, (double Busy, double At)> _prevGpu = new();

    /// <summary>
    /// The formatted counter classes give unreliable CPU figures when a fresh query asks for them, so this reads the
    /// raw counters, which are running totals, and divides the change by the time between two scans. The first scan
    /// has nothing to compare with and returns null.
    /// </summary>
    ProcessInfo? Scan()
    {
        var byName = new Dictionary<string, (int Count, double Cpu, double MemMB)>();
        var nameOfPid = new Dictionary<int, string>();
        var seenProc = new Dictionary<int, (double Cpu, double At)>();
        var comparable = false;

        using (var s = new ManagementObjectSearcher(@"root\CIMV2",
            "SELECT Name, IDProcess, PercentProcessorTime, WorkingSetPrivate, Timestamp_Sys100NS FROM Win32_PerfRawData_PerfProc_Process"))
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
                    var at = Convert.ToDouble(o["Timestamp_Sys100NS"]);
                    seenProc[pid] = (cpu, at);

                    double cpuPct = 0;
                    if (_prevProc.TryGetValue(pid, out var old) && at > old.At)
                    {
                        comparable = true;
                        cpuPct = Math.Max(0, (cpu - old.Cpu) / (at - old.At) * 100) / _cores;   // share of the whole CPU, like Task Manager
                    }
                    byName.TryGetValue(name, out var v);
                    byName[name] = (v.Count + 1, v.Cpu + cpuPct, v.MemMB + Convert.ToDouble(o["WorkingSetPrivate"]) / 1048576);
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
                "SELECT Name, UtilizationPercentage, Timestamp_Sys100NS FROM Win32_PerfRawData_GPUPerformanceCounters_GPUEngine WHERE UtilizationPercentage > 0");   // the counter is a running total, so an engine that was never used cannot be busy now; this skips about 85 % of the rows
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

        var disk = ScanDisk(nameOfPid, byName.ToDictionary(k => k.Key, k => k.Value.Count));   // drained every scan, so each window is one interval

        if (!comparable) return null;

        static ProcRow[] Rank(IEnumerable<(string Name, int Count, double Value)> rows, double min) =>
            rows.Where(r => r.Value >= min).OrderByDescending(r => r.Value).Take(Top)
                .Select(r => new ProcRow(r.Name, r.Count, (float)Math.Round(r.Value, 1))).ToArray();

        return new ProcessInfo(
            Rank(byName.Select(k => (k.Key, k.Value.Count, k.Value.Cpu)), 0.1),
            Rank(byName.Select(k => (k.Key, k.Value.Count, k.Value.MemMB)), 1),
            Rank(gpuByName.Select(k => (k.Key, byName.TryGetValue(k.Key, out var v) ? v.Count : 1, Math.Min(100, k.Value))), 0.1),
            disk);
    }

    /// <summary>The programs that moved the most data to and from the drives since the last scan, or null without a trace.</summary>
    DiskRow[]? ScanDisk(Dictionary<int, string> nameOfPid, Dictionary<string, int> processCount)
    {
        var tracer = _disk;
        if (tracer is null) return null;
        var (bytes, seconds) = tracer.Drain();
        var now = new Dictionary<string, (long Read, long Write)>();
        foreach (var (pid, v) in bytes)
        {
            var name = nameOfPid.GetValueOrDefault(pid) ?? v.Name;   // a process that already ended has only the name from the trace
            if (string.IsNullOrEmpty(name)) name = "Unknown";
            now.TryGetValue(name, out var n);
            now[name] = (n.Read + v.Read, n.Write + v.Write);
        }
        foreach (var (name, v) in now)
        {
            tracer.Totals.TryGetValue(name, out var t);
            tracer.Totals[name] = (t.Read + v.Read, t.Write + v.Write);
        }
        double PerSecond(long b) => Math.Round(b / 1048576.0 / Math.Max(0.5, seconds), 2);
        return now.Where(k => PerSecond(k.Value.Read + k.Value.Write) >= 0.01)   // less than 10 KB/s would show as zero
            .OrderByDescending(k => k.Value.Read + k.Value.Write).Take(TopDisk)
            .Select(k => new DiskRow(k.Key, processCount.GetValueOrDefault(k.Key, 1),
                (float)PerSecond(k.Value.Read), (float)PerSecond(k.Value.Write),
                Math.Round(tracer.Totals[k.Key].Read / 1048576.0, 1), Math.Round(tracer.Totals[k.Key].Write / 1048576.0, 1)))
            .ToArray();
    }

    public void Dispose() { lock (_gate) { _timer?.Dispose(); _timer = null; _disk?.Dispose(); _disk = null; } }
}
