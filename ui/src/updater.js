// LOQ Monitor | Auto update
// Author: cahyata
// Copyright (c) 2026 cahyata
"use strict";
/* Checks GitHub Releases for a newer version through the Tauri updater plugin and installs it on
   request. The check runs a few seconds after start, unless it is turned off in SETTINGS, and
   never installs by itself. The installer replaces the app and the sensor service and then starts
   the app again. Shares $ and store with main.js. */

const Updater = (() => {
  const api = window.__TAURI__;
  let pending = null, busy = false;

  const say = (t) => { $("updMsg").textContent = t; };

  function showBar(update) {
    pending = update;
    $("updText").textContent = "Version " + update.version + " is available.";
    $("updBar").hidden = false;
    $("updInstall").hidden = false;
    $("updInstall").textContent = "INSTALL AND RESTART";
    say("Version " + update.version + " is available.");
  }

  /** Looks for an update. `quiet` hides "up to date" and error messages, for the automatic check. */
  async function check(quiet) {
    if (busy) return;
    if (!api?.updater) { if (!quiet) say("Updates need the desktop app."); return; }
    busy = true;
    if (!quiet) say("Checking for updates...");
    try {
      const update = await api.updater.check();
      if (update) showBar(update);
      else if (!quiet) say("You have the latest version.");
    } catch (e) {
      if (!quiet) say("Could not check for updates: " + e);
    } finally { busy = false; }
  }

  async function install() {
    if (!pending || busy) return;
    busy = true;
    $("updInstall").disabled = true;
    let total = 0, got = 0;
    try {
      await pending.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength || 0;
        else if (ev.event === "Progress") { got += ev.data.chunkLength; $("updText").textContent = "Downloading " + (total ? Math.round((got / total) * 100) + "%" : "..."); }
        else if (ev.event === "Finished") $("updText").textContent = "Installing. The app restarts when it is done.";
      });
    } catch (e) {
      $("updText").textContent = "The update failed: " + e;
      $("updInstall").disabled = false; $("updInstall").textContent = "TRY AGAIN";
    } finally { busy = false; }
  }

  $("updInstall").onclick = install;
  $("updLater").onclick = () => { $("updBar").hidden = true; };
  $("updCheck").onclick = () => check(false);
  $("cfgAutoUpdate").checked = store.get("autoupdate", "on") === "on";
  $("cfgAutoUpdate").onchange = () => store.set("autoupdate", $("cfgAutoUpdate").checked ? "on" : "off");
  api?.app?.getVersion?.().then((v) => { $("updVersion").textContent = "Version " + v; }).catch(() => {});

  if (store.get("autoupdate", "on") === "on") setTimeout(() => check(true), 8000);

  return { check };
})();
