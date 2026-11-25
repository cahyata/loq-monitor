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

  const open = new Set(["Lenovo embedded controller", "ACPI thermal zones"]); // expanded sections survive refreshes
  let sig = "", on = false, last = null;

  const rank = (t) => { const i = ORDER.indexOf(t); return i < 0 ? 99 : i; };
  const digits = (t) => (t === "Voltage" || t === "Factor" || t === "Current" ? 3 : t === "Throughput" || t === "Power" || t === "Temperature" || t === "Load" || t === "Level" || t === "Data" ? 1 : 0);

  function fmtSensor(type, v) {
    if (v == null) return "--";
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
      sm.append(a, b); d.append(sm);
      [...new Set(rows.map((r) => r.x.type))].sort((p, q) => rank(p) - rank(q)).forEach((t) => {
        const g = document.createElement("div"); g.className = "grp";
        const h4 = document.createElement("h4"); h4.textContent = NAMES[t] ?? t; g.append(h4);
        const head = document.createElement("div"); head.className = "srow head";
        ["SENSOR", "VALUE", "MIN", "MAX"].forEach((c) => { const s = document.createElement("span"); s.textContent = c; head.append(s); });
        g.append(head);
        rows.filter((r) => r.x.type === t).forEach(({ x, i }) => {
          const r = document.createElement("div"); r.className = "srow"; r.dataset.i = i;
          ["nm", "val", "mm", "mm"].forEach((c) => { const s = document.createElement("span"); s.className = c; r.append(s); });
          r.children[0].textContent = x.name; r.children[0].title = x.name;
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
    const next = filter + "|" + s.hardware.map((h) => h.name + ":" + h.sensors.length).join(",");
    const tree = $("dtree");
    if (next !== sig) { sig = next; tree.replaceChildren(build(s.hardware, filter)); }
    tree.querySelectorAll("details.hw[open]").forEach((d) => {
      const h = s.hardware.find((z) => z.name === d.dataset.name);
      if (!h) return;
      d.querySelectorAll(".srow:not(.head)").forEach((r) => {
        const x = h.sensors[+r.dataset.i];
        if (!x) return;
        const c = x.type === "Temperature" ? tempClass(x.value) : "";
        r.children[1].textContent = fmtSensor(x.type, x.value);
        r.children[1].className = "val" + (c && c !== "ok" ? " " + c : "");
        r.children[2].textContent = fmtSensor(x.type, x.min);
        r.children[3].textContent = fmtSensor(x.type, x.max);
      });
    });
  }

  function setTab(detail) {
    on = detail;
    $("overview").hidden = detail; $("detail").hidden = !detail;
    $("tabOverview").classList.toggle("on", !detail);
    $("tabDetail").classList.toggle("on", detail);
    store.set("tab", detail ? "detail" : "overview");
    if (detail) { sig = ""; if (last) refresh(last); } else drawAll();
  }

  $("tabOverview").onclick = () => setTab(false);
  $("tabDetail").onclick = () => setTab(true);
  $("dfilter").oninput = () => { if (last) refresh(last); };
  $("dexp").onclick = () => { document.querySelectorAll("#dtree details").forEach((d) => (d.open = true)); };
  $("dcol").onclick = () => { document.querySelectorAll("#dtree details").forEach((d) => (d.open = false)); };

  return {
    update(s) { last = s; if (on && s.hardware && !document.hidden) refresh(s); },
    restore() { if (store.get("tab", "overview") === "detail") setTab(true); },
  };
})();
Detail.restore();
