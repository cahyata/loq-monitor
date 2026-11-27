// LOQ Monitor | Link to the sensor service
// Author: cahyata
// Copyright (c) 2026 cahyata
"use strict";
/* Everything a window says to the sensor service: the live snapshot over a WebSocket that reconnects by itself,
   the commands, the data the service measures only while someone asks for it, and the two reports it answers on
   request. The main window and the overlay window each make one link. It touches no page; the caller shows the
   state. Tests: ui/test/link.test.js. */

const SERVICE_HOST = "127.0.0.1:47821";
const OVERDUE_MS = 12_000;   // a request with no answer after this long will most likely get none

/** The browser's WebSocket, fetch and timers are passed in, so the tests can stand in for them. */
function createLink({ WebSocket, fetch, setTimeout, clearTimeout, now = Date.now }) {
  const wanted = new Set();      // data that is needed: "procs", "net", "limits", "fps"
  const askedAt = new Map();     // when this connection was asked for it
  let socket = null, attempts = 0, timer = null, listen = {}, system = null;

  const online = () => socket?.readyState === 1;
  function send(text) {
    if (!online()) return false;
    try { socket.send(text); return true; } catch { return false; /* the connection is closing */ }
  }
  function ask(kind) { if (send(kind + "-on")) askedAt.set(kind, now()); }

  function connect() {
    clearTimeout(timer);
    askedAt.clear();                 // a new connection starts with nothing asked
    const mine = new WebSocket(`ws://${SERVICE_HOST}/ws`);
    socket = mine;
    mine.onopen = () => {
      if (mine !== socket) return;
      attempts = 0;
      wanted.forEach(ask);
      listen.onState?.(true);
    };
    mine.onmessage = (e) => {
      if (mine !== socket) return;
      try { listen.onSnapshot?.(JSON.parse(e.data)); } catch (err) { console.error(err); }
    };
    mine.onclose = () => {
      if (mine !== socket) return;
      askedAt.clear();
      listen.onState?.(false);
      timer = setTimeout(connect, Math.min(5000, 1000 + attempts++ * 500));
    };
    mine.onerror = () => mine.close();
  }

  /** One request over HTTP. A failure carries `reason`: "http" (with `status`), "older" when the connection is
      fine but the service will not answer, which is what an older service does for an address it does not know,
      or "unreachable". */
  async function get(path, refresh) {
    const url = `http://${SERVICE_HOST}${path}` + (refresh ? (path.includes("?") ? "&" : "?") + "refresh=1" : "");
    let res;
    try { res = await fetch(url); }
    catch (e) { throw Object.assign(new Error(e.message), { reason: online() ? "older" : "unreachable" }); }
    if (!res.ok) throw Object.assign(new Error("HTTP " + res.status), { reason: "http", status: res.status });
    return res.json();
  }

  return {
    /** Connects and stays connected. `onSnapshot(s)` gets every snapshot, `onState(online)` every change and
        every failed attempt. */
    start(handlers) { listen = handlers; connect(); },
    /** Drops the connection and tries again at once. */
    retry() {
      const old = socket;
      socket = null;                 // first let go of it, so its close is ignored
      try { old?.close(); } catch { /* already closed */ }
      connect();
    },
    online,
    /** Sends a command such as "reset-minmax". It is dropped while there is no connection. */
    command: send,
    /** Says whether `kind` is needed now. The service is told once, and again after every reconnect. */
    need(kind, on) {
      if (on === wanted.has(kind)) return;
      if (on) { wanted.add(kind); ask(kind); }
      else { wanted.delete(kind); askedAt.delete(kind); send(kind + "-off"); }
    },
    /** True when `kind` was asked for long enough ago that an answer should have come. */
    overdue: (kind) => askedAt.has(kind) && now() - askedAt.get(kind) > OVERDUE_MS,
    /** The machine facts from /system. Read once and shared; `refresh` makes the service read them again. */
    system(refresh = false) {
      if (!system || refresh) {
        const read = get("/system", refresh);
        system = read;
        read.catch(() => { if (system === read) system = null; });
      }
      return system;
    },
    /** The Windows Event Log entries of the last `days` days. */
    events: (days, refresh = false) => get("/events?days=" + days, refresh),
  };
}

if (typeof module !== "undefined") module.exports = { createLink };   // for the tests, which run in Node
