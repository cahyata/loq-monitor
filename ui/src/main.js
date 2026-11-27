// LOQ Monitor | UI main script (connection, status line, alerts, settings, shortcuts)
// Author: cahyata
// Copyright (c) 2026 cahyata
"use strict";

const WS_URL = "ws://127.0.0.1:47821/ws";

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const fmt = (v, d = 0) => (v == null ? "--" : Number(v).toFixed(d));
const tempClass = (t) => Rules.temp(t, CFG);
const css = (name) => getComputedStyle(root).getPropertyValue(name).trim();

/* ---------- preferences (theme, FX) and limits ---------- */
const DEFAULTS = { ...Rules.LIMITS, hold: 10 }; // °C, °C, °C, seconds
const CFG = { ...DEFAULTS };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
/* temperature unit: every value is kept in °C and converted only for display */
let unit = store.get("unit", "C") === "F" ? "F" : "C";
const conv = (c, u = unit) => (u === "F" ? (c * 9) / 5 + 32 : c);
const unconv = (v, u = unit) => (u === "F" ? ((v - 32) * 5) / 9 : v);
const deg = () => "\u00B0" + unit;
const tf = (c, d = 0) => (c == null ? "--" : conv(c).toFixed(d));        // number in the chosen unit
const tdeg = (c, d = 0) => (c == null ? "--" : tf(c, d) + deg());         // number plus unit
function applyUnit() { document.querySelectorAll(".u-deg").forEach((e) => { e.textContent = deg(); }); }
function setUnit(u) {
  unit = u === "F" ? "F" : "C"; store.set("unit", unit); applyUnit();
  redraw();
}

/* theme: "system" follows the operating system, otherwise dark or light */
const THEME_LABEL = { system: "AUTO", dark: "DARK", light: "LIGHT" };
const themePref = () => { const t = store.get("theme", "system"); return t in THEME_LABEL ? t : "system"; };
const systemLight = matchMedia("(prefers-color-scheme: light)");
function cycleTheme() {
  const order = ["system", "dark", "light"];
  store.set("theme", order[(order.indexOf(themePref()) + 1) % 3]);
  applyPrefs(); redraw();
  toast("Theme: " + THEME_LABEL[themePref()]);
}

/* a short message for actions that no longer have a visible button (keyboard shortcuts) */
let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
}

function applyPrefs() {
  const t = themePref();
  root.classList.toggle("light", t === "light" || (t === "system" && systemLight.matches));
  root.classList.toggle("nofx", store.get("fx", "on") === "off");
  $("alertsOff").hidden = store.get("alerts", "on") === "on";     // the bar says so when notifications are off
}
systemLight.addEventListener("change", () => { if (themePref() === "system") { applyPrefs(); redraw(); } });
applyPrefs(); applyUnit();
for (const k of Object.keys(DEFAULTS)) { const v = parseFloat(store.get("cfg." + k, "")); if (Number.isFinite(v)) CFG[k] = v; }
addEventListener("load", () => scrollTo(0, 0));

/* save resources: the grid stops while the window is unfocused */
const syncIdle = () => root.classList.toggle("idle", !document.hasFocus());
addEventListener("focus", syncIdle); addEventListener("blur", syncIdle); syncIdle();

/* The blink is a class flipped twice a second, not a CSS animation (see style.css). It stops while the window is hidden. */
setInterval(() => { if (!document.hidden) root.classList.toggle("blink-off"); }, 600);
/* The moving grid is stepped from a timer. About ten frames a second cost an eighth of a 60 Hz CSS animation. It stands still while the
   window has no focus or is hidden, on battery power, with visual effects off, or when the system asks for less motion. */
const gridEl = $("grid"), calm = matchMedia("(prefers-reduced-motion: reduce)");
let gridStep = 0, onBattery = false;
setInterval(() => {
  if (document.hidden || onBattery || calm.matches || root.classList.contains("nofx") || root.classList.contains("idle")) return;
  gridStep = (gridStep + 1) % 16;   // 16 steps of 3 px make one 48 px cell, so the loop has no jump
  gridEl.style.transform = `rotateX(58deg) translate3d(0, ${gridStep * 3}px, 0)`;
}, 100);
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
    invoke("notify", { title: "LOQ Monitor: " + label + " is hot", body: `${label} reached ${tdeg(value)}` }).catch(() => {});
  }
}
function trayUpdate(s) {
  if (!invoke) return;
  const tip = `LOQ Monitor\nCPU ${tdeg(s.cpu.tempC)}   GPU ${tdeg(s.gpu.tempC)}`;
  if (tip !== lastTip) { lastTip = tip; invoke("set_tooltip", { text: tip }).catch(() => {}); }
  if (store.get("alerts", "on") !== "on") return;
  checkAlert("cpu", "CPU", s.cpu.tempC, CFG.hot);
  checkAlert("gpu", "GPU", s.gpu.tempC, CFG.hot);
  checkAlert("hotspot", "GPU hotspot", s.gpu.hotspotC, CFG.spot);
}

/* ---------- pinned sensors (favorites) ---------- */
const Pins = (() => {
  let list = [];
  try { const v = JSON.parse(store.get("pins", "[]")); if (Array.isArray(v)) list = v.filter((k) => typeof k === "string"); } catch { /* keep empty */ }
  return {
    key: (h, x) => h.name + "|" + x.type + "|" + x.name,
    has: (k) => list.includes(k),
    toggle(k) { list = list.includes(k) ? list.filter((x) => x !== k) : [...list, k]; store.set("pins", JSON.stringify(list)); },
    resolve(s) {
      const out = [];
      for (const k of list) {
        const [hn, type, ...rest] = k.split("|"), name = rest.join("|");
        const h = (s.hardware ?? []).find((z) => z.name === hn);
        const x = h?.sensors.find((z) => z.type === type && z.name === name);
        if (x) out.push({ key: k, hw: h.name, source: h, x });
      }
      return out;
    },
  };
})();
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
    if (!st.dismissed && now - st.since >= HEAT_AFTER_MS) live.push([key, `${label} ${tdeg(v)} for ${duration(now - st.since)}`]);
  }
  const show = live.length > 0 && now >= heat.snoozeUntil;
  $("heat").hidden = !show;
  if (show) $("heatMsg").textContent = "Running hot: " + live.map((x) => x[1]).join(", ") + ". Check airflow, power mode and dust.";
  heat.live = live.map((x) => x[0]);
  // The banner text changes every second, so it is not a live region. A screen reader hears it only
  // when the banner appears or the set of hot sensors changes.
  const sig = show ? heat.live.join() : "";
  if (sig !== heat.sig) {
    heat.sig = sig;
    $("announce").textContent = show ? "Running hot: " + live.map((x) => x[1].replace(/ for .*/, "")).join(", ") + "." : "";
  }
}
$("heatDismiss").onclick = () => { (heat.live ?? []).forEach((k) => { heat[k].dismissed = true; }); $("heat").hidden = true; };
$("heatSnooze").onclick = () => { heat.snoozeUntil = Date.now() + SNOOZE_MS; $("heat").hidden = true; };

/* ---------- helper render ---------- */
function updateMini(s) {
  const t = (id, v) => { const e = $(id); e.textContent = tf(v) + "\u00B0"; e.className = "mv " + tempClass(v); };
  t("mCpu", s.cpu.tempC); t("mGpu", s.gpu.tempC);
  $("mCpuL").textContent = fmt(s.cpu.load) + "%";
  $("mGpuL").textContent = fmt(s.gpu.load) + "%";
  $("mRam").textContent = fmt(s.ram.loadPct) + "%";
  $("mMode").textContent = modeLabel(s.powerMode);
}

/* One line that says whether anything needs attention, so the answer does not hide in the log. */
function summaryOf(s) {
  const NAME = { cpu: "CPU", gpu: "GPU", hotspot: "GPU hotspot", ram: "RAM", vram: "VRAM", battery: "Battery" };
  const DRIVE = { temp: (f) => `${tf(f.value)}\u00B0`, fill: (f) => `${fmt(f.value)}% full`, life: (f) => `${fmt(f.value)}% life left`, spare: () => "spare blocks low" };
  const say = (f) => {
    if (f.part === "drive") return "SSD " + DRIVE[f.kind](f);
    if (f.part === "gpuLimit") return "GPU slowed (" + f.limit.label.toLowerCase() + ")";
    const temperature = f.part === "cpu" || f.part === "gpu" || f.part === "hotspot";
    return NAME[f.part] + " " + (temperature ? tf(f.value) + "\u00B0" : fmt(f.value) + "%");
  };
  const found = Rules.findings(s, CFG);
  const hot = found.filter((f) => f.level === "hot").map(say), watch = found.filter((f) => f.level === "warn").map(say);
  const parts = [];
  if (hot.length) parts.push("Hot or critical: " + hot.join(", "));
  if (watch.length) parts.push("Watch: " + watch.join(", "));
  const level = hot.length ? "hot" : watch.length ? "warn" : "ok";
  return { level, text: parts.join("  \u00B7  ") || "Everything is within normal range" };
}
function renderSummary(s) {
  const { level, text } = summaryOf(s);
  $("sumTag").textContent = level === "hot" ? "ATTENTION" : level === "warn" ? "WATCH" : "ALL NORMAL";
  $("sumTag").className = "tag " + level;
  $("sumText").textContent = text;
  $("sumText").title = text;     // the full message, in case it is clipped to two lines
}

const modeLabel = (code) => Rules.powerMode(code)?.toUpperCase() ?? "--";

/* ---------- every snapshot ---------- */
let miniOn = false, lastSnapshot = null;
const Pages = createPages({ element: $, store, visible: () => !document.hidden && !miniOn });

/** What belongs to no single page: tray, alerts, the heat banner, the power mode, the status line and mini mode. */
function drawStatus(s) {
  trayUpdate(s); // runs while the window is hidden in the tray
  heatUpdate(s);
  if (document.hidden) return;
  $("mode").textContent = modeLabel(s.powerMode);
  if (miniOn) updateMini(s); else renderSummary(s);
}
function receive(s) {
  lastSnapshot = s;
  onBattery = s.battery?.acOnline === false;
  Pages.update(s);
  drawStatus(s);
}
/** Draws the latest snapshot again, after a change of settings, theme or window mode. */
function redraw() {
  if (!lastSnapshot) return;
  drawStatus(lastSnapshot);
  Pages.draw();
}

/* ---------- WebSocket + auto-reconnect, offline screen ---------- */
let retry = 0, ws = null, retryTimer = null, offlineTimer = null;
function showOffline(show) {
  const was = !$("offline").hidden;
  $("offline").hidden = !show;
  $("shell").inert = show;                         // the pages behind the overlay cannot take focus
  if (show && !was) $("btnStart").focus();
  if (!show && was) $("btnSettings").focus({ preventScroll: true });
}
function setLink(on) {
  const b = $("link");
  b.textContent = on ? "ONLINE" : "OFFLINE";
  b.className = on ? "on" : "";
  $("sub").textContent = on ? "HARDWARE MONITOR" : "WAITING FOR SERVICE…";
  if (on) { clearTimeout(offlineTimer); offlineTimer = null; showOffline(false); }
  else if (!offlineTimer) offlineTimer = setTimeout(() => showOffline(true), 3000); // brief drops stay quiet; reconnect attempts must not restart this timer
}
function connect() {
  clearTimeout(retryTimer);
  ws = new WebSocket(WS_URL);
  const mine = ws;
  ws.onopen = () => { retry = 0; setLink(true); Pages.connected(); };
  ws.onmessage = (e) => { try { receive(JSON.parse(e.data)); } catch (err) { console.error(err); } };
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
// Every control saves and applies as soon as it changes. A number that is not valid yet (for example half typed)
// is not saved, so the last good value stays in use, and the reason is shown once the field is left.
const dlg = $("settings");
const cfgIds = { warn: "cfgWarn", hot: "cfgHot", spot: "cfgSpot", hold: "cfgHold" };
const TEMP_KEYS = ["warn", "hot", "spot"];
const shownLimit = (k) => (TEMP_KEYS.includes(k) ? Math.round(conv(CFG[k], unit)) : CFG[k]);
function fillLimits() {
  document.querySelectorAll(".dlg-deg").forEach((e) => { e.textContent = "\u00B0" + unit; });
  for (const [k, id] of Object.entries(cfgIds)) $(id).value = shownLimit(k);
}
function fillCfg() {
  $("cfgUnit").value = unit; $("cfgKeys").checked = keysOn;
  $("cfgTheme").value = themePref(); $("cfgFx").checked = store.get("fx", "on") === "on"; $("cfgAlerts").checked = store.get("alerts", "on") === "on";
  fillLimits();
  $("cfgTariff").value = store.get("tariff", ""); $("cfgCurrency").value = store.get("currency", "");
  $("cfgErr").textContent = "";
}

/** Saves the four limits when they make sense together. Returns the reason when they do not. */
function saveLimits() {
  const v = {};
  for (const [k, id] of Object.entries(cfgIds)) {
    const n = parseFloat($(id).value);
    if (!Number.isFinite(n)) return "Fill in every field with a number.";
    // An untouched field keeps its exact value, so rounding in \u00B0F does not move it.
    v[k] = n === shownLimit(k) ? CFG[k] : TEMP_KEYS.includes(k) ? Math.round(unconv(n, unit) * 10) / 10 : n;   // stored in \u00B0C
  }
  if (TEMP_KEYS.some((k) => v[k] < 30 || v[k] > 120) || v.hold < 0 || v.hold > 300) return "Limits must be 30 to 120 \u00B0C (86 to 248 \u00B0F) and the delay 0 to 300 s.";
  if (v.warn >= v.hot) return "Warm must be lower than Hot.";
  if (Object.keys(v).some((k) => v[k] !== CFG[k])) {
    Object.assign(CFG, v);
    for (const k of Object.keys(v)) store.set("cfg." + k, String(v[k]));
    Object.keys(alertState).forEach((k) => delete alertState[k]);
    redraw();
  }
  return "";
}
for (const id of Object.values(cfgIds)) {
  $(id).oninput = () => { if (!saveLimits()) $("cfgErr").textContent = ""; };
  $(id).onchange = () => { $("cfgErr").textContent = saveLimits(); };
}

$("cfgTheme").onchange = () => { store.set("theme", $("cfgTheme").value); applyPrefs(); redraw(); };
$("cfgFx").onchange = () => { store.set("fx", $("cfgFx").checked ? "on" : "off"); applyPrefs(); redraw(); };
$("cfgAlerts").onchange = () => { store.set("alerts", $("cfgAlerts").checked ? "on" : "off"); applyPrefs(); redraw(); };
$("cfgKeys").onchange = () => { keysOn = $("cfgKeys").checked; store.set("keys", keysOn ? "on" : "off"); };
$("cfgUnit").onchange = () => { setUnit($("cfgUnit").value); fillLimits(); $("cfgErr").textContent = ""; };
$("cfgTariff").oninput = () => {
  const e = $("cfgTariff"), tariff = e.value.trim();
  if (e.validity.badInput || (tariff !== "" && !(parseFloat(tariff) >= 0))) { $("cfgErr").textContent = "The electricity price must be a number, or empty."; return; }
  $("cfgErr").textContent = ""; store.set("tariff", tariff); redraw();
};
$("cfgCurrency").oninput = () => { store.set("currency", $("cfgCurrency").value.trim()); redraw(); };
$("cfgReset").onclick = () => {
  Object.assign(CFG, DEFAULTS);
  for (const k of Object.keys(DEFAULTS)) store.set("cfg." + k, String(DEFAULTS[k]));
  Object.keys(alertState).forEach((k) => delete alertState[k]);
  fillLimits(); $("cfgErr").textContent = ""; redraw();
};
$("btnSettings").onclick = () => { fillCfg(); dlg.showModal(); };

/* ---------- mini mode: small always-on-top window ---------- */
let fullSize = null;
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
  redraw();
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

/* ---------- keyboard shortcuts ---------- */
let keysOn = store.get("keys", "on") === "on";   // single-key shortcuts can be turned off (WCAG 2.1.4)
const typing = (t) => t && (t.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName));
addEventListener("keydown", (e) => {
  if (!keysOn || window.__capturing || e.ctrlKey || e.altKey || e.metaKey || typing(e.target) || document.querySelector("dialog[open]")) return;
  const k = e.key.toLowerCase();
  if (k === "escape" && miniOn) { setMini(false); return; }
  if (k === "m") { setMini(!miniOn); return; }
  if (miniOn) return;
  const page = Pages.byKey(k);
  if (page) Pages.show(page);
  else if (k === "o") OverlayUI.toggle();
  else if (k === "/" || k === "f") { Pages.show("detail"); $("dfilter").focus(); e.preventDefault(); }
  else if (k === "t") cycleTheme();
  else if (k === "u") { setUnit(unit === "C" ? "F" : "C"); toast("Unit: \u00B0" + unit); }
  else if (k === "s") $("btnSettings").click();
  else if (k === "?" || k === "h") $("help").showModal();
});
$("btnHelp").onclick = () => { $("settings").close(); $("help").showModal(); };
$("helpClose").onclick = () => $("help").close();

/* ---------- close a dialog by clicking outside it ---------- */
for (const d of [$("settings"), $("help")]) {
  d.addEventListener("click", (e) => {
    if (e.target !== d) return;   // a control inside, also when pressed with the keyboard (which reports position 0, 0)
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
  });
}

/* ---------- no browser context menu ---------- */
// The right-click menu (Back, Reload, Inspect) does not belong in an app. Text fields keep it so Paste works.
addEventListener("contextmenu", (e) => { if (!e.target.closest?.('input[type="text"], input[type="search"], input[type="number"], textarea')) e.preventDefault(); });
