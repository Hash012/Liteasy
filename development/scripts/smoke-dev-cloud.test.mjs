import assert from "node:assert/strict";
import test from "node:test";
import { runDevCloudSmoke } from "./smoke-dev-cloud.mjs";

test("checks real surfaces and requires the removed demo endpoint to stay absent", async () => {
  const requested = [];
  const responses = new Map([
    ["/", new Response(JSON.stringify({ service: "liteasy-dev-cloud" }), {
      headers: { "content-type": "application/json" },
      status: 200
    })],
    ["/healthz", new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
      status: 200
    })],
    ["/admin/", new Response("<h1>Liteasy 管理后台</h1>", {
      headers: { "content-type": "text/html; charset=utf-8" },
      status: 200
    })],
    ["/v1/admin/demo-state", new Response(JSON.stringify({ code: "not_found" }), {
      headers: { "content-type": "application/json" },
      status: 404
    })]
  ]);

  const results = await runDevCloudSmoke("https://liteasy.example.test/", async (url) => {
    const path = new URL(url).pathname;
    requested.push(path);
    return responses.get(path);
  });

  assert.deepEqual(requested, ["/", "/healthz", "/admin/", "/v1/admin/demo-state"]);
  assert.deepEqual(results.at(-1), { path: "/v1/admin/demo-state", status: 404 });
});

test("fails when a removed demo endpoint becomes available again", async () => {
  await assert.rejects(
    runDevCloudSmoke("https://liteasy.example.test", async (url) => {
      const path = new URL(url).pathname;
      return new Response(path === "/admin/" ? "Liteasy 管理后台" : "{}", {
        headers: { "content-type": path === "/admin/" ? "text/html" : "application/json" },
        status: path === "/v1/admin/demo-state" ? 200 : 200
      });
    }),
    /demo-state returned 200, expected 404/
  );
});
