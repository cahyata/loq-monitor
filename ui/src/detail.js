// LOQ Monitor | UI Detailed tab
// Author: cahyata
// Copyright (c) 2026 cahyata
"use strict";
/* Detailed tab: every sensor the service reports, grouped by hardware like HWMonitor.
   Shares $, fmt, store, tempClass and drawAll with main.js (classic scripts share one global scope). */

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
  let sig = "", on = false, last = null;
  let sort = store.get("dsort", "default"), hideNet = store.get("dhide", "on") === "on";
  const VIRTUAL = /vmware|virtualbox|hyper-v|vethernet|openvpn|wireguard|tap-|loopback|bluetooth|local area connection|wan miniport/i;
  const idleNet = (h) => h.type === "Network" && (VIRTUAL.test(h.name) || h.sensors.every((x) => !x.value));
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
      a.textContent = h.name; b.className = "dim"; b.textContent = rows.length + " sensors";
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
          pin.onclick = (ev) => { ev.stopPropagation(); Pins.toggle(key); sig = ""; if (last) { refresh(last); if (typeof renderFavs === "function") renderFavs(last); } };
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
    const favs = Pins.resolve(s).map(({ key, hw: from, x }) => ({ ...x, key, name: from + " \u203A " + x.name }));
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
        const c = x.type === "Temperature" ? tempClass(x.value) : "";
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

  function setTab(detail) {
    on = detail;
    $("overview").hidden = detail; $("detail").hidden = !detail;
    $("tabOverview").classList.toggle("on", !detail);
    $("tabDetail").classList.toggle("on", detail);
    $("tabOverview").setAttribute("aria-selected", String(!detail));
    $("tabDetail").setAttribute("aria-selected", String(detail));
    store.set("tab", detail ? "detail" : "overview");
    if (detail) { sig = ""; if (last) refresh(last); } else drawAll();
  }

  $("tabOverview").onclick = () => setTab(false);
  $("tabDetail").onclick = () => setTab(true);
  $("dsort").value = sort;
  $("dhide").checked = hideNet;
  $("dsort").onchange = () => { sort = $("dsort").value; store.set("dsort", sort); sig = ""; if (last) refresh(last); };
  $("dhide").onchange = () => { hideNet = $("dhide").checked; store.set("dhide", hideNet ? "on" : "off"); sig = ""; if (last) refresh(last); };
  $("dreset").onclick = () => { sendWs("reset-minmax"); const b = $("dreset"); b.textContent = "RESET DONE"; setTimeout(() => { b.textContent = "RESET MIN/MAX"; }, 1500); };
  $("dfilter").oninput = () => { if (last) refresh(last); };
  $("dexp").onclick = () => { document.querySelectorAll("#dtree details").forEach((d) => (d.open = true)); };
  $("dcol").onclick = () => { document.querySelectorAll("#dtree details").forEach((d) => (d.open = false)); };

  return {
    fmt: fmtSensor,
    show: setTab,
    update(s) { last = s; if (on && s.hardware && !document.hidden) refresh(s); },
    restore() { if (store.get("tab", "overview") === "detail") setTab(true); },
  };
})();
Detail.restore();
