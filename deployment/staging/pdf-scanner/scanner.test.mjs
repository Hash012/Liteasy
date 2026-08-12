import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { Readable } from "node:stream";
import test from "node:test";
import { ClamAvClient } from "./clamavClient.mjs";
import { createRequestHandler } from "./server.mjs";

const secret = "scanner-test-secret-with-at-least-32-characters";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

function config(overrides = {}) {
  return {
    maximumBytes: 1024 * 1024,
    maximumConcurrent: 2,
    secret,
    ...overrides
  };
}

function scanner({ clean = true, fail = false } = {}) {
  return {
    async info() {
      if (fail) throw new Error("offline");
      return { scanner: "clamav", version: "1.5.4/28087" };
    },
    async scan(readable) {
      if (fail) throw new Error("offline");
      const chunks = [];
      for await (const chunk of readable) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      return {
        byteLength: bytes.length,
        clean,
        contentHash: createHash("sha256").update(bytes).digest("hex"),
        scanner: "clamav",
        version: "1.5.4/28087"
      };
    }
  };
}

async function request(port, bytes, overrides = {}) {
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  return fetch(`http://127.0.0.1:${port}/v1/pdf:scan`, {
    body: bytes,
    headers: {
      authorization: `Bearer ${secret}`,
      "content-length": String(bytes.length),
      "content-type": "application/pdf",
      "x-liteasy-content-sha256": contentHash,
      "x-liteasy-scan-protocol": "1",
      ...overrides.headers
    },
    method: "POST"
  });
}

test("serves strict Liteasy responses for clean and rejected PDFs", async (t) => {
  const bytes = Buffer.from("%PDF-1.7\nbody");
  for (const clean of [true, false]) {
    const server = http.createServer(createRequestHandler(config(), scanner({ clean })));
    const port = await listen(server);
    t.after(() => close(server));
    const response = await request(port, bytes);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.deepEqual(await response.json(), {
      clean,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      scanner: "clamav",
      version: "1.5.4/28087"
    });
  }
});

test("fails closed on authentication, hash binding, media type, size, and scanner errors", async (t) => {
  const bytes = Buffer.from("%PDF-1.7\nbody");
  const server = http.createServer(createRequestHandler(config({ maximumBytes: bytes.length }), scanner()));
  const port = await listen(server);
  t.after(() => close(server));

  assert.equal((await request(port, bytes, { headers: { authorization: "Bearer wrong" } })).status, 401);
  assert.equal((await request(port, bytes, {
    headers: { "x-liteasy-content-sha256": "0".repeat(64) }
  })).status, 400);
  assert.equal((await request(port, bytes, { headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await request(port, Buffer.concat([bytes, Buffer.from("x")]))).status, 413);

  const failedServer = http.createServer(createRequestHandler(config(), scanner({ fail: true })));
  const failedPort = await listen(failedServer);
  t.after(() => close(failedServer));
  assert.equal((await request(failedPort, bytes)).status, 503);
  assert.equal((await fetch(`http://127.0.0.1:${failedPort}/readyz`)).status, 503);
});

function mockClamd() {
  return net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let mode;
    let body = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!mode) {
        const terminator = buffer.indexOf(0);
        if (terminator < 0) return;
        mode = buffer.subarray(0, terminator).toString("ascii");
        buffer = buffer.subarray(terminator + 1);
        if (mode === "zPING") socket.end("PONG\0");
        if (mode === "zVERSION") socket.end("ClamAV 1.5.4/28087/Sun Aug 9 06:24:56 2026\0");
      }
      if (mode !== "zINSTREAM") return;
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (length === 0) {
          const verdict = body.includes(Buffer.from("infected"))
            ? "stream: Test.Signature FOUND\0"
            : "stream: OK\0";
          socket.end(verdict);
          return;
        }
        if (buffer.length < length + 4) return;
        body = Buffer.concat([body, buffer.subarray(4, length + 4)]);
        buffer = buffer.subarray(length + 4);
      }
    });
  });
}

test("streams bytes to clamd and maps clean and malicious verdicts", async (t) => {
  const daemon = mockClamd();
  const port = await listen(daemon);
  t.after(() => close(daemon));
  const client = new ClamAvClient({ host: "127.0.0.1", port, timeoutMs: 2_000 });
  assert.deepEqual(await client.info(), { scanner: "clamav", version: "1.5.4/28087" });

  for (const [source, clean] of [["%PDF-clean", true], ["%PDF-infected", false]]) {
    const result = await client.scan(Readable.from([source]), {
      expectedLength: Buffer.byteLength(source),
      maximumBytes: 1024
    });
    assert.equal(result.clean, clean);
    assert.equal(result.contentHash, createHash("sha256").update(source).digest("hex"));
    assert.equal(result.version, "1.5.4/28087");
  }
});

test("rejects a stream whose bytes do not match the declared length", async (t) => {
  const daemon = mockClamd();
  const port = await listen(daemon);
  t.after(() => close(daemon));
  const client = new ClamAvClient({ host: "127.0.0.1", port, timeoutMs: 2_000 });
  await assert.rejects(
    () => client.scan(Readable.from(["short"]), { expectedLength: 6, maximumBytes: 1024 }),
    /scanner_request_length_mismatch/
  );
});

test("ignores empty stream chunks without terminating the clamd request", async (t) => {
  const daemon = mockClamd();
  const port = await listen(daemon);
  t.after(() => close(daemon));
  const client = new ClamAvClient({ host: "127.0.0.1", port, timeoutMs: 2_000 });
  const result = await client.scan(Readable.from(["%PDF-", Buffer.alloc(0), "clean"]), {
    expectedLength: 10,
    maximumBytes: 1024
  });
  assert.equal(result.clean, true);
  assert.equal(result.contentHash, createHash("sha256").update("%PDF-clean").digest("hex"));
});
