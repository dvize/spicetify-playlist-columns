#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const downloads = path.join(os.homedir(), "Downloads");
const latestFile = path.join(root, "sort-debug.latest.json");
const traceFile = path.join(root, "sort-debug.trace.jsonl");

function copyNewestTrace() {
  if (!fs.existsSync(downloads)) return;
  const files = fs
    .readdirSync(downloads)
    .filter((f) => f.startsWith("ptc-sort-trace-") && f.endsWith(".json"))
    .map((f) => ({ f, mtime: fs.statSync(path.join(downloads, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (!files.length) return;
  const src = path.join(downloads, files[0].f);
  const stat = fs.statSync(src);
  if (copyNewestTrace.lastMtime === stat.mtimeMs) return;
  copyNewestTrace.lastMtime = stat.mtimeMs;

  fs.copyFileSync(src, latestFile);
  const pointer = JSON.stringify({
    at: new Date().toISOString(),
    source: src,
    copiedTo: latestFile,
  });
  fs.appendFileSync(traceFile, `${pointer}\n`);
  console.log(`[ptc-sort-watch] copied ${files[0].f} -> sort-debug.latest.json`);
}
copyNewestTrace.lastMtime = 0;

console.log(`[ptc-sort-watch] watching ${downloads}`);
console.log(`[ptc-sort-watch] latest -> ${latestFile}`);

copyNewestTrace();
fs.watch(downloads, { persistent: true }, () => {
  try {
    copyNewestTrace();
  } catch (e) {
    console.warn("[ptc-sort-watch]", e);
  }
});
