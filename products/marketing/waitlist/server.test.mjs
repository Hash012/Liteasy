import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWaitlistServer } from "./server.mjs";

async function start(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "liteasy-waitlist-"));
  const dataFile = join(directory, "submissions.jsonl");
  const applicationWrites = [];
  const server = createWaitlistServer({
    applicationWriter: async (path, body) => {
      applicationWrites.push({ body, path });
      return { ok: true };
    },
    dataFile,
    maxPerHour: 20,
    ...options
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { applicationWrites, dataFile, server, url: `http://127.0.0.1:${port}` };
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
    assert.equal(fixture.applicationWrites[0].path, "/v1/internal/marketing/applications");
    assert.equal(fixture.applicationWrites[0].body.email, "reader@example.com");
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
    assert.equal(fixture.applicationWrites.at(-1).path, "/v1/internal/marketing/installer-downloaded");
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

test("does not report success when durable application storage is unavailable", async () => {
  const fixture = await start({
    applicationWriter: async () => {
      throw Object.assign(new Error("database unavailable"), { statusCode: 503 });
    }
  });
  try {
    const response = await fetch(fixture.url + "/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "reader@example.com", role: "研究生" })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "提交暂时不可用，请稍后再试。");
    await assert.rejects(() => readFile(fixture.dataFile, "utf8"));
  } finally {
    await stop(fixture.server);
  }
});

test("publishes an installer only from the configured GitHub workflow", async () => {
  const directory = await mkdtemp(join(tmpdir(), "liteasy-release-"));
  const installerPath = join(directory, "Liteasy_0.1.0_x64-setup.exe");
  const gitSha = "a".repeat(40);
  const bytes = Buffer.alloc(2048, "installer");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const fixture = await start({
    downloadSecret: "test-secret-with-sufficient-entropy",
    installerName: "Liteasy_0.1.0_x64-setup.exe",
    installerPath,
    releaseTokenVerifier: async (token) => {
      assert.equal(token, "valid-github-token");
      return {
        sha: gitSha,
        workflow_ref: "Hash012/Liteasy/.github/workflows/windows-installer.yml@refs/heads/main"
      };
    }
  });
  try {
    const response = await fetch(fixture.url + "/api/releases/windows-installer", {
      body: bytes,
      headers: {
        authorization: "Bearer valid-github-token",
        "content-type": "application/octet-stream",
        "x-liteasy-release-filename": "Liteasy_0.1.0_x64-setup.exe",
        "x-liteasy-release-sha": gitSha,
        "x-liteasy-release-sha256": sha256,
        "x-liteasy-release-version": "0.1.0"
      },
      method: "PUT"
    });
    assert.equal(response.status, 201, await response.text());
    assert.equal((await stat(installerPath)).size, bytes.length);
    assert.equal(JSON.parse(await readFile(installerPath + ".json", "utf8")).signed, false);
    assert.equal((await (await fetch(fixture.url + "/healthz")).json()).installerReady, true);
  } finally {
    await stop(fixture.server);
  }
});

test("rejects release metadata that does not match the GitHub workflow identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "liteasy-release-rejected-"));
  const installerPath = join(directory, "Liteasy_0.1.0_x64-setup.exe");
  const bytes = Buffer.alloc(2048, "installer");
  const fixture = await start({
    installerName: "Liteasy_0.1.0_x64-setup.exe",
    installerPath,
    releaseTokenVerifier: async () => ({
      sha: "a".repeat(40),
      workflow_ref: "Hash012/Liteasy/.github/workflows/windows-installer.yml@refs/heads/main"
    })
  });
  try {
    const response = await fetch(fixture.url + "/api/releases/windows-installer", {
      body: bytes,
      headers: {
        authorization: "Bearer valid-github-token",
        "x-liteasy-release-filename": "Liteasy_0.1.0_x64-setup.exe",
        "x-liteasy-release-sha": "b".repeat(40),
        "x-liteasy-release-sha256": createHash("sha256").update(bytes).digest("hex"),
        "x-liteasy-release-version": "0.1.0"
      },
      method: "PUT"
    });
    assert.equal(response.status, 409);
    await assert.rejects(() => stat(installerPath));
  } finally {
    await stop(fixture.server);
  }
});
