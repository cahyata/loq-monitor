// LOQ Monitor | Overview page
// Author: cahyata
// Copyright (c) 2026 cahyata
"use strict";
/* The OVERVIEW page: the CPU and GPU panels with their temperature history, memory, battery, drives, the system
   log and the favorite sensors. Shares $, store, CFG, the formatting helpers and Pins with main.js; rules.js
   judges the readings. */

(() => {
const HISTORY = 3600;               // samples kept per series (one per second)
const hist = { cpu: [], gpu: [] };
let range = 600;                    // seconds shown in the charts
{ const r = parseInt(store.get("range", "600"), 10); if ([60, 600, 3600].includes(r)) range = r; }
let batAvg = null;                  // battery power in watts, averaged

function renderFavs(s) {
  const items = Pins.resolve(s);
  $("favPanel").hidden = items.length === 0;
  if (!items.length) return;
  $("favList").replaceChildren(...items.map(({ hw, x }) => {
    const row = document.createElement("div"); row.className = "fav";
    const a = document.createElement("span"); a.textContent = hw + " \u203A " + x.name; row.title = a.textContent + "\n" + SensorHelp.sensor(x.type, x.name);
    const b = document.createElement("b"); b.textContent = Detail.fmt(x.type, x.value);
    row.append(a, b); return row;
  }));
}

function setTemp(el, tagEl, t) {
  el.textContent = tf(t);
  el.className = "big " + tempClass(t);
  const c = tempClass(t);
  tagEl.textContent = c === "hot" ? "HOT" : c === "warn" ? "WARM" : c === "ok" ? "NORMAL" : "--";
  tagEl.className = "tag " + c;
}
/* The rules call a normal battery "ok"; its meter and chip have their own green. */
const batState = (p) => { const level = Rules.battery(p); return level === "ok" ? "good" : level; };
const CAP_LABEL = { ok: "OK", warn: "HIGH", hot: "CRITICAL" };
const BAT_LABEL = { good: "OK", warn: "LOW", hot: "CRITICAL" };
function setMeter(barId, pct, state = "load") {
  const bar = $(barId);
  bar.style.transform = `scaleX(${Math.max(0, Math.min(100, pct ?? 0)) / 100})`;
  bar.parentElement.className = "meter " + (state === "load" ? "load" : "st-" + state);
}
function setLimit(el, mask) {
  const worst = Rules.gpuLimits(mask)[0];
  el.hidden = !worst;
  if (!worst) return;
  el.textContent = worst.label; el.className = "tag limit " + worst.level; el.title = worst.text;
}
function setChip(el, state, labels) {
  el.textContent = labels[state] ?? "--";
  el.className = "tag " + (state === "good" ? "ok" : state);
}
function setDd(id, text, cls = "") { const e = $(id); e.textContent = text; e.className = cls; }

function drawChart(canvas, series, color) {
  const dpr = devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const n = Math.min(series.length, range);
  const data = series.slice(series.length - n);
  // The scale follows the data but always includes both limits, rounded to tidy 5 degree steps.
  let lo = CFG.warn - 5, hi = CFG.hot + 5;
  for (const v of data) { if (v - 4 < lo) lo = v - 4; if (v + 4 > hi) hi = v + 4; }
  lo = Math.floor(lo / 5) * 5; hi = Math.ceil(hi / 5) * 5;
  if (hi - lo < 30) lo = hi - 30;
  const padL = 36, padT = 7, padB = 7, pw = w - padL;
  const py = (v) => padT + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (h - padT - padB);

  // axis labels live in a left gutter so they never sit on the data line
  ctx.font = "11px " + css("--font-mono"); ctx.textBaseline = "middle"; ctx.textAlign = "right";
  const muted = css("--text-muted"), ticks = [];
  const mark = (v, c, line) => {
    const y = py(v);
    if (ticks.some((t) => Math.abs(t - y) < 15)) return;       // skip a label that would overlap another
    ticks.push(y);
    if (line) { ctx.setLineDash([4, 4]); ctx.strokeStyle = c; ctx.globalAlpha = 0.75; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
    ctx.fillStyle = c; ctx.fillText(Math.round(conv(v)) + "\u00B0", padL - 6, y);
  };
  mark(CFG.hot, css("--danger"), true);
  mark(CFG.warn, css("--highlight"), true);
  mark(hi, muted, false); mark(lo, muted, false);

  if (n < 2) return;
  const bucket = Math.max(1, Math.ceil(n / Math.max(1, pw)));        // average samples so a 1 hour range stays light
  const pts = [];
  for (let k = 0; k * bucket < n; k++) {
    const part = data.slice(k * bucket, (k + 1) * bucket);
    const v = part.reduce((a, b) => a + b, 0) / part.length;
    const j = k * bucket + (part.length - 1) / 2;
    pts.push([padL + (j / (n - 1)) * pw, py(v)]); // the range is a maximum: a short history fills the width
  }
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
  ctx.lineTo(pts[pts.length - 1][0], h); ctx.lineTo(pts[0][0], h); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, color + "44"); g.addColorStop(1, color + "00");
  ctx.fillStyle = g; ctx.fill();
}
const RANGE_NAMES = { 60: "1 min", 600: "10 min", 3600: "1 hour" };
function caption(el, series, canvas, name) {
  const n = Math.min(series.length, range);
  if (!n) { el.textContent = ""; return; }
  let lo = Infinity, hi = -Infinity, sum = 0;
  for (let i = series.length - n; i < series.length; i++) { const v = series[i]; if (v < lo) lo = v; if (v > hi) hi = v; sum += v; }
  const span = n < range ? (n < 60 ? n + " s" : Math.floor(n / 60) + " min") : RANGE_NAMES[range];
  el.textContent = `last ${span} · min ${tf(lo)}\u00B0 · avg ${tf(sum / n)}\u00B0 · max ${tf(hi)}\u00B0`;
  canvas.setAttribute("aria-label", `${name} temperature history, ${el.textContent.replace(/\u00B0/g, " degrees")}`);
}
function drawAll() {
  drawChart($("cpuChart"), hist.cpu, css("--accent-primary"));
  drawChart($("gpuChart"), hist.gpu, css("--accent-secondary"));
  caption($("cpuCap"), hist.cpu, $("cpuChart"), "CPU"); caption($("gpuCap"), hist.gpu, $("gpuChart"), "GPU");
}
document.querySelectorAll(".seg button").forEach((b) => {
  b.classList.toggle("on", +b.dataset.r === range); b.setAttribute("aria-pressed", String(+b.dataset.r === range));
  b.onclick = () => {
    range = +b.dataset.r; store.set("range", String(range));
    document.querySelectorAll(".seg button").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
    drawAll();
  };
});
function push(series, v) {
  if (v == null) return;
  series.push(v);
  if (series.length > HISTORY) series.shift();
}

function logLines(s) {
  // The log keeps to what is urgent: memory only when nearly full, and one line for the GPU temperatures.
  const found = Rules.findings(s, CFG);
  const of = (part) => found.find((f) => f.part === part);
  const out = [];
  const add = (level, msg) => out.push([level === "hot" ? "CRIT" : "WARN", msg]);
  const cpu = of("cpu"), gpu = of("gpu"), spot = of("hotspot");
  if (cpu) add(cpu.level, `cpu.temp ${tdeg(cpu.value)}${cpu.level === "hot" ? ", near thermal limit" : ""}`);
  if (spot) add(spot.level, `gpu.hotspot ${tdeg(spot.value)}`);
  else if (gpu) add(gpu.level, `gpu.temp ${tdeg(gpu.value)}`);
  for (const part of ["vram", "ram"]) { const f = of(part); if (f?.level === "hot") add("warn", `${part} ${fmt(f.value)}% used`); }
  const DRIVE = { temp: (f) => tdeg(f.value), fill: (f) => `${fmt(f.value)}% full`, life: (f) => `${fmt(f.value)}% life left`, spare: () => "spare blocks low" };
  for (const f of found) if (f.part === "drive") add(f.level, `ssd ${f.name} ${DRIVE[f.kind](f)}`);
  const bat = of("battery");
  if (bat) add(bat.level, `battery ${fmt(bat.value)}%`);
  if (!out.length) out.push(["OK", "all sensors within normal range"]);
  out.push(["INFO", "ec.wmi link established"]);
  return out;
}

/** Every snapshot: the chart history and the battery average, also while another page or the tray is showing. */
function collect(s) {
  push(hist.cpu, s.cpu.tempC); push(hist.gpu, s.gpu.tempC);
  if (!s.battery) return;
  // The reading jumps with the load, so the time left uses a running average that restarts when the charger changes.
  const r = s.battery.rateW ?? 0;
  batAvg = batAvg != null && Math.sign(batAvg) === Math.sign(r) ? batAvg * 0.85 + r * 0.15 : r;
}

function draw(s) {
  const { cpu, gpu, ram } = s;

  // CPU
  $("cpuName").textContent = cpu.name ? `${cpu.name} · ${cpu.coreLoads.length}T` : "";
  setTemp($("cpuTemp"), $("cpuTag"), cpu.tempC);
  setMeter("cpuLoadBar", cpu.load);
  setDd("cpuLoad", fmt(cpu.load) + "%");
  setDd("cpuFan", cpu.fanRpm != null ? cpu.fanRpm + " rpm" : "--");
  setDd("cpuPower", cpu.powerW != null ? fmt(cpu.powerW, 1) + " W" : "--");
  setDd("cpuClock", cpu.clockMHz != null ? fmt(cpu.clockMHz) + " MHz" : "--");
  const cores = $("cores");
  if (cores.children.length !== cpu.coreLoads.length) {
    cores.replaceChildren(...cpu.coreLoads.map(() => document.createElement("i")));
  }
  cpu.coreLoads.forEach((l, i) => { cores.children[i].style.transform = `scaleY(${Math.max(8, l) / 100})`; });

  // GPU
  $("gpuName").textContent = (gpu.name ?? "").replace("NVIDIA GeForce ", "");
  setTemp($("gpuTemp"), $("gpuTag"), gpu.tempC);
  setMeter("gpuLoadBar", gpu.load);
  setDd("gpuLoad", fmt(gpu.load) + "%");
  const spot = Rules.hotspot(gpu.hotspotC, CFG);
  setDd("gpuHot", tdeg(gpu.hotspotC), spot === "ok" ? "" : spot);
  setDd("gpuPower", fmt(gpu.powerW) + " W");
  setDd("gpuFan", gpu.fanRpm != null ? gpu.fanRpm + " rpm" : "--");
  setDd("gpuClock", fmt(gpu.coreClockMHz) + " MHz");
  setDd("gpuVt", tdeg(gpu.vramTempC));
  setDd("gpuMem", fmt(gpu.memClockMHz) + " MHz");
  setLimit($("gpuLimit"), gpu.throttleMask);
  setDd("gpuRx", fmt(gpu.pcieRxMBs, 1) + " MB/s");
  setDd("gpuTx", fmt(gpu.pcieTxMBs, 1) + " MB/s");
  drawAll();

  // RAM / VRAM
  setBig("ramV", fmt(ram.usedGB, 1), `GB · ${fmt(ram.loadPct)}%`);
  const rs = Rules.capacity(ram.loadPct);
  setMeter("ramBar", ram.loadPct, rs); setChip($("ramTag"), rs, CAP_LABEL);
  $("ramSub").textContent = `free ${fmt(ram.availableGB, 1)} GB`;
  setBig("vramV", fmt(gpu.vramUsedMB / 1024, 1), `/ ${fmt(gpu.vramTotalMB / 1024, 1)} GB`);
  const vp = Rules.vramPct(gpu), vs = Rules.capacity(vp);
  setMeter("vramBar", vp, vs); setChip($("vramTag"), vs, CAP_LABEL);
  $("vramSub").textContent = `free ${fmt((gpu.vramTotalMB - gpu.vramUsedMB) / 1024, 1)} GB · ${fmt(gpu.memClockMHz)} MHz`;

  // Battery
  const b = s.battery;
  if (b) {
    setBig("batV", fmt(b.levelPct), "%");
    const bs = batState(b.levelPct);
    setMeter("batBar", b.levelPct, bs); setChip($("batTag"), bs, BAT_LABEL);
    $("batSub").textContent = `health ${fmt(100 - (b.degradationPct ?? 0), 1)}% · ${fmt(b.fullWh)}/${fmt(b.designedWh)} Wh`;
    const r = b.rateW ?? 0;
    const stored = (b.fullWh ?? 0) * (b.levelPct ?? 0) / 100;
    const left = r < -0.5 && stored > 0 ? ` · about ${hm(stored / -batAvg)} left` : r > 0.5 && b.fullWh ? ` · full in about ${hm(Math.max(0, b.fullWh - stored) / batAvg)}` : "";
    $("batRate").textContent = (r > 0.5 ? `charging +${fmt(r, 1)} W` : r < -0.5 ? `draining ${fmt(r, 1)} W`
      : b.acOnline && b.charging === false && (b.levelPct ?? 0) < 98 ? "AC \u00B7 charging paused (battery protection)" : b.acOnline ? "AC \u00B7 not charging (0.0 W)" : "idle (0.0 W)") + left;
  }

  // Storage
  $("storage").replaceChildren(...Rules.drives(s).map(diskCard));

  renderFavs(s);

  // Log
  $("log").replaceChildren(...logLines(s).map(([lv, msg]) => {
    const row = document.createElement("div");
    const a = document.createElement("span"); a.className = "lv " + lv; a.textContent = "> " + lv;
    row.append(a, document.createTextNode(msg));
    return row;
  }));
}

function diskCard(d) {
  const el = document.createElement("div"); el.className = "disk";
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const hd = mk("div", "hd");
  const n = mk("span", "n", d.name.replace(/\s*(SSD|\d+GB)\s*/g, " ").trim()); n.title = d.name;
  hd.append(n, mk("span", "t " + Rules.driveTemp(d.temp, d.tempWarn), tdeg(d.temp)));
  const us = Rules.driveFill(d.fill);
  const meter = mk("div", "meter st-" + us); const bar = document.createElement("i");
  bar.style.transform = `scaleX(${Math.min(100, d.fill ?? 0) / 100})`; meter.append(bar);
  const line = (label, valueEl, chip) => { const l = mk("div", "ln"); const lab = mk("span", null, label); if (chip) lab.append(chip); l.append(lab, valueEl); return l; };
  const lifeLevel = Rules.driveLife(d.life), full = Rules.driveIssues(d).some((x) => x.kind === "fill");
  const life = mk("b", lifeLevel === "ok" ? "" : lifeLevel, fmt(d.life) + "%");
  const used = mk("b", full ? "warn" : "", fmt(d.fill) + "%");
  const io = mk("b", "", `${fmt(d.readMBs, 1)} / ${fmt(d.writeMBs, 1)} MB/s`);
  const usedChip = us === "ok" ? null : mk("span", "tag " + us, CAP_LABEL[us]);
  el.append(hd, meter, line("USED", used, usedChip), line("LIFE LEFT", life), line("R / W", io));
  return el;
}

/** Hours as a short phrase: "35 min", "1 h 05 min". */
function hm(hours) {
  if (!Number.isFinite(hours)) return "--";
  const m = Math.round(hours * 60);
  if (m >= 1440) return "more than a day";
  return m >= 60 ? Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0") + " min" : Math.max(1, m) + " min";
}
function setBig(id, value, unit) {
  const el = $(id);
  const small = document.createElement("small"); small.textContent = unit;
  el.replaceChildren(document.createTextNode(value), small);
}

// The history range only applies to the charts of this page.
Pages.add("overview", { collect, draw, show() { $("rangeSeg").hidden = false; }, hide() { $("rangeSeg").hidden = true; } });
})();
