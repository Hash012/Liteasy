// Run against the actual desktop binary (including Windows release EXE).
// This tests inherited stdin/stdout and the native bridge without opening a WebView.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

if (!process.argv[2]) throw new Error("Usage: node scripts/check-local-mcp-stdio.mjs /absolute/path/to/Liteasy.exe");
const directory = await mkdtemp(join(tmpdir(), "liteasy-mcp-"));
const token = randomBytes(24).toString("hex");
const generation = "stdio-smoke";
const scopeId = "test-only";
let failure;
const received = [];
const sockets = new Set();
const server = createServer((socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.setTimeout(5_000, () => socket.destroy());
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (data) => {
    buffer += data;
    if (buffer.length > 65536) { socket.destroy(); return; }
    if (!buffer.includes("\n")) return;
    try {
      const bridge = JSON.parse(buffer.slice(0, buffer.indexOf("\n")));
      assert.equal(bridge.token, token);
      assert.equal(bridge.generation, generation);
      assert.equal(bridge.scopeId, scopeId);
      const request = JSON.parse(bridge.line);
      received.push(request.method);
      const line = request.id === undefined ? null : JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {
        ...(request.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "stdio-fixture", version: "1" } } : { echo: "研究笔记" }),
      } });
      socket.end(JSON.stringify({ line }) + "\n");
    } catch (error) { failure = error; socket.destroy(); }
  });
});
let child;
try {
  await new Promise((yes, no) => { server.once("error", no); server.listen(0, "127.0.0.1", yes); });
  const file = join(directory, "连接 config.json");
  await writeFile(file, JSON.stringify({ address: `127.0.0.1:${server.address().port}`, token, generation, scopeId }), { mode: 0o600 });
  child = spawn(resolve(process.argv[2]), ["--local-mcp", file], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let output = "", diagnostic = "";
  child.stdout.setEncoding("utf8").on("data", (data) => { output += data; });
  child.stderr.setEncoding("utf8").on("data", (data) => { diagnostic += data; });
  const timer = setTimeout(() => child.kill(), 15_000);
  const exit = new Promise((yes, no) => { child.once("error", no); child.once("close", (code) => yes(code)); });
  for (const request of [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "ping" },
  ]) child.stdin.write(JSON.stringify(request) + "\n");
  child.stdin.end();
  let code;
  try { code = await exit; } finally { clearTimeout(timer); }
  if (failure) throw failure;
  assert.equal(code, 0, diagnostic);
  const lines = output.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.deepEqual(received, ["initialize", "notifications/initialized", "ping"]);
  assert.deepEqual(lines.map((line) => line.id), [1, 2]);
  assert.equal(lines[1].result.echo, "研究笔记");
  console.log("Native MCP stdio passed: inherited pipes, Unicode paths/data, notifications, clean JSON output.");
} finally {
  child?.kill();
  for (const socket of sockets) socket.destroy();
  server.close();
  await rm(directory, { recursive: true, force: true });
}
