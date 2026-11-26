// LOQ Monitor | EventHistory (problems recorded in the Windows Event Log)
// Author: cahyata
// Copyright (c) 2026 cahyata
using System.Diagnostics.Eventing.Reader;
using System.Globalization;

/// <summary>
/// Reads the Windows Event Log for the Diagnosis page: hardware errors (WHEA), blue screens and
/// shutdowns without warning, graphics driver and drive errors, and programs that crashed or stopped
/// responding. It only reads. Program entries carry the file name, the faulting module and the
/// exception code, and leave out folder paths and user names on purpose.
/// </summary>
static class EventHistory
{
    const int PerQuery = 500;    // newest entries of one kind, so a log full of one error stays quick to read
    const int MaxPrograms = 30;

    public record Event(long Time, string Kind, string Level, string Title, string? Detail, string Source, int Id);
    public record Program(string Name, int Crashes, int Hangs, long Last, string? Module, string? Code);
    public record Result(long CollectedAt, int Days, Event[] Events, Program[] Programs, string[] Failed);

    public static Result Collect(int days)
    {
        var window = (long)TimeSpan.FromDays(days).TotalMilliseconds;
        var events = new List<Event>();
        var failed = new HashSet<string>();

        void System(string filter, Func<EventRecord, (string Kind, string Level, string Title, string? Detail)?> map) =>
            Read("System", filter, window, failed, e =>
            {
                if (map(e) is { } m) events.Add(new Event(Time(e), m.Kind, m.Level, m.Title, m.Detail, e.ProviderName, e.Id));
            });

        // Hardware errors reported through the Windows Hardware Error Architecture.
        System("Provider[@Name='Microsoft-Windows-WHEA-Logger'] and (Level=1 or Level=2 or Level=3)", e =>
        {
            var part = e.Id switch { 17 => "PCI Express", 18 or 19 => "Processor", 47 => "Memory", _ => "Hardware" };
            return e.Level <= 2
                ? ("hardware", "hot", "Hardware error that was not corrected", part)
                : ("hardware", "warn", "Hardware error that was corrected", part);
        });

        // Windows writes this at the next start, so the time is when the laptop came back, not when it stopped.
        System("Provider[@Name='Microsoft-Windows-Kernel-Power'] and EventID=41", e =>
        {
            var code = Number(e, 0);
            return code is > 0
                ? ("crash", "hot", "Blue screen", "Stop code 0x" + code.Value.ToString("X8"))
                : ("crash", "warn", "Shut down without warning", "Power loss, a forced shutdown or a freeze");
        });

        // A blue screen is normally covered by the entry above. This one is kept only when that entry is missing.
        var blueScreens = events.Where(x => x.Title == "Blue screen").Select(x => x.Time).ToArray();
        System("Provider[@Name='Microsoft-Windows-WER-SystemErrorReporting'] and EventID=1001", e =>
        {
            var at = Time(e);
            if (blueScreens.Any(t => Math.Abs(t - at) < 600_000)) return null;
            var code = Text(e, 0)?.Split(' ')[0];
            return ("crash", "hot", "Blue screen", code is null ? null : "Stop code " + code);
        });

        System("Provider[@Name='Display'] and EventID=4101", e =>
            ("graphics", "warn", "Graphics driver stopped responding and recovered", Text(e, 0)));
        System("Provider[@Name='nvlddmkm'] and (Level=1 or Level=2 or Level=3)", e =>
            ("graphics", "warn", "NVIDIA driver reported an error", "Driver event " + e.Id));

        System("Provider[@Name='disk'] and (EventID=7 or EventID=11 or EventID=51 or EventID=153)", e => e.Id switch
        {
            7 => ("drive", "hot", "Drive has a bad block", Text(e, 0)),
            11 => ("drive", "hot", "Drive controller error", Text(e, 0)),
            51 => ("drive", "warn", "Error while moving data to or from a drive", Text(e, 0)),
            _ => ("drive", "warn", "Drive operation had to be repeated", null),
        });
        System("(Provider[@Name='stornvme'] or Provider[@Name='storahci']) and EventID=129", e =>
            ("drive", "warn", "Drive did not answer and was reset", e.ProviderName == "stornvme" ? "NVMe drive" : "SATA drive"));
        System("(Provider[@Name='Ntfs'] or Provider[@Name='Microsoft-Windows-Ntfs']) and EventID=55", _ =>
            ("drive", "hot", "File system damage found", "Run a disk check on the volume"));

        var programs = new Dictionary<string, Program>(StringComparer.OrdinalIgnoreCase);
        void Add(EventRecord e, bool hang)
        {
            var name = FileName(Text(e, 0));
            if (name is null) return;
            var at = Time(e);
            var p = programs.GetValueOrDefault(name) ?? new Program(name, 0, 0, 0, null, null);
            // Entries arrive newest first within each kind, so the first module and code seen are the latest ones.
            if (!hang && p.Module is null) p = p with { Module = FileName(Text(e, 3)), Code = Text(e, 6) is { } c ? "0x" + c : null };
            programs[name] = p with { Crashes = p.Crashes + (hang ? 0 : 1), Hangs = p.Hangs + (hang ? 1 : 0), Last = Math.Max(p.Last, at) };
        }
        Read("Application", "Provider[@Name='Application Error'] and EventID=1000", window, failed, e => Add(e, false));
        Read("Application", "Provider[@Name='Application Hang'] and EventID=1002", window, failed, e => Add(e, true));

        return new Result(
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), days,
            events.OrderByDescending(x => x.Time).ToArray(),
            programs.Values.OrderByDescending(p => p.Crashes + p.Hangs).ThenByDescending(p => p.Last).Take(MaxPrograms).ToArray(),
            failed.ToArray());
    }

    static void Read(string log, string filter, long windowMs, HashSet<string> failed, Action<EventRecord> take)
    {
        try
        {
            var xpath = string.Create(CultureInfo.InvariantCulture, $"*[System[{filter} and TimeCreated[timediff(@SystemTime) <= {windowMs}]]]");
            using var reader = new EventLogReader(new EventLogQuery(log, PathType.LogName, xpath) { ReverseDirection = true });
            for (var n = 0; n < PerQuery; n++)
            {
                using var e = reader.ReadEvent();
                if (e is null) break;
                try { take(e); } catch { /* skip an entry that does not map */ }
            }
        }
        catch { failed.Add(log); }
    }

    static long Time(EventRecord e) => new DateTimeOffset(e.TimeCreated ?? DateTime.Now).ToUnixTimeMilliseconds();

    static string? Text(EventRecord e, int i)
    {
        if (i >= e.Properties.Count) return null;
        var v = Convert.ToString(e.Properties[i].Value, CultureInfo.InvariantCulture)?.Trim();
        return string.IsNullOrEmpty(v) ? null : v;
    }

    static ulong? Number(EventRecord e, int i) => ulong.TryParse(Text(e, i), NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : null;

    /// <summary>The last part of a name, in case an entry holds a whole path.</summary>
    static string? FileName(string? text) => text is null ? null : Path.GetFileName(text) is { Length: > 0 } n ? n : null;
}
