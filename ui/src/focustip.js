// LOQ Monitor | Explanations for keyboard users
// Author: cahyata
// Copyright (c) 2026 cahyata
"use strict";
/* The browser shows a title attribute only under the mouse. This shows the same text beside an element that
   was reached with the keyboard. In the sensor list the explanation belongs to the row, not to its star button.
   Esc closes it. A screen reader already reads the title, so the box is hidden from it. */

(() => {
  const tip = document.createElement("div");
  tip.id = "focustip"; tip.hidden = true; tip.setAttribute("aria-hidden", "true");
  document.body.append(tip);
  let target = null;

  const hide = () => { tip.hidden = true; target = null; };
  function place() {
    if (!target) return;
    const at = target.getBoundingClientRect();
    const below = at.bottom + 6, fits = below + tip.offsetHeight <= innerHeight - 4;
    tip.style.top = (fits ? below : Math.max(4, at.top - tip.offsetHeight - 6)) + "px";
    tip.style.left = Math.max(4, Math.min(at.left, innerWidth - tip.offsetWidth - 16)) + "px";
  }

  document.addEventListener("focusin", (e) => {
    const el = e.target;
    const source = el.closest?.(".srow[title]") ?? el.closest?.("[title]");
    // A dialog lies above the page, so the box could not show over it.
    if (!source?.title || el.closest("dialog") || !el.matches(":focus-visible")) { hide(); return; }
    target = el; tip.textContent = source.title; tip.hidden = false; place();
  });
  document.addEventListener("focusout", hide);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  document.addEventListener("scroll", place, true);   // focusing can scroll the element into view
  addEventListener("resize", place);
})();
