// LOQ Monitor | Tests of the link to the sensor service
// Author: cahyata
// Copyright (c) 2026 cahyata
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createLink } = require("../src/link.js");

/** A link on a made-up WebSocket, fetch and clock. */
function setup({ answer } = {}) {
  const sockets = [], timers = [], urls = [], snapshots = [], states = [];
  let time = 1000;
  class Socket {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(text) { this.sent.push(text); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.(); }
    open() { this.readyState = 1; this.onopen(); }
    receive(data) { this.onmessage({ data }); }
  }
  const link = createLink({
    WebSocket: Socket,
    fetch: async (url) => { urls.push(url); return (answer ?? (() => ({ ok: true, json: async () => ({ n: urls.length }) })))(url); },
    setTimeout: (run, ms) => { timers.push({ run, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; },
    now: () => time,
  });
  link.start({ onSnapshot: (s) => snapshots.push(s), onState: (on) => states.push(on) });
  const socket = () => sockets.at(-1);
  /** Runs the newest reconnect timer and returns its delay. */
  const reconnect = () => { const t = timers.at(-1); t.run(); return t.ms; };
  return { link, sockets, socket, timers, urls, snapshots, states, reconnect, wait: (ms) => { time += ms; } };
}

test("connects to the service and passes each snapshot on", () => {
  const { link, socket, snapshots, states } = setup();
  assert.equal(socket().url, "ws://127.0.0.1:47821/ws");
  assert.equal(link.online(), false);
  socket().open();
  socket().receive('{"ts":1}');
  assert.deepEqual([link.online(), states, snapshots], [true, [true], [{ ts: 1 }]]);
});

test("a broken message is logged and the next one still arrives", (t) => {
  const errors = t.mock.method(console, "error", () => {});
  const { socket, snapshots } = setup();
  socket().open();
  socket().receive("{broken");
  socket().receive('{"ts":2}');
  assert.deepEqual(snapshots, [{ ts: 2 }]);
  assert.equal(errors.mock.callCount(), 1);
});

test("reconnects with a growing delay, up to five seconds, and starts over after a success", () => {
  const { socket, states, reconnect } = setup();
  const delays = [];
  for (let i = 0; i < 11; i++) { socket().close(); delays.push(reconnect()); }
  assert.deepEqual(delays, [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5000, 5000]);
  assert.equal(states.length, 11);
  socket().open();
  socket().close();
  assert.equal(reconnect(), 1000);
});

test("retry replaces the connection at once and ignores the old one", () => {
  const { link, sockets, socket, timers, states, snapshots } = setup();
  socket().open();
  const old = socket();
  link.retry();
  assert.equal(sockets.length, 2);
  old.receive('{"ts":1}');
  assert.deepEqual([states, snapshots, timers.length], [[true], [], 0]);
});

test("needed data is asked for once and released once", () => {
  const { link, socket } = setup();
  socket().open();
  link.need("procs", true); link.need("procs", true);
  link.need("procs", false); link.need("procs", false);
  assert.deepEqual(socket().sent, ["procs-on", "procs-off"]);
});

test("data needed before the connection opens is asked for when it does", () => {
  const { link, socket } = setup();
  link.need("net", true); link.need("fps", true); link.need("fps", false);
  assert.deepEqual(socket().sent, []);
  socket().open();
  assert.deepEqual(socket().sent, ["net-on"]);
});

test("a new connection is asked again for what is still needed", () => {
  const { link, socket, reconnect } = setup();
  socket().open();
  link.need("procs", true); link.need("limits", true); link.need("limits", false);
  socket().close();
  reconnect();
  socket().open();
  assert.deepEqual(socket().sent, ["procs-on"]);
});

test("a command is sent only while connected", () => {
  const { link, socket } = setup();
  assert.equal(link.command("reset-minmax"), false);
  socket().open();
  assert.equal(link.command("reset-minmax"), true);
  assert.deepEqual(socket().sent, ["reset-minmax"]);
});

test("a request is overdue twelve seconds after the service was asked", () => {
  const { link, socket, wait, reconnect } = setup();
  link.need("limits", true);
  wait(60_000);
  assert.equal(link.overdue("limits"), false, "not asked yet");
  socket().open();
  wait(12_000);
  assert.equal(link.overdue("limits"), false);
  wait(1);
  assert.equal(link.overdue("limits"), true);
  socket().close(); reconnect(); socket().open();
  assert.equal(link.overdue("limits"), false, "the new connection was just asked");
  wait(13_000);
  link.need("limits", false);
  assert.equal(link.overdue("limits"), false, "no longer needed");
});

test("the machine facts are read once, shared, and read again on refresh", async () => {
  const { link, urls } = setup();
  const [a, b] = await Promise.all([link.system(), link.system()]);
  assert.equal(a, b);
  assert.deepEqual(await link.system(true), { n: 2 });
  assert.deepEqual(await link.system(), { n: 2 });
  assert.deepEqual(urls, ["http://127.0.0.1:47821/system", "http://127.0.0.1:47821/system?refresh=1"]);
});

test("a failed read of the machine facts is not kept", async () => {
  let fail = true;
  const { link } = setup({ answer: () => (fail ? { ok: false, status: 500 } : { ok: true, json: async () => ({ good: true }) }) });
  await assert.rejects(link.system(), { message: "HTTP 500", reason: "http", status: 500 });
  fail = false;
  assert.deepEqual(await link.system(), { good: true });
});

test("the event log is read for the asked days", async () => {
  const { link, urls } = setup();
  await link.events(30); await link.events(7, true);
  assert.deepEqual(urls, ["http://127.0.0.1:47821/events?days=30", "http://127.0.0.1:47821/events?days=7&refresh=1"]);
});

test("a request that gets no answer says whether the service is there", async () => {
  const { link, socket } = setup({ answer: () => { throw new TypeError("Failed to fetch"); } });
  await assert.rejects(link.events(30), { reason: "unreachable" });
  socket().open();
  await assert.rejects(link.events(30), { reason: "older" });
});
