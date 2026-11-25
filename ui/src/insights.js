// LOQ Monitor | Insights tab
// Author: cahyata
// Copyright (c) 2026 cahyata
"use strict";
/* The INSIGHTS tab: the programs that use the most resources, the power draw and the energy used,
   why the GPU is being held back, and min, average and max for this session. The session numbers
   and the energy total are collected from every snapshot, also while another tab or the tray is
   showing, so they are right when the tab is opened. The program list is measured by the service
   only while this tab is open. Shares $, store, sendWs, tf, deg, GPU_LIMITS and limitsOf with main.js. */

var Insights = (() => {   // var, so a failure while loading this file cannot break the typeof checks in main.js
  let active = false, last = null, procKey = store.get("insproc", "cpu"), askedProcs = false, askedAt = 0;
  let prevAt = 0;

  /** One bucket of statistics per measured value. */
  const bucket = () => ({ min: Infinity, max: -Infinity, sum: 0, n: 0 });
  const add = (b, v) => { if (v == null || !Number.isFinite(v)) return; b.min = Math.min(b.min, v); b.max = Math.max(b.max, v); b.sum += v; b.n++; };
  const fresh = () => ({ start: Date.now(), wh: 0, limitSec: {}, stats: { cpuTemp: bucket(), gpuTemp: bucket(), cpuLoad: bucket(), gpuLoad: bucket(), gpuPower: bucket(), ram: bucket() }, secs: 0 });
  let sess = fresh();

  // Energy and limit time for today, kept across restarts.
  const dayKey = () => new Date().toISOString().slice(0, 10);
  let day = (() => {
    try { const d = JSON.parse(store.get("insday", "null")); if (d && d.date === dayKey()) return d; } catch { /* start a new day */ }
    return { date: dayKey(), wh: 0, limitSec: {} };
  })();
  let savedAt = 0;
  const saveDay = () => { savedAt = Date.now(); store.set("insday", JSON.stringify(day)); };

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const clock = (sec) => { const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return h ? h + " h " + String(m).padStart(2, "0") + " min" : m ? m + " min " + String(s % 60).padStart(2, "0") + " s" : s + " s"; };

  /* Only the battery measures the whole laptop, and only while it drains. The rest of the laptop (screen, drives, fans,
     board) is learned from those moments as the difference to CPU plus GPU, and added back while the charger is plugged in. */
  let rest = (() => { const v = parseFloat(store.get("insrest", "")); return Number.isFinite(v) ? v : null; })();
  let restSaved = 0;
  const parts = (s) => (s.cpu?.powerW ?? 0) + (s.gpu?.powerW ?? 0);

  function learnRest(s) {
    const r = s.battery?.rateW;
    if (r == null || r >= -0.5 || s.cpu?.powerW == null || s.gpu?.powerW == null) return;   // needs the whole-laptop reading and both parts
    const other = Math.min(80, Math.max(0, -r - parts(s)));
    rest = rest == null ? other : rest * 0.97 + other * 0.03;
    if (Date.now() - restSaved > 30000) { restSaved = Date.now(); store.set("insrest", rest.toFixed(1)); }
  }

  /** Power now. `estimated` is true when the charger is plugged in and the rest of the laptop comes from what was learned. */
  function power(s) {
    const r = s.battery?.rateW;
    if (r != null && r < -0.5) return { w: -r, estimated: false, note: "The whole laptop, measured at the battery." };
    if (rest != null) return { w: parts(s) + rest, estimated: true, note: `Estimated: CPU and GPU plus about ${rest.toFixed(0)} W for the rest of the laptop, learned while it ran on battery.` };
    return { w: parts(s), estimated: false, note: "CPU and GPU only. Use the laptop on battery once and this page learns the power of the rest." };
  }

  /** Called for every snapshot. */
  function update(s) {
    last = s;
    const now = Date.now(), dt = prevAt ? Math.min(5, (now - prevAt) / 1000) : 0;
    prevAt = now;
    if (dt > 0) {
      learnRest(s);
      const p = power(s);
      const wh = (p.w * dt) / 3600;
      sess.wh += wh; day.wh += wh; sess.secs += dt;
      if (p.estimated) sess.est = true;
      for (const l of limitsOf(s.gpu?.throttleMask)) { sess.limitSec[l.bit] = (sess.limitSec[l.bit] ?? 0) + dt; day.limitSec[l.bit] = (day.limitSec[l.bit] ?? 0) + dt; }
      if (day.date !== dayKey()) day = { date: dayKey(), wh, limitSec: {} };
      if (now - savedAt > 30000) saveDay();
    }
    const st = sess.stats;
    add(st.cpuTemp, s.cpu?.tempC); add(st.gpuTemp, s.gpu?.tempC); add(st.cpuLoad, s.cpu?.load); add(st.gpuLoad, s.gpu?.load);
    add(st.gpuPower, s.gpu?.powerW); add(st.ram, s.ram?.usedGB);
    if (active && !document.hidden) paint();
  }

  /* ---- what the service should measure ---- */
  const wantProcs = () => active && !document.hidden;
  function syncProcs() {
    const want = wantProcs();
    if (want === askedProcs) return;
    askedProcs = want; askedAt = Date.now(); sendWs(want ? "procs-on" : "procs-off");
  }
  document.addEventListener("visibilitychange", syncProcs);

  /* ---- drawing ---- */
  const FORMATS = {
    cpu: { unit: "%", fmt: (v) => v.toFixed(1) + " %", empty: "Nothing is using noticeable CPU right now." },
    memMB: { unit: "MB", fmt: (v) => (v >= 1024 ? (v / 1024).toFixed(1) + " GB" : Math.round(v) + " MB"), empty: "No data yet." },
    gpu: { unit: "%", fmt: (v) => v.toFixed(0) + " %", empty: "No program is using the GPU right now." },
    diskMBs: { unit: "MB/s", fmt: (v) => v.toFixed(1) + " MB/s", empty: "No program is reading or writing much right now." },
  };

  function paintProcs(s) {
    const list = $("insProcs"), f = FORMATS[procKey];
    const rows = s?.processes?.[procKey];
    $("insProcNote").textContent = s?.processes ? "Updates every 3 s" : "";
    if (!s?.processes) {
      // An older sensor service ignores the request, so say so instead of waiting for ever.
      const old = askedAt && Date.now() - askedAt > 12000;
      list.replaceChildren(el("li", "empty", old
        ? "No data. The sensor service that is running is older than this app and cannot rank programs. Update LOQ Monitor, or restart the service from the new install."
        : "Measuring... the first numbers appear in a few seconds."));
      return;
    }
    if (!rows.length) { list.replaceChildren(el("li", "empty", f.empty)); return; }
    const top = procKey === "memMB" || procKey === "diskMBs" ? Math.max(...rows.map((r) => r.value)) : 100;
    list.replaceChildren(...rows.map((r, i) => {
      const li = el("li");
      const name = el("span", "pname", r.name + (r.count > 1 ? "  ×" + r.count : ""));
      name.title = r.count > 1 ? r.name + " runs " + r.count + " processes. The numbers are added together." : r.name;
      const bar = el("span", "pbar"), fill = el("i"); fill.style.transform = `scaleX(${Math.max(0.02, Math.min(1, r.value / top))})`; bar.append(fill);
      li.append(el("span", "prank", String(i + 1)), name, bar, el("b", "pval", f.fmt(r.value)));
      return li;
    }));
  }

  function row(cells, head) {
    const r = el("div", "sysrow" + (head ? " head" : "")); r.setAttribute("role", "row"); r.style.setProperty("--cols", String(cells.length));
    cells.forEach((c) => { const x = el("span", null, c); x.setAttribute("role", head ? "columnheader" : "cell"); r.append(x); });
    return r;
  }

  function paintPower(s) {
    const p = power(s);
    $("insWatts").textContent = (p.estimated ? "~" : "") + p.w.toFixed(0);
    $("insWattsNote").textContent = p.note;
    const tariff = parseFloat(store.get("tariff", "")), cur = store.get("currency", "");
    const money = (wh) => (Number.isFinite(tariff) && tariff > 0 ? "  ·  " + (cur ? cur + " " : "") + ((wh / 1000) * tariff).toFixed(tariff >= 100 ? 0 : 2) : "");
    const dl = $("insEnergy");
    dl.replaceChildren(
      el("dt", null, "This session"), el("dd", null, sess.wh.toFixed(1) + " Wh" + money(sess.wh)),
      el("dt", null, "Today"), el("dd", null, day.wh.toFixed(1) + " Wh" + money(day.wh)));
    if (sess.est) dl.append(el("dt", null, "Note"), el("dd", null, "Includes estimates while the charger was plugged in."));
    $("insTariff").hidden = Number.isFinite(tariff) && tariff > 0;
  }

  function paintLimits(s) {
    const now = limitsOf(s.gpu?.throttleMask);
    const worst = now[0];
    $("insLimitState").textContent = s.gpu?.throttleMask == null ? "Not available" : worst ? worst.label : "No limit";
    $("insLimitNow").textContent = s.gpu?.throttleMask == null
      ? "This needs an NVIDIA GPU with its driver, and a sensor service that is as new as this app."
      : worst ? worst.text : "The GPU is running without being held back right now.";
    // Only the limits that happened are listed, so the table is not a wall of zeros.
    const hit = GPU_LIMITS.filter((l) => (sess.limitSec[l.bit] ?? 0) > 0 || (day.limitSec[l.bit] ?? 0) > 0);
    const wrap = $("insLimits");
    wrap.replaceChildren(row(["LIMIT", "THIS SESSION", "TODAY"], true),
      ...(hit.length ? hit.map((l) => { const x = row([l.name, clock(sess.limitSec[l.bit] ?? 0), clock(day.limitSec[l.bit] ?? 0)]); x.title = l.text; return x; })
                     : [el("p", "note", "No limit has held the GPU back so far today.")]));
  }

  function paintStats() {
    $("insSessionLen").textContent = "Running for " + clock((Date.now() - sess.start) / 1000);
    const st = sess.stats, T = (b, k) => (b.n ? tf(k === "avg" ? b.sum / b.n : b[k], 0) + deg() : "--");
    const P = (b, k, d, u) => (b.n ? (k === "avg" ? b.sum / b.n : b[k]).toFixed(d) + u : "--");
    const defs = [
      ["CPU temperature", (b, k) => T(b, k), st.cpuTemp], ["GPU temperature", (b, k) => T(b, k), st.gpuTemp],
      ["CPU load", (b, k) => P(b, k, 0, " %"), st.cpuLoad], ["GPU load", (b, k) => P(b, k, 0, " %"), st.gpuLoad],
      ["GPU power", (b, k) => P(b, k, 0, " W"), st.gpuPower], ["RAM used", (b, k) => P(b, k, 1, " GB"), st.ram],
    ];
    $("insStats").replaceChildren(row(["", "LOWEST", "AVERAGE", "HIGHEST"], true), ...defs.map(([name, f, b]) => row([name, f(b, "min"), f(b, "avg"), f(b, "max")])));
  }

  function paint() {
    if (!last) return;
    paintProcs(last); paintPower(last); paintLimits(last); paintStats();
  }

  /* ---- controls ---- */
  const setKey = (k) => {
    procKey = k; store.set("insproc", k);
    document.querySelectorAll("#insProcSeg button").forEach((b) => { const on = b.dataset.k === k; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
    if (last) paintProcs(last);
  };
  document.querySelectorAll("#insProcSeg button").forEach((b) => { b.onclick = () => setKey(b.dataset.k); });
  setKey(procKey in FORMATS ? procKey : "cpu");
  $("insReset").onclick = () => { sess = fresh(); if (last) paint(); };
  $("insTariff").onclick = () => $("btnSettings").click();
  addEventListener("beforeunload", saveDay);

  return {
    setActive(on) { active = on; syncProcs(); if (on) paint(); },
    update,
    /** After a reconnect the service has forgotten what this window asked for. */
    resync() { askedProcs = false; syncProcs(); },
  };
})();
Insights.setActive(store.get("tab", "overview") === "insights");   // the saved tab was restored before this file loaded
