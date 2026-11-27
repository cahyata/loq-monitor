// LOQ Monitor | Care tab
// Author: cahyata
// Copyright (c) 2026 cahyata
"use strict";
/* The CARE tab: advice that makes the hardware last, and the advice that applies to this laptop right now.
   Every tip is written in our own words from the page it links to; the sources were read on the date in CHECKED.
   When you change a tip, read its source again. A link opens only when its host is in the list in lib.rs.
   Shares $, store, tf, tdeg and invoke with main.js; rules.js judges the drives. */

(() => {
  const CHECKED = "26 November 2026";
  const SOURCES = {
    lenovoQa: ["Lenovo: Battery Q&A", "https://support.lenovo.com/us/en/solutions/ht509084"],
    lenovoLife: ["Lenovo: Extend your battery life", "https://support.lenovo.com/us/en/solutions/ht069687"],
    lenovoCool: ["Lenovo: Cool down your laptop", "https://www.lenovo.com/us/en/glossary/how-to-cool-down-your-laptop/"],
    lenovoFan: ["Lenovo: Laptop fan care", "https://www.lenovo.com/us/en/glossary/laptop-fan/"],
    lenovoClean: ["Lenovo: Keeping your computer clean", "https://support.lenovo.com/us/en/solutions/ht035676-keeping-your-computer-clean-notebooks-all-in-one-desktops-tiny-in-one-and-monitors"],
    lenovoSafety: ["Lenovo: Safety notices (PDF)", "https://download.lenovo.com/pccbbs/mobiles_pdf/t14_gen2_t15_gen2_p14s_gen2_p15s_gen2_generic_safety_compliance_notices.pdf"],
    lenovoBios: ["Lenovo: Update the BIOS", "https://support.lenovo.com/sg/en/solutions/ht500008"],
    msBattery: ["Microsoft: Caring for your battery", "https://support.microsoft.com/en-us/windows/experience/power-battery/caring-for-your-battery-in-windows"],
    msDrives: ["Microsoft: Optimize drives", "https://support.microsoft.com/en-us/windows/experience/storage-filemanagement/defragment-optimize-your-data-drives-in-windows"],
    bu808: ["Battery University: BU-808", "https://www.batteryuniversity.com/article/bu-808-how-to-prolong-lithium-based-batteries/"],
    kingstonCare: ["Kingston: SSD longevity", "https://www.kingston.com/en/blog/pc-performance/extend-ssd-lifespan-boost-performance"],
    kingstonTbw: ["Kingston: SSD endurance", "https://www.kingston.com/en/blog/servers-and-data-centers/understanding-ssd-endurance-tbw-dwpd"],
    crucialSmart: ["Crucial: SSDs and SMART data", "https://www.crucial.com/support/articles-faq-ssd/ssds-and-smart-data"],
  };

  // [title, text, source keys]. "wear" is what shortens the life of the part, "help" is what to do.
  const TOPICS = [
    { title: "BATTERY", color: "green", wear: [
      ["Heat", "Heat ages a lithium-ion battery permanently. Lenovo says charging while the system is above 35 °C (95 °F) costs capacity for good.", ["lenovoQa", "msBattery"]],
      ["Staying near 100 %", "A high charge level wears the battery faster. In one year of storage at 25 °C, Battery University estimates 96 % capacity left at 40 % charge and 80 % at full charge. At 40 °C the figures are 85 % and 65 %.", ["bu808", "msBattery"]],
      ["Deep discharges", "Running the battery nearly empty often stresses it more than short, partial discharges.", ["bu808", "msBattery"]],
    ], help: [
      ["Plugged in most of the time? Limit the charge", "Turn on Conservation Mode in Lenovo Vantage and leave the adapter connected. Lenovo advises an upper limit of 80 % or less for a laptop that is always on mains power.", ["lenovoLife", "lenovoQa"]],
      ["On battery, stay in the middle", "Microsoft suggests keeping the level between about 20 % and 80 % when you can. Full discharges are not needed to keep a lithium-ion battery healthy.", ["msBattery", "lenovoQa"]],
      ["Storing it for months", "Charge it to about half, switch the laptop off, keep it somewhere cool and dry, and check it every few months.", ["lenovoQa", "msBattery"]],
      ["A swollen battery", "A bulging battery or case is not normal. Handle it carefully, do not press or puncture it, and contact Lenovo service for a replacement.", ["lenovoQa"]],
    ] },
    { title: "HEAT AND AIRFLOW", color: "pink", wear: [
      ["Blocked vents", "A bed, cushion or blanket can cover the vents and trap heat. Dust around the openings restricts the airflow too.", ["lenovoCool"]],
      ["Hot surroundings", "Direct sunlight and places without air movement raise the temperature of the whole laptop.", ["lenovoCool"]],
    ], help: [
      ["Use a firm, flat surface", "A desk or table keeps the openings free. A stand or a cooling pad can help if it does not cover any vent.", ["lenovoCool"]],
      ["Clean out dust", "Switch the laptop off first. Lenovo suggests compressed air every 3 to 6 months, depending on the room. Do not push objects into the vents.", ["lenovoFan", "lenovoClean", "lenovoCool"]],
      ["Ease the load when it runs hot", "Close programs you do not use, or pick a quieter power mode (Fn+Q). Avoid unsupported tools that take over the fans.", ["lenovoCool"]],
    ] },
    { title: "SSD AND YOUR FILES", color: "cyan", wear: [
      ["Writing a lot of data", "An SSD wears as data is written to it. Its rating, total bytes written (TBW), says how much it is built to take. The Insights tab shows what your drives have written.", ["kingstonTbw"]],
      ["A drive that is nearly full", "A full SSD slows down and has less room for its own upkeep.", ["kingstonCare"]],
      ["Overheating and forced shutdowns", "Heat shortens its life (Crucial rates most of its drives for 0 to 70 °C), and forcing the laptop off can corrupt data.", ["kingstonCare", "crucialSmart"]],
    ], help: [
      ["Keep at least 10 % free", "Move large files elsewhere before the drive fills up.", ["kingstonCare"]],
      ["Let Windows look after it", "Windows optimizes drives on its own and uses TRIM for SSDs.", ["msDrives"]],
      ["Back up what matters", "No health reading can promise a drive will not fail. Keep a second copy of important files.", ["kingstonCare"]],
    ] },
    { title: "POWER AND HANDLING", color: "yellow", wear: [
      ["Liquids", "Spills can short a circuit and corrode connectors over time. Keep drinks away from the laptop and its adapter.", ["lenovoSafety"]],
      ["A damaged or covered adapter", "Do not cover the adapter or wrap the cord around it while it is in use. Stop using a cracked, corroded or heat-damaged adapter or cord.", ["lenovoSafety"]],
      ["Overloaded power strips", "Use extension cords and surge protectors that are rated for the load.", ["lenovoSafety"]],
    ], help: [
      ["Use the maker's adapter", "Lenovo says to use only the adapter and cords supplied by the manufacturer.", ["lenovoSafety"]],
      ["Clean gently", "Switch off. Use a soft lint-free cloth, lightly damp. Never spray or pour cleaner on the screen or keyboard.", ["lenovoClean"]],
    ] },
    { title: "UPDATES", color: "orange", wear: [
      ["An interrupted BIOS update", "A power cut or freeze during the update can corrupt the firmware and stop the laptop from starting.", ["lenovoBios"]],
    ], help: [
      ["Update safely", "Use Lenovo Vantage or Lenovo System Update, keep the adapter connected and the battery charged, and let the update finish.", ["lenovoBios"]],
    ] },
  ];

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function link(key) {
    const [label, url] = SOURCES[key];
    const b = el("button", "src", label); b.type = "button"; b.title = "Open in your browser: " + url;
    b.onclick = () => {
      if (!invoke) { open(url, "_blank", "noopener"); return; }
      invoke("open_source", { url }).catch((e) => { $("careMsg").textContent = "Could not open the page: " + e + ". The address is " + url; });
    };
    return b;
  }

  function tip([title, text, sources]) {
    const li = el("li"), from = el("p", "srcs");
    from.append(...sources.map(link));
    li.append(el("b", null, title), el("p", null, text), from);
    return li;
  }

  $("careTopics").replaceChildren(...TOPICS.map((t) => {
    const card = el("section", "panel mini " + t.color), head = el("div", "ph"); head.append(el("h2", "ptit", t.title)); card.append(head);
    for (const [label, cls, list] of [["WHAT SHORTENS ITS LIFE", "wear", t.wear], ["WHAT HELPS", "help", t.help]]) {
      const ul = el("ul", "tips " + cls); ul.append(...list.map(tip));
      card.append(el("h3", "sub" + (cls === "wear" ? " first" : ""), label), ul);
    }
    return card;
  }));
  $("careChecked").textContent = "Sources read on " + CHECKED;

  /* ---- what applies to this laptop right now ---- */
  /** Advice drawn from the live readings. Each entry is [level, text, source key or null]. */
  function advice(s) {
    const out = [];
    const DRIVE = {
      spare: (d) => [`${d.name} is running out of spare blocks. Back up your files and plan a replacement.`, null],
      life: (d) => [`${d.name} reports ${Math.round(d.life)} % life left. Back up your files and plan a replacement.`, "kingstonCare"],
      temp: (d) => [`${d.name} is at ${tdeg(d.temp)}. Check the airflow and pause long copies until it cools.`, "kingstonCare"],
      fill: (d) => [`${d.name} is ${Math.round(d.fill)} % full. Free up space so at least 10 % stays empty.`, "kingstonCare"],
    };
    for (const d of Rules.drives(s)) for (const x of Rules.driveIssues(d)) out.push([x.level, ...DRIVE[x.kind](d)]);
    const b = s.battery;
    if (b) {
      if (b.acOnline && (b.levelPct ?? 0) >= 95) out.push(["warn", `The battery is at ${Math.round(b.levelPct)} % on mains power. If the laptop usually stays plugged in, turn on Conservation Mode in Lenovo Vantage.`, "lenovoQa"]);
      if ((b.levelPct ?? 100) < 20 && !b.acOnline) out.push(["warn", `The battery is at ${Math.round(b.levelPct)} %. Plug in soon to avoid a deep discharge.`, "msBattery"]);
      if ((b.degradationPct ?? 0) >= 20) out.push(["warn", `The battery now holds ${Math.round(100 - b.degradationPct)} % of its design capacity. This wear is permanent; replace the battery when the running time no longer suits you.`, null]);
    }
    let heat = [];
    try { heat = JSON.parse(store.get("heatlog", "[]")); } catch { /* no history */ }
    const recent = Array.isArray(heat) ? heat.filter((r) => r?.e >= Date.now() - 7 * 86_400_000).length : 0;
    if (recent) out.push(["warn", `A temperature passed its limit ${recent === 1 ? "once" : recent + " times"} in the last 7 days (see Diagnosis). Check that the vents are free of dust and the laptop stands on a firm surface.`, "lenovoCool"]);
    return out;
  }

  let shown = "";
  function paint(s) {
    const list = advice(s), signature = JSON.stringify(list);
    if (signature === shown) return;     // redraw only on a change, so a focused link stays focused
    shown = signature;
    $("careState").textContent = list.length ? list.length + (list.length === 1 ? " point" : " points") : "";
    $("careNow").replaceChildren(...(list.length ? list.map(([level, text, source]) => {
      const li = el("li"); li.append(el("span", "mark " + level, level === "hot" ? "ACT NOW" : "ADVICE"), el("p", null, text));
      if (source) li.append(link(source));
      return li;
    }) : [el("li", "none", "Nothing in the current readings calls for action.")]));
  }

  Pages.add("care", { draw: paint });
})();
