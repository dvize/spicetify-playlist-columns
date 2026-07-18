#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const children = ["sort-log-server.mjs", "watch-sort-traces.mjs"].map((script) =>
  spawn("node", [path.join(__dirname, script)], { stdio: "inherit" })
);

function shutdown() {
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

for (const child of children) {
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) shutdown();
  });
}
