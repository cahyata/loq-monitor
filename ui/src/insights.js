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
  let active = false, last = null, procKey = store.get("insproc", "cpu"), askedProcs = false, askedNet = false, askedAt = 0;
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

  /* ---- network speed history (last 5 minutes), kept from every snapshot ---- */
  const VIRTUAL = /vmware|virtualbox|hyper-v|vethernet|openvpn|wireguard|tap-|loopback|bluetooth|wan miniport/i;
  const netHist = [];
  const NET_KEEP = 300;
  function netRates(s) {
    let d = 0, u = 0;
    for (const h of s.hardware ?? []) {
      if (h.type !== "Network" || VIRTUAL.test(h.name)) continue;
      for (const x of h.sensors) { if (x.name === "Download Speed") d += x.value || 0; else if (x.name === "Upload Speed") u += x.value || 0; }
    }
    return { d, u };
  }
  const rate = (b) => (b >= 1e6 ? (b / 1e6).toFixed(b >= 1e7 ? 0 : 1) + " MB/s" : Math.round(b / 1e3) + " KB/s");

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
    netHist.push(netRates(s)); if (netHist.length > NET_KEEP) netHist.shift();
    const st = sess.stats;
    add(st.cpuTemp, s.cpu?.tempC); add(st.gpuTemp, s.gpu?.tempC); add(st.cpuLoad, s.cpu?.load); add(st.gpuLoad, s.gpu?.load);
    add(st.gpuPower, s.gpu?.powerW); add(st.ram, s.ram?.usedGB);
    if (active && !document.hidden) paint();
  }

  /* ---- what the service should measure ---- */
  const wantNow = () => active && !document.hidden;
  function syncProcs() {
    const want = wantNow();
    if (want !== askedProcs) { askedProcs = want; askedAt = Date.now(); sendWs(want ? "procs-on" : "procs-off"); }
    if (want !== askedNet) { askedNet = want; sendWs(want ? "net-on" : "net-off"); sendWs(want ? "limits-on" : "limits-off"); }
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

  /* ---- power limits card ---- */
  let modes = null, modesAsked = false;
  function loadModes() {
    if (modes || modesAsked) return;
    modesAsked = true;
    fetch("http://127.0.0.1:47821/system").then((r) => r.json()).then((d) => { modes = d.powerModes ?? []; if (last) paintLimitsCard(last); }).catch(() => { modesAsked = false; });
  }

  function lbar(label, value, limit, text, kind) {
    const li = el("li"), top = el("div", "ltop"), track = el("div", "ltrack"), fill = el("i");
    const ratio = limit ? Math.max(0, Math.min(1, value / limit)) : 0;
    fill.style.transform = `scaleX(${ratio})`;
    if (kind === "temp") fill.className = ratio >= 0.97 ? "hot" : ratio >= 0.9 ? "warn" : "";
    top.append(el("span", null, label), el("b", null, text)); track.append(fill); li.append(top, track);
    return li;
  }

  function paintLimitsCard(s) {
    const L = s.limits, bars = $("insPLBars"), mode = { 1: 1, 2: 2, 3: 3 }[s.powerMode] ?? 0;
    const names = { 1: "Quiet", 2: "Balanced", 3: "Performance", 224: "Custom", 255: "Custom" };
    $("insPLMode").textContent = s.powerMode ? "Power mode: " + (names[s.powerMode] ?? "--") : "";
    if (!L) {
      const old = askedAt && Date.now() - askedAt > 12000;
      bars.replaceChildren(el("li", "empty", old ? "No data. The sensor service that is running is older than this app and cannot read the limits." : "Reading the limits..."));
    } else {
      const items = [];
      if (L.cpuSustainedW != null && s.cpu?.powerW != null)
        items.push(lbar("CPU power", s.cpu.powerW, L.cpuPeakW ?? L.cpuSustainedW, `${s.cpu.powerW.toFixed(0)} W of ${L.cpuSustainedW} W sustained${L.cpuPeakW ? ", " + L.cpuPeakW + " W peak" : ""}`));
      if (L.gpuW != null && s.gpu?.powerW != null)
        items.push(lbar("GPU power", s.gpu.powerW, L.gpuW, `${s.gpu.powerW.toFixed(0)} W of ${L.gpuW} W`));
      if (L.cpuTempC != null && s.cpu?.tempC != null)
        items.push(lbar("CPU temperature", s.cpu.tempC, L.cpuTempC, `${tf(s.cpu.tempC)}${deg()} of ${tf(L.cpuTempC)}${deg()}`, "temp"));
      if (L.gpuTempC != null && s.gpu?.tempC != null)
        items.push(lbar("GPU temperature", s.gpu.tempC, L.gpuTempC, `${tf(s.gpu.tempC)}${deg()} of ${tf(L.gpuTempC)}${deg()} slowdown`, "temp"));
      bars.replaceChildren(...items);
    }

    const wrap = $("insPLModes");
    if (modes && modes.length) {
      const row = (cells, head) => {
        const x = el("div", "sysrow modes" + (head ? " head" : "")); x.setAttribute("role", "row");
        cells.forEach((c, i) => { const sp = el("span", i && modes[i - 1] && mode === i ? "now" : null, c); sp.setAttribute("role", head ? "columnheader" : "cell"); x.append(sp); });
        return x;
      };
      const W = (k) => modes.map((m) => (m[k] == null ? "--" : m[k] + " W"));
      wrap.replaceChildren(row(["", ...modes.map((m) => m.name.toUpperCase())], true),
        row(["CPU sustained", ...W("cpuSustainedW")]), row(["CPU short boost", ...W("cpuShortW")]), row(["CPU peak", ...W("cpuPeakW")]),
        row(["GPU base", ...W("gpuBaseW")]), row(["GPU boost", ...W("gpuBoostW")]));
    } else wrap.replaceChildren(el("p", "note", modes ? "This laptop does not list limits per mode." : "Reading..."));

    $("insPLNote").textContent = "These limits come from the laptop firmware (CPU) and the NVIDIA driver (GPU). LOQ Monitor only reads them. Change the power mode with Fn+Q or in Lenovo Vantage. When power sits at its limit the chip is held back, which is normal under heavy load."
      + (s.powerMode === 224 || s.powerMode === 255 ? " Custom mode uses your own values, so the table shows only the defaults of the other modes." : "");
  }

  /* ---- network card ---- */
  let netMask = store.get("insmask", "on") === "on";
  const hideIf = (t) => (netMask ? "hidden" : t);
  const BAR_COUNT = 5;
  function bars(pct) {
    const on = Math.max(1, Math.min(BAR_COUNT, Math.ceil(pct / 20)));
    const wrap = el("span", "bars"); wrap.setAttribute("aria-hidden", "true");
    for (let i = 0; i < BAR_COUNT; i++) wrap.append(el("span", i < on ? null : "off", "\u25AE"));
    return wrap;
  }

  /** A round number above the peak, for the top of the speed chart. */
  function niceTop(peak) {
    const exp = 10 ** Math.floor(Math.log10(peak)), m = peak / exp;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * exp;
  }

  function paintNetChart() {
    const cv = $("insNetChart"), dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const cs = getComputedStyle(document.documentElement);
    const cyan = cs.getPropertyValue("--accent-secondary").trim(), pink = cs.getPropertyValue("--accent-primary").trim(), grid = cs.getPropertyValue("--divider").trim(), muted = cs.getPropertyValue("--text-muted").trim();
    const peak = Math.max(1e5, ...netHist.map((p) => Math.max(p.d, p.u)));
    const top = niceTop(peak);
    const L = 58, R = 4, T = 8, B = 4, pw = w - L - R, ph = h - T - B;
    g.font = "11px " + (cs.getPropertyValue("--font-mono").trim() || "monospace"); g.textBaseline = "middle"; g.lineWidth = 1;
    for (const f of [0, 0.5, 1]) {
      const y = T + ph * (1 - f);
      g.strokeStyle = grid; g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke();
      g.fillStyle = muted; g.fillText(rate(top * f), 0, Math.min(h - 6, Math.max(8, y)));
    }
    const x = (i) => L + (pw * i) / (NET_KEEP - 1), y = (v) => T + ph * (1 - Math.min(1, v / top));
    const off = NET_KEEP - netHist.length;
    for (const [key, color, fill] of [["u", pink, false], ["d", cyan, true]]) {
      if (!netHist.length) break;
      g.beginPath();
      netHist.forEach((p, i) => (i ? g.lineTo(x(i + off), y(p[key])) : g.moveTo(x(i + off), y(p[key]))));
      g.strokeStyle = color; g.lineWidth = 1.5; g.stroke();
      if (fill) { g.lineTo(x(netHist.length - 1 + off), T + ph); g.lineTo(x(off), T + ph); g.closePath(); g.globalAlpha = 0.15; g.fillStyle = color; g.fill(); g.globalAlpha = 1; }
    }
    const peakD = Math.max(0, ...netHist.map((p) => p.d)), peakU = Math.max(0, ...netHist.map((p) => p.u));
    $("insNetCap").textContent = `last ${netHist.length < 60 ? netHist.length + " s" : Math.floor(netHist.length / 60) + " min"} \u00B7 peak down ${rate(peakD)} \u00B7 peak up ${rate(peakU)}`;
    cv.setAttribute("aria-label", "Download and upload speed. " + $("insNetCap").textContent);
  }

  /** One sentence for the verdict, worst problem first. Router trouble outranks DNS trouble. */
  function verdict(n) {
    const g = n.gateway, d = n.dns;
    if (!g) return { level: "", label: "No connection", text: "No network with a gateway was found. Check the cable or the Wi-Fi." };
    if (g.lossPct >= 10 || (g.avgMs ?? 0) > 100) return { level: "hot", label: "Problem", text: "The router drops replies or answers slowly. The problem is on your side: the Wi-Fi signal, the router, or this laptop's network adapter." };
    if ((g.avgMs ?? 0) > 30 || (g.jitterMs ?? 0) > 15 || g.lossPct > 0) return { level: "warn", label: "Unsteady", text: "The connection to the router is not steady. On Wi-Fi this usually means a weak signal or interference. Try moving closer or using the 5 GHz band." };
    if (d && d.ip !== g.ip && (d.lossPct >= 10 || (d.avgMs ?? 0) > 150)) return { level: "warn", label: "DNS slow", text: "The router is fine, but the DNS server is slow or does not answer. Pages may take long to start loading. Try another DNS server." };
    return { level: "ok", label: "Looks good", text: "The router answers quickly and steadily. If something online is slow, the cause is beyond your router: your provider or the site itself." };
  }

  function paintNetwork(s) {
    const r = netRates(s);
    $("insDown").textContent = rate(r.d); $("insUp").textContent = rate(r.u);
    $("insDown").title = ((r.d * 8) / 1e6).toFixed(1) + " Mbps"; $("insUp").title = ((r.u * 8) / 1e6).toFixed(1) + " Mbps";
    paintNetChart();
    $("insNetMask").textContent = netMask ? "SHOW NETWORK NAME AND ADDRESSES" : "HIDE NETWORK NAME AND ADDRESSES";

    const n = s.network, wifi = $("insWifi"), ping = $("insPing"), vd = $("insNetVerdict");
    if (!n) {
      const old = askedAt && Date.now() - askedAt > 12000;
      vd.textContent = ""; vd.className = "dim"; wifi.replaceChildren(); ping.replaceChildren();
      $("insNetNote").textContent = old ? "No data. The sensor service that is running is older than this app and cannot measure the network." : "Measuring... the first numbers appear in a few seconds.";
      return;
    }
    const v = verdict(n);
    vd.textContent = v.label; vd.className = "dim " + v.level;
    $("insNetNote").textContent = v.text + (n.adapter ? " Measured through " + n.adapter + "." : "");

    if (n.wifi) {
      const w = n.wifi, q = w.signalPct, word = q >= 80 ? "Excellent" : q >= 60 ? "Good" : q >= 40 ? "Fair" : "Weak";
      const sig = el("dd"); sig.append(bars(q), document.createTextNode("  " + q + " %  " + word));
      wifi.replaceChildren(
        el("dt", null, "Network"), el("dd", null, hideIf(w.ssid)),
        el("dt", null, "Signal"), sig,
        el("dt", null, "Link speed"), el("dd", null, w.rxMbps + " down, " + w.txMbps + " up Mbps"),
        el("dt", null, "Standard"), el("dd", null, w.standard),
        el("dt", null, "Channel"), el("dd", null, w.channel ? w.channel + (w.band ? " (" + w.band + ")" : "") : "--"));
    } else {
      wifi.replaceChildren(el("dt", null, "Wi-Fi"), el("dd", null, "Not connected by Wi-Fi."));
    }

    const row = (cells, head) => {
      const x = el("div", "sysrow net" + (head ? " head" : "")); x.setAttribute("role", "row"); x.style.setProperty("--cols", String(cells.length));
      cells.forEach((c) => { const sp = el("span", null, c); sp.setAttribute("role", head ? "columnheader" : "cell"); x.append(sp); });
      return x;
    };
    const ms = (x) => (x == null ? "--" : x < 1 ? "<1 ms" : (Number.isInteger(x) ? x : x.toFixed(1)) + " ms");
    const line = (label, p) => (p ? row([label, p.rttMs == null ? "lost" : ms(p.rttMs), ms(p.avgMs), ms(p.jitterMs), p.lossPct + " %"]) : null);
    const rows = [row(["TARGET", "NOW", "AVERAGE", "JITTER", "LOSS"], true), line("Router" + (netMask ? "" : " " + (n.gateway?.ip ?? "")), n.gateway)];
    if (n.dns && n.dns.ip !== n.gateway?.ip) rows.push(line("DNS" + (netMask ? "" : " " + n.dns.ip), n.dns));
    ping.replaceChildren(...rows.filter(Boolean));
    if (n.dns && n.dns.ip === n.gateway?.ip) ping.append(el("p", "note", "The DNS server is the router, so one measurement covers both."));
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
    paintProcs(last); paintPower(last); paintLimits(last); paintLimitsCard(last); paintNetwork(last); paintStats();
  }

  /* ---- controls ---- */
  const setKey = (k) => {
    procKey = k; store.set("insproc", k);
    document.querySelectorAll("#insProcSeg button").forEach((b) => { const on = b.dataset.k === k; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
    if (last) paintProcs(last);
  };
  document.querySelectorAll("#insProcSeg button").forEach((b) => { b.onclick = () => setKey(b.dataset.k); });
  setKey(procKey in FORMATS ? procKey : "cpu");
  $("insNetMask").onclick = () => { netMask = !netMask; store.set("insmask", netMask ? "on" : "off"); if (last) paintNetwork(last); };
  $("insReset").onclick = () => { sess = fresh(); if (last) paint(); };
  $("insTariff").onclick = () => $("btnSettings").click();
  addEventListener("beforeunload", saveDay);

  return {
    setActive(on) { active = on; syncProcs(); if (on) { loadModes(); paint(); } },
    update,
    /** After a reconnect the service has forgotten what this window asked for. */
    resync() { askedProcs = false; askedNet = false; syncProcs(); },
  };
})();
Insights.setActive(store.get("tab", "overview") === "insights");   // the saved tab was restored before this file loaded
