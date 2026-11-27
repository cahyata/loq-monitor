// LOQ Monitor | Game overlay window script
// Author: cahyata
// Copyright (c) 2026 cahyata
"use strict";
/* Runs inside the transparent overlay window. It makes its own link to the sensor service,
   draws the readings chosen in the app, and tells the Rust side how big its content is so the
   window fits it and sits in the chosen corner. */

const Link = createLink({ WebSocket, fetch: (url) => fetch(url), setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (id) => clearTimeout(id) });
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

/* Frame rate needs the service to run PresentMon, which only happens on request. It is needed while the
   overlay is visible and shows an FPS reading. */
let visible = false;
function syncFps() { Link.need("fps", visible && OvMetrics.needsFps(cfg)); }
window.__TAURI__?.event?.listen("overlay-state", (e) => { visible = !!e.payload; syncFps(); });
invoke?.("overlay_is_visible").then((v) => { visible = !!v; syncFps(); }).catch(() => {});

Link.start({ onSnapshot: (s) => { last = s; paint(); } });
paint();
setInterval(() => invoke?.("overlay_raise"), 5000);   // keep the window above games that reorder windows
