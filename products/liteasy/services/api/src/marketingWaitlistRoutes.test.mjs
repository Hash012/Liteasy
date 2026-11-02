import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createCloudRequestHandler } from "./server.mjs";
import { MarketingWaitlistService } from "./marketingWaitlist.mjs";

test("public application HTTP contract validates inputs, saves data and returns a private download", async (t) => {
  const rows = [];
  const pool = { async connect() {
    return {
      async query(sql, values) {
        if (sql.includes("SELECT count")) return { rows: [{ personal: rows.length, global: rows.length }] };
        if (sql.includes("INSERT")) rows.push(values);
        return { rows: [] };
      },
      release() {}
    };
  } };
  const marketingWaitlist = new MarketingWaitlistService(pool, {
    origin: "https://staging.liteasyclaw.com", installerKey: "installers/release.exe", expiresSeconds: 600
  }, async () => "https://liteasy.oss-cn-hongkong.aliyuncs.com/installers/release.exe?test-signature");
  const runtime = { marketingWaitlist };
  const server = http.createServer(createCloudRequestHandler(runtime, { allowedOrigins: [] }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/api/waitlist`;
  const body = JSON.stringify({ email: "reader@example.com", role: "研究生" });
  const headers = { "content-type": "application/json", origin: "https://staging.liteasyclaw.com" };
  const send = (overrides = {}) => fetch(url, { method: "POST", headers, body, ...overrides });
  const wrongOrigin = await send({ headers: { ...headers, origin: "https://attacker.example" } });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(rows.length, 0);
  assert.equal((await send({ body: "{" })).status, 400);
  assert.equal((await send({ body: JSON.stringify({ email: "x".repeat(17000) }) })).status, 413);
  assert.equal((await send({ headers: { ...headers, "content-type": "text/plain" } })).status, 415);
  const wrongMethod = await fetch(url);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");
  const result = await send();
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal((await result.json()).expiresIn, 600);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1], "reader@example.com");
  for (let index = 0; index < 4; index++) assert.equal((await send()).status, 200);
  const limited = await send();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "600");
  assert.equal((await limited.json()).ok, false);
  runtime.marketingWaitlist = undefined;
  assert.equal((await send()).status, 503);
});
