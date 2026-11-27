// LOQ Monitor | FpsMeter (frame rate of the game in front)
// Author: cahyata
// Copyright (c) 2026 cahyata
using System.Diagnostics;
using System.Runtime.InteropServices;

/// <summary>
/// Measures the frame rate of the program that has the foreground window, using PresentMon.
/// PresentMon only reads Windows trace events about presented frames. It injects nothing into the
/// game, so anti-cheat systems have nothing to object to. It starts when the first client asks for
/// frame data and stops when the last one lets go, because tracing has a small cost.
/// </summary>
sealed class FpsMeter : IOnDemand, IDisposable
{
    const string SessionName = "LOQMonitorFps";
    const int KeepMs = 6000;      // how much frame history to keep
    const int WindowMs = 1000;    // frames averaged for FPS and frame time
    const int StaleMs = 2000;     // no frames for this long means nothing is presenting

    readonly object _gate = new();
    readonly Dictionary<int, Queue<(long At, double Ms)>> _frames = new();
    readonly string? _exe;
    Process? _proc;
    IntPtr _job;
    int _demand;
    long _lastStopRequest;

    public FpsMeter()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "PresentMon.exe");
        _exe = File.Exists(path) ? path : null;
    }

    /// <summary>False when PresentMon.exe is not next to the service.</summary>
    public bool Available => _exe is not null;

    public void Acquire()
    {
        lock (_gate) { _demand++; if (_proc is null) Start(); }
    }

    public void Release()
    {
        lock (_gate)
        {
            if (_demand > 0) _demand--;
            if (_demand == 0) _lastStopRequest = Environment.TickCount64;
        }
    }

    /// <summary>Called once per second: stops PresentMon a few seconds after the last client let go.</summary>
    public void Tick()
    {
        lock (_gate)
        {
            if (_demand == 0 && _proc is not null && Environment.TickCount64 - _lastStopRequest > 5000) Stop();
        }
    }

    void Start()
    {
        if (_exe is null) return;
        try
        {
            var psi = new ProcessStartInfo(_exe)
            {
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true,
                WorkingDirectory = Path.GetDirectoryName(_exe)!,
            };
            foreach (var a in new[] { "--output_stdout", "--no_console_stats", "--stop_existing_session", "--session_name", SessionName,
                                      "--no_track_input", "--no_track_gpu" })
                psi.ArgumentList.Add(a);
            var p = Process.Start(psi);
            if (p is null) return;
            _proc = p;
            Log("PresentMon started, pid " + p.Id);
            AttachToJob(p);
            _ = Task.Run(() => ReadLoop(p));
        }
        catch (Exception e) { Log("PresentMon failed to start: " + e.Message); _proc = null; }
    }

    void Stop()
    {
        var p = _proc; _proc = null;
        Log("PresentMon stopped");
        try { if (p is { HasExited: false }) p.Kill(true); } catch { }
        lock (_frames) _frames.Clear();
    }

    void ReadLoop(Process p)
    {
        try
        {
            int app = -1, pid = -1, ms = -1;
            string? line;
            while ((line = p.StandardOutput.ReadLine()) is not null)
            {
                var f = line.TrimStart('﻿').Split(',');
                if (app < 0)
                {
                    app = Array.IndexOf(f, "Application");
                    pid = Array.IndexOf(f, "ProcessID");
                    ms = Array.IndexOf(f, "MsBetweenPresents");
                    if (app < 0 || pid < 0 || ms < 0) { app = -1; continue; }   // not the header yet
                    continue;
                }
                if (f.Length <= Math.Max(pid, ms)) continue;
                if (!int.TryParse(f[pid], out var id)) continue;
                if (!double.TryParse(f[ms], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var frameMs) || frameMs <= 0) continue;
                var now = Environment.TickCount64;
                lock (_frames)
                {
                    if (!_frames.TryGetValue(id, out var q)) _frames[id] = q = new Queue<(long, double)>();
                    q.Enqueue((now, frameMs));
                    while (q.Count > 0 && now - q.Peek().At > KeepMs) q.Dequeue();
                }
            }
        }
        catch { /* the process was stopped */ }
    }

    /// <summary>The latest reading for the program in front, or null when nothing is presenting.</summary>
    public FpsInfo? Current()
    {
        if (_proc is null) return null;
        var fg = ForegroundPid();
        if (fg == 0) return null;
        (long At, double Ms)[] all;
        lock (_frames)
        {
            if (!_frames.TryGetValue(fg, out var q) || q.Count == 0) return null;
            all = q.ToArray();
        }
        var now = Environment.TickCount64;
        if (now - all[^1].At > StaleMs) return null;

        var recent = all.Where(x => now - x.At <= WindowMs).Select(x => x.Ms).ToArray();
        if (recent.Length == 0) return null;
        var avg = recent.Average();

        // 1% low: the average frame time of the slowest 1% of frames in the kept history.
        var sorted = all.Select(x => x.Ms).OrderByDescending(x => x).ToArray();
        var worst = Math.Max(1, sorted.Length / 100);
        var low = sorted.Take(worst).Average();

        string? name = null;
        try { name = Process.GetProcessById(fg).ProcessName; } catch { }
        return new FpsInfo(name, (float)Math.Round(1000 / avg, 1), (float)Math.Round(avg, 1), (float)Math.Round(1000 / low, 1));
    }

    public void Dispose() { lock (_gate) { _demand = 0; Stop(); } if (_job != IntPtr.Zero) CloseHandle(_job); }

    static void Log(string msg)
    {
        try { File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "service.log"), $"{DateTime.Now:s} {msg}{Environment.NewLine}"); } catch { }
    }

    // ---- foreground window and child process cleanup ----
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    static int ForegroundPid()
    {
        var h = GetForegroundWindow();
        if (h == IntPtr.Zero) return 0;
        GetWindowThreadProcessId(h, out var pid);
        return (int)pid;
    }

    // A job object makes Windows end PresentMon when the service exits, even if it is killed.
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attrs, string? name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, int size);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinWs, MaxWs; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint Priority, Scheduling; }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters { public ulong a, b, c, d, e, f; }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits { public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMem, JobMem, PeakProcessMem, PeakJobMem; }

    void AttachToJob(Process p)
    {
        try
        {
            if (_job == IntPtr.Zero)
            {
                _job = CreateJobObject(IntPtr.Zero, null);
                var info = new ExtendedLimits { Basic = { LimitFlags = 0x2000 } };   // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                var size = Marshal.SizeOf<ExtendedLimits>();
                var ptr = Marshal.AllocHGlobal(size);
                try { Marshal.StructureToPtr(info, ptr, false); SetInformationJobObject(_job, 9, ptr, size); }   // 9 = extended limit information
                finally { Marshal.FreeHGlobal(ptr); }
            }
            AssignProcessToJobObject(_job, p.Handle);
        }
        catch (Exception e) { Log("job object failed: " + e.Message); }
    }
}
