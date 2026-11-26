// LOQ Monitor | DiskTracer (which programs read and write the drives)
// Author: cahyata
// Copyright (c) 2026 cahyata
using System.Diagnostics;
using Microsoft.Diagnostics.Tracing.Parsers;
using Microsoft.Diagnostics.Tracing.Session;

/// <summary>
/// Listens to the Windows kernel's disk events (ETW), which count only data that really goes to or from a
/// drive, attributed to the process that asked for it. The per-process I/O counters of Windows cannot do
/// this: they also count pipes, network and cached reads. Needs administrator rights. The trace session
/// runs only while this object exists.
/// </summary>
sealed class DiskTracer : IDisposable
{
    const string SessionName = "LOQMonitorDisk";

    readonly object _gate = new();
    Dictionary<int, (string Name, long Read, long Write)> _window = new();
    readonly Stopwatch _clock = Stopwatch.StartNew();
    readonly TraceEventSession _session;

    DiskTracer(TraceEventSession session) => _session = session;

    /// <summary>Bytes per program since this tracer started.</summary>
    public Dictionary<string, (long Read, long Write)> Totals { get; } = new();

    /// <summary>Starts the trace, or returns null when Windows does not allow it.</summary>
    public static DiskTracer? Start()
    {
        TraceEventSession? session = null;
        try
        {
            session = new TraceEventSession(SessionName);   // replaces a session left behind by an earlier run
            // Process and thread events are needed to tell which process a disk request belongs to.
            session.EnableKernelProvider(KernelTraceEventParser.Keywords.DiskIO | KernelTraceEventParser.Keywords.Process | KernelTraceEventParser.Keywords.Thread);
            var tracer = new DiskTracer(session);
            session.Source.Kernel.DiskIORead += e => tracer.Add(e.ProcessID, e.ProcessName, e.TransferSize, 0);
            session.Source.Kernel.DiskIOWrite += e => tracer.Add(e.ProcessID, e.ProcessName, 0, e.TransferSize);
            var source = session.Source;
            new Thread(() => { try { source.Process(); } catch { /* the session was closed */ } }) { IsBackground = true, Name = "disk trace" }.Start();
            return tracer;
        }
        catch
        {
            session?.Dispose();
            return null;
        }
    }

    /// <summary>Stops a session that outlived the service, for example after the process was ended.</summary>
    public static void StopLeftover()
    {
        try { using var old = TraceEventSession.GetActiveSession(SessionName); old?.Stop(); }
        catch { /* none, or not allowed */ }
    }

    void Add(int pid, string name, int read, int write)
    {
        lock (_gate)
        {
            _window.TryGetValue(pid, out var v);
            _window[pid] = (string.IsNullOrEmpty(name) ? v.Name : name, v.Read + read, v.Write + write);
        }
    }

    /// <summary>Hands over the bytes counted since the last call, and the seconds they cover.</summary>
    public (Dictionary<int, (string Name, long Read, long Write)> Bytes, double Seconds) Drain()
    {
        lock (_gate)
        {
            var bytes = _window;
            _window = new();
            var seconds = _clock.Elapsed.TotalSeconds;
            _clock.Restart();
            return (bytes, seconds);
        }
    }

    public void Dispose() => _session.Dispose();
}
