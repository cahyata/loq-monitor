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
  const prefs = () => ({ unit: get("unit", "C") === "F" ? "F" : "C", warn: num("cfg.warn", Rules.LIMITS.warn), hot: num("cfg.hot", Rules.LIMITS.hot), spot: num("cfg.spot", Rules.LIMITS.spot) });

  const f = (v, d = 0) => (v == null ? "--" : Number(v).toFixed(d));
  const pct = (v) => ({ text: f(v) + "%", state: v == null ? "" : Rules.capacity(v) });
  const plain = (v, d, unit) => ({ text: v == null ? "--" : Number(v).toFixed(d) + unit, state: "" });
  const temp = (p, c, state = Rules.temp(c, p)) => ({ text: c == null ? "--" : (p.unit === "F" ? (c * 9) / 5 + 32 : c).toFixed(0) + "°", state });
  const rate = (v) => (v == null ? "--" : v >= 1e6 ? (v / 1e6).toFixed(1) + " MB/s" : (v / 1e3).toFixed(0) + " KB/s");
  /** The hottest drive's temperature, colored by the drive that is worst off (a drive may have a lower limit of its own). */
  const driveTemps = (p, s) => {
    const list = Rules.drives(s).filter((d) => d.temp != null);
    const levels = list.map((d) => Rules.driveTemp(d.temp, d.tempWarn));
    return temp(p, list.length ? Math.max(...list.map((d) => d.temp)) : null, ["hot", "warn", "ok"].find((l) => levels.includes(l)) ?? "");
  };

  // id, group, name in the settings list, short label on the overlay, value function
  const LIST = [
    ["cpuTemp", "CPU", "Temperature", "CPU TEMP", (s, p) => temp(p, s.cpu.tempC)],
    ["cpuLoad", "CPU", "Load", "CPU LOAD", (s) => pct(s.cpu.load)],
    ["cpuClock", "CPU", "Clock speed", "CPU CLK", (s) => ({ text: s.cpu.clockMHz == null ? "--" : (s.cpu.clockMHz / 1000).toFixed(1) + " GHz", state: "" })],
    ["cpuPower", "CPU", "Power", "CPU PWR", (s) => plain(s.cpu.powerW, 0, " W")],
    ["cpuFan", "CPU", "Fan speed", "CPU FAN", (s) => plain(s.cpu.fanRpm, 0, " rpm")],

    ["gpuTemp", "GPU", "Temperature", "GPU TEMP", (s, p) => temp(p, s.gpu.tempC)],
    ["gpuHot", "GPU", "Hotspot temperature", "GPU HOT", (s, p) => temp(p, s.gpu.hotspotC, Rules.hotspot(s.gpu.hotspotC, p))],
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
    ["ssdTemp", "Memory", "Hottest SSD temperature", "SSD TEMP", (s, p) => driveTemps(p, s)],

    ["battery", "System", "Battery level", "BAT", (s) => ({ text: s.battery ? f(s.battery.levelPct) + "%" : "--", state: Rules.battery(s.battery?.levelPct) })],
    ["batteryRate", "System", "Battery power", "BAT PWR", (s) => ({ text: s.battery?.rateW == null ? "--" : (s.battery.rateW > 0 ? "+" : "") + s.battery.rateW.toFixed(0) + " W", state: "" })],
    ["powerMode", "System", "Power mode", "MODE", (s) => ({ text: Rules.powerMode(s.powerMode) ?? "--", state: "" })],
    ["netDown", "System", "Network download", "DOWN", (s) => ({ text: rate(Rules.netRates(s).down), state: "" })],
    ["netUp", "System", "Network upload", "UP", (s) => ({ text: rate(Rules.netRates(s).up), state: "" })],
    ["fps", "Game", "Frame rate", "FPS", (s) => ({ text: s.fps?.fps == null ? "--" : s.fps.fps.toFixed(0), state: "" })],
    ["frameTime", "Game", "Frame time", "FRAME", (s) => plain(s.fps?.frameMs, 1, " ms")],
    ["fpsLow", "Game", "1% low frame rate", "1% LOW", (s) => ({ text: s.fps?.low1Fps == null ? "--" : s.fps.low1Fps.toFixed(0), state: "" })],
    ["clock", "System", "Clock", "TIME", () => ({ text: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), state: "" })],
  ].map(([id, group, label, short, value]) => ({ id, group, label, short, value }));

  const BY_ID = Object.fromEntries(LIST.map((m) => [m.id, m]));
  const GROUPS = ["CPU", "GPU", "Memory", "Game", "System"];
  // Accent names map to design system tokens, so the overlay follows the palette.
  const ACCENTS = { cyan: "var(--accent-secondary)", pink: "var(--accent-primary)", green: "var(--success)", yellow: "var(--highlight)", white: "var(--text-strong)", none: "transparent" };
  const FPS_IDS = ["fps", "frameTime", "fpsLow"];
  /** True when the settings show a frame rate reading, so the service has to measure frames. */
  const needsFps = (cfg) => cfg.metrics.some((id) => FPS_IDS.includes(id));
  // Sample values for the preview in the app, where no game is running.
  const DEMO = { fps: "144", frameTime: "6.9 ms", fpsLow: "118" };

  const DEFAULTS = {
    metrics: ["cpuTemp", "cpuLoad", "gpuTemp", "gpuLoad", "gpuPower", "vramUsed", "ramUsed"],
    layout: "vertical",   // "vertical" list or "horizontal" bar
    corner: "tl",         // two letters: t, m, b for top, middle, bottom, then l, c, r for left, center, right
    marginX: 16,          // pixels from the left or right edge, or the shift from the center
    marginY: 16,          // pixels from the top or bottom edge, or the shift from the middle
    monitor: 0,           // 0 is the primary display
    accent: "cyan",       // color of the line on the card: cyan, pink, green, yellow, white or none
    font: "mono",         // mono, sans or display
    spacing: "normal",    // tight, normal or roomy
    radius: 12,           // card corner radius in pixels
    statusColors: true,   // warm and hot values change color
    scale: 100,           // percent
    opacity: 90,          // percent
    bg: "panel",          // "panel" or "none"
    labels: true,
  };
  const PRESETS = {
    minimal: ["cpuTemp", "gpuTemp", "gpuLoad"],
    gaming: ["fps", "frameTime", "cpuTemp", "cpuLoad", "gpuTemp", "gpuLoad", "gpuPower", "gpuClock", "vramUsed", "ramUsed"],
    full: ["cpuTemp", "cpuLoad", "cpuClock", "cpuPower", "gpuTemp", "gpuHot", "gpuLoad", "gpuPower", "gpuClock", "gpuMem", "vramUsed", "ramUsed", "ssdTemp", "battery", "powerMode", "clock"],
  };

  function load() {
    try {
      const saved = JSON.parse(get("overlay", "{}"));
      // Older settings had one distance for both axes.
      if (saved.margin != null) { saved.marginX ??= saved.margin; saved.marginY ??= saved.margin; }
      return { ...DEFAULTS, ...saved };
    } catch { return { ...DEFAULTS }; }
  }

  /** Draws the overlay readings into `el`. `s` is the latest snapshot, or null before data arrives. */
  function draw(el, s, cfg, demo = false) {
    const p = prefs();
    el.className = "ov " + (cfg.layout === "horizontal" ? "h" : "v") + (cfg.bg === "none" ? " nobg" : "") + (cfg.labels === false ? " nolabels" : "")
      + " f-" + (cfg.font || "mono") + " s-" + (cfg.spacing || "normal") + (cfg.statusColors === false ? " plain" : "");
    el.style.setProperty("--ov-accent", ACCENTS[cfg.accent] ?? "transparent");
    el.style.setProperty("--ov-radius", (cfg.radius ?? 12) + "px");
    el.style.setProperty("--ov-scale", String((cfg.scale || 100) / 100));
    el.style.setProperty("--ov-alpha", String((cfg.opacity || 90) / 100));
    const rows = cfg.metrics.map((id) => BY_ID[id]).filter(Boolean).map((m) => {
      let v = { text: "--", state: "" };
      try { if (s) v = m.value(s, p); } catch { /* a missing sensor shows as -- */ }
      if (demo && DEMO[m.id]) v = { text: DEMO[m.id], state: "" };
      const row = document.createElement("div"); row.className = "m";
      const l = document.createElement("span"); l.className = "l"; l.textContent = m.short;
      const x = document.createElement("span"); x.className = "x " + v.state; x.textContent = v.text;
      row.append(l, x);
      return row;
    });
    el.replaceChildren(...rows);
  }

  return { LIST, BY_ID, GROUPS, DEFAULTS, PRESETS, load, draw, needsFps };
})();
