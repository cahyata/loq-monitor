// LOQ Monitor | Game overlay window script
// Author: cahyata
// Copyright (c) 2026 cahyata
"use strict";
/* Runs inside the transparent overlay window. It opens its own connection to the sensor service,
   draws the readings chosen in the app, and tells the Rust side how big its content is so the
   window fits it and sits in the chosen corner. */

const WS_URL = "ws://127.0.0.1:47821/ws";
const invoke = window.__TAURI__?.core?.invoke;
const box = document.getElementById("ov");
let cfg = OvMetrics.load();
let last = null;
let sentW = 0, sentH = 0;

function fit() {
  const r = box.getBoundingClientRect();
  const w = Math.ceil(r.width) + 2, h = Math.ceil(r.height) + 2;
  if (w !== sentW || h !== sentH) { sentW = w; sentH = h; invoke?.("overlay_resize", { w, h }); }
}
function paint() { cfg = OvMetrics.load(); OvMetrics.draw(box, last, cfg); fit(); syncFps(); }   // settings are re-read each time, so edits in the app show up at once

// The app edits the settings; both windows share localStorage, and the app also sends an event.
addEventListener("storage", (e) => { if (e.key === "overlay" || e.key?.startsWith("cfg.") || e.key === "unit") { cfg = OvMetrics.load(); paint(); } });
window.__TAURI__?.event?.listen("overlay-config", (e) => { cfg = { ...OvMetrics.DEFAULTS, ...e.payload }; paint(); });

/* Frame rate needs the service to run PresentMon, which only happens on request. Ask while the overlay
   is visible and shows an FPS reading, and let go otherwise. */
let socket = null, visible = false, sentFps = null;
function syncFps() {
  const want = visible && OvMetrics.needsFps(cfg);
  if (socket?.readyState !== WebSocket.OPEN || want === sentFps) return;
  sentFps = want;
  socket.send(want ? "fps-on" : "fps-off");
}
window.__TAURI__?.event?.listen("overlay-state", (e) => { visible = !!e.payload; syncFps(); });
invoke?.("overlay_is_visible").then((v) => { visible = !!v; syncFps(); }).catch(() => {});

let retry = 0;
function connect() {
  const ws = new WebSocket(WS_URL);
  socket = ws;
  ws.onopen = () => { retry = 0; sentFps = null; syncFps(); };
  ws.onmessage = (e) => { try { last = JSON.parse(e.data); paint(); } catch { /* ignore a bad frame */ } };
  ws.onclose = () => { setTimeout(connect, Math.min(5000, 1000 + retry++ * 500)); };
  ws.onerror = () => ws.close();
}
connect();
paint();
setInterval(() => invoke?.("overlay_raise"), 5000);   // keep the window above games that reorder windows
