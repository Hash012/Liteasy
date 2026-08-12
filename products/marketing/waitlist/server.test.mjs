import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWaitlistServer } from "./server.mjs";

async function start(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "liteasy-waitlist-"));
  const dataFile = join(directory, "submissions.jsonl");
  const server = createWaitlistServer({ dataFile, maxPerHour: 20, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { dataFile, server, url: `http://127.0.0.1:${port}` };
}

function stop(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("stores a valid application and reports unavailable installer truthfully", async () => {
  const fixture = await start();
  try {
    const response = await fetch(fixture.url + "/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "reader@example.com", role: "研究生", field: "信息检索" })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.downloadUrl, undefined);
    assert.match(body.message, /安装包准备完成后/);
    assert.match(await readFile(fixture.dataFile, "utf8"), /reader@example\.com/);
  } finally {
    await stop(fixture.server);
  }
});

test("requires an application token and streams the configured installer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "liteasy-installer-"));
  const installerPath = join(directory, "Liteasy.exe");
  await writeFile(installerPath, "signed-installer-fixture");
  const fixture = await start({ installerPath, downloadSecret: "test-secret-with-sufficient-entropy" });
  try {
    assert.equal((await fetch(fixture.url + "/downloads/liteasy-windows")).status, 403);
    const application = await fetch(fixture.url + "/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "researcher@example.com", role: "青年研究者" })
    });
    const body = await application.json();
    assert.match(body.downloadUrl, /^\/downloads\/liteasy-windows\?/);
    const download = await fetch(fixture.url + body.downloadUrl);
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition"), /Liteasy-windows-x64-setup\.exe/);
    assert.equal(await download.text(), "signed-installer-fixture");
  } finally {
    await stop(fixture.server);
  }
});

test("rejects invalid application data", async () => {
  const fixture = await start();
  try {
    const response = await fetch(fixture.url + "/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "invalid", role: "研究生" })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /有效邮箱/);
  } finally {
    await stop(fixture.server);
  }
});
