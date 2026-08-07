import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  HttpsPdfSecurityScanner,
  maximumScannerResponseBytes
} from "./pdfSecurityScanner.mjs";

const contentHash = "a".repeat(64);

function scanner(fetchImpl, overrides = {}) {
  return new HttpsPdfSecurityScanner({
    endpoint: "https://scanner.internal/v1/pdf:scan",
    secret: "deployment-scanner-secret",
    timeoutMs: 100,
    ...overrides
  }, {
    fetchImpl,
    now: () => new Date("2026-08-07T00:00:00.000Z")
  });
}

function result(overrides = {}) {
  return new Response(JSON.stringify({
    clean: true,
    contentHash,
    scanner: "clamav",
    version: "1.4.3",
    ...overrides
  }), { headers: { "content-type": "application/json" }, status: 200 });
}

test("streams a PDF with deployment authentication and accepts a hash-bound clean result", async () => {
  const source = Readable.from([Buffer.from("%PDF-"), Buffer.from("1.7\nbody")]);
  const calls = [];
  const client = scanner(async (url, init) => {
    calls.push({ init, url });
    let received = 0;
    for await (const chunk of init.body) received += chunk.length;
    assert.equal(received, 13);
    return result();
  });

  assert.deepEqual(await client.scan(source, { byteLength: 13, contentHash }), {
    contentHash,
    scannedAt: "2026-08-07T00:00:00.000Z",
    scanner: "clamav",
    version: "1.4.3"
  });
  assert.equal(calls[0].url, "https://scanner.internal/v1/pdf:scan");
  assert.equal(calls[0].init.body, source);
  assert.equal(calls[0].init.duplex, "half");
  assert.equal(calls[0].init.headers.authorization, "Bearer deployment-scanner-secret");
  assert.equal(calls[0].init.headers["x-liteasy-content-sha256"], contentHash);
});

test("returns a stable rejection only for a valid hash-bound dirty result", async () => {
  await assert.rejects(
    () => scanner(async () => result({ clean: false })).scan(
      Readable.from(["%PDF-dirty"]),
      { byteLength: 10, contentHash }
    ),
    (error) => error.code === "pdf_security_rejected" && error.status === 422
  );
});

test("fails closed on hash mismatch, extra fields, invalid JSON and oversized responses", async () => {
  const cases = [
    async () => result({ contentHash: "b".repeat(64) }),
    async () => result({ detail: "not allowed" }),
    async () => new Response("not-json", { headers: { "content-type": "application/json" } }),
    async () => new Response(JSON.stringify({ padding: "x".repeat(maximumScannerResponseBytes) }), {
      headers: { "content-type": "application/json" }
    })
  ];
  for (const fetchImpl of cases) {
    await assert.rejects(
      () => scanner(fetchImpl).scan(Readable.from(["%PDF-body"]), { byteLength: 9, contentHash }),
      (error) => error.code === "pdf_security_scanner_unavailable" && error.status === 503
    );
  }
});

test("maps scanner timeouts and non-success responses to stable unavailability", async () => {
  const timeoutClient = scanner((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }), { timeoutMs: 5 });
  await assert.rejects(
    () => timeoutClient.scan(Readable.from(["%PDF-body"]), { byteLength: 9, contentHash }),
    /pdf_security_scanner_unavailable/
  );
  await assert.rejects(
    () => scanner(async () => new Response("denied", { status: 401 })).scan(
      Readable.from(["%PDF-body"]),
      { byteLength: 9, contentHash }
    ),
    /pdf_security_scanner_unavailable/
  );
});
