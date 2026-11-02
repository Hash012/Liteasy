import assert from "node:assert/strict";
import test from "node:test";
import OSS from "ali-oss";
import { createOssInstallerSigner, loadMarketingWaitlistConfig, MarketingWaitlistService } from "./marketingWaitlist.mjs";

const config = { origin: "https://www.example.com", installerKey: "installers/1.0/Liteasy.exe", expiresSeconds: 600 };
const input = { email: " User@example.com ", role: "研究生", field: "Research", problem: "Reading" };
const context = { origin: config.origin, clientIp: "192.0.2.1" };

function harness({ counts = { personal: 0, global: 0 }, failInsert = false, failSign = false, installerKey = config.installerKey } = {}) {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("SELECT count")) return { rows: [counts] };
      if (failInsert && sql.includes("INSERT")) throw new Error("database unavailable");
      return { rows: [] };
    },
    release() { calls.push({ sql: "RELEASE" }); }
  };
  const service = new MarketingWaitlistService({ async connect() { return client; } }, { ...config, installerKey }, async (key, ttl) => {
    calls.push({ sign: key, ttl });
    if (failSign) throw new Error("private credentials must never reach the response");
    return "https://private.example.com/signed";
  });
  return { service, calls };
}

test("waitlist is opt-in and rejects unsafe origins, object paths and link lifetimes", () => {
  assert.equal(loadMarketingWaitlistConfig({}), undefined);
  const env = { LITEASY_WAITLIST_ORIGIN: config.origin, LITEASY_WAITLIST_INSTALLER_KEY: config.installerKey };
  assert.deepEqual(loadMarketingWaitlistConfig(env), { ...config, transferAcceleration: false });
  assert.equal(loadMarketingWaitlistConfig({ ...env, LITEASY_WAITLIST_TRANSFER_ACCELERATION: "true" }).transferAcceleration, true);
  for (const overrides of [
    { LITEASY_WAITLIST_ORIGIN: "http://www.example.com" },
    { LITEASY_WAITLIST_ORIGIN: "https://www.example.com/path" },
    { LITEASY_WAITLIST_INSTALLER_KEY: "documents/private.exe" },
    { LITEASY_WAITLIST_INSTALLER_KEY: "installers/../private.exe" },
    { LITEASY_WAITLIST_DOWNLOAD_TTL_SECONDS: "86400" },
    { LITEASY_WAITLIST_TRANSFER_ACCELERATION: "yes" }
  ]) assert.throws(() => loadMarketingWaitlistConfig({ ...env, ...overrides }));
});

test("saves normalized application before signing only the configured installer", async () => {
  const { service, calls } = harness();
  const result = await service.submit(input, context);
  assert.equal(result.ok, true);
  assert.equal(result.expiresIn, 600);
  const insert = calls.find((call) => call.sql?.includes("INSERT"));
  assert.equal(insert.values[1], "user@example.com");
  assert.match(insert.values[5], /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(calls).includes(context.clientIp), false);
  assert.ok(calls.findIndex((call) => call.sql === "COMMIT") < calls.findIndex((call) => call.sign));
  assert.deepEqual(calls.at(-1), { sign: config.installerKey, ttl: 600 });
});

test("rejects foreign origins and malformed applications before database or signing", async () => {
  const { service, calls } = harness();
  await assert.rejects(service.submit(input, { ...context, origin: "https://attacker.example" }), { status: 403 });
  for (const body of [null, [], { ...input, email: "bad" }, { ...input, role: "admin" },
    { ...input, problem: "x".repeat(2001) }, { ...input, installerKey: "documents/private.exe" }]) {
    await assert.rejects(service.submit(body, context), { status: 400 });
  }
  assert.equal(calls.length, 0);
});

test("persistent per-user and global limits roll back without signing", async () => {
  for (const counts of [{ personal: 5, global: 5 }, { personal: 0, global: 100 }]) {
    const { service, calls } = harness({ counts });
    await assert.rejects(service.submit(input, context), { status: 429 });
    assert.equal(calls.some((call) => call.sign || call.sql?.includes("INSERT")), false);
    assert.equal(calls.at(-2).sql, "ROLLBACK");
    assert.equal(calls.at(-1).sql, "RELEASE");
  }
});

test("database failure never issues a download and signing failure keeps the application", async () => {
  const failedDb = harness({ failInsert: true });
  await assert.rejects(failedDb.service.submit(input, context), /database unavailable/);
  assert.equal(failedDb.calls.some((call) => call.sign), false);
  const failedOss = harness({ failSign: true });
  await assert.rejects(failedOss.service.submit(input, context), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.message.includes("credentials"), false);
    return true;
  });
  assert.ok(failedOss.calls.some((call) => call.sql === "COMMIT"));
});

test("unpublished installer records application without claiming download or email delivery", async () => {
  const { service, calls } = harness({ installerKey: "" });
  const result = await service.submit(input, context);
  assert.equal(result.ok, true);
  assert.equal(result.downloadUrl, undefined);
  assert.equal(calls.some((call) => call.sign), false);
});

test("real OSS SDK signs HTTPS GET with expiry, attachment name and scoped object", async () => {
  const keys = [];
  class Client extends OSS {
    async head(key) { keys.push(key); }
  }
  const sign = createOssInstallerSigner({ provider: "aliyun-oss", bucket: "test-private", region: "cn-hongkong" },
    async () => ({ accessKeyId: "test-id", secretAccessKey: "test-secret", sessionToken: "test-session" }), { Client });
  const url = new URL(await sign(config.installerKey, 600));
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "test-private.oss-cn-hongkong.aliyuncs.com");
  assert.equal(url.pathname, `/${config.installerKey}`);
  assert.equal(url.searchParams.get("x-oss-expires"), "600");
  assert.equal(url.searchParams.get("x-oss-signature-version"), "OSS4-HMAC-SHA256");
  assert.equal(url.searchParams.get("x-oss-security-token"), "test-session");
  assert.match(url.searchParams.get("response-content-disposition"), /^attachment;/);
  assert.equal(url.searchParams.has("response-content-type"), false);
  assert.match(url.searchParams.get("x-oss-signature"), /^[a-f0-9]{64}$/);
  assert.deepEqual(keys, [config.installerKey]);
});

test("acceleration uses its public host for object checks and links but preserves Hong Kong signing region", async () => {
  let headHost;
  class Client extends OSS {
    async head() { headHost = this.options.endpoint.hostname; }
  }
  const sign = createOssInstallerSigner({ provider: "aliyun-oss", bucket: "test-private", region: "cn-hongkong" },
    async () => ({ accessKeyId: "test-id", secretAccessKey: "test-secret" }), { Client, transferAcceleration: true });
  const url = new URL(await sign(config.installerKey, 600));
  assert.equal(headHost, "oss-accelerate.aliyuncs.com");
  assert.equal(url.hostname, "test-private.oss-accelerate.aliyuncs.com");
  assert.equal(url.searchParams.has("response-content-type"), false);
  assert.match(url.searchParams.get("response-content-disposition"), /^attachment;/);
  assert.equal(url.protocol, "https:");
  assert.equal(url.pathname, `/${config.installerKey}`);
  assert.match(url.searchParams.get("x-oss-credential"), /\/cn-hongkong\/oss\/aliyun_v4_request$/);
  assert.equal(url.searchParams.get("x-oss-expires"), "600");
  assert.match(url.searchParams.get("x-oss-signature"), /^[a-f0-9]{64}$/);
});
