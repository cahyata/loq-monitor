// LOQ Monitor | Tests of the reading rules
// Author: cahyata
// Copyright (c) 2026 cahyata
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Rules = require("../src/rules.js");

const limits = Rules.LIMITS;
/** Checks a rule at each value: [[input, level], ...]. */
const levels = (rule, table) => { for (const [input, level] of table) assert.equal(rule(input), level, "input " + input); };

/** A snapshot with nothing to report. */
function quiet(change = {}) {
  return {
    cpu: { tempC: 50 }, gpu: { tempC: 45, hotspotC: 55, vramUsedMB: 1000, vramTotalMB: 8000 }, ram: { loadPct: 40 },
    storage: [{ name: "Drive A", tempC: 45, usedPct: 50, lifePct: 95 }], battery: { levelPct: 80 }, hardware: [], ...change,
  };
}
const driveHardware = (name, sensors) => ({ name, type: "Storage", sensors: sensors.map(([type, n, value]) => ({ type, name: n, value })) });
const found = (change, user = limits) => Rules.findings(quiet(change), user).map((f) => [f.part, f.kind ?? null, f.level]);

test("a CPU or GPU temperature follows the user's limits", () => {
  levels((c) => Rules.temp(c, limits), [[null, ""], [undefined, ""], [74.9, "ok"], [75, "warn"], [89.9, "warn"], [90, "hot"]]);
  assert.equal(Rules.temp(60, { warn: 50, hot: 60, spot: 70 }), "hot");
});

test("the hotspot warns from the hot limit and is critical from its own", () => {
  levels((c) => Rules.hotspot(c, limits), [[null, ""], [89, "ok"], [90, "warn"], [95, "hot"]]);
});

test("memory and load warn at 80 % and are critical at 90 %", () => {
  levels(Rules.capacity, [[null, "ok"], [79.9, "ok"], [80, "warn"], [89.9, "warn"], [90, "hot"]]);
});

test("the battery warns below 30 % and is critical below 15 %", () => {
  levels(Rules.battery, [[undefined, ""], [30, "ok"], [29, "warn"], [15, "warn"], [14, "hot"], [0, "hot"]]);
});

test("a drive temperature is a warning at 70 and critical at 80", () => {
  levels((c) => Rules.driveTemp(c), [[null, ""], [69, "ok"], [70, "warn"], [79, "warn"], [80, "hot"]]);
});

test("a drive's own lower limit makes it critical earlier, a higher one does not delay it", () => {
  assert.equal(Rules.driveTemp(76, 75), "hot");
  assert.equal(Rules.driveTemp(66, 65), "hot");
  assert.equal(Rules.driveTemp(80, 86), "hot");
  assert.equal(Rules.driveTemp(79, 0), "warn");
});

test("a full drive is never critical", () => {
  levels(Rules.driveFill, [[null, "ok"], [79, "ok"], [80, "warn"], [100, "warn"]]);
});

test("drive life warns at 20 % and is critical at 10 %", () => {
  levels(Rules.driveLife, [[null, ""], [75, "ok"], [21, "ok"], [20, "warn"], [11, "warn"], [10, "hot"], [0, "hot"]]);
});

test("drives join each storage record with its health sensors, also for two drives of one model", () => {
  const list = Rules.drives({
    storage: [{ name: "Twin", tempC: 40, usedPct: 10 }, { name: "Twin", usedPct: 20, lifePct: 50 }],
    hardware: [
      driveHardware("Twin", [["Level", "Life", 91], ["Temperature", "Warning Temperature", 82]]),
      driveHardware("Twin", [["Temperature", "Temperature #1", 55], ["Level", "Available Spare", 3], ["Level", "Available Spare Threshold", 5]]),
    ],
  });
  assert.deepEqual(list.map((d) => [d.key, d.temp, d.tempWarn, d.life, d.spare, d.fill]),
    [["0 Twin", 40, 82, 91, null, 10], ["1 Twin", 55, null, 50, 3, 20]]);
});

test("a drive without health sensors still has what the storage record says", () => {
  const [d] = Rules.drives({ storage: [{ name: "Plain", tempC: 40, usedPct: 10, lifePct: 99 }] });
  assert.deepEqual([d.temp, d.fill, d.life, d.spare], [40, 10, 99, null]);
});

test("drive issues come in a fixed order and a full drive counts from 90 %", () => {
  const issues = Rules.driveIssues({ spare: 5, spareMin: 5, life: 15, temp: 72, fill: 95 });
  assert.deepEqual(issues.map((x) => [x.kind, x.level]), [["spare", "hot"], ["life", "warn"], ["temp", "warn"], ["fill", "warn"]]);
  assert.deepEqual(Rules.driveIssues({ life: 75, temp: 61, fill: 89.9 }), []);
});

test("the condition of a drive is its worst issue, leaving out how full it is", () => {
  const condition = (d) => { const c = Rules.driveCondition(d); return [c.level, c.reason]; };
  assert.deepEqual(condition({ life: 90, temp: 50, fill: 99 }), ["ok", "healthy"]);
  assert.deepEqual(condition({ life: 15, temp: 85 }), ["hot", "temp"]);
  assert.deepEqual(condition({ life: 15, temp: 72 }), ["warn", "life"]);
  assert.deepEqual(condition({ life: 90, spare: 4, spareMin: 5 }), ["hot", "spare"]);
  assert.deepEqual(condition({ life: null, temp: 40 }), ["", "unknown"]);
});

test("the sensor list judges drive temperatures by the drive limits and leaves limit rows plain", () => {
  const drive = driveHardware("A", [["Temperature", "Composite Temperature", 78], ["Temperature", "Warning Temperature", 76]]);
  assert.equal(Rules.sensor(drive, drive.sensors[0], limits), "hot");
  assert.equal(Rules.sensor(drive, drive.sensors[1], limits), "");
  assert.equal(Rules.sensor(drive, { type: "Temperature", name: "A › Critical Temperature", value: 89 }, limits), "");
  assert.equal(Rules.sensor({ type: "Cpu", sensors: [] }, { type: "Temperature", name: "Core", value: 78 }, limits), "warn");
  assert.equal(Rules.sensor(drive, { type: "Load", name: "Used Space", value: 99 }, limits), "");
});

test("a quiet snapshot has nothing to report", () => {
  assert.deepEqual(found(), []);
});

test("findings list every problem in order", () => {
  assert.deepEqual(found({
    cpu: { tempC: 92 }, gpu: { tempC: 80, hotspotC: 96, vramUsedMB: 7000, vramTotalMB: 8000, throttleMask: 0x4 | 0x20 }, ram: { loadPct: 95 },
    storage: [{ name: "Drive A", tempC: 71, usedPct: 96, lifePct: 8 }], battery: { levelPct: 20 },
  }), [
    ["cpu", null, "hot"], ["gpu", null, "warn"], ["hotspot", null, "hot"], ["ram", null, "hot"], ["vram", null, "warn"],
    ["drive", "life", "hot"], ["drive", "temp", "warn"], ["drive", "fill", "warn"], ["gpuLimit", null, "hot"], ["battery", null, "warn"],
  ]);
});

test("a hotspot below its own limit and a plain power limit are not findings", () => {
  assert.deepEqual(found({ gpu: { tempC: 45, hotspotC: 92, throttleMask: 0x4 } }), []);
});

test("a laptop without a battery or video memory reading reports neither", () => {
  assert.deepEqual(found({ battery: undefined, gpu: { tempC: 45 } }), []);
});

test("power modes have one name each", () => {
  assert.deepEqual([1, 2, 3, 224, 255, 7, undefined].map(Rules.powerMode), ["Quiet", "Balanced", "Performance", "Custom", "Custom", null, null]);
});

test("virtual adapters are left out of the network speed", () => {
  const net = (name, down, up) => ({ name, type: "Network", sensors: [{ name: "Download Speed", value: down }, { name: "Upload Speed", value: up }] });
  const s = { hardware: [net("Wi-Fi", 100, 10), net("Local Area Connection* 1", 50, 5), net("vEthernet (Default Switch)", 7, 7), net("Ethernet", 1, 2)] };
  assert.deepEqual(Rules.netRates(s), { down: 101, up: 12 });
});
