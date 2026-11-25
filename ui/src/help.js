// LOQ Monitor | Plain-language descriptions for sensors
// Author: cahyata
// Copyright (c) 2026 cahyata
"use strict";
/* Short explanations for the Detailed tab, written for people who are not hardware experts.
   Rules are matched on the sensor type and name; the first match wins. No numbers in degrees
   appear here because the temperature unit can change. */

const SensorHelp = (() => {
  // [sensor type, name pattern, description]
  const RULES = [
    // Temperatures
    ["Temperature", /^Core \(Tctl\/Tdie\)$/, "Processor temperature, taken at the hottest point of the whole processor package and reported by the processor itself. Long periods near its limit mean the cooling is struggling."],
    ["Temperature", /^GPU Core$/, "Temperature of the graphics chip."],
    ["Temperature", /^GPU Hot Spot$/, "The hottest point found anywhere on the graphics chip. It is always somewhat higher than the core temperature."],
    ["Temperature", /^GPU Memory Junction$/, "Temperature of the hottest point in the video memory chips (VRAM)."],
    ["Temperature", /^Composite Temperature$/, "Overall temperature of the SSD. An SSD slows itself down when it gets too hot."],
    ["Temperature", /^Temperature #\d+$/, "One of the temperature sensors inside the SSD."],
    ["Temperature", /^Warning Temperature$/, "SSD temperature at which the drive reports a warning."],
    ["Temperature", /^Critical Temperature$/, "SSD temperature at which the drive protects itself by slowing down or shutting off."],
    ["Temperature", /^TZ\d+$/, "A thermal zone the laptop firmware (BIOS) reports to Windows. The system uses it to decide fan speed and when to slow down."],
    ["Temperature", /^(CPU|GPU)$/, "Temperature read from the laptop's embedded controller, the small chip that runs the fans. The Lenovo software shows the same value."],

    // Fans
    ["Fan", /./, "Fan speed in revolutions per minute (RPM). A higher number means more cooling and more noise."],

    // Load
    ["Load", /^CPU Total$/, "How busy the whole processor is. 100% means every thread is fully used."],
    ["Load", /^CPU Core Max$/, "The busiest processor thread right now. Many games load one thread much harder than the rest."],
    ["Load", /^CPU Core #\d+$/, "How busy one processor thread is. Each physical core shows as two threads."],
    ["Load", /^GPU Core$/, "How busy the graphics chip is. Close to 100% while gaming is normal."],
    ["Load", /^GPU Memory Controller$/, "How busy the circuit that moves data in and out of video memory."],
    ["Load", /^GPU Memory$/, "How full the video memory (VRAM) is."],
    ["Load", /^GPU Video Engine$/, "How busy the graphics card's video hardware is (video playback, recording, streaming)."],
    ["Load", /^GPU Bus$/, "How busy the graphics card's connection to the rest of the computer is."],
    ["Load", /^D3D 3D$/, "Share of graphics chip time spent drawing 3D graphics (games and the desktop)."],
    ["Load", /^D3D Copy/, "Share of graphics chip time spent copying data between memory areas."],
    ["Load", /^D3D Video Decode/, "Share of graphics chip time spent playing back video."],
    ["Load", /^D3D Video Encode/, "Share of graphics chip time spent compressing video (recording, streaming)."],
    ["Load", /^D3D Overlay$/, "Graphics chip time used by overlays drawn on top of the screen."],
    ["Load", /^D3D Security$/, "Graphics chip time used for protected content such as DRM video."],
    ["Load", /^D3D VR$/, "Graphics chip time used for virtual reality."],
    ["Load", /^D3D Optical Flow/, "Graphics chip time used for motion analysis, for example by frame generation features."],
    ["Load", /^Memory$/, "Percentage of memory (RAM) that is in use."],
    ["Load", /^Used Space$/, "Percentage of the drive that is full."],
    ["Load", /^Total Activity$/, "How busy the drive is with reading and writing together."],
    ["Load", /^Read Activity$/, "How busy the drive is with reading."],
    ["Load", /^Write Activity$/, "How busy the drive is with writing."],
    ["Load", /^Network Utilization$/, "How much of the connection's top speed is being used."],

    // Power
    ["Power", /^Package$/, "Total electrical power the processor is drawing, in watts. More power means more heat."],
    ["Power", /^Core #\d+ \(SMU\)$/, "Power drawn by one processor core."],
    ["Power", /^GPU Package$/, "Total electrical power the graphics chip is drawing, in watts."],
    ["Power", /^Charge Rate$/, "Power flowing into the battery while charging, or out of it while the laptop runs on battery."],

    // Clocks
    ["Clock", /^Bus Speed$/, "The base reference speed that the processor speeds are multiplied from."],
    ["Clock", /^Cores \(Average Effective\)$/, "Average real speed of all cores, counting the time they sit idle. Closest to what the processor actually delivers."],
    ["Clock", /^Cores \(Average\)$/, "Average speed all cores are asked to run at."],
    ["Clock", /^Core #\d+ \(Effective\)$/, "Real speed of this core, counting idle time. Usually lower than the speed it is asked for."],
    ["Clock", /^Core #\d+$/, "Speed this core is asked to run at. It rises under load and falls when idle."],
    ["Clock", /^GPU Core$/, "Speed of the graphics chip. It rises under load and drops when the chip is hot or hits its power limit."],
    ["Clock", /^GPU Memory$/, "Speed of the video memory."],

    // Voltage, current, factor
    ["Voltage", /^Core #\d+ VID$/, "Voltage this core asks for. It is a request, not a measurement, and moves with speed and load."],
    ["Voltage", /^GPU Core Voltage$/, "Voltage supplied to the graphics chip."],
    ["Voltage", /^Voltage$/, "Voltage of the battery pack."],
    ["Current", /^Charge Current$/, "Electric current flowing into the battery."],
    ["Factor", /^Core #\d+$/, "Multiplier for this core. Core speed equals this number times the bus speed."],
    ["Factor", /^Power On Count$/, "How many times the drive has been powered on."],
    ["Factor", /^Power On Hours$/, "Total hours the drive has been powered on. A rough measure of its age."],

    // Levels
    ["Level", /^Charge Level$/, "How full the battery is."],
    ["Level", /^Degradation Level$/, "How much battery capacity has been lost to wear. Higher means a more worn battery."],
    ["Level", /^Life$/, "Remaining SSD life as estimated by the drive. 100% is new."],
    ["Level", /^Percentage Used$/, "The drive maker's estimate of how much of the SSD's rated lifetime has been used. It can go above 100% without the drive failing. The opposite of Life."],
    ["Level", /^Available Spare$/, "Spare memory cells the SSD keeps to replace worn ones. It shrinks as the drive wears."],
    ["Level", /^Available Spare Threshold$/, "When the Available Spare level falls below this one, the drive reports a warning about wear."],

    // Energy
    ["Energy", /^Designed Capacity$/, "How much energy the battery could store when it was new."],
    ["Energy", /^Fully-Charged Capacity$/, "How much energy the battery holds when full today. Lower than the designed capacity means wear."],
    ["Energy", /^Remaining Capacity$/, "Energy stored in the battery right now."],

    // Data and throughput
    ["Data", /^Memory Used$/, "Memory that is in use."],
    ["Data", /^Memory Available$/, "Memory that is still free for programs."],
    ["Data", /^Data Read$/, "Total data read from the drive, counted by the drive itself over its lifetime."],
    ["Data", /^Data Written$/, "Total data written to the drive, counted by the drive itself over its lifetime. It relates to wear."],
    ["Data", /^Free Space$/, "Storage space still free on the drive."],
    ["Data", /^Total Space$/, "Total size of the drive."],
    ["Data", /^Data Downloaded$/, "Total data received through this network connection since it came up."],
    ["Data", /^Data Uploaded$/, "Total data sent through this network connection since it came up."],
    ["SmallData", /^D3D Dedicated Memory Used$/, "Video memory used by programs through DirectX."],
    ["SmallData", /^D3D Shared Memory Used$/, "Normal memory (RAM) borrowed as extra video memory. It is slower than real video memory."],
    ["SmallData", /^GPU Memory Used$/, "Video memory in use."],
    ["SmallData", /^GPU Memory Free$/, "Video memory still free."],
    ["SmallData", /^GPU Memory Total$/, "Total video memory on the graphics card."],
    ["Throughput", /^GPU PCIe Rx$/, "Data the graphics card receives from the rest of the computer."],
    ["Throughput", /^GPU PCIe Tx$/, "Data the graphics card sends to the rest of the computer."],
    ["Throughput", /^Read Rate$/, "How fast the drive is reading right now."],
    ["Throughput", /^Write Rate$/, "How fast the drive is writing right now."],
    ["Throughput", /^Download Speed$/, "Current download speed on this network connection."],
    ["Throughput", /^Upload Speed$/, "Current upload speed on this network connection."],
  ];

  const GENERIC = {
    Temperature: "A temperature reading. Higher means hotter.",
    Fan: "Fan speed in revolutions per minute.",
    Load: "How busy this part is, in percent.",
    Power: "Electrical power in watts.",
    Clock: "Operating speed in megahertz. Higher is faster.",
    Voltage: "Electrical voltage.",
    Current: "Electric current.",
    Factor: "A unitless number, such as a multiplier or a counter.",
    Level: "A level in percent.",
    Energy: "An amount of stored energy.",
    Data: "An amount of data.",
    SmallData: "An amount of data in megabytes.",
    Throughput: "A data transfer speed.",
  };

  const GROUPS = {
    Temperature: "How hot parts are.",
    Fan: "How fast the fans are spinning.",
    Load: "How busy parts are, in percent.",
    Power: "How much electrical power parts are using, in watts.",
    Clock: "How fast parts are running, in megahertz.",
    Voltage: "Electrical voltages.",
    Current: "Electric currents.",
    Factor: "Multipliers and counters.",
    Level: "Levels in percent, such as charge or wear.",
    Energy: "Stored energy.",
    Data: "Amounts of data.",
    SmallData: "Amounts of data, in megabytes.",
    Throughput: "How fast data is moving.",
  };

  const HARDWARE = {
    Favorites: "Sensors you pinned with the star. They are also shown on the Overview tab.",
    "Lenovo embedded controller": "Readings from the laptop's own control chip, which runs the fans and watches the temperatures.",
    "ACPI thermal zones": "Temperatures that the laptop firmware (BIOS) exposes to Windows to manage cooling.",
    "Virtual Memory": "Your memory (RAM) plus the page file, the part of the disk Windows uses as extra memory.",
    "Total Memory": "Your installed memory (RAM).",
  };
  const HARDWARE_TYPE = {
    Cpu: "The processor.",
    GpuNvidia: "The NVIDIA graphics card.",
    GpuAmd: "The AMD graphics card.",
    Storage: "A drive (SSD or hard disk).",
    Network: "A network connection.",
    Battery: "The laptop battery.",
    Memory: "System memory (RAM).",
    Motherboard: "The main board of the computer.",
  };

  const COLUMNS = {
    SENSOR: "What is being measured. Hover a row for a short explanation.",
    VALUE: "The current reading.",
    MIN: "The lowest reading since the service started or since you pressed Reset min/max.",
    MAX: "The highest reading since the service started or since you pressed Reset min/max.",
  };

  return {
    /** Description for one sensor. A favorite's name carries a "hardware › " prefix, which is ignored. */
    sensor(type, name) {
      const n = name.includes("›") ? name.split("›").pop().trim() : name;
      const hit = RULES.find(([t, re]) => t === type && re.test(n));
      return hit ? hit[2] : GENERIC[type] ?? "";
    },
    group: (type) => GROUPS[type] ?? "",
    hardware: (name, type) => HARDWARE[name] ?? HARDWARE_TYPE[type] ?? "",
    column: (name) => COLUMNS[name] ?? "",
  };
})();
