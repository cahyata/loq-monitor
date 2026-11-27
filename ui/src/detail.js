// LOQ Monitor | UI Detailed tab
// Author: cahyata
// Copyright (c) 2026 cahyata
"use strict";
/* Detailed tab: every sensor the service reports, grouped by hardware like HWMonitor.
   Shares $, fmt, store and CFG with main.js (classic scripts share one global scope); rules.js colors the readings. */

const Detail = (() => {
  const UNITS = { Voltage: "V", Current: "A", Power: "W", Clock: "MHz", Temperature: "°C", Load: "%", Frequency: "Hz",
    Fan: "RPM", Flow: "L/h", Control: "%", Level: "%", Factor: "", Data: "GB", SmallData: "MB", Throughput: "MB/s",
    TimeSpan: "s", Energy: "mWh", Noise: "dBA", Conductivity: "µS/cm", Humidity: "%" };
  const ORDER = ["Voltage", "Current", "Power", "Clock", "Temperature", "Load", "Fan", "Control", "Level", "Factor",
    "Data", "SmallData", "Throughput", "Energy", "Frequency", "Flow", "TimeSpan", "Noise", "Humidity", "Conductivity"];
  const NAMES = { Voltage: "Voltages", Current: "Currents", Power: "Powers", Clock: "Clocks", Temperature: "Temperatures",
    Load: "Utilization", Fan: "Fans", Control: "Controls", Level: "Levels", Factor: "Factors", Data: "Data",
    SmallData: "Small data", Throughput: "Throughput", Energy: "Energy", Frequency: "Frequencies", Flow: "Flow",
    TimeSpan: "Time", Noise: "Noise", Humidity: "Humidity", Conductivity: "Conductivity" };

  const open = new Set(["Favorites", "Lenovo embedded controller", "ACPI thermal zones"]); // expanded sections survive refreshes
  let sig = "", last = null;
  let sort = store.get("dsort", "default"), hideNet = store.get("dhide", "on") === "on";
  const idleNet = (h) => h.type === "Network" && (Rules.isVirtualAdapter(h.name) || h.sensors.every((x) => !x.value));
  const shown = (s) => s.hardware.filter((h) => !(hideNet && idleNet(h)));

  const rank = (t) => { const i = ORDER.indexOf(t); return i < 0 ? 99 : i; };
  const digits = (t) => (t === "Voltage" || t === "Factor" || t === "Current" ? 3 : t === "Throughput" || t === "Power" || t === "Temperature" || t === "Load" || t === "Level" || t === "Data" ? 1 : 0);

  function fmtSensor(type, v) {
    if (v == null) return "--";
    if (type === "Temperature") return tf(v, 1) + " " + deg();
    if (type === "Throughput") return fmt(v / 1e6, 2) + " MB/s";
    return Number(v).toFixed(digits(type)) + (UNITS[type] ? " " + UNITS[type] : "");
  }

  const visible = (h, filter) =>
    h.sensors.map((x, i) => ({ x, i })).filter(({ x }) => !filter || (h.name + " " + x.name + " " + x.type).toLowerCase().includes(filter));

  function build(hw, filter) {
    const frag = document.createDocumentFragment();
    hw.forEach((h) => {
      const rows = visible(h, filter);
      if (!rows.length) return;
      const d = document.createElement("details");
      d.className = "hw"; d.dataset.name = h.name;
      d.open = open.has(h.name) || !!filter;
      d.addEventListener("toggle", () => { if (d.open) open.add(h.name); else open.delete(h.name); if (last) refresh(last); });
      const sm = document.createElement("summary");
      const a = document.createElement("span"), b = document.createElement("span");
      a.textContent = h.name; b.className = "dim"; b.textContent = rows.length + (rows.length === 1 ? " sensor" : " sensors");
      sm.title = SensorHelp.hardware(h.name, h.type);
      sm.append(a, b); d.append(sm);
      if (sort === "name") rows.sort((p, q) => p.x.name.localeCompare(q.x.name, undefined, { numeric: true }));
      [...new Set(rows.map((r) => r.x.type))].sort((p, q) => rank(p) - rank(q)).forEach((t) => {
        const g = document.createElement("div"); g.className = "grp"; g.setAttribute("role", "table"); g.setAttribute("aria-label", (h.name + " " + (NAMES[t] ?? t)).trim());
        const h4 = document.createElement("h4"); h4.textContent = NAMES[t] ?? t; h4.title = SensorHelp.group(t); g.append(h4);
        const head = document.createElement("div"); head.className = "srow head"; head.setAttribute("role", "row");
        ["SENSOR", "VALUE", "MIN", "MAX"].forEach((c) => { const s = document.createElement("span"); s.textContent = c; s.title = SensorHelp.column(c); s.setAttribute("role", "columnheader"); head.append(s); });
        g.append(head);
        rows.filter((r) => r.x.type === t).forEach(({ x, i }) => {
          const r = document.createElement("div"); r.className = "srow"; r.dataset.i = i; r.setAttribute("role", "row");
          ["nm", "val", "mm", "mm"].forEach((c) => { const s = document.createElement("span"); s.className = c; s.setAttribute("role", "cell"); r.append(s); });
          const key = x.key ?? Pins.key(h, x);
          const pin = document.createElement("button");
          pin.type = "button"; pin.className = "pin";
          const paint = () => { const on = Pins.has(key); pin.textContent = on ? "\u2605" : "\u2606"; pin.setAttribute("aria-pressed", String(on)); pin.title = on ? "Remove from favorites" : "Add to favorites"; };
          paint();
          pin.setAttribute("aria-label", "Favorite " + x.name);
          pin.onclick = (ev) => { ev.stopPropagation(); Pins.toggle(key); sig = ""; if (last) refresh(last); };
          r.children[0].append(pin, document.createTextNode(x.name));
          r.title = x.name + "\n" + SensorHelp.sensor(x.type, x.name);   // plain-language hint on hover
          g.append(r);
        });
        d.append(g);
      });
      frag.append(d);
    });
    return frag;
  }

  function refresh(s) {
    const filter = $("dfilter").value.trim().toLowerCase();
    const favs = Pins.resolve(s).map(({ key, hw: from, source, x }) => ({ ...x, key, source, name: from + " \u203A " + x.name }));
    const hw = favs.length ? [{ name: "Favorites", type: "Pins", sensors: favs }, ...shown(s)] : shown(s);
    const next = filter + "|" + (sort === "name" ? "n" : "d") + "|" + hw.map((h) => h.name + ":" + h.sensors.length).join(",");
    const tree = $("dtree");
    if (next !== sig) { sig = next; tree.replaceChildren(build(hw, filter)); }
    tree.querySelectorAll("details.hw[open]").forEach((d) => {
      const h = hw.find((z) => z.name === d.dataset.name);
      if (!h) return;
      d.querySelectorAll(".srow:not(.head)").forEach((r) => {
        const x = h.sensors[+r.dataset.i];
        if (!x) return;
        const c = Rules.sensor(x.source ?? h, x, CFG);
        r.children[1].textContent = fmtSensor(x.type, x.value);
        r.children[1].className = "val" + (c && c !== "ok" ? " " + c : "");
        r.children[2].textContent = fmtSensor(x.type, x.min);
        r.children[3].textContent = fmtSensor(x.type, x.max);
        r._v = x.value ?? -Infinity;
      });
      if (sort === "value") {
        d.querySelectorAll(".grp").forEach((g) => {
          [...g.querySelectorAll(".srow:not(.head)")].sort((a, b) => b._v - a._v).forEach((r) => g.append(r));
        });
      }
    });
  }

  $("dsort").value = sort;
  $("dhide").checked = hideNet;
  $("dsort").onchange = () => { sort = $("dsort").value; store.set("dsort", sort); sig = ""; if (last) refresh(last); };
  $("dhide").onchange = () => { hideNet = $("dhide").checked; store.set("dhide", hideNet ? "on" : "off"); sig = ""; if (last) refresh(last); };
  $("dreset").onclick = () => { sendWs("reset-minmax"); const b = $("dreset"); b.textContent = "RESET DONE"; setTimeout(() => { b.textContent = "RESET MIN/MAX"; }, 1500); };
  $("dfilter").oninput = () => { if (last) refresh(last); };
  $("dexp").onclick = () => { document.querySelectorAll("#dtree details").forEach((d) => (d.open = true)); };
  $("dcol").onclick = () => { document.querySelectorAll("#dtree details").forEach((d) => (d.open = false)); };

  Pages.add("detail", {
    show() { sig = ""; },
    draw(s) { last = s; if (s.hardware) refresh(s); },
  });

  return { fmt: fmtSensor };
})();
