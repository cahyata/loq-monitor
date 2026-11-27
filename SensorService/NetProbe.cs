// LOQ Monitor | NetProbe (Wi-Fi link and ping to the router and the DNS server)
// Author: cahyata
// Copyright (c) 2026 cahyata
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;

/// <summary>
/// Reads the Wi-Fi connection from the Windows WLAN API and measures ping to the default gateway
/// (the router) and to the DNS server of the same connection. It never contacts a host the machine
/// does not already use. It runs only while a client has asked for it and then every two seconds.
/// </summary>
sealed class NetProbe : IOnDemand, IDisposable
{
    const int EveryMs = 2000, Keep = 30, TimeoutMs = 1000;

    readonly object _gate = new();
    readonly Dictionary<string, Queue<int>> _rtts = new() { ["gateway"] = new(), ["dns"] = new() };   // -1 is a lost reply
    Timer? _timer;
    int _demand, _busy;
    volatile NetworkInfo? _latest;

    public NetworkInfo? Current => _latest;

    public void Acquire()
    {
        lock (_gate) { _demand++; _timer ??= new Timer(_ => _ = SampleAsync(), null, 0, EveryMs); }
    }

    public void Release()
    {
        lock (_gate)
        {
            if (_demand > 0) _demand--;
            if (_demand == 0) { _timer?.Dispose(); _timer = null; _latest = null; foreach (var q in _rtts.Values) q.Clear(); }
        }
    }

    async Task SampleAsync()
    {
        if (Interlocked.Exchange(ref _busy, 1) == 1) return;
        try
        {
            var (adapter, gateway, dns) = Route();
            var pings = await Task.WhenAll(Ping(gateway), Ping(dns));
            _latest = new NetworkInfo(adapter, Wifi.Read(), Stats("gateway", gateway, pings[0]), Stats("dns", dns, pings[1]));
        }
        catch { /* keep the previous result */ }
        finally { Volatile.Write(ref _busy, 0); }
    }

    /// <summary>The connection that has a default gateway, preferring a wired one, and its first IPv4 DNS server.</summary>
    static (string? Adapter, IPAddress? Gateway, IPAddress? Dns) Route()
    {
        var candidates = NetworkInterface.GetAllNetworkInterfaces()
            .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType is not (NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel))
            .Select(n => (Nic: n, Props: n.GetIPProperties()))
            .Select(x => (x.Nic, Gw: x.Props.GatewayAddresses.Select(g => g.Address).FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork && !a.Equals(IPAddress.Any)), x.Props))
            .Where(x => x.Gw is not null)
            .OrderBy(x => x.Nic.NetworkInterfaceType == NetworkInterfaceType.Ethernet ? 0 : 1)
            .ToList();
        if (candidates.Count == 0) return (null, null, null);
        var best = candidates[0];
        var dns = best.Props.DnsAddresses.FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork);
        return (best.Nic.Name, best.Gw, dns);
    }

    static async Task<int?> Ping(IPAddress? ip)
    {
        if (ip is null) return null;
        try
        {
            using var p = new Ping();
            var r = await p.SendPingAsync(ip, TimeoutMs);
            return r.Status == IPStatus.Success ? (int)r.RoundtripTime : -1;
        }
        catch { return -1; }
    }

    PingInfo? Stats(string key, IPAddress? ip, int? rtt)
    {
        if (ip is null || rtt is null) return null;
        int[] window;
        lock (_rtts)
        {
            var q = _rtts[key];
            q.Enqueue(rtt.Value);
            while (q.Count > Keep) q.Dequeue();
            window = q.ToArray();
        }
        var ok = window.Where(x => x >= 0).ToArray();
        double jitter = 0;
        for (var i = 1; i < ok.Length; i++) jitter += Math.Abs(ok[i] - ok[i - 1]);
        return new PingInfo(ip.ToString(), rtt.Value >= 0 ? rtt.Value : null,
            ok.Length > 0 ? (float)Math.Round(ok.Average(), 1) : null,
            ok.Length > 1 ? (float)Math.Round(jitter / (ok.Length - 1), 1) : null,
            (float)Math.Round(100.0 * (window.Length - ok.Length) / window.Length, 0));
    }

    public void Dispose() { lock (_gate) { _timer?.Dispose(); _timer = null; } }
}

/// <summary>The current Wi-Fi connection from wlanapi.dll. Read only.</summary>
static class Wifi
{
    [DllImport("wlanapi.dll")] static extern uint WlanOpenHandle(uint version, IntPtr reserved, out uint negotiated, out IntPtr handle);
    [DllImport("wlanapi.dll")] static extern uint WlanCloseHandle(IntPtr handle, IntPtr reserved);
    [DllImport("wlanapi.dll")] static extern uint WlanEnumInterfaces(IntPtr handle, IntPtr reserved, out IntPtr list);
    [DllImport("wlanapi.dll")] static extern uint WlanQueryInterface(IntPtr handle, byte[] iface, int opcode, IntPtr reserved, out int size, out IntPtr data, out int type);
    [DllImport("wlanapi.dll")] static extern void WlanFreeMemory(IntPtr memory);

    const int CurrentConnection = 7, ChannelNumber = 8;

    static string Standard(int phy) => phy switch
    {
        4 => "802.11a", 5 => "802.11b", 6 => "802.11g", 7 => "Wi-Fi 4 (802.11n)", 8 => "Wi-Fi 5 (802.11ac)", 10 => "Wi-Fi 6 (802.11ax)", 11 => "Wi-Fi 7 (802.11be)", _ => "Wi-Fi",
    };

    public static WifiInfo? Read()
    {
        var handle = IntPtr.Zero;
        try
        {
            if (WlanOpenHandle(2, IntPtr.Zero, out _, out handle) != 0) return null;
            if (WlanEnumInterfaces(handle, IntPtr.Zero, out var list) != 0) return null;
            try
            {
                // WLAN_INTERFACE_INFO_LIST: a count and an index (8 bytes), then 532 bytes per interface (GUID, name, state).
                var count = Marshal.ReadInt32(list);
                for (var i = 0; i < count; i++)
                {
                    var item = IntPtr.Add(list, 8 + i * 532);
                    if (Marshal.ReadInt32(item, 528) != 1) continue;   // 1 means connected
                    var guid = new byte[16];
                    Marshal.Copy(item, guid, 0, 16);
                    var info = Query(handle, guid);
                    if (info is not null) return info;
                }
            }
            finally { WlanFreeMemory(list); }
        }
        catch (Exception) { /* no WLAN service or no adapter */ }
        finally { if (handle != IntPtr.Zero) WlanCloseHandle(handle, IntPtr.Zero); }
        return null;
    }

    static WifiInfo? Query(IntPtr handle, byte[] guid)
    {
        if (WlanQueryInterface(handle, guid, CurrentConnection, IntPtr.Zero, out _, out var data, out _) != 0) return null;
        try
        {
            // WLAN_CONNECTION_ATTRIBUTES: state (4), mode (4), profile name (512), then the association attributes at 520.
            var ssidLen = Math.Min(32, Marshal.ReadInt32(data, 520));
            var ssid = new byte[ssidLen];
            Marshal.Copy(IntPtr.Add(data, 524), ssid, 0, ssidLen);
            var phy = Marshal.ReadInt32(data, 568);
            var signal = Marshal.ReadInt32(data, 576);
            var rxKbps = Marshal.ReadInt32(data, 580);
            var txKbps = Marshal.ReadInt32(data, 584);

            int? channel = null;
            if (WlanQueryInterface(handle, guid, ChannelNumber, IntPtr.Zero, out _, out var ch, out _) == 0)
            {
                try { channel = Marshal.ReadInt32(ch); } finally { WlanFreeMemory(ch); }
            }
            string? band = channel is >= 1 and <= 14 ? "2.4 GHz" : channel is >= 32 and <= 177 ? "5 GHz" : null;
            return new WifiInfo(Encoding.UTF8.GetString(ssid), signal, rxKbps / 1000, txKbps / 1000, Standard(phy), channel, band);
        }
        finally { WlanFreeMemory(data); }
    }
}
