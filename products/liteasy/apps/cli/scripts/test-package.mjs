import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import http from "node:http";
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(path.join(os.tmpdir(), "liteasy package "));
async function command(program, args, cwd, stdin = "", extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, shell: false, windowsHide: true, env: { ...process.env, ...extraEnv }, stdio: ["pipe", "pipe", "pipe"] });
    let output = ""; child.stdout.on("data", (value) => { output += value; }); child.stderr.resume();
    child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(`package_command_failed:${code}`)));
    child.stdin.end(stdin);
  });
}
try {
  const npm = process.env.npm_execpath;
  assert.ok(npm, "Run with npm run test:package");
  if (!process.env.LITEASY_CLI_ARCHIVE) await command(process.execPath, [npm, "pack", "--pack-destination", directory], root);
  const archive = process.env.LITEASY_CLI_ARCHIVE ?? (await readdir(directory)).find((file) => file.endsWith(".tgz"));
  assert.ok(archive);
  await command(process.execPath, [npm, "install", "--prefix", directory, "--ignore-scripts", "--no-audit", "--no-fund", path.isAbsolute(archive) ? archive : path.join(directory, archive)], directory);
  const main = path.join(directory, "node_modules", "@liteasy", "context-cli", "dist", "main.mjs");
  const result = JSON.parse(await command(process.execPath, [main, "--version", "--json"], directory));
  assert.equal(result.result.version, "0.1.0");
  assert.ok(JSON.parse(await command(process.execPath, [main, "--help", "--json"], directory)).result.help.includes("context add"));
  const server = http.createServer((request, response) => {
    assert.equal(request.headers.authorization, `Bearer lcg_${"a".repeat(43)}`);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ schemaVersion: "liteasy.context-api/v1", subject: "package-fixture", actor: "synthetic-grant", readScopes: ["personal"], writeScopes: [], expiresAt: null, idempotencyWindowSeconds: 604800 }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const env = { LITEASY_CONFIG_DIR: path.join(directory, "配置 with spaces") };
    const login = JSON.parse(await command(process.execPath, [main, "auth", "login", "--origin", `http://127.0.0.1:${server.address().port}`, "--token-stdin", "--credential-store", "file", "--json"], directory, `lcg_${"a".repeat(43)}`, env));
    assert.equal(login.result.subject, "package-fixture");
    assert.equal(JSON.parse(await command(process.execPath, [main, "doctor", "--json"], directory, "", env)).result.reachable, true);
    if (process.platform === "win32") {
      const powershell = await command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "& $env:LITEASY_PACKAGE_EXECUTABLE --version --json"], directory, "", { LITEASY_PACKAGE_EXECUTABLE: path.join(directory, "node_modules", ".bin", "liteasy.cmd") });
      assert.equal(JSON.parse(powershell).result.version, "0.1.0");
      const { readPrivateJson, writePrivateJson } = await import(pathToFileURL(path.join(path.dirname(main), "credentials.mjs")));
      const aclFixture = path.join(directory, "ACL 配置 with spaces");
      const file = path.join(aclFixture, "synthetic.json");
      await writePrivateJson(file, { synthetic: true });
      const allowEveryone = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$p = [Console]::In.ReadToEnd()
$directory = [IO.Directory]::Exists($p)
$access = [Security.AccessControl.AccessControlSections]::Access
$acl = if ($directory) { [IO.Directory]::GetAccessControl($p, $access) } else { [IO.File]::GetAccessControl($p, $access) }
$rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'), [Security.AccessControl.FileSystemRights]::Read, [Security.AccessControl.AccessControlType]::Allow)
[void]$acl.AddAccessRule($rule)
if ($directory) { [IO.Directory]::SetAccessControl($p, $acl) } else { [IO.File]::SetAccessControl($p, $acl) }
`;
      await command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", allowEveryone], directory, file);
      await assert.rejects(readPrivateJson(file), { code: "credential_file_unsafe" });
      await command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", allowEveryone], directory, aclFixture);
      // Replacing the file also repairs a pre-existing explicit directory grant.
      await writePrivateJson(file, { synthetic: "repaired" });
      assert.deepEqual(await readPrivateJson(file), { synthetic: "repaired" });
    }
    await command(process.execPath, [main, "auth", "logout", "--json"], directory, "", env);
  } finally { await new Promise((resolve) => server.close(resolve)); }
  process.stdout.write(`${JSON.stringify({ package: archive, platform: process.platform, runtime: process.version, installedWithoutRepository: true })}\n`);
} finally { await rm(directory, { recursive: true, force: true }); }
