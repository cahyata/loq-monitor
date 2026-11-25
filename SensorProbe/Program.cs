// LOQ Monitor | SensorProbe (diagnostic console tool)
// Author: cahyata
// Copyright (c) 2026 cahyata
using System.Management;
using System.Security.Principal;
using LibreHardwareMonitor.Hardware;

var isAdmin = new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
Console.WriteLine($"Admin: {isAdmin}");
Console.WriteLine();

// ---- 1. LibreHardwareMonitor ----
Console.WriteLine("=== LibreHardwareMonitor ===");
var pc = new Computer
{
    IsCpuEnabled = true,
    IsGpuEnabled = true,
    IsMemoryEnabled = true,
    IsStorageEnabled = true,
    IsBatteryEnabled = true,
    IsMotherboardEnabled = true,
    IsControllerEnabled = true,
    IsNetworkEnabled = false,
};
try { pc.Open(); }
catch (Exception e) { Console.WriteLine($"Open failed: {e.Message}"); }

pc.Accept(new UpdateVisitor());

void Dump(IHardware hw, int depth)
{
    var pad = new string(' ', depth * 2);
    Console.WriteLine($"{pad}[{hw.HardwareType}] {hw.Name}");
    foreach (var s in hw.Sensors.OrderBy(s => s.SensorType).ThenBy(s => s.Name))
        Console.WriteLine($"{pad}  {s.SensorType,-12} {s.Name,-28} = {(s.Value.HasValue ? s.Value.Value.ToString("F1") : "null")}");
    foreach (var sub in hw.SubHardware) Dump(sub, depth + 1);
}
foreach (var hw in pc.Hardware) Dump(hw, 0);
pc.Close();

// ---- 2. Lenovo WMI ----
Console.WriteLine();
Console.WriteLine("=== Lenovo WMI (root\\WMI) ===");
try
{
    using var searcher = new ManagementObjectSearcher(@"root\WMI", "SELECT * FROM meta_class WHERE __CLASS LIKE 'LENOVO%'");
    var names = searcher.Get().Cast<ManagementBaseObject>().Select(o => (string)o["__CLASS"]).OrderBy(n => n).ToList();
    Console.WriteLine($"{names.Count} classes found");
    foreach (var n in names) Console.WriteLine("  " + n);
}
catch (Exception e) { Console.WriteLine("WMI error: " + e.Message); }

// ---- 3. Lenovo GameZone read-only getters ----
Console.WriteLine();
Console.WriteLine("=== Lenovo GameZone (read-only getters) ===");
string[] getters = { "GetFanCount", "GetFan1Speed", "GetFan2Speed", "GetFanMaxSpeed", "GetCPUTemp", "GetGPUTemp",
                     "GetIRTemp", "GetCpuFrequency", "GetGPUPow", "GetThermalMode", "GetSmartFanMode", "GetPowerChargeMode" };
foreach (var g in getters)
{
    try
    {
        using var searcher = new ManagementObjectSearcher(@"root\WMI", "SELECT * FROM LENOVO_GAMEZONE_DATA");
        foreach (ManagementObject mo in searcher.Get())
        {
            var res = mo.InvokeMethod(g, null, null);
            Console.WriteLine($"  {g,-20} = {res?["Data"]}");
            break;
        }
    }
    catch (Exception e) { Console.WriteLine($"  {g,-20} : {e.GetType().Name} - {e.Message.Trim()}"); }
}

// ---- 4. Lenovo capability values (GetFeatureValue, read-only) ----
Console.WriteLine();
Console.WriteLine("=== Lenovo GetFeatureValue (capabilities) ===");
var caps = new (string Name, int Id)[]
{
    ("CpuCurrentFanSpeed", 0x04030001), ("GpuCurrentFanSpeed", 0x04030002),
    ("SystemCurrentFanSpeed", 0x04030004), ("ExtraSystemCurrentFanSpeed", 0x04030005),
    ("MotherboardCurrentTemp", 0x05010000), ("CpuCurrentTemp", 0x05040000), ("GpuCurrentTemp", 0x05050000),
};
foreach (var (name, id) in caps)
{
    try
    {
        using var searcher = new ManagementObjectSearcher(@"root\WMI", "SELECT * FROM LENOVO_OTHER_METHOD");
        foreach (ManagementObject mo in searcher.Get())
        {
            var inp = mo.GetMethodParameters("GetFeatureValue");
            inp["IDs"] = id;
            var res = mo.InvokeMethod("GetFeatureValue", inp, null);
            Console.WriteLine($"  {name,-28} = {res?["value"]}");
            break;
        }
    }
    catch (Exception e) { Console.WriteLine($"  {name,-28} : {e.GetType().Name} - {e.Message.Trim()}"); }
}

class UpdateVisitor : IVisitor
{
    public void VisitComputer(IComputer computer) => computer.Traverse(this);
    public void VisitHardware(IHardware hardware)
    {
        hardware.Update();
        foreach (var sub in hardware.SubHardware) sub.Accept(this);
    }
    public void VisitSensor(ISensor sensor) { }
    public void VisitParameter(IParameter parameter) { }
}
