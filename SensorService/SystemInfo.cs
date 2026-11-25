// LOQ Monitor | SystemInfo (static facts about the machine)
// Author: cahyata
// Copyright (c) 2026 cahyata
using System.Management;
using Microsoft.Win32;

/// <summary>
/// Collects the facts the System page shows: device, firmware, operating system, processor, graphics,
/// memory modules, drives, network adapters and battery. Everything comes from Windows (WMI and the
/// registry) and is read-only. It leaves out serial numbers and the user name on purpose. The read
/// takes a second or two, so the service keeps the result and the page asks for it once.
/// </summary>
static class SystemInfo
{
    public static object Collect() => new
    {
        CollectedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        Device = Device(),
        Firmware = Firmware(),
        Os = Os(),
        Cpu = Cpu(),
        Gpus = Gpus(),
        Memory = Memory(),
        Drives = Drives(),
        Volumes = Volumes(),
        Network = Network(),
        Battery = Battery(),
        PowerModes = PowerModes(),
    };

    static List<T> Query<T>(string scope, string wql, Func<ManagementObject, T> map)
    {
        var list = new List<T>();
        try
        {
            using var s = new ManagementObjectSearcher(scope, wql);
            foreach (ManagementObject o in s.Get()) using (o) { try { list.Add(map(o)); } catch { /* skip an entry that does not map */ } }
        }
        catch { /* the class is missing on this machine */ }
        return list;
    }

    static string? S(ManagementBaseObject o, string name)
    {
        var v = o[name]?.ToString()?.Trim();
        return string.IsNullOrEmpty(v) ? null : v;
    }
    static long? L(ManagementBaseObject o, string name) => o[name] is null ? null : Convert.ToInt64(o[name]);
    static string? Date(ManagementBaseObject o, string name)
    {
        var v = S(o, name);
        if (v is null) return null;
        try { return ManagementDateTimeConverter.ToDateTime(v).ToString("yyyy-MM-dd"); } catch { return null; }
    }
    static object? Reg(string key, string name) => Registry.GetValue(@"HKEY_LOCAL_MACHINE\" + key, name, null);

    static object? Device()
    {
        var cs = Query(@"root\CIMV2", "SELECT Manufacturer, Model, SystemFamily, SystemType, Name, TotalPhysicalMemory FROM Win32_ComputerSystem",
            o => new { Manufacturer = S(o, "Manufacturer"), Model = S(o, "Model"), Family = S(o, "SystemFamily"), Type = S(o, "SystemType"), Name = S(o, "Name"), RamBytes = L(o, "TotalPhysicalMemory") }).FirstOrDefault();
        // The product name on the box ("LOQ 15APH8") sits in Version, the model code ("83JC") in Model.
        var product = Query(@"root\CIMV2", "SELECT Version FROM Win32_ComputerSystemProduct", o => S(o, "Version")).FirstOrDefault();
        var board = Query(@"root\CIMV2", "SELECT Manufacturer, Product FROM Win32_BaseBoard", o => new { Manufacturer = S(o, "Manufacturer"), Product = S(o, "Product") }).FirstOrDefault();
        return cs is null ? null : new { cs.Manufacturer, cs.Model, cs.Family, ProductName = product, cs.Type, cs.Name, cs.RamBytes, Board = board };
    }

    static object? Firmware()
    {
        var bios = Query(@"root\CIMV2", "SELECT Manufacturer, SMBIOSBIOSVersion, ReleaseDate, SMBIOSMajorVersion, SMBIOSMinorVersion FROM Win32_BIOS", o => new
        {
            Vendor = S(o, "Manufacturer"), Version = S(o, "SMBIOSBIOSVersion"), ReleaseDate = Date(o, "ReleaseDate"),
            Smbios = $"{S(o, "SMBIOSMajorVersion")}.{S(o, "SMBIOSMinorVersion")}",
        }).FirstOrDefault();
        // The key exists only on UEFI machines.
        var secureBoot = Reg(@"SYSTEM\CurrentControlSet\Control\SecureBoot\State", "UEFISecureBootEnabled");
        return new { Bios = bios, Uefi = secureBoot is not null, SecureBoot = secureBoot is int i ? i == 1 : (bool?)null };
    }

    static object? Os()
    {
        var os = Query(@"root\CIMV2", "SELECT Caption, Version, BuildNumber, OSArchitecture, InstallDate, LastBootUpTime, Locale FROM Win32_OperatingSystem", o => new
        {
            Name = S(o, "Caption"), Version = S(o, "Version"), Build = S(o, "BuildNumber"), Architecture = S(o, "OSArchitecture"),
            Installed = Date(o, "InstallDate"),
            BootTime = S(o, "LastBootUpTime") is { } b ? new DateTimeOffset(ManagementDateTimeConverter.ToDateTime(b)).ToUnixTimeMilliseconds() : (long?)null,
        }).FirstOrDefault();
        const string cv = @"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
        return os is null ? null : new { os.Name, os.Version, os.Build, Revision = Reg(cv, "UBR")?.ToString(), Release = Reg(cv, "DisplayVersion")?.ToString(), os.Architecture, os.Installed, os.BootTime };
    }

    static object? Cpu() => Query(@"root\CIMV2",
        "SELECT Name, Manufacturer, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed, L2CacheSize, L3CacheSize, SocketDesignation, VirtualizationFirmwareEnabled FROM Win32_Processor",
        o => new
        {
            Name = S(o, "Name"), Vendor = S(o, "Manufacturer"), Cores = L(o, "NumberOfCores"), Threads = L(o, "NumberOfLogicalProcessors"),
            MaxMHz = L(o, "MaxClockSpeed"), L2KB = L(o, "L2CacheSize"), L3KB = L(o, "L3CacheSize"), Socket = S(o, "SocketDesignation"),
            Virtualization = o["VirtualizationFirmwareEnabled"] as bool?,
        }).FirstOrDefault();

    static object Gpus() => Query(@"root\CIMV2",
        "SELECT Name, AdapterCompatibility, DriverVersion, DriverDate, CurrentHorizontalResolution, CurrentVerticalResolution, CurrentRefreshRate, VideoProcessor FROM Win32_VideoController",
        o => new
        {
            Name = S(o, "Name"), Vendor = S(o, "AdapterCompatibility"), Driver = S(o, "DriverVersion"), DriverDate = Date(o, "DriverDate"),
            Width = L(o, "CurrentHorizontalResolution"), Height = L(o, "CurrentVerticalResolution"), RefreshHz = L(o, "CurrentRefreshRate"),
        });

    static string MemoryType(long? code) => code switch
    {
        20 => "DDR", 21 => "DDR2", 24 => "DDR3", 26 => "DDR4", 27 => "LPDDR", 28 => "LPDDR2", 29 => "LPDDR3", 30 => "LPDDR4", 34 => "DDR5", 35 => "LPDDR5",
        _ => "RAM",
    };
    static string? FormFactor(long? code) => code switch { 8 => "DIMM", 12 => "SO-DIMM", 0 or null => null, _ => "Soldered" };

    static object Memory() => Query(@"root\CIMV2",
        "SELECT BankLabel, DeviceLocator, Capacity, Speed, ConfiguredClockSpeed, Manufacturer, PartNumber, SMBIOSMemoryType, FormFactor FROM Win32_PhysicalMemory",
        o => new
        {
            Slot = S(o, "DeviceLocator") ?? S(o, "BankLabel"), Bytes = L(o, "Capacity"), Type = MemoryType(L(o, "SMBIOSMemoryType")), FormFactor = FormFactor(L(o, "FormFactor")),
            SpeedMTs = L(o, "ConfiguredClockSpeed") ?? L(o, "Speed"), Manufacturer = S(o, "Manufacturer"), PartNumber = S(o, "PartNumber"),
        });

    static string Bus(long? code) => code switch { 17 => "NVMe", 11 => "SATA", 7 => "USB", 8 => "RAID", 1 => "SCSI", 3 => "ATA", 10 => "SAS", _ => "Other" };
    static string Media(long? code) => code switch { 3 => "HDD", 4 => "SSD", 5 => "SCM", _ => "Unknown" };
    static string Health(long? code) => code switch { 0 => "Healthy", 1 => "Warning", 2 => "Unhealthy", _ => "Unknown" };

    static object Drives() => Query(@"root\Microsoft\Windows\Storage",
        "SELECT FriendlyName, MediaType, BusType, HealthStatus, Size, FirmwareVersion FROM MSFT_PhysicalDisk",
        o => new { Name = S(o, "FriendlyName"), Media = Media(L(o, "MediaType")), Bus = Bus(L(o, "BusType")), Health = Health(L(o, "HealthStatus")), Bytes = L(o, "Size"), Firmware = S(o, "FirmwareVersion") });

    static object Volumes() => Query(@"root\CIMV2",
        "SELECT DeviceID, VolumeName, FileSystem, Size, FreeSpace FROM Win32_LogicalDisk WHERE DriveType = 3",
        o => new { Drive = S(o, "DeviceID"), Label = S(o, "VolumeName"), FileSystem = S(o, "FileSystem"), Bytes = L(o, "Size"), FreeBytes = L(o, "FreeSpace") });

    static object Network()
    {
        var speeds = Query(@"root\CIMV2", "SELECT Index, Speed, NetConnectionID, AdapterType FROM Win32_NetworkAdapter WHERE PhysicalAdapter = TRUE",
            o => (Index: L(o, "Index"), Speed: L(o, "Speed"), Connection: S(o, "NetConnectionID"), Type: S(o, "AdapterType")));
        return Query(@"root\CIMV2",
            "SELECT Index, Description, MACAddress, IPAddress, DefaultIPGateway, DHCPEnabled FROM Win32_NetworkAdapterConfiguration WHERE IPEnabled = TRUE",
            o =>
            {
                var idx = L(o, "Index");
                var sp = speeds.FirstOrDefault(x => x.Index == idx);
                return new
                {
                    Name = S(o, "Description"), Connection = sp.Connection, Mac = S(o, "MACAddress"),
                    Ip = (o["IPAddress"] as string[])?.ToArray(), Gateway = (o["DefaultIPGateway"] as string[])?.FirstOrDefault(),
                    Dhcp = o["DHCPEnabled"] as bool?, SpeedMbps = sp.Speed is > 0 ? sp.Speed / 1_000_000 : (long?)null,
                };
            });
    }

    static object? Battery()
    {
        var b = Query(@"root\CIMV2", "SELECT Name, Chemistry, DesignVoltage FROM Win32_Battery",
            o => new { Name = S(o, "Name"), Chemistry = Chem(L(o, "Chemistry")), DesignMilliVolts = L(o, "DesignVoltage") }).FirstOrDefault();
        if (b is null) return null;
        var cycles = Query(@"root\WMI", "SELECT CycleCount FROM BatteryCycleCount", o => L(o, "CycleCount")).FirstOrDefault();
        return new { b.Name, b.Chemistry, b.DesignMilliVolts, CycleCount = cycles is > 0 ? cycles : null };
    }
    /// <summary>
    /// What each Lenovo power mode allows by default: CPU and GPU power limits. The laptop firmware lists them as
    /// capability data, one entry per feature and mode. The mode is the second byte of the ID (1 quiet, 2 balanced,
    /// 3 performance). Read only.
    /// </summary>
    static object? PowerModes()
    {
        var table = Query(@"root\WMI", "SELECT IDs, DefaultValue FROM LENOVO_CAPABILITY_DATA_01", o => (Id: L(o, "IDs"), Value: L(o, "DefaultValue")))
            .Where(x => x.Id is not null && x.Value is not null).GroupBy(x => x.Id!.Value).ToDictionary(g => g.Key, g => g.First().Value);
        if (table.Count == 0) return null;
        long? V(long feature, int mode) => table.TryGetValue((feature << 16) | ((long)mode << 8), out var v) ? v : null;
        object Mode(string name, int mode) => new
        {
            Name = name,
            CpuSustainedW = V(0x0102, mode), CpuShortW = V(0x0101, mode), CpuPeakW = V(0x0103, mode), CpuTempC = V(0x0104, mode),
            GpuBaseW = V(0x0202, mode), GpuBoostW = V(0x0201, mode),
        };
        return new[] { Mode("Quiet", 1), Mode("Balanced", 2), Mode("Performance", 3) };
    }

    static string? Chem(long? code) => code switch { 1 => "Other", 3 => "Lead acid", 4 => "Nickel cadmium", 5 => "Nickel metal hydride", 6 => "Lithium ion", 7 => "Zinc air", 8 => "Lithium polymer", _ => null };
}
