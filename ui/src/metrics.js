// LOQ Monitor | Overlay metric catalog and renderer (shared by the app and the overlay window)
// Author: cahyata
// Copyright (c) 2026 cahyata
"use strict";
/* The list of readings the game overlay can show, and the function that draws them. Both the
   Overlay tab (live preview) and overlay.html use it, so they always look the same. It reads the
   user's unit and temperature limits straight from localStorage, which both windows share. */

const OvMetrics = (() => {
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
  const num = (k, d) => { const v = parseFloat(get(k, "")); return Number.isFinite(v) ? v : d; };
  const prefs = () => ({ unit: get("unit", "C") === "F" ? "F" : "C", warn: num("cfg.warn", 75), hot: num("cfg.hot", 90), spot: num("cfg.spot", 95) });

  const f = (v, d = 0) => (v == null ? "--" : Number(v).toFixed(d));
  const pct = (v) => ({ text: f(v) + "%", state: v == null ? "" : v >= 90 ? "hot" : v >= 80 ? "warn" : "ok" });
  const plain = (v, d, unit) => ({ text: v == null ? "--" : Number(v).toFixed(d) + unit, state: "" });
  const temp = (p, c, warn = p.warn, hot = p.hot) => ({
    text: c == null ? "--" : (p.unit === "F" ? (c * 9) / 5 + 32 : c).toFixed(0) + "°",
    state: c == null ? "" : c >= hot ? "hot" : c >= warn ? "warn" : "ok",
  });
  const rate = (v) => (v == null ? "--" : v >= 1e6 ? (v / 1e6).toFixed(1) + " MB/s" : (v / 1e3).toFixed(0) + " KB/s");
  const VIRTUAL = /vmware|virtualbox|hyper-v|vethernet|openvpn|wireguard|tap-|loopback|bluetooth|local area connection|wan miniport/i;
  const netSum = (s, name) => {
    let sum = 0;
    for (const h of s.hardware ?? []) {
      if (h.type !== "Network" || VIRTUAL.test(h.name)) continue;
      for (const x of h.sensors) if (x.name === name && x.value) sum += x.value;
    }
    return sum;
  };
  const MODES = { 1: "Quiet", 2: "Balanced", 3: "Performance", 224: "Custom", 255: "Custom" };

  // id, group, name in the settings list, short label on the overlay, value function
  const LIST = [
    ["cpuTemp", "CPU", "Temperature", "CPU TEMP", (s, p) => temp(p, s.cpu.tempC)],
    ["cpuLoad", "CPU", "Load", "CPU LOAD", (s) => pct(s.cpu.load)],
    ["cpuClock", "CPU", "Clock speed", "CPU CLK", (s) => ({ text: s.cpu.clockMHz == null ? "--" : (s.cpu.clockMHz / 1000).toFixed(1) + " GHz", state: "" })],
    ["cpuPower", "CPU", "Power", "CPU PWR", (s) => plain(s.cpu.powerW, 0, " W")],
    ["cpuFan", "CPU", "Fan speed", "CPU FAN", (s) => plain(s.cpu.fanRpm, 0, " rpm")],

    ["gpuTemp", "GPU", "Temperature", "GPU TEMP", (s, p) => temp(p, s.gpu.tempC)],
    ["gpuHot", "GPU", "Hotspot temperature", "GPU HOT", (s, p) => temp(p, s.gpu.hotspotC, p.hot, p.spot)],
    ["gpuLoad", "GPU", "Load", "GPU LOAD", (s) => ({ text: f(s.gpu.load) + "%", state: "" })],
    ["gpuPower", "GPU", "Power", "GPU PWR", (s) => plain(s.gpu.powerW, 0, " W")],
    ["gpuClock", "GPU", "Core clock", "GPU CLK", (s) => plain(s.gpu.coreClockMHz, 0, " MHz")],
    ["gpuMem", "GPU", "Memory clock", "VRAM CLK", (s) => plain(s.gpu.memClockMHz, 0, " MHz")],
    ["gpuFan", "GPU", "Fan speed", "GPU FAN", (s) => plain(s.gpu.fanRpm, 0, " rpm")],
    ["gpuVramTemp", "GPU", "Video memory temperature", "VRAM TEMP", (s, p) => temp(p, s.gpu.vramTempC)],
    ["vramUsed", "GPU", "Video memory used", "VRAM", (s) => {
      const t = s.gpu.vramTotalMB, u = s.gpu.vramUsedMB;
      return { text: u == null ? "--" : `${(u / 1024).toFixed(1)}/${t ? (t / 1024).toFixed(1) : "--"} GB`, state: t ? pct((u / t) * 100).state : "" };
    }],

    ["ramUsed", "Memory", "RAM used", "RAM", (s) => ({ text: s.ram.usedGB == null ? "--" : s.ram.usedGB.toFixed(1) + " GB", state: pct(s.ram.loadPct).state })],
    ["ramPct", "Memory", "RAM used (percent)", "RAM", (s) => pct(s.ram.loadPct)],
    ["ssdTemp", "Memory", "Hottest SSD temperature", "SSD TEMP", (s, p) => {
      const t = Math.max(...s.storage.map((d) => d.tempC ?? -1));
      return temp(p, t < 0 ? null : t, 70, 80);
    }],

    ["battery", "System", "Battery level", "BAT", (s) => ({ text: s.battery ? f(s.battery.levelPct) + "%" : "--", state: !s.battery ? "" : s.battery.levelPct < 15 ? "hot" : s.battery.levelPct < 30 ? "warn" : "ok" })],
    ["batteryRate", "System", "Battery power", "BAT PWR", (s) => ({ text: s.battery?.rateW == null ? "--" : (s.battery.rateW > 0 ? "+" : "") + s.battery.rateW.toFixed(0) + " W", state: "" })],
    ["powerMode", "System", "Power mode", "MODE", (s) => ({ text: MODES[s.powerMode] ?? "--", state: "" })],
    ["netDown", "System", "Network download", "DOWN", (s) => ({ text: rate(netSum(s, "Download Speed")), state: "" })],
    ["netUp", "System", "Network upload", "UP", (s) => ({ text: rate(netSum(s, "Upload Speed")), state: "" })],
    ["clock", "System", "Clock", "TIME", () => ({ text: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), state: "" })],
  ].map(([id, group, label, short, value]) => ({ id, group, label, short, value }));

  const BY_ID = Object.fromEntries(LIST.map((m) => [m.id, m]));
  const GROUPS = ["CPU", "GPU", "Memory", "System"];

  const DEFAULTS = {
    metrics: ["cpuTemp", "cpuLoad", "gpuTemp", "gpuLoad", "gpuPower", "vramUsed", "ramUsed"],
    layout: "vertical",   // "vertical" list or "horizontal" bar
    corner: "tl",         // "tl", "tr", "bl", "br"
    margin: 16,           // pixels from the screen edge
    scale: 100,           // percent
    opacity: 90,          // percent
    bg: "panel",          // "panel" or "none"
    labels: true,
  };
  const PRESETS = {
    minimal: ["cpuTemp", "gpuTemp", "gpuLoad"],
    gaming: ["cpuTemp", "cpuLoad", "gpuTemp", "gpuLoad", "gpuPower", "gpuClock", "vramUsed", "ramUsed"],
    full: ["cpuTemp", "cpuLoad", "cpuClock", "cpuPower", "gpuTemp", "gpuHot", "gpuLoad", "gpuPower", "gpuClock", "gpuMem", "vramUsed", "ramUsed", "ssdTemp", "battery", "powerMode", "clock"],
  };

  function load() {
    try { return { ...DEFAULTS, ...JSON.parse(get("overlay", "{}")) }; } catch { return { ...DEFAULTS }; }
  }

  /** Draws the overlay readings into `el`. `s` is the latest snapshot, or null before data arrives. */
  function draw(el, s, cfg) {
    const p = prefs();
    el.className = "ov " + (cfg.layout === "horizontal" ? "h" : "v") + (cfg.bg === "none" ? " nobg" : "") + (cfg.labels === false ? " nolabels" : "");
    el.style.setProperty("--ov-scale", String((cfg.scale || 100) / 100));
    el.style.setProperty("--ov-alpha", String((cfg.opacity || 90) / 100));
    const rows = cfg.metrics.map((id) => BY_ID[id]).filter(Boolean).map((m) => {
      let v = { text: "--", state: "" };
      try { if (s) v = m.value(s, p); } catch { /* a missing sensor shows as -- */ }
      const row = document.createElement("div"); row.className = "m";
      const l = document.createElement("span"); l.className = "l"; l.textContent = m.short;
      const x = document.createElement("span"); x.className = "x " + v.state; x.textContent = v.text;
      row.append(l, x);
      return row;
    });
    el.replaceChildren(...rows);
  }

  return { LIST, BY_ID, GROUPS, DEFAULTS, PRESETS, load, draw };
})();
