"use strict";

const WS_URL = "ws://127.0.0.1:47821/ws";
const HISTORY = 90;                 // detik riwayat grafik
const WARN_AT = 75, HOT_AT = 90;    // °C — samakan dengan tokens.css

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const hist = { cpu: [], gpu: [] };
const fmt = (v, d = 0) => (v == null ? "--" : Number(v).toFixed(d));
const tempClass = (t) => (t == null ? "" : t >= HOT_AT ? "hot" : t >= WARN_AT ? "warn" : "ok");
const css = (name) => getComputedStyle(root).getPropertyValue(name).trim();

/* ---------- preferensi (tema, FX) ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* abaikan */ } },
};
function applyPrefs() {
  root.classList.toggle("light", store.get("theme", "dark") === "light");
  root.classList.toggle("nofx", store.get("fx", "on") === "off");
  $("btnFx").classList.toggle("on", store.get("fx", "on") === "on");
}
$("btnFx").onclick = () => { store.set("fx", store.get("fx", "on") === "on" ? "off" : "on"); applyPrefs(); };
$("btnTheme").onclick = () => { store.set("theme", store.get("theme", "dark") === "dark" ? "light" : "dark"); applyPrefs(); drawAll(); };
applyPrefs();
addEventListener("load", () => scrollTo(0, 0));

/* hemat sumber daya: grid berhenti saat jendela tidak fokus */
const syncIdle = () => root.classList.toggle("idle", !document.hasFocus());
addEventListener("focus", syncIdle); addEventListener("blur", syncIdle); syncIdle();

setInterval(() => { $("clock").textContent = new Date().toLocaleTimeString("id-ID", { hour12: false }); }, 1000);

/* ---------- helper render ---------- */
function setTemp(el, tagEl, t) {
  el.textContent = fmt(t);
  el.className = "big " + tempClass(t);
  tagEl.classList.toggle("show", t != null && t >= HOT_AT);
}
function setMeter(barId, pct) {
  const bar = $(barId);
  const p = Math.max(0, Math.min(100, pct ?? 0));
  bar.style.width = p + "%";
  bar.parentElement.classList.toggle("over", p >= 90);
}
function setDd(id, text, cls = "") { const e = $(id); e.textContent = text; e.className = cls; }

function drawChart(canvas, series, color) {
  const dpr = devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (series.length < 2) return;
  const min = 30, max = 100, offset = HISTORY - series.length;
  const px = (i) => ((i + offset) / (HISTORY - 1)) * w;
  const py = (v) => h - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * (h - 4) - 2;
  ctx.beginPath();
  series.forEach((v, i) => (i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v))));
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
  ctx.lineTo(px(series.length - 1), h); ctx.lineTo(px(0), h); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, color + "44"); g.addColorStop(1, color + "00");
  ctx.fillStyle = g; ctx.fill();
}
function drawAll() {
  drawChart($("cpuChart"), hist.cpu, css("--pink"));
  drawChart($("gpuChart"), hist.gpu, css("--cyan"));
}
function push(series, v) {
  if (v == null) return;
  series.push(v);
  if (series.length > HISTORY) series.shift();
}

function logLines(s) {
  const out = [];
  const add = (lv, msg) => out.push([lv, msg]);
  if (s.cpu.tempC >= HOT_AT) add("CRIT", `cpu.temp ${fmt(s.cpu.tempC)}°C — mendekati batas termal`);
  else if (s.cpu.tempC >= WARN_AT) add("WARN", `cpu.temp ${fmt(s.cpu.tempC)}°C`);
  if (s.gpu.hotspotC >= 95) add("CRIT", `gpu.hotspot ${fmt(s.gpu.hotspotC)}°C`);
  else if (s.gpu.tempC >= HOT_AT) add("CRIT", `gpu.temp ${fmt(s.gpu.tempC)}°C`);
  else if (s.gpu.tempC >= WARN_AT) add("WARN", `gpu.temp ${fmt(s.gpu.tempC)}°C`);
  const vp = s.gpu.vramTotalMB ? (s.gpu.vramUsedMB / s.gpu.vramTotalMB) * 100 : 0;
  if (vp >= 90) add("WARN", `vram ${fmt(vp)}% terpakai`);
  if (s.ram.loadPct >= 90) add("WARN", `ram ${fmt(s.ram.loadPct)}% terpakai`);
  s.storage.forEach((d) => { if (d.tempC >= 70) add("WARN", `ssd ${d.name} ${fmt(d.tempC)}°C`); });
  if (s.battery && s.battery.levelPct < 20) add("WARN", `battery ${fmt(s.battery.levelPct)}%`);
  if (!out.length) add("OK", "semua sensor dalam batas normal");
  add("INFO", "ec.wmi link established");
  return out;
}

function render(s) {
  const { cpu, gpu, ram } = s;
  push(hist.cpu, cpu.tempC); push(hist.gpu, gpu.tempC);
  if (document.hidden) return; // jendela tersembunyi: simpan riwayat saja, tak perlu menggambar

  // CPU
  $("cpuName").textContent = cpu.name ?? "";
  setTemp($("cpuTemp"), $("cpuTag"), cpu.tempC);
  setMeter("cpuLoadBar", cpu.load);
  setDd("cpuLoad", fmt(cpu.load) + "%");
  setDd("cpuFan", cpu.fanRpm != null ? cpu.fanRpm + " rpm" : "--");
  setDd("cpuThr", String(cpu.coreLoads.length));
  const cores = $("cores");
  if (cores.children.length !== cpu.coreLoads.length) {
    cores.replaceChildren(...cpu.coreLoads.map(() => document.createElement("i")));
  }
  cpu.coreLoads.forEach((l, i) => { cores.children[i].style.height = Math.max(8, l) + "%"; });

  // GPU
  $("gpuName").textContent = (gpu.name ?? "").replace("NVIDIA GeForce ", "");
  setTemp($("gpuTemp"), $("gpuTag"), gpu.tempC);
  setMeter("gpuLoadBar", gpu.load);
  setDd("gpuLoad", fmt(gpu.load) + "%");
  setDd("gpuHot", fmt(gpu.hotspotC) + "°C", gpu.hotspotC >= 95 ? "hot" : gpu.hotspotC >= HOT_AT ? "warn" : "");
  setDd("gpuPower", fmt(gpu.powerW) + " W");
  setDd("gpuFan", gpu.fanRpm != null ? gpu.fanRpm + " rpm" : "--");
  setDd("gpuClock", fmt(gpu.coreClockMHz) + " MHz");
  setDd("gpuVt", fmt(gpu.vramTempC) + "°C");
  setDd("gpuMem", fmt(gpu.memClockMHz) + " MHz");
  setDd("gpuRx", fmt(gpu.pcieRxMBs, 1) + " MB/s");
  setDd("gpuTx", fmt(gpu.pcieTxMBs, 1) + " MB/s");
  drawAll();

  // RAM / VRAM
  setBig("ramV", fmt(ram.usedGB, 1), `GB · ${fmt(ram.loadPct)}%`);
  setMeter("ramBar", ram.loadPct);
  $("ramSub").textContent = `free ${fmt(ram.availableGB, 1)} GB`;
  const vp = gpu.vramTotalMB ? (gpu.vramUsedMB / gpu.vramTotalMB) * 100 : 0;
  setBig("vramV", fmt(gpu.vramUsedMB / 1024, 1), `/ ${fmt(gpu.vramTotalMB / 1024, 1)} GB`);
  setMeter("vramBar", vp);
  $("vramSub").textContent = `free ${fmt((gpu.vramTotalMB - gpu.vramUsedMB) / 1024, 1)} GB · ${fmt(gpu.memClockMHz)} MHz`;

  // Baterai
  const b = s.battery;
  if (b) {
    setBig("batV", fmt(b.levelPct), "%");
    setMeter("batBar", b.levelPct);
    $("batBar").parentElement.classList.toggle("over", b.levelPct < 20);
    $("batSub").textContent = `health ${fmt(100 - (b.degradationPct ?? 0), 1)}% · ${fmt(b.fullWh)}/${fmt(b.designedWh)} Wh`;
    const r = b.rateW ?? 0;
    $("batRate").textContent = r > 0.5 ? `charging +${fmt(r, 1)} W` : r < -0.5 ? `draining ${fmt(r, 1)} W` : "AC · idle (0.0 W)";
  }

  // Storage
  $("storage").replaceChildren(...s.storage.map(diskCard));

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
  hd.append(n, mk("span", "t " + tempClass(d.tempC), fmt(d.tempC) + "°C"));
  const meter = mk("div", "meter"); const bar = document.createElement("i");
  bar.style.width = Math.min(100, d.usedPct ?? 0) + "%"; meter.append(bar);
  meter.classList.toggle("over", (d.usedPct ?? 0) >= 90);
  const line = (label, valueEl) => { const l = mk("div", "ln"); l.append(mk("span", null, label), valueEl); return l; };
  const life = mk("b", d.lifePct != null && d.lifePct <= 80 ? "warn" : "", fmt(d.lifePct) + "%");
  const used = mk("b", (d.usedPct ?? 0) >= 90 ? "hot" : "", fmt(d.usedPct) + "%");
  const io = mk("b", "", `${fmt(d.readMBs, 1)} / ${fmt(d.writeMBs, 1)} MB/s`);
  el.append(hd, meter, line("USED", used), line("LIFE LEFT", life), line("R / W", io));
  return el;
}

function setBig(id, value, unit) {
  const el = $(id);
  const small = document.createElement("small"); small.textContent = unit;
  el.replaceChildren(document.createTextNode(value), small);
}

/* ---------- WebSocket + auto-reconnect ---------- */
let retry = 0;
function setLink(on) {
  const b = $("link");
  b.textContent = on ? "ONLINE" : "OFFLINE";
  b.className = on ? "on" : "";
  $("sub").textContent = on ? "HARDWARE MONITOR" : "MENUNGGU SERVICE…";
}
function connect() {
  const ws = new WebSocket(WS_URL);
  ws.onopen = () => { retry = 0; setLink(true); };
  ws.onmessage = (e) => { try { render(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose = () => { setLink(false); setTimeout(connect, Math.min(5000, 1000 + retry++ * 500)); };
  ws.onerror = () => ws.close();
}
connect();
