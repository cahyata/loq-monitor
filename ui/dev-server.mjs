// Dev-only static server with live reload. Serves ./src on http://localhost:1420.
// Tauri starts it through build.beforeDevCommand; it is not part of the release build.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { watch } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("./src", import.meta.url)));
const PORT = 1420;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
};
const RELOAD = `<script>new EventSource("/__reload").onmessage=()=>location.reload()</script>`;

const clients = new Set();
let timer;
watch(ROOT, { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(() => clients.forEach((res) => res.write("data: reload\n\n")), 80);
});

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/__reload") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    res.write(": ok\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname);
  const file = normalize(join(ROOT, rel));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
  try {
    let body = await readFile(file);
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    if (type.startsWith("text/html")) body = body.toString().replace("</body>", RELOAD + "</body>");
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`dev server on http://localhost:${PORT} (live reload)`));
