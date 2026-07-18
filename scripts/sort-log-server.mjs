#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const logFile = path.join(root, "sort-debug.trace.jsonl");
const port = 39281;

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/ptc-sort") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        fs.appendFileSync(logFile, `${body.trim()}\n`);
        res.writeHead(204);
        res.end();
      } catch (e) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(String(e));
      }
    });
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[ptc-sort-log] writing to ${logFile}`);
  console.log(`[ptc-sort-log] listening on http://127.0.0.1:${port}/ptc-sort`);
});
