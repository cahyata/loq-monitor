// LOQ Monitor | Diagnosis tab
// Author: cahyata
// Copyright (c) 2026 cahyata
"use strict";
/* The DIAGNOSIS tab: the times a temperature passed its limit (kept across restarts), the problems
   Windows recorded in its Event Log, and the export of the recent sensor readings to a CSV file.
   The history and the readings are collected from every snapshot, also while another tab or the tray
   is showing. The Event Log is read by the service only when this tab asks for it.
   Shares $, store, CFG, tf, tdeg, deg, conv, unit, modeLabel, Link and invoke with main.js. */

(() => {
  let lastTs = 0, drawn = null;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const when = (ms) => new Date(ms).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const span = (sec) => { const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return h ? h + " h " + String(m).padStart(2, "0") + " min" : m ? m + " min " + String(s % 60).padStart(2, "0") + " s" : s + " s"; };
  const times = (n) => n + (n === 1 ? " time" : " times");
  function line(cls, cells, head) {
    const r = el("div", "sysrow " + cls + (head ? " head" : "")); r.setAttribute("role", "row");
    cells.forEach((c) => { const x = el("span"); x.append(c); x.setAttribute("role", head ? "columnheader" : "cell"); r.append(x); });
    return r;
  }

  /* ---- heat history ---- */
  const SENSORS = [["cpu", "CPU", (s) => s.cpu?.tempC, () => CFG.hot], ["gpu", "GPU", (s) => s.gpu?.tempC, () => CFG.hot], ["spot", "GPU hotspot", (s) => s.gpu?.hotspotC, () => CFG.spot]];
  const LOG_MAX = 500, SHOWN = 15;
  const MERGE_MS = 10_000;   // a dip shorter than this does not start a new entry
  const GAP_MS = 15_000;     // readings stopped (sleep, lost connection): the entry ends at the last one
  let log = (() => {
    try { const v = JSON.parse(store.get("heatlog", "[]")); return Array.isArray(v) ? v.filter((x) => x && Number.isFinite(x.t) && Number.isFinite(x.p)) : []; } catch { return []; }
  })();
  const live = {};           // per sensor: the episode that is running now
  let savedAt = 0, showAll = false, heatDirty = true;
  const save = () => { savedAt = Date.now(); store.set("heatlog", JSON.stringify(log)); };

  function track(s, now) {
    let ended = false;
    for (const [key, , read, limitOf] of SENSORS) {
      const v = read(s), limit = limitOf();
      let st = live[key];
      if (st && now - st.seen > GAP_MS) { delete live[key]; st = null; ended = true; heatDirty = true; }
      const over = v != null && v >= limit;
      if (over) {
        st ??= live[key] = { run: null, kept: false, rec: { s: key, t: now, e: now, p: v, l: limit, m: s.powerMode ?? null } };
        st.run ??= now;
        const r = st.rec;
        r.e = now;
        if (v > r.p) { r.p = v; r.m = s.powerMode ?? null; heatDirty = true; }
        // An entry is kept once the heat lasted as long as a notification needs: "Alert delay" in Settings.
        if (!st.kept && now - st.run >= CFG.hold * 1000) {
          st.kept = true; log.push(r); if (log.length > LOG_MAX) log = log.slice(-LOG_MAX);
          save(); heatDirty = true;
        }
      } else if (st) {
        st.run = null;
        if (now - st.rec.e >= MERGE_MS) { delete live[key]; ended = true; heatDirty = true; }
      }
      if (st) st.seen = now;
    }
    const running = Object.values(live).some((st) => st.kept);
    if (running) heatDirty = true;
    if (ended || (running && Date.now() - savedAt > 10_000)) save();
  }

  const NAME = Object.fromEntries(SENSORS.map(([k, n]) => [k, n]));
  function paintHeat() {
    heatDirty = false;
    const wrap = $("diagHeat"), week = Date.now() - 7 * 86_400_000;
    const recent = log.filter((r) => r.e >= week);
    const state = $("diagHeatState");
    state.textContent = log.length ? log.length + (log.length === 1 ? " entry" : " entries") : "";
    const by = SENSORS.map(([k, n]) => [n, recent.filter((r) => r.s === k).length]).filter(([, n]) => n);
    $("diagHeatSum").textContent = recent.length
      ? `Last 7 days: ${times(recent.length)} above the limit (${by.map(([n, c]) => n + " " + c).join(", ")}). Highest ${tdeg(Math.max(...recent.map((r) => r.p)))}.`
      : log.length ? "No temperature passed its limit in the last 7 days." : "No temperature has passed its limit since the app started keeping this history.";
    $("diagHeatMore").hidden = log.length <= SHOWN;
    $("diagHeatMore").textContent = showAll ? "SHOW NEWEST ONLY" : "SHOW ALL";
    $("diagHeatClear").hidden = !log.length;
    if (!log.length) { wrap.replaceChildren(); return; }
    const running = new Set(Object.values(live).filter((st) => st.kept).map((st) => st.rec));
    const rows = log.slice().sort((a, b) => b.t - a.t).slice(0, showAll ? LOG_MAX : SHOWN).map((r) => {
      const name = el("span", null, NAME[r.s] ?? r.s);
      const peak = el("span", "hot", tdeg(r.p));
      const length = running.has(r) ? el("span", "hot", span((r.e - r.t) / 1000) + ", now") : span((r.e - r.t) / 1000);
      return line("heatrow", [when(r.t), name, peak, tdeg(r.l), length, modeLabel(r.m)]);
    });
    wrap.replaceChildren(line("heatrow", ["STARTED", "SENSOR", "PEAK", "LIMIT", "LASTED", "POWER MODE"], true), ...rows);
  }

  confirmTwice($("diagHeatClear"), "CLICK AGAIN TO CLEAR", () => { log = []; for (const k of Object.keys(live)) delete live[k]; showAll = false; save(); paintHeat(); });
  $("diagHeatMore").onclick = () => { showAll = !showAll; paintHeat(); };

  /* ---- Windows problems ---- */
  const KINDS = [["hardware", "Hardware errors"], ["crash", "Blue screens and sudden shutdowns"], ["graphics", "Graphics driver errors"], ["drive", "Drive errors"]];
  let days = [7, 30, 90].includes(+store.get("evdays", "30")) ? +store.get("evdays", "30") : 30;
  let events = null, eventsFor = 0, eventsAt = 0, loading = false;

  const say = (t) => { $("diagEvMsg").textContent = t; };

  async function load(force) {
    if (loading) return;
    loading = true;
    const asked = days;
    $("diagEvRefresh").disabled = true;
    if (!events || eventsFor !== asked) say("Reading the Windows Event Log...");
    try {
      events = await Link.events(asked, force); eventsFor = asked; eventsAt = Date.now();
      say(events.failed?.length ? "Windows did not let the service read this log: " + events.failed.join(", ") + "." : "");
      paintEvents();
    } catch (e) {
      say(e.reason === "older" ? "The sensor service that is running is older than this app and cannot read the Event Log. Update LOQ Monitor, or restart the service from the new install."
        : e.reason === "unreachable" ? "Could not reach the sensor service."
        : e.reason === "http" ? "The service answered with HTTP " + e.status + "."
        : e.message);
      if (eventsFor !== asked) { events = null; paintEvents(); }
    } finally {
      loading = false; $("diagEvRefresh").disabled = false;
      if (days !== asked) load(false);       // the period changed while this one was being read
    }
  }

  const PROGRAMS_SHOWN = 8;
  let allPrograms = false;
  function paintEvents() {
    const tiles = $("diagTiles"), list = $("diagEvents"), progs = $("diagPrograms"), more = $("diagProgMore");
    $("diagProgTitle").hidden = !events;
    more.hidden = !events || events.programs.length <= PROGRAMS_SHOWN;
    more.textContent = allPrograms ? "SHOW FEWER PROGRAMS" : events ? "SHOW ALL " + events.programs.length + " PROGRAMS" : "";
    if (!events) { tiles.replaceChildren(); list.replaceChildren(); progs.replaceChildren(); $("diagEvState").textContent = ""; return; }
    $("diagEvState").textContent = "Read at " + new Date(events.collectedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    tiles.replaceChildren(...KINDS.map(([kind, label]) => {
      const mine = events.events.filter((x) => x.kind === kind);
      const level = mine.some((x) => x.level === "hot") ? "hot" : mine.length ? "warn" : "ok";
      const t = el("div", "tile"); t.append(el("b", "bignum " + level, String(mine.length)), el("span", null, label)); return t;
    }));

    // Each blue screen or shutdown keeps its own line, because the time matters. Repeats of the rest are added together.
    const groups = new Map();
    for (const x of events.events) {
      const key = x.kind === "crash" ? String(x.time) + x.title : [x.kind, x.title, x.detail, x.id].join("|");
      const g = groups.get(key) ?? { ...x, count: 0, last: 0 };
      g.count++; g.last = Math.max(g.last, x.time); groups.set(key, g);
    }
    const rows = [...groups.values()].sort((a, b) => b.last - a.last).map((g) => {
      const what = el("span", "evwhat"); what.append(el("b", g.level, g.title));
      if (g.detail) what.append(el("small", null, g.detail));
      const r = line("evrow", [what, times(g.count), when(g.last)]);
      r.title = "Windows event " + g.id + " from " + g.source;
      return r;
    });
    list.replaceChildren(...(rows.length ? [line("evrow", ["WHAT HAPPENED", "HOW OFTEN", "LAST"], true), ...rows]
      : [el("p", "note", `Windows recorded no hardware, crash, graphics driver or drive problem in the last ${events.days} days.`)]));

    progs.replaceChildren(...(events.programs.length
      ? [line("progrow", ["PROGRAM", "CRASHED", "NOT RESPONDING", "LAST", "FAULTY FILE"], true), ...events.programs.slice(0, allPrograms ? Infinity : PROGRAMS_SHOWN).map((p) => {
          const r = line("progrow", [p.name, String(p.crashes), String(p.hangs), when(p.last), p.module ?? "--"]);
          r.title = p.name + (p.code ? "\nException code " + p.code : "");
          return r;
        })]
      : [el("p", "note", `No program crashed or stopped responding in the last ${events.days} days.`)]));
  }

  $("diagProgMore").onclick = () => { allPrograms = !allPrograms; paintEvents(); };
  $("diagEvDays").value = String(days);
  $("diagEvDays").onchange = () => { days = +$("diagEvDays").value; store.set("evdays", String(days)); load(false); };
  $("diagEvRefresh").onclick = () => load(true);

  /* ---- CSV export ---- */
  const KEEP = 6 * 3600;     // one reading per second
  const rows = [];           // each row: [time, ...values in the order of COLUMNS, ...one temperature per drive]
  let driveNames = [];
  // [header, reader, true when the value is a temperature]
  const COLUMNS = [
    ["cpu_temp", (s) => s.cpu?.tempC, true], ["cpu_load_pct", (s) => s.cpu?.load], ["cpu_clock_mhz", (s) => s.cpu?.clockMHz], ["cpu_power_w", (s) => s.cpu?.powerW], ["cpu_fan_rpm", (s) => s.cpu?.fanRpm],
    ["gpu_temp", (s) => s.gpu?.tempC, true], ["gpu_hotspot", (s) => s.gpu?.hotspotC, true], ["gpu_vram_temp", (s) => s.gpu?.vramTempC, true], ["gpu_load_pct", (s) => s.gpu?.load], ["gpu_power_w", (s) => s.gpu?.powerW],
    ["gpu_clock_mhz", (s) => s.gpu?.coreClockMHz], ["gpu_mem_clock_mhz", (s) => s.gpu?.memClockMHz], ["gpu_fan_rpm", (s) => s.gpu?.fanRpm], ["vram_used_mb", (s) => s.gpu?.vramUsedMB],
    ["ram_used_gb", (s) => s.ram?.usedGB], ["ram_load_pct", (s) => s.ram?.loadPct], ["battery_pct", (s) => s.battery?.levelPct], ["battery_w", (s) => s.battery?.rateW], ["power_mode", (s) => Rules.powerMode(s.powerMode)?.toUpperCase()],
  ];

  function keep(s, now) {
    const drives = s.storage ?? [];
    if (drives.length > driveNames.length) driveNames = drives.map((d) => d.name);
    rows.push([now, ...COLUMNS.map(([, read]) => read(s) ?? null), ...drives.map((d) => d.tempC ?? null)]);
    if (rows.length > KEEP) rows.shift();
  }

  // Excel splits a CSV file on the list separator of Windows. Where the decimal mark is a comma, that is the semicolon.
  let format = store.get("csvfmt", "") || ((1.5).toLocaleString().includes(",") ? "semi" : "comma");
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

  function csv(list) {
    const sep = format === "semi" ? ";" : ",", u = unit.toLowerCase();
    const quote = (t) => (/[";,\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t);
    const num = (v, temp) => {
      if (v == null) return "";
      if (typeof v !== "number") return quote(String(v));
      const t = String(Math.round((temp ? conv(v) : v) * 10) / 10);
      return format === "semi" ? t.replace(".", ",") : t;
    };
    const head = ["time", ...COLUMNS.map(([name, , temp]) => (temp ? name + "_" + u : name)), ...driveNames.map((n) => `drive_temp_${u} (${n})`)];
    const body = list.map((r) => [stamp(r[0]), ...COLUMNS.map(([, , temp], i) => num(r[i + 1], temp)), ...driveNames.map((_, i) => num(r[COLUMNS.length + 1 + i], true))].join(sep));
    return "﻿" + [head.map(quote).join(sep), ...body].join("\r\n") + "\r\n";
  }

  const chosen = () => { const sec = +$("diagRange").value; return sec ? rows.slice(-sec) : rows; };
  let savedPath = null;
  function paintExport() {
    const first = rows[0]?.[0];
    $("diagKept").textContent = rows.length ? span(rows.length) + " of readings" : "";
    $("diagCsv").disabled = !rows.length;
    $("diagExportNote").textContent = rows.length ? `${chosen().length.toLocaleString("en-US")} rows would be saved. The oldest reading is from ${when(first)}.` : "No readings yet.";
  }

  $("diagRange").onchange = paintExport;
  $("diagFormat").value = format;
  $("diagFormat").onchange = () => { format = $("diagFormat").value; store.set("csvfmt", format); };
  $("diagCsv").onclick = async () => {
    const list = chosen();
    if (!list.length) return;
    const name = "loq-monitor-" + stamp(Date.now()).replace(/[-:]/g, "").replace(" ", "-") + ".csv";
    const msg = $("diagCsvMsg");
    $("diagReveal").hidden = true; savedPath = null;
    try {
      if (invoke) {
        savedPath = await invoke("save_csv", { name, content: csv(list) });
        msg.textContent = "Saved " + list.length.toLocaleString("en-US") + " rows to " + savedPath;
        $("diagReveal").hidden = false;
      } else {
        const a = el("a"); a.href = URL.createObjectURL(new Blob([csv(list)], { type: "text/csv" })); a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
        msg.textContent = "Downloaded " + name;
      }
    } catch (e) { msg.textContent = "Could not save the file: " + e; }
  };
  $("diagReveal").onclick = () => { if (savedPath) invoke("reveal_file", { path: savedPath }).catch((e) => { $("diagCsvMsg").textContent = "Could not open the folder: " + e; }); };

  /* ---- every snapshot ---- */
  function collect(s) {
    const now = s.ts || Date.now();
    if (now === lastTs) return;
    lastTs = now;
    track(s, now); keep(s, now);
  }

  function draw(s) {
    if (heatDirty || s === drawn) paintHeat();   // the same snapshot again means the unit or a limit may have changed
    drawn = s;
    paintExport();
  }

  addEventListener("beforeunload", save);

  Pages.add("diagnosis", {
    collect,
    draw,
    show() {
      paintHeat(); paintExport();
      if (!events || eventsFor !== days || Date.now() - eventsAt > 60_000) load(false);
    },
  });
})();
