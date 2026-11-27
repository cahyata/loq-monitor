// LOQ Monitor | Overlay tab (settings, preview, hotkey)
// Author: cahyata
// Copyright (c) 2026 cahyata
"use strict";
/* The Overlay tab: turns the game overlay on or off, picks what it shows and how it looks, and
   previews it live. Shares $, store and invoke with main.js and the catalog with metrics.js. */

const OverlayUI = (() => {
  const DEFAULT_KEY = "Ctrl+Shift+O";
  let cfg = OvMetrics.load();
  let visible = false, active = false, last = null, hotkey = store.get("overlay.hotkey", DEFAULT_KEY);

  const msg = (t) => { $("ovMsg").textContent = t; };
  const redraw = () => {
    if (!active) return;
    const el = $("ovPreview"), stage = $("ovStage");
    OvMetrics.draw(el, last, cfg, true);
    // A wide horizontal bar would overflow the stage, so shrink the preview to fit. The real overlay is not affected.
    el.style.zoom = "1";
    const room = stage.clientWidth - 30;
    if (el.offsetWidth > room && room > 0) el.style.zoom = String(room / el.offsetWidth);
  };

  const place = () => invoke?.("overlay_configure", { corner: cfg.corner, marginX: cfg.marginX, marginY: cfg.marginY, monitor: cfg.monitor });

  /** The selected readings in display order, each with buttons that move or remove it. */
  function buildOrder() {
    const list = $("ovOrder");
    if (!cfg.metrics.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = "Nothing selected."; list.replaceChildren(li); return; }
    list.replaceChildren(...cfg.metrics.map((id, i) => {
      const m = OvMetrics.BY_ID[id];
      const li = document.createElement("li");
      const name = document.createElement("span"); name.textContent = m ? m.group + ": " + m.label : id;
      const btn = (text, label, disabled, fn) => {
        const b = document.createElement("button"); b.type = "button"; b.textContent = text; b.setAttribute("aria-label", label + " " + (m?.label ?? id)); b.disabled = disabled; b.onclick = fn; return b;
      };
      const move = (d) => { const a = cfg.metrics, j = i + d; [a[i], a[j]] = [a[j], a[i]]; save(); list.children[j]?.querySelector("button:not(:disabled)")?.focus(); };
      li.append(name,
        btn("▲", "Move up", i === 0, () => move(-1)),
        btn("▼", "Move down", i === cfg.metrics.length - 1, () => move(1)),
        btn("✕", "Remove", false, () => { cfg.metrics.splice(i, 1); buildMetrics(); save(); }));
      return li;
    }));
  }

  /** Fills the Display list with the connected screens. */
  function loadMonitors() {
    if (!invoke) return;
    invoke("overlay_monitors").then((names) => {
      if (!names.length) return;
      $("ovMonitor").replaceChildren(...names.map((n, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = n; return o; }));
      if (cfg.monitor >= names.length) cfg.monitor = 0;
      $("ovMonitor").value = String(cfg.monitor);
    }).catch(() => {});
  }

  /** Saves the settings and tells the overlay window (position) and the preview (look). */
  function save() {
    store.set("overlay", JSON.stringify(cfg));
    place();
    buildOrder();
    window.__TAURI__?.event?.emit("overlay-config", cfg);
    $("ovCount").textContent = cfg.metrics.length + " selected";
    redraw();
  }

  function paintState() {
    $("ovToggle").textContent = visible ? "HIDE OVERLAY" : "SHOW OVERLAY";
    $("ovToggle").setAttribute("aria-pressed", String(visible));
    $("ovToggle").classList.toggle("on", visible);
    $("ovState").textContent = visible ? "Showing over your game" : "Hidden";
    $("ovDot").classList.toggle("on", visible);
    $("tabOverlay").title = "Game overlay (key 7)" + (visible ? ", showing" : "");
  }
  function setVisible(v) { visible = !!v; paintState(); }

  function buildMetrics() {
    const wrap = $("ovMetrics");
    wrap.replaceChildren(...OvMetrics.GROUPS.map((g) => {
      const fs = document.createElement("fieldset"); fs.className = "mgroup";
      const lg = document.createElement("legend"); lg.textContent = g; fs.append(lg);
      for (const m of OvMetrics.LIST.filter((x) => x.group === g)) {
        const lab = document.createElement("label"); lab.className = "mchk";
        const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = cfg.metrics.includes(m.id);
        cb.onchange = () => {
          // New readings go to the end. The order list changes the order.
          cfg.metrics = cb.checked ? [...cfg.metrics.filter((id) => id !== m.id), m.id] : cfg.metrics.filter((id) => id !== m.id);
          save();
        };
        lab.append(cb, document.createTextNode(" " + m.label));
        fs.append(lab);
      }
      return fs;
    }));
  }

  function fillForm() {
    $("ovLayout").value = cfg.layout; $("ovCorner").value = cfg.corner;
    $("ovMarginX").value = cfg.marginX; $("ovMarginY").value = cfg.marginY; $("ovMonitor").value = String(cfg.monitor);
    $("ovAccent").value = cfg.accent; $("ovFont").value = cfg.font; $("ovSpacing").value = cfg.spacing;
    $("ovRadius").value = cfg.radius; $("ovRadiusV").textContent = cfg.radius + " px"; $("ovStatus").checked = cfg.statusColors !== false;
    $("ovScale").value = cfg.scale; $("ovScaleV").textContent = cfg.scale + "%";
    $("ovOpacity").value = cfg.opacity; $("ovOpacityV").textContent = cfg.opacity + "%";
    $("ovBg").value = cfg.bg; $("ovLabels").checked = cfg.labels !== false;
    $("ovKey").textContent = hotkey;
  }

  const bind = (id, apply, ev = "input") => { $(id).addEventListener(ev, () => { apply($(id)); save(); }); };
  bind("ovLayout", (e) => { cfg.layout = e.value; }, "change");
  bind("ovCorner", (e) => {
    cfg.corner = e.value;
    // On a centered axis the offset is a shift from the center, so it starts at 0. On an edge it starts at 16 px.
    cfg.marginX = cfg.corner[1] === "c" ? 0 : (cfg.marginX || 16);
    cfg.marginY = cfg.corner[0] === "m" ? 0 : (cfg.marginY || 16);
    $("ovMarginX").value = cfg.marginX; $("ovMarginY").value = cfg.marginY;
  }, "change");
  bind("ovBg", (e) => { cfg.bg = e.value; }, "change");
  const offset = (e) => { const v = parseFloat(e.value); return Number.isFinite(v) ? Math.max(-2000, Math.min(2000, v)) : 16; };
  bind("ovMarginX", (e) => { cfg.marginX = offset(e); });
  bind("ovMarginY", (e) => { cfg.marginY = offset(e); });
  bind("ovMonitor", (e) => { cfg.monitor = parseInt(e.value, 10) || 0; }, "change");
  bind("ovAccent", (e) => { cfg.accent = e.value; }, "change");
  bind("ovFont", (e) => { cfg.font = e.value; }, "change");
  bind("ovSpacing", (e) => { cfg.spacing = e.value; }, "change");
  bind("ovRadius", (e) => { cfg.radius = +e.value; $("ovRadiusV").textContent = cfg.radius + " px"; });
  bind("ovStatus", (e) => { cfg.statusColors = e.checked; }, "change");
  bind("ovScale", (e) => { cfg.scale = +e.value; $("ovScaleV").textContent = cfg.scale + "%"; });
  bind("ovOpacity", (e) => { cfg.opacity = +e.value; $("ovOpacityV").textContent = cfg.opacity + "%"; });
  bind("ovLabels", (e) => { cfg.labels = e.checked; }, "change");

  document.querySelectorAll("#ovPresets button").forEach((b) => {
    b.onclick = () => { cfg.metrics = b.dataset.p === "none" ? [] : [...OvMetrics.PRESETS[b.dataset.p]]; buildMetrics(); save(); };
  });

  $("ovToggle").onclick = () => {
    if (!invoke) { msg("The overlay needs the desktop app."); return; }
    const want = !visible;   // read now: the event from Rust may change `visible` before the call returns
    invoke("overlay_show", { visible: want }).then(() => setVisible(want)).catch((e) => msg("Could not change the overlay: " + e));
  };

  /* ---- hotkey capture ---- */
  function applyHotkey(acc, quiet = false) {
    if (!invoke) return Promise.resolve();
    return invoke("overlay_hotkey", { accelerator: acc }).then(() => { hotkey = acc; store.set("overlay.hotkey", acc); $("ovKey").textContent = acc; if (!quiet) msg("Hotkey set to " + acc + "."); });
  }
  function stopCapture() { window.__capturing = false; $("ovKeyBtn").textContent = "CHANGE"; removeEventListener("keydown", onKey, true); }
  function onKey(e) {
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;       // wait for the real key
    e.preventDefault(); e.stopPropagation();
    if (e.key === "Escape") { stopCapture(); msg("Cancelled. The hotkey is still " + hotkey + "."); return; }
    const key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : /^F([1-9]|1[0-2])$/.test(e.code) ? e.code : null;
    if (!key) { msg("Use a letter, a digit or F1 to F12 with Ctrl, Alt or Shift. Press Esc to cancel."); return; }
    if (!(e.ctrlKey || e.altKey || e.shiftKey || e.metaKey)) { msg("Add Ctrl, Alt or Shift so the key does not clash with the game."); return; }
    const acc = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super", key].filter(Boolean).join("+");
    stopCapture();
    applyHotkey(acc).catch((err) => msg("Could not use " + acc + ": " + err));
  }
  $("ovKeyBtn").onclick = () => {
    if (window.__capturing) { stopCapture(); return; }
    window.__capturing = true; $("ovKeyBtn").textContent = "CANCEL";
    msg("Press the new key combination now, or Esc to cancel.");
    addEventListener("keydown", onKey, true);
  };

  /* ---- start up ---- */
  buildMetrics(); buildOrder(); fillForm(); paintState(); loadMonitors();
  $("ovCount").textContent = cfg.metrics.length + " selected";
  window.__TAURI__?.event?.listen("overlay-state", (e) => setVisible(e.payload));
  if (invoke) {
    invoke("overlay_is_visible").then(setVisible).catch(() => {});
    place();
    applyHotkey(hotkey, true).catch((err) => msg("The hotkey " + hotkey + " is not available: " + err + " Choose another with CHANGE."));
  } else {
    msg("Open the desktop app to use the overlay.");
  }

  return {
    setActive(on) { active = on; if (on) { fillForm(); redraw(); } },
    update(s) { last = s; redraw(); },
    toggle() { $("ovToggle").click(); },
  };
})();
OverlayUI.setActive(store.get("tab", "overview") === "overlay");   // the saved tab was restored before this file loaded
