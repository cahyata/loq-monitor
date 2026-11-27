// LOQ Monitor | Pages
// Author: cahyata
// Copyright (c) 2026 cahyata
"use strict";
/* The pages of the main window and their whole life: the tabs and number keys that open them, which one is
   shown, the saved choice, and when each one works. A page file registers its behavior once with
   Pages.add(id, hooks); every hook is optional:

     show()      the page was opened
     hide()      another page is open. Every page that is not open at the start is told once.
     collect(s)  every new snapshot, shown or not, for history and statistics
     draw(s)     paint the latest snapshot. Called only while the page is open and can be seen.

   After add, a page has been told either show or hide. Tests: ui/test/pages.test.js. */

/** One row per page, in tab order. The first is the default, and its place is its number key. */
const PAGE_LIST = [
  { id: "overview", tab: "tabOverview", panel: "overview", tip: "Overview" },
  { id: "insights", tab: "tabInsights", panel: "insightsTab", tip: "Insights" },
  { id: "detail", tab: "tabDetail", panel: "detail", tip: "Detailed" },
  { id: "system", tab: "tabSystem", panel: "systemTab", tip: "System" },
  { id: "diagnosis", tab: "tabDiag", panel: "diagTab", tip: "Diagnosis" },
  { id: "care", tab: "tabCare", panel: "careTab", tip: "Hardware care" },
  { id: "overlay", tab: "tabOverlay", panel: "overlayTab", tip: "Game overlay" },
];

/** `element(id)` finds an element, `store` keeps the open page, and `visible()` is false while nothing can be seen
    (the window is hidden or in mini mode). */
function createPages({ element, store, visible }) {
  const added = new Map();
  const known = (id) => PAGE_LIST.some((p) => p.id === id);
  let current = store.get("tab", PAGE_LIST[0].id), last = null;
  if (!known(current)) current = PAGE_LIST[0].id;

  /** A page that fails must not stop the others or the rest of the app. */
  const call = (id, hook, arg) => { try { added.get(id)?.[hook]?.(arg); } catch (e) { console.error(e); } };
  const draw = () => { if (last && visible()) call(current, "draw", last); };

  function mark() {
    for (const p of PAGE_LIST) {
      const open = p.id === current, tab = element(p.tab);
      element(p.panel).hidden = !open;
      tab.classList.toggle("on", open);
      tab.setAttribute("aria-selected", String(open));
    }
  }

  /** Writes the tooltip of a tab, with an optional note after the key. */
  function note(id, text = "") {
    const at = PAGE_LIST.findIndex((p) => p.id === id), p = PAGE_LIST[at], tab = element(p.tab);
    tab.title = `${p.tip} (key ${at + 1})${text}`;
    tab.setAttribute("aria-keyshortcuts", String(at + 1));
  }

  /** Opens a page. Opening the open page again goes back to its top and tells it once more. */
  function show(id) {
    const next = known(id) ? id : PAGE_LIST[0].id;
    if (next !== current) call(current, "hide");
    current = next;
    mark();
    store.set("tab", current);
    element("scroller").scrollTop = 0;   // each page starts at its top
    call(current, "show");
    draw();
  }

  for (const p of PAGE_LIST) { element(p.tab).onclick = () => show(p.id); note(p.id); }
  mark();

  return {
    show,
    note,
    /** Redraws the open page, for a change of settings or leaving mini mode. */
    draw,
    add(id, hooks) {
      if (!known(id)) throw new Error("unknown page " + id);
      added.set(id, hooks);
      call(id, id === current ? "show" : "hide");
      if (id === current) draw();
    },
    /** A new snapshot from the service. */
    update(s) {
      last = s;
      for (const id of added.keys()) call(id, "collect", s);
      draw();
    },
    /** The page a pressed key opens, or null. */
    byKey: (key) => (/^[1-9]$/.test(key) ? PAGE_LIST[key - 1]?.id ?? null : null),
  };
}

if (typeof module !== "undefined") module.exports = { createPages, PAGE_LIST };   // for the tests, which run in Node
