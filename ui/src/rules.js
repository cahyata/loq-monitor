// LOQ Monitor | Reading rules
// Author: cahyata
// Copyright (c) 2026 cahyata
"use strict";
/* The one place that judges readings: which level a temperature, a fill, the battery or a drive is at, what a
   snapshot has that needs attention, and how raw codes are named. Pure: no page, no storage, no clock. The
   caller passes the user's temperature limits; the pages decide the words and the colors.

   A level is "ok" (Normal), "warn" (Warning) or "hot" (Critical), the class names the style sheets use, and
   "" when there is no reading. Tests: ui/test/rules.test.js. */

var Rules = (() => {   // var, so a page that loads this file shares it with the scripts after it
  const NORMAL = "ok", WARNING = "warn", CRITICAL = "hot", NONE = "";

  /** Temperature limits in °C until the user changes them: CPU and GPU warm and hot, GPU hotspot. */
  const LIMITS = Object.freeze({ warn: 75, hot: 90, spot: 95 });
  const DRIVE_WARN_C = 70, DRIVE_HOT_C = 80;
  const FILL_WARN = 80, FILL_CRITICAL = 90, DRIVE_FILL_ATTENTION = 90;
  const BATTERY_WARN = 30, BATTERY_CRITICAL = 15;
  const LIFE_WARN = 20, LIFE_CRITICAL = 10;

  const atLeast = (v, warn, critical) => (v == null ? NONE : v >= critical ? CRITICAL : v >= warn ? WARNING : NORMAL);

  /** A CPU or GPU temperature. */
  const temp = (c, limits) => atLeast(c, limits.warn, limits.hot);
  /** The GPU hotspot runs above the core, so it is a warning from the core's hot limit and critical from its own. */
  const hotspot = (c, limits) => atLeast(c, limits.hot, limits.spot);
  /** RAM, video memory or processor load, in percent. A missing value counts as normal. */
  const capacity = (pct) => atLeast(pct ?? 0, FILL_WARN, FILL_CRITICAL);
  const battery = (pct) => (pct == null ? NONE : pct < BATTERY_CRITICAL ? CRITICAL : pct < BATTERY_WARN ? WARNING : NORMAL);

  /** A drive temperature. A drive that reports a lower warning temperature of its own is critical from there. */
  const driveTemp = (c, ownLimit) => atLeast(c, DRIVE_WARN_C, ownLimit > 0 ? Math.min(ownLimit, DRIVE_HOT_C) : DRIVE_HOT_C);
  /** A full drive needs tidying but is no emergency, so it never goes past a warning. */
  const driveFill = (pct) => ((pct ?? 0) >= FILL_WARN ? WARNING : NORMAL);
  /** The life a drive reports as left, in percent. */
  const driveLife = (pct) => (pct == null ? NONE : pct <= LIFE_CRITICAL ? CRITICAL : pct <= LIFE_WARN ? WARNING : NORMAL);

  /** The drives of a snapshot: the storage record of each, joined with the health values among its sensors. */
  function drives(s) {
    const unused = (s.hardware ?? []).filter((h) => h.type === "Storage");
    return (s.storage ?? []).map((d, i) => {
      const at = unused.findIndex((h) => h.name === d.name);   // two drives of one model keep their order
      const sensors = at < 0 ? [] : unused.splice(at, 1)[0].sensors;
      const v = (type, name) => sensors.find((x) => x.type === type && x.name === name)?.value ?? null;
      return {
        key: i + " " + d.name, name: d.name,
        temp: d.tempC ?? v("Temperature", "Composite Temperature") ?? v("Temperature", "Temperature #1"),
        tempWarn: v("Temperature", "Warning Temperature"),
        fill: d.usedPct ?? null, readMBs: d.readMBs ?? null, writeMBs: d.writeMBs ?? null,
        life: d.lifePct ?? v("Level", "Life"), spare: v("Level", "Available Spare"), spareMin: v("Level", "Available Spare Threshold"),
        written: v("Data", "Data Written"), read: v("Data", "Data Read"),
        hours: v("Factor", "Power On Hours"), cycles: v("Factor", "Power On Count"),
      };
    });
  }

  /** What needs attention on one drive, in a fixed order: spare blocks, life, temperature, fill.
      Each is { kind, level, value }. */
  function driveIssues(d) {
    const out = [];
    const add = (kind, level, value) => { if (level === WARNING || level === CRITICAL) out.push({ kind, level, value }); };
    if (d.spare != null && d.spareMin != null && d.spare <= d.spareMin) add("spare", CRITICAL, d.spare);
    add("life", driveLife(d.life), d.life);
    add("temp", driveTemp(d.temp, d.tempWarn), d.temp);
    if ((d.fill ?? 0) >= DRIVE_FILL_ATTENTION) add("fill", WARNING, d.fill);
    return out;
  }

  /** The health of a drive in one answer: its worst issue, leaving out how full it is.
      `reason` is "spare", "life", "temp", "unknown" (no wear data) or "healthy". */
  function driveCondition(d) {
    const health = driveIssues(d).filter((x) => x.kind !== "fill");
    const worst = health.find((x) => x.level === CRITICAL) ?? health[0];
    if (worst) return { level: worst.level, reason: worst.kind, value: worst.value };
    return d.life == null ? { level: NONE, reason: "unknown" } : { level: NORMAL, reason: "healthy" };
  }

  /** The level of one sensor in the full sensor list. `hardware` is the entry the sensor belongs to. */
  function sensor(hardware, x, limits) {
    if (x.type !== "Temperature" || /(Warning|Critical) Temperature$/.test(x.name)) return NONE;   // those two are limits, not measurements
    if (hardware?.type !== "Storage") return temp(x.value, limits);
    return driveTemp(x.value, hardware.sensors.find((y) => y.type === "Temperature" && y.name === "Warning Temperature")?.value);
  }

  /* Why the NVIDIA GPU is held back. Each entry is a bit of the throttle mask from the service, worst first. */
  const GPU_LIMITS = [
    { bit: 0x40, label: "HEAT LIMIT", level: CRITICAL, name: "Hardware heat limit", text: "The GPU hardware is cutting its speed because it is too hot. Check the vents, the fans and the power mode." },
    { bit: 0x20, label: "HEAT LIMIT", level: CRITICAL, name: "Heat limit", text: "The GPU is slowing down to cool off. Check the vents and fans, or use a higher power mode." },
    { bit: 0x80, label: "POWER BRAKE", level: WARNING, name: "Power brake", text: "The charger or battery cannot give the GPU enough power, so it slows down. Check that the charger fits the laptop." },
    { bit: 0x8, label: "SLOWDOWN", level: WARNING, name: "Hardware slowdown", text: "The GPU hardware is slowing itself down because of heat or power. If it lasts, check the cooling and the charger." },
    { bit: 0x4, label: "POWER LIMIT", level: "info", name: "Power limit", text: "The GPU is held back by its power limit. This is normal under heavy load on a laptop." },
  ];
  const gpuLimits = (mask) => GPU_LIMITS.filter((l) => (mask ?? 0) & l.bit);

  const vramPct = (gpu) => (gpu?.vramTotalMB ? (gpu.vramUsedMB / gpu.vramTotalMB) * 100 : 0);

  /** Everything in a snapshot that needs attention, in the order CPU, GPU, hotspot, RAM, video memory, drives,
      GPU limit, battery. Each is { part, level, value }; a drive adds `name` and `kind`, a GPU limit adds `limit`. */
  function findings(s, limits) {
    const out = [];
    const add = (part, level, value, more) => { if (level === WARNING || level === CRITICAL) out.push({ part, level, value, ...more }); };
    add("cpu", temp(s.cpu.tempC, limits), s.cpu.tempC);
    add("gpu", temp(s.gpu.tempC, limits), s.gpu.tempC);
    if (hotspot(s.gpu.hotspotC, limits) === CRITICAL) add("hotspot", CRITICAL, s.gpu.hotspotC);   // below its own limit the GPU temperature speaks for it
    add("ram", capacity(s.ram.loadPct), s.ram.loadPct);
    if (s.gpu.vramTotalMB) add("vram", capacity(vramPct(s.gpu)), vramPct(s.gpu));
    for (const d of drives(s)) for (const x of driveIssues(d)) add("drive", x.level, x.value, { name: d.name, kind: x.kind });
    const slowed = gpuLimits(s.gpu.throttleMask).find((l) => l.level !== "info");
    if (slowed) add("gpuLimit", slowed.level, null, { limit: slowed });
    if (s.battery) add("battery", battery(s.battery.levelPct), s.battery.levelPct);
    return out;
  }

  const MODES = { 1: "Quiet", 2: "Balanced", 3: "Performance", 224: "Custom", 255: "Custom" };
  /** The name of a Lenovo power mode, or null for a code it does not know. */
  const powerMode = (code) => MODES[code] ?? null;

  const VIRTUAL = /vmware|virtualbox|hyper-v|vethernet|openvpn|wireguard|tap-|loopback|bluetooth|local area connection|wan miniport/i;
  /** True for a network adapter that is not a physical connection of the laptop. */
  const isVirtualAdapter = (name) => VIRTUAL.test(name ?? "");

  /** Download and upload speed over the physical adapters, in bytes per second. */
  function netRates(s) {
    let down = 0, up = 0;
    for (const h of s.hardware ?? []) {
      if (h.type !== "Network" || isVirtualAdapter(h.name)) continue;
      for (const x of h.sensors) { if (x.name === "Download Speed") down += x.value || 0; else if (x.name === "Upload Speed") up += x.value || 0; }
    }
    return { down, up };
  }

  return { LIMITS, GPU_LIMITS, temp, hotspot, capacity, battery, driveTemp, driveFill, driveLife, drives, driveIssues, driveCondition, sensor, vramPct, gpuLimits, findings, powerMode, isVirtualAdapter, netRates };
})();

if (typeof module !== "undefined") module.exports = Rules;   // for the tests, which run in Node
