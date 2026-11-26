// LOQ Monitor | Collects the license texts of everything the installer ships
// Author: cahyata
// Copyright (c) 2026 cahyata
//
// Writes THIRD-PARTY-LICENSES.txt, which the installer puts next to the app. Run it after
// `dotnet publish SensorService -c Release -r win-x64 --self-contained true`, because the list of
// .NET packages comes from that restore. Needs Node.js, cargo and no extra packages.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = (path) => {
  const raw = readFileSync(path);
  const decoded = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString("utf16le") : raw.toString("utf8");
  return decoded.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
};
const bundled = (name) => text(join(root, "licenses", name));
const LICENSE_FILE = /^(licen[sc]e|copying|unlicense|notice|copyright|third-party-notices)/i;
const licenseFiles = (dir) => readdirSync(dir).filter((f) => LICENSE_FILE.test(f) && statSync(join(dir, f)).isFile()).sort();
const byName = (a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0);
const fail = (message) => { console.error("collect-licenses: " + message); process.exit(1); };

const out = [];
const rule = "=".repeat(100);
const section = (title) => out.push("", rule, title, rule, "");

/* ---- .NET packages of the sensor service ---- */
const assetsPath = join(root, "SensorService", "obj", "project.assets.json");
if (!existsSync(assetsPath)) fail("publish SensorService first: " + assetsPath + " is missing");
const assets = JSON.parse(readFileSync(assetsPath, "utf8"));
const folders = Object.keys(assets.packageFolders);
const packageDir = (name, version) => folders.map((f) => join(f, name.toLowerCase(), version.toLowerCase())).find(existsSync) ?? fail(`package ${name} ${version} is not in the NuGet cache`);
const shipped = new Map();
for (const target of Object.values(assets.targets)) {
  for (const [id, lib] of Object.entries(target)) {
    const files = ["runtime", "native", "runtimeTargets"].flatMap((k) => Object.keys(lib[k] ?? {})).filter((f) => !f.endsWith("_._"));
    if (lib.type === "package" && files.length) shipped.set(id, id.split("/"));
  }
}
const packages = [...shipped.values()].map(([name, version]) => {
  const dir = packageDir(name, version);
  const spec = text(join(dir, name.toLowerCase() + ".nuspec"));
  const tag = (re) => spec.match(re)?.[1]?.trim() ?? "";
  return {
    name, version, dir,
    license: tag(/<license type="expression">([\s\S]*?)<\/license>/) || tag(/<licenseUrl>([\s\S]*?)<\/licenseUrl>/),
    copyright: tag(/<copyright>([\s\S]*?)<\/copyright>/), authors: tag(/<authors>([\s\S]*?)<\/authors>/),
    url: tag(/<projectUrl>([\s\S]*?)<\/projectUrl>/),
  };
}).sort(byName);

/* ---- the .NET runtime that a self-contained publish includes ---- */
const wanted = Object.values(assets.project.frameworks).flatMap((f) => f.downloadDependencies ?? [])
  .find((d) => d.name.toLowerCase() === "microsoft.netcore.app.runtime.win-x64");
if (!wanted) fail("the restore has no win-x64 runtime: run dotnet publish with -r win-x64 --self-contained true first");
const runtimeVersion = wanted.version.match(/\d+\.\d+\.\d+/)[0];
const runtimeDir = packageDir(wanted.name, runtimeVersion);

/* ---- Rust crates of the desktop app ---- */
const meta = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1", "--locked", "--filter-platform", "x86_64-pc-windows-msvc"],
  { cwd: join(root, "ui", "src-tauri"), encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }));
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
const reached = new Set(), todo = [meta.resolve.root];
while (todo.length) {
  const id = todo.pop();
  if (reached.has(id)) continue;
  reached.add(id);
  // Normal dependencies only: build and test tools are not part of the app.
  for (const dep of nodes.get(id).deps) if (dep.dep_kinds.some((k) => k.kind === null)) todo.push(dep.pkg);
}
const crates = meta.packages.filter((p) => reached.has(p.id) && p.id !== meta.resolve.root)
  .map((p) => ({ name: p.name, version: p.version, license: p.license ?? "see its license file", authors: p.authors.join(", "), url: p.repository ?? "", dir: dirname(p.manifest_path) }))
  .sort((a, b) => byName(a, b) || a.version.localeCompare(b.version));
// "A OR B" lets the user pick, so a crate is a problem only when every choice is from the GPL family.
const strong = crates.filter((c) => c.license.split(/\s+OR\s+|\//).every((choice) => /GPL/.test(choice)));
if (strong.length) fail("a crate is only available under a GPL family license: " + strong.map((c) => c.name).join(", "));

/* ---- output ---- */
out.push("LOQ Monitor: license texts of the software shipped with the installer",
  "", "LOQ Monitor itself is under the MIT License (LICENSE.txt in the same folder). THIRD-PARTY-NOTICES.md",
  "gives the overview. This file is generated by scripts/collect-licenses.mjs.");

section("Source code of the components under the Mozilla Public License 2.0");
out.push("These are used unmodified. Their source code is available at the addresses below.", "");
for (const p of packages.filter((x) => x.license === "MPL-2.0")) out.push(`${p.name} ${p.version}: ${p.url}`);
if (!packages.some((p) => p.name === "LibreHardwareMonitorLib" && p.license === "MPL-2.0")) fail("LibreHardwareMonitorLib is expected to be listed under MPL-2.0");
for (const c of crates.filter((x) => x.license.includes("MPL-2.0"))) out.push(`${c.name} ${c.version}: https://crates.io/crates/${c.name}/${c.version}`);

section("Mozilla Public License 2.0"); out.push(bundled("MPL-2.0.txt"));
section("Apache License 2.0"); out.push(bundled("Apache-2.0.txt"));
section("PresentMon (PresentMon.exe)"); out.push(bundled("PresentMon.txt"));
section("Microsoft Edge WebView2 loader (linked into the app)"); out.push(bundled("WebView2.txt"));

section(`.NET ${runtimeVersion} runtime (included in the sensor service)`);
const runtimeFiles = licenseFiles(runtimeDir);
if (!runtimeFiles.length) fail("the .NET runtime package has no license file");
for (const f of runtimeFiles) out.push("--- " + f, "", text(join(runtimeDir, f)), "");

section(".NET packages used by the sensor service");
for (const p of packages) out.push(`${p.name} ${p.version}`, `  License: ${p.license}`, ...(p.copyright || p.authors ? [`  ${p.copyright || "Authors: " + p.authors}`] : []), ...(p.url ? [`  ${p.url}`] : []));
const mit = packages.filter((p) => p.license === "MIT");
out.push("", "--- MIT License, for the packages above marked MIT (copyright as listed for each)", "",
  `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`);
if (!mit.length) fail("expected MIT packages");
// Every other license needs its own text: from the package, or one of the bundled files.
for (const p of packages.filter((x) => x.license !== "MIT")) {
  const files = licenseFiles(p.dir);
  if (files.length) for (const f of files) out.push("", `--- ${p.name} ${p.version}: ${f}`, "", text(join(p.dir, f)));
  else if (p.name === "Mono.Posix.NETStandard") out.push("", `--- ${p.name} ${p.version}: license of the Mono.Posix project`, "", bundled("Mono.Posix.txt"));
  else if (p.license !== "MPL-2.0" && p.license !== "Apache-2.0") fail(`no license text for ${p.name} (${p.license}): add one in licenses/ and name it here`);
}

section("Rust crates used by the desktop app");
for (const c of crates) out.push(`${c.name} ${c.version} | ${c.license}${c.url ? " | " + c.url : ""}`);

section("License files of the Rust crates");
const texts = new Map(), without = [];
for (const c of crates) {
  const files = licenseFiles(c.dir);
  if (!files.length) without.push(c);
  for (const f of files) {
    const body = text(join(c.dir, f));
    if (!texts.has(body)) texts.set(body, []);
    texts.get(body).push(`${c.name} ${c.version} (${f})`);
  }
}
for (const [body, users] of texts) out.push("--- " + users.join(", "), "", body, "");
// A crate package without a license file needs its text from licenses/, taken from the project it belongs to.
const FALLBACK = { "https://github.com/wravery/webview2-rs": "webview2-rs.txt", "https://github.com/dropbox/rust-alloc-no-stdlib": "rust-alloc-stdlib.txt" };
const covered = new Map();
for (const c of without) {
  const file = FALLBACK[c.url] ?? (c.license === "MPL-2.0" ? "MPL-2.0.txt" : null);
  if (!file) fail(`no license text for the crate ${c.name} (${c.license}): add one in licenses/ and name it in FALLBACK`);
  if (!covered.has(file)) covered.set(file, []);
  covered.get(file).push(`${c.name} ${c.version} | ${c.license}${c.authors ? " | " + c.authors : ""}${c.url ? " | " + c.url : ""}`);
}
for (const [file, users] of covered) out.push("--- Crates whose package holds no license file", "", ...users, "", file === "MPL-2.0.txt" ? "Their license is the Mozilla Public License 2.0 above." : bundled(file), "");

writeFileSync(join(root, "THIRD-PARTY-LICENSES.txt"), out.join("\n") + "\n");
console.log(`THIRD-PARTY-LICENSES.txt: ${packages.length} .NET packages, runtime ${runtimeVersion}, ${crates.length} crates, ${texts.size} crate license texts, ${without.length} crates without a file`);
