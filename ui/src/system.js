// LOQ Monitor | System page
// Author: cahyata
// Copyright (c) 2026 cahyata
"use strict";
/* The SYSTEM tab: facts about the machine (device, firmware, Windows, processor, graphics, memory,
   drives, network, battery). The service reads them from Windows once and serves them at /system,
   so this page asks when it is opened and again on REFRESH. A few values (uptime, memory in use,
   battery health) stay live from the sensor snapshot. Shares $ and store with main.js. */

(() => {
  const SYSTEM_URL = "http://127.0.0.1:47821/system";
  let data = null, last = null, fetchedAt = 0, loading = false;
  let mask = store.get("sysmask", "on") === "on", showVirtual = store.get("sysvirtual", "off") === "on";

  const GB = (b) => (b == null ? "--" : (b / 1024 ** 3).toFixed(b >= 100 * 1024 ** 3 ? 0 : 1) + " GB");
  const dash = (v) => (v == null || v === "" ? "--" : String(v));
  const hide = (text) => (mask ? "hidden" : text);
  const when = (ms) => (ms ? new Date(ms).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "--");
  function uptime(boot) {
    if (!boot) return "--";
    const s = Math.max(0, Math.floor((Date.now() - boot) / 1000)), d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
    return (d ? d + " d " : "") + h + " h " + m + " min";
  }

  /** A card is a title, an accent color, and rows of [label, value]. A row with a `live` key refreshes from the snapshot. */
  function cards() {
    if (!data) return [];
    const d = data.device ?? {}, f = data.firmware ?? {}, o = data.os ?? {}, c = data.cpu ?? {}, b = data.battery;
    const gpus = data.gpus ?? [], mem = data.memory ?? [];
    const out = [];

    out.push({ title: "DEVICE", color: "cyan", rows: [
      ["Model", [d.productName ?? d.family, d.model && "(" + d.model + ")"].filter(Boolean).join(" ")],
      ["Manufacturer", d.manufacturer], ["Host name", hide(d.name)], ["System type", d.type],
      ["Mainboard", [d.board?.manufacturer, d.board?.product].filter(Boolean).join(" ")],
    ] });

    out.push({ title: "FIRMWARE", color: "pink", rows: [
      ["BIOS version", f.bios?.version], ["BIOS date", f.bios?.releaseDate], ["BIOS vendor", f.bios?.vendor], ["SMBIOS", f.bios?.smbios],
      ["Boot mode", f.uefi == null ? null : f.uefi ? "UEFI" : "Legacy BIOS"], ["Secure Boot", f.secureBoot == null ? null : f.secureBoot ? "On" : "Off"],
    ] });

    out.push({ title: "OPERATING SYSTEM", color: "yellow", rows: [
      ["Edition", o.name], ["Version", [o.release, o.build && "build " + o.build + (o.revision ? "." + o.revision : "")].filter(Boolean).join(", ")],
      ["Architecture", o.architecture], ["Installed", o.installed], ["Last boot", when(o.bootTime)], ["Uptime", uptime(o.bootTime), "uptime"],
    ] });

    out.push({ title: "PROCESSOR", color: "green", rows: [
      ["Name", c.name], ["Vendor", c.vendor], ["Cores and threads", c.cores ? c.cores + " cores, " + c.threads + " threads" : null],
      ["Base clock", c.maxMHz ? (c.maxMHz / 1000).toFixed(2) + " GHz" : null],
      ["Cache", c.l2KB ? "L2 " + (c.l2KB / 1024).toFixed(0) + " MB, L3 " + (c.l3KB / 1024).toFixed(0) + " MB" : null],
      ["Socket", c.socket], ["Virtualization", c.virtualization == null ? null : c.virtualization ? "Enabled in firmware" : "Off"],
    ] });

    for (const g of gpus) {
      out.push({ title: "GRAPHICS", color: "pink", rows: [
        ["Name", g.name], ["Vendor", g.vendor], ["Driver", [g.driver, g.driverDate && "(" + g.driverDate + ")"].filter(Boolean).join(" ")],
        ["Video memory", null, "vram"], ["Display", g.width ? g.width + " x " + g.height + (g.refreshHz ? " at " + g.refreshHz + " Hz" : "") : null],
      ] });
    }

    if (b) {
      out.push({ title: "BATTERY", color: "yellow", rows: [
        ["Model", b.name], ["Design capacity", null, "batDesign"], ["Full charge capacity", null, "batFull"], ["Health", null, "batHealth"],
        ["Charge cycles", b.cycleCount], ["Design voltage", b.designMilliVolts ? (b.designMilliVolts / 1000).toFixed(1) + " V" : null],
      ] });
    }

    const total = mem.reduce((a, m) => a + (m.bytes ?? 0), 0);
    out.push({ title: "MEMORY", color: "orange", wide: true, rows: [
      ["Installed", total ? GB(total) + " in " + mem.length + " module" + (mem.length === 1 ? "" : "s") : null],
      ["In use", null, "ram"],
    ], table: { head: ["SLOT", "SIZE", "TYPE", "SPEED", "MAKER", "PART"], rows: mem.map((m, i) => [
      "Module " + (i + 1), GB(m.bytes), [m.type, m.formFactor].filter(Boolean).join(" "), m.speedMTs ? m.speedMTs + " MT/s" : "--", m.manufacturer, m.partNumber]) } });

    const vol = data.volumes ?? [];
    out.push({ title: "STORAGE", color: "cyan", wide: true, rows: [], table: { head: ["DRIVE", "TYPE", "SIZE", "HEALTH", "FIRMWARE"], rows: (data.drives ?? []).map((x) => [
      x.name, [x.media, x.bus].filter(Boolean).join(" "), GB(x.bytes), x.health, x.firmware]) },
      table2: { head: ["VOLUME", "LABEL", "FILE SYSTEM", "SIZE", "FREE"], rows: vol.map((v) => [
        v.drive, v.label, v.fileSystem, GB(v.bytes), v.bytes ? GB(v.freeBytes) + " (" + Math.round((v.freeBytes / v.bytes) * 100) + "%)" : "--"]) } });

    const nets = (data.network ?? []).filter((n) => showVirtual || !Rules.isVirtualAdapter((n.name ?? "") + " " + (n.connection ?? "")));
    out.push({ title: "NETWORK", color: "green", wide: true, rows: [], table: { head: ["ADAPTER", "CONNECTION", "SPEED", "IPV4", "GATEWAY", "MAC"], rows: nets.map((n) => {
      const v4 = (n.ip ?? []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
      return [n.name, n.connection, n.speedMbps ? n.speedMbps + " Mbps" : "--", hide(v4 ?? "--"), hide(n.gateway ?? "--"), hide(n.mac ?? "--")];
    }) } });

    return out;
  }

  /** Values that come from the live snapshot instead of the one-time read. */
  function liveValue(key) {
    const s = last;
    switch (key) {
      case "uptime": return uptime(data?.os?.bootTime);
      case "vram": return s?.gpu?.vramTotalMB ? (s.gpu.vramTotalMB / 1024).toFixed(0) + " GB" : "--";
      case "ram": return s?.ram?.usedGB == null ? "--" : s.ram.usedGB.toFixed(1) + " GB used, " + (s.ram.availableGB ?? 0).toFixed(1) + " GB free (" + Math.round(s.ram.loadPct) + "%)";
      case "batDesign": return s?.battery?.designedWh ? s.battery.designedWh.toFixed(1) + " Wh" : "--";
      case "batFull": return s?.battery?.fullWh ? s.battery.fullWh.toFixed(1) + " Wh" : "--";
      case "batHealth": return s?.battery ? (100 - (s.battery.degradationPct ?? 0)).toFixed(1) + " %" : "--";
      default: return "--";
    }
  }

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function table(t) {
    const wrap = el("div", "systable"); wrap.setAttribute("role", "table");
    const row = (cells, head) => {
      const r = el("div", "sysrow" + (head ? " head" : "")); r.setAttribute("role", "row"); r.style.setProperty("--cols", String(cells.length));
      cells.forEach((c) => { const x = el("span", null, dash(c)); x.setAttribute("role", head ? "columnheader" : "cell"); x.title = dash(c); r.append(x); });
      return r;
    };
    wrap.append(row(t.head, true), ...t.rows.map((r) => row(r)));
    if (!t.rows.length) wrap.append(el("p", "note", "Nothing reported."));
    return wrap;
  }

  function render() {
    const grid = $("sysGrid");
    if (!data) { grid.replaceChildren(); return; }
    grid.replaceChildren(...cards().map((c) => {
      const sec = el("section", "panel mini " + c.color + (c.wide ? " wide" : ""));
      const ph = el("div", "ph"); ph.append(el("h2", "ptit", c.title)); sec.append(ph);
      if (c.rows.length) {
        const dl = el("dl", "kv");
        for (const [label, value, live] of c.rows) {
          const dt = el("dt", null, label), dd = el("dd", null, live ? liveValue(live) : dash(value));
          if (live) dd.dataset.live = live;
          dl.append(dt, dd);
        }
        sec.append(dl);
      }
      if (c.table) sec.append(table(c.table));
      if (c.table2) sec.append(table(c.table2));
      return sec;
    }));
    $("sysWhen").textContent = "Read at " + new Date(data.collectedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  function refreshLive() {
    document.querySelectorAll("#sysGrid dd[data-live]").forEach((dd) => { dd.textContent = liveValue(dd.dataset.live); });
  }

  /** Plain text of everything on the page, for pasting into a message or a forum post. */
  function report() {
    const lines = ["LOQ Monitor system report", ""];
    for (const c of cards()) {
      lines.push(c.title);
      for (const [label, value, live] of c.rows) lines.push("  " + label + ": " + dash(live ? liveValue(live) : value));
      for (const t of [c.table, c.table2].filter(Boolean)) {
        lines.push("  " + t.head.join(" | "));
        t.rows.forEach((r) => lines.push("  " + r.map(dash).join(" | ")));
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  const say = (t) => { $("sysMsg").textContent = t; };

  async function load(force) {
    if (loading) return;
    loading = true;
    if (!data) say("Reading system information...");
    try {
      const res = await fetch(SYSTEM_URL + (force ? "?refresh=1" : ""));
      if (!res.ok) throw new Error("HTTP " + res.status);
      data = await res.json(); fetchedAt = Date.now();
      say(""); render();
    } catch (e) {
      say(data ? "Could not refresh: " + e.message : "Could not read the system information. Is the sensor service running? (" + e.message + ")");
    } finally { loading = false; }
  }

  $("sysMask").checked = mask;
  $("sysMask").onchange = () => { mask = $("sysMask").checked; store.set("sysmask", mask ? "on" : "off"); render(); };
  $("sysVirtual").checked = showVirtual;
  $("sysVirtual").onchange = () => { showVirtual = $("sysVirtual").checked; store.set("sysvirtual", showVirtual ? "on" : "off"); render(); };
  $("sysRefresh").onclick = () => load(true);
  $("sysCopy").onclick = async () => {
    try { await navigator.clipboard.writeText(report()); say("Report copied" + (mask ? ", with addresses hidden." : ". It includes your host name and addresses.")); }
    catch { say("Could not copy. Select the text on the page instead."); }
  };

  Pages.add("system", {
    show() {
      if (!data || Date.now() - fetchedAt > 60000) load(data != null);   // reopen: refresh drive space after a minute
      else render();
    },
    draw(s) { last = s; refreshLive(); },
  });
})();
