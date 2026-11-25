"use strict";

const WS_URL = "ws://127.0.0.1:47821/ws";
const HISTORY = 3600;               // samples kept per series (one per second)
let range = 600;                    // seconds shown in the charts

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const hist = { cpu: [], gpu: [] };
const fmt = (v, d = 0) => (v == null ? "--" : Number(v).toFixed(d));
const tempClass = (t) => (t == null ? "" : t >= CFG.hot ? "hot" : t >= CFG.warn ? "warn" : "ok");
const css = (name) => getComputedStyle(root).getPropertyValue(name).trim();

/* ---------- preferences (theme, FX) and limits ---------- */
const DEFAULTS = { warn: 75, hot: 90, spot: 95, hold: 10 }; // °C, °C, °C, seconds
const CFG = { ...DEFAULTS };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
function applyPrefs() {
  $("btnAlerts").classList.toggle("on", store.get("alerts", "on") === "on");
  root.classList.toggle("light", store.get("theme", "dark") === "light");
  root.classList.toggle("nofx", store.get("fx", "on") === "off");
  $("btnFx").classList.toggle("on", store.get("fx", "on") === "on");
}
$("btnAlerts").onclick = () => { store.set("alerts", store.get("alerts", "on") === "on" ? "off" : "on"); applyPrefs(); };
$("btnFx").onclick = () => { store.set("fx", store.get("fx", "on") === "on" ? "off" : "on"); applyPrefs(); };
$("btnTheme").onclick = () => { store.set("theme", store.get("theme", "dark") === "dark" ? "light" : "dark"); applyPrefs(); drawAll(); };
applyPrefs();
for (const k of Object.keys(DEFAULTS)) { const v = parseFloat(store.get("cfg." + k, "")); if (Number.isFinite(v)) CFG[k] = v; }
{ const r = parseInt(store.get("range", "600"), 10); if ([60, 600, 3600].includes(r)) range = r; }
addEventListener("load", () => scrollTo(0, 0));

/* save resources: the grid stops while the window is unfocused */
const syncIdle = () => root.classList.toggle("idle", !document.hasFocus());
addEventListener("focus", syncIdle); addEventListener("blur", syncIdle); syncIdle();

setInterval(() => { $("clock").textContent = new Date().toLocaleTimeString("en-GB", { hour12: false }); }, 1000);

/* ---------- tray tooltip and critical-temperature alerts ---------- */
// Outside Tauri (plain browser) there is no invoke, and both features do nothing.
const invoke = window.__TAURI__?.core?.invoke;
const ALERT_COOLDOWN_MS = 600_000;   // minimum gap between two notifications for one sensor
const ALERT_REARM_DELTA = 5;         // °C below the limit before the sensor can alert again
const alertState = {};
let lastTip = "";

function checkAlert(key, label, value, limit) {
  const st = (alertState[key] ??= { since: null, sent: 0, armed: true });
  const now = Date.now();
  if (value == null || value < limit) {
    st.since = null;
    if (value == null || value < limit - ALERT_REARM_DELTA) st.armed = true;
    return;
  }
  st.since ??= now;
  if (st.armed && now - st.since >= CFG.hold * 1000 && now - st.sent >= ALERT_COOLDOWN_MS) {
    st.armed = false; st.sent = now;
    invoke("notify", { title: "LOQ Monitor: " + label + " is hot", body: `${label} reached ${fmt(value)}°C` }).catch(() => {});
  }
}
function trayUpdate(s) {
  if (!invoke) return;
  const tip = `LOQ Monitor\nCPU ${fmt(s.cpu.tempC)}°C   GPU ${fmt(s.gpu.tempC)}°C`;
  if (tip !== lastTip) { lastTip = tip; invoke("set_tooltip", { text: tip }).catch(() => {}); }
  if (store.get("alerts", "on") !== "on") return;
  checkAlert("cpu", "CPU", s.cpu.tempC, CFG.hot);
  checkAlert("gpu", "GPU", s.gpu.tempC, CFG.hot);
  checkAlert("hotspot", "GPU hotspot", s.gpu.hotspotC, CFG.spot);
}

/* ---------- sustained-heat banner ---------- */
const HEAT_AFTER_MS = 30_000, SNOOZE_MS = 1_800_000;
const heat = { cpu: {}, gpu: {}, spot: {}, snoozeUntil: 0 };
const duration = (ms) => { const m = Math.floor(ms / 60000); return m < 1 ? Math.floor(ms / 1000) + " s" : m < 60 ? m + " min" : Math.floor(m / 60) + " h " + (m % 60) + " min"; };
function heatUpdate(s) {
  const now = Date.now();
  const items = [["cpu", "CPU", s.cpu.tempC, CFG.hot], ["gpu", "GPU", s.gpu.tempC, CFG.hot], ["spot", "GPU hotspot", s.gpu.hotspotC, CFG.spot]];
  const live = [];
  for (const [key, label, v, limit] of items) {
    const st = heat[key];
    if (v == null || v < limit) { st.since = null; st.dismissed = false; continue; }
    st.since ??= now;
    if (!st.dismissed && now - st.since >= HEAT_AFTER_MS) live.push([key, `${label} ${fmt(v)}°C for ${duration(now - st.since)}`]);
  }
  const show = live.length > 0 && now >= heat.snoozeUntil;
  $("heat").hidden = !show;
  if (show) $("heatMsg").textContent = "Running hot: " + live.map((x) => x[1]).join(", ") + ". Check airflow, power mode and dust.";
  heat.live = live.map((x) => x[0]);
}
$("heatDismiss").onclick = () => { (heat.live ?? []).forEach((k) => { heat[k].dismissed = true; }); $("heat").hidden = true; };
$("heatSnooze").onclick = () => { heat.snoozeUntil = Date.now() + SNOOZE_MS; $("heat").hidden = true; };

/* ---------- helper render ---------- */
function setTemp(el, tagEl, t) {
  el.textContent = fmt(t);
  el.className = "big " + tempClass(t);
  const c = tempClass(t);
  tagEl.textContent = c === "hot" ? "HOT" : c === "warn" ? "WARM" : c === "ok" ? "NORMAL" : "--";
  tagEl.className = "tag " + c;
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
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const min = 30, max = 100;
  const py = (v) => h - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * (h - 6) - 3;

  // limit lines with their values
  ctx.font = "11px " + css("--font-mono"); ctx.textBaseline = "bottom"; ctx.textAlign = "right";
  ctx.lineWidth = 1;
  [[CFG.warn, css("--highlight")], [CFG.hot, css("--danger")]].forEach(([t, c]) => {
    const y = Math.round(py(t)) + 0.5;
    ctx.setLineDash([4, 4]); ctx.strokeStyle = c; ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.fillStyle = c; ctx.fillText(t + "°", w - 2, y - 1);
  });

  const n = Math.min(series.length, range);
  if (n < 2) return;
  const data = series.slice(series.length - n);
  const bucket = Math.max(1, Math.ceil(n / Math.max(1, w)));        // average samples so a 1 hour range stays light
  const pts = [];
  for (let k = 0; k * bucket < n; k++) {
    const part = data.slice(k * bucket, (k + 1) * bucket);
    const v = part.reduce((a, b) => a + b, 0) / part.length;
    const j = k * bucket + (part.length - 1) / 2;
    pts.push([(j / (n - 1)) * w, py(v)]); // the range is a maximum: a short history fills the width
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
function caption(el, series) {
  const n = Math.min(series.length, range);
  if (!n) { el.textContent = ""; return; }
  let lo = Infinity, hi = -Infinity, sum = 0;
  for (let i = series.length - n; i < series.length; i++) { const v = series[i]; if (v < lo) lo = v; if (v > hi) hi = v; sum += v; }
  const span = n < range ? (n < 60 ? n + " s" : Math.floor(n / 60) + " min") : RANGE_NAMES[range];
  el.textContent = `last ${span} · min ${fmt(lo)}° · avg ${fmt(sum / n)}° · max ${fmt(hi)}°`;
}
function drawAll() {
  drawChart($("cpuChart"), hist.cpu, css("--accent-primary"));
  drawChart($("gpuChart"), hist.gpu, css("--accent-secondary"));
  caption($("cpuCap"), hist.cpu); caption($("gpuCap"), hist.gpu);
}
document.querySelectorAll(".seg button").forEach((b) => {
  b.classList.toggle("on", +b.dataset.r === range);
  b.onclick = () => {
    range = +b.dataset.r; store.set("range", String(range));
    document.querySelectorAll(".seg button").forEach((x) => x.classList.toggle("on", x === b));
    drawAll();
  };
});
function push(series, v) {
  if (v == null) return;
  series.push(v);
  if (series.length > HISTORY) series.shift();
}

function logLines(s) {
  const out = [];
  const add = (lv, msg) => out.push([lv, msg]);
  if (s.cpu.tempC >= CFG.hot) add("CRIT", `cpu.temp ${fmt(s.cpu.tempC)}°C, near thermal limit`);
  else if (s.cpu.tempC >= CFG.warn) add("WARN", `cpu.temp ${fmt(s.cpu.tempC)}°C`);
  if (s.gpu.hotspotC >= CFG.spot) add("CRIT", `gpu.hotspot ${fmt(s.gpu.hotspotC)}°C`);
  else if (s.gpu.tempC >= CFG.hot) add("CRIT", `gpu.temp ${fmt(s.gpu.tempC)}°C`);
  else if (s.gpu.tempC >= CFG.warn) add("WARN", `gpu.temp ${fmt(s.gpu.tempC)}°C`);
  const vp = s.gpu.vramTotalMB ? (s.gpu.vramUsedMB / s.gpu.vramTotalMB) * 100 : 0;
  if (vp >= 90) add("WARN", `vram ${fmt(vp)}% used`);
  if (s.ram.loadPct >= 90) add("WARN", `ram ${fmt(s.ram.loadPct)}% used`);
  s.storage.forEach((d) => { if (d.tempC >= 70) add("WARN", `ssd ${d.name} ${fmt(d.tempC)}°C`); });
  if (s.battery && s.battery.levelPct < 20) add("WARN", `battery ${fmt(s.battery.levelPct)}%`);
  if (!out.length) add("OK", "all sensors within normal range");
  add("INFO", "ec.wmi link established");
  return out;
}

function updateMini(s) {
  const t = (id, v) => { const e = $(id); e.textContent = fmt(v) + "°"; e.className = "mv " + tempClass(v); };
  t("mCpu", s.cpu.tempC); t("mGpu", s.gpu.tempC);
  $("mCpuL").textContent = fmt(s.cpu.load) + "%";
  $("mGpuL").textContent = fmt(s.gpu.load) + "%";
  $("mRam").textContent = fmt(s.ram.loadPct) + "%";
  $("mMode").textContent = MODES[s.powerMode] ?? "--";
}

const MODES = { 1: "QUIET", 2: "BALANCED", 3: "PERFORMANCE", 224: "CUSTOM", 255: "CUSTOM" };

function render(s) {
  lastRendered = s;
  const { cpu, gpu, ram } = s;
  push(hist.cpu, cpu.tempC); push(hist.gpu, gpu.tempC);
  if (typeof Detail !== "undefined") Detail.update(s);
  trayUpdate(s); // runs while the window is hidden in the tray
  heatUpdate(s);
  if (document.hidden) return; // window hidden: keep the history, skip drawing
  if (miniOn) { updateMini(s); return; }

  // CPU
  $("cpuName").textContent = cpu.name ? `${cpu.name} · ${cpu.coreLoads.length}T` : "";
  setTemp($("cpuTemp"), $("cpuTag"), cpu.tempC);
  setMeter("cpuLoadBar", cpu.load);
  setDd("cpuLoad", fmt(cpu.load) + "%");
  setDd("cpuFan", cpu.fanRpm != null ? cpu.fanRpm + " rpm" : "--");
  setDd("cpuPower", cpu.powerW != null ? fmt(cpu.powerW, 1) + " W" : "--");
  setDd("cpuClock", cpu.clockMHz != null ? fmt(cpu.clockMHz) + " MHz" : "--");
  $("mode").textContent = MODES[s.powerMode] ?? "--";
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
  setDd("gpuHot", fmt(gpu.hotspotC) + "°C", gpu.hotspotC >= CFG.spot ? "hot" : gpu.hotspotC >= CFG.hot ? "warn" : "");
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

/* ---------- WebSocket + auto-reconnect, offline screen ---------- */
let retry = 0, ws = null, retryTimer = null, offlineTimer = null;
function setLink(on) {
  const b = $("link");
  b.textContent = on ? "ONLINE" : "OFFLINE";
  b.className = on ? "on" : "";
  $("sub").textContent = on ? "HARDWARE MONITOR" : "WAITING FOR SERVICE…";
  if (on) { clearTimeout(offlineTimer); offlineTimer = null; $("offline").hidden = true; }
  else if (!offlineTimer) offlineTimer = setTimeout(() => { $("offline").hidden = false; }, 3000); // brief drops stay quiet; reconnect attempts must not restart this timer
}
function connect() {
  clearTimeout(retryTimer);
  ws = new WebSocket(WS_URL);
  const mine = ws;
  ws.onopen = () => { retry = 0; setLink(true); };
  ws.onmessage = (e) => { try { render(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose = () => { if (mine !== ws) return; setLink(false); retryTimer = setTimeout(connect, Math.min(5000, 1000 + retry++ * 500)); };
  ws.onerror = () => mine.close();
}
function sendWs(msg) { try { if (ws && ws.readyState === 1) ws.send(msg); } catch { /* connection closing */ } }
connect();
$("btnRetry").onclick = () => { $("offlineMsg").textContent = "Trying now…"; try { ws.onclose = null; ws.close(); } catch { /* already closed */ } connect(); };
$("btnStart").onclick = () => {
  if (!invoke) { $("offlineMsg").textContent = "Starting the service needs the desktop app."; return; }
  $("offlineMsg").textContent = "Starting the service…";
  invoke("start_service").then(() => { $("offlineMsg").textContent = "Service started. Reconnecting…"; setTimeout(() => $("btnRetry").click(), 2500); })
    .catch((e) => { $("offlineMsg").textContent = "Could not start it: " + e; });
};

/* ---------- settings dialog ---------- */
const dlg = $("settings");
const cfgIds = { warn: "cfgWarn", hot: "cfgHot", spot: "cfgSpot", hold: "cfgHold" };
function fillCfg(src) { for (const [k, id] of Object.entries(cfgIds)) $(id).value = src[k]; $("cfgErr").textContent = ""; }
$("btnSettings").onclick = () => { fillCfg(CFG); dlg.showModal(); };
$("cfgCancel").onclick = () => dlg.close();
$("cfgReset").onclick = () => fillCfg(DEFAULTS);
$("settingsForm").onsubmit = (e) => {
  const v = {}; for (const [k, id] of Object.entries(cfgIds)) v[k] = parseFloat($(id).value);
  if (Object.values(v).some((x) => !Number.isFinite(x))) { e.preventDefault(); $("cfgErr").textContent = "Fill in every field with a number."; return; }
  if (v.warn >= v.hot) { e.preventDefault(); $("cfgErr").textContent = "Warm must be lower than Hot."; return; }
  Object.assign(CFG, v);
  for (const k of Object.keys(v)) store.set("cfg." + k, String(v[k]));
  Object.keys(alertState).forEach((k) => delete alertState[k]);
  if (lastRendered) render(lastRendered);
};

/* ---------- mini mode: small always-on-top window ---------- */
let miniOn = false, fullSize = null, lastRendered = null;
async function setMini(on) {
  const T = window.__TAURI__, w = T?.window?.getCurrentWindow?.();
  miniOn = on; root.classList.toggle("mini", on);
  if (!w) return;
  const LS = T.dpi?.LogicalSize ?? T.window?.LogicalSize;
  try {
    if (on) {
      fullSize = { w: innerWidth, h: innerHeight };
      await w.unmaximize();
      await w.setMinSize(new LS(220, 150));
      await w.setSize(new LS(280, 190));
      await w.setAlwaysOnTop(true);
    } else {
      await w.setAlwaysOnTop(false);
      await w.setMinSize(new LS(760, 560));
      await w.setSize(new LS(fullSize?.w ?? 1040, fullSize?.h ?? 780));
    }
  } catch (e) { console.error(e); }
  if (lastRendered) render(lastRendered);
}
$("btnMini").onclick = () => setMini(true);
$("btnFull").onclick = () => setMini(false);

/* ---------- custom title bar (window has no native frame) ---------- */
(() => {
  const w = window.__TAURI__?.window?.getCurrentWindow?.();
  if (!w) { $("titlebar").hidden = true; return; }
  $("wMin").onclick = () => w.minimize();
  $("wMax").onclick = () => w.toggleMaximize();
  $("wClose").onclick = () => w.close(); // hides to tray (see lib.rs)
})();
