// LOQ Monitor | Tests of the pages module
// Author: cahyata
// Copyright (c) 2026 cahyata
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createPages, PAGE_LIST } = require("../src/pages.js");

/** Pages on made-up elements, with the calls to every added page written to `log`. */
function setup({ saved, add = ["overview", "insights", "care"] } = {}) {
  const elements = new Map(), kept = new Map(saved ? [["tab", saved]] : []), log = [];
  const element = (id) => {
    if (!elements.has(id)) {
      const classes = new Set(), attributes = {};
      elements.set(id, { hidden: false, title: "", scrollTop: 99, attributes, setAttribute: (k, v) => { attributes[k] = v; },
        classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) } });
    }
    return elements.get(id);
  };
  const state = { seen: true };
  const pages = createPages({ element, store: { get: (k, d) => kept.get(k) ?? d, set: (k, v) => kept.set(k, v) }, visible: () => state.seen });
  const hooks = (id) => Object.fromEntries(["show", "hide", "collect", "draw", "connected"].map((h) => [h, (s) => log.push(`${id}.${h}${s ? " " + s.n : ""}`)]));
  for (const id of add) pages.add(id, hooks(id));
  const take = () => log.splice(0);
  return { pages, element, kept, state, take, hooks };
}

test("the first page is open when none was saved, and an unknown saved page counts as none", () => {
  for (const saved of [undefined, "nonsense"]) {
    const { element, take } = setup({ saved });
    assert.deepEqual(take(), ["overview.show", "insights.hide", "care.hide"]);
    assert.equal(element("overview").hidden, false);
    assert.equal(element("careTab").hidden, true);
    assert.equal(element("tabOverview").attributes["aria-selected"], "true");
  }
});

test("the saved page is restored, also when its file registers last", () => {
  const { element, take } = setup({ saved: "care" });
  assert.deepEqual(take(), ["overview.hide", "insights.hide", "care.show"]);
  assert.equal(element("careTab").hidden, false);
  assert.equal(element("overview").hidden, true);
});

test("every snapshot is collected by all pages and drawn by the open one only", () => {
  const { pages, take } = setup();
  take();
  pages.update({ n: 1 });
  assert.deepEqual(take(), ["overview.collect 1", "insights.collect 1", "care.collect 1", "overview.draw 1"]);
});

test("nothing is drawn while it cannot be seen, and draw catches up afterwards", () => {
  const { pages, state, take } = setup();
  state.seen = false;
  take();
  pages.update({ n: 1 });
  assert.deepEqual(take(), ["overview.collect 1", "insights.collect 1", "care.collect 1"]);
  state.seen = true;
  pages.draw();
  assert.deepEqual(take(), ["overview.draw 1"]);
});

test("opening a page hides the last one, shows and draws the new one, and is remembered", () => {
  const { pages, element, kept, take } = setup();
  pages.update({ n: 1 });
  take();
  element("tabCare").onclick();
  assert.deepEqual(take(), ["overview.hide", "care.show", "care.draw 1"]);
  assert.equal(kept.get("tab"), "care");
  assert.equal(element("tabCare").classList.contains("on"), true);
  assert.equal(element("tabOverview").classList.contains("on"), false);
  assert.equal(element("scroller").scrollTop, 0);
});

test("opening the open page again shows it without hiding it", () => {
  const { pages, take } = setup();
  take();
  pages.show("overview");
  assert.deepEqual(take(), ["overview.show"]);
});

test("a page added after data arrived is drawn at once", () => {
  const { pages, take, hooks } = setup({ saved: "detail" });
  pages.update({ n: 5 });
  take();
  pages.add("detail", hooks("detail"));
  assert.deepEqual(take(), ["detail.show", "detail.draw 5"]);
});

test("a page that fails does not stop the others", (t) => {
  const errors = t.mock.method(console, "error", () => {});
  const { pages, take } = setup({ add: [] });
  pages.add("overview", { collect: () => { throw new Error("broken"); } });
  const seen = [];
  pages.add("care", { collect: () => seen.push("care") });
  pages.update({ n: 1 });
  assert.deepEqual(seen, ["care"]);
  assert.equal(errors.mock.callCount(), 1);
  take();
});

test("a new connection is told to every page", () => {
  const { pages, take } = setup();
  take();
  pages.connected();
  assert.deepEqual(take(), ["overview.connected", "insights.connected", "care.connected"]);
});

test("number keys follow the tab order", () => {
  const { pages } = setup();
  assert.deepEqual(["1", "2", "7", "8", "0", "o", "10"].map(pages.byKey), ["overview", "insights", "overlay", null, null, null, null]);
});

test("each tab names its own key in its tooltip, with a note when given", () => {
  const { pages, element } = setup();
  assert.equal(element("tabOverlay").title, "Game overlay (key 7)");
  assert.equal(element("tabCare").attributes["aria-keyshortcuts"], "6");
  pages.note("overlay", ", showing");
  assert.equal(element("tabOverlay").title, "Game overlay (key 7), showing");
});

test("an unknown page cannot be added", () => {
  const { pages } = setup();
  assert.throws(() => pages.add("nonsense", {}), /unknown page/);
});

test("index.html has a tab and a panel for every page, in the same order", () => {
  const html = readFileSync(join(__dirname, "../src/index.html"), "utf8");
  const tabs = [...html.matchAll(/<button id="(tab\w+)"[^>]*aria-controls="(\w+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(tabs, PAGE_LIST.map((p) => [p.tab, p.panel]));
  for (const p of PAGE_LIST) assert.ok(html.includes(` id="${p.panel}"`), p.panel);
});
