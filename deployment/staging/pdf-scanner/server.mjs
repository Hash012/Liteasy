import { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import { fileURLToPath } from "node:url";
import { ClamAvClient } from "./clamavClient.mjs";

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`pdf_scanner_config_missing:${name}`);
  return value;
}

function positiveInteger(env, name, fallback, maximum) {
  const source = env[name]?.trim() || String(fallback);
  if (!/^[1-9][0-9]*$/.test(source)) throw new Error(`pdf_scanner_config_invalid:${name}`);
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value > maximum) {
    throw new Error(`pdf_scanner_config_invalid:${name}`);
  }
  return value;
}

export function loadScannerConfig(env = process.env) {
  const secret = required(env, "PDF_SCANNER_SECRET");
  if (secret.length < 32 || secret.length > 4096) {
    throw new Error("pdf_scanner_config_invalid:PDF_SCANNER_SECRET");
  }
  return Object.freeze({
    clamav: Object.freeze({
      host: required(env, "CLAMAV_HOST"),
      port: positiveInteger(env, "CLAMAV_PORT", 3310, 65_535),
      timeoutMs: positiveInteger(env, "CLAMAV_TIMEOUT_MS", 110_000, 300_000)
    }),
    host: env.PDF_SCANNER_HOST?.trim() || "0.0.0.0",
    maximumBytes: positiveInteger(
      env,
      "PDF_SCANNER_MAX_BYTES",
      256 * 1024 * 1024,
      256 * 1024 * 1024
    ),
    maximumConcurrent: positiveInteger(env, "PDF_SCANNER_MAX_CONCURRENT", 2, 16),
    port: positiveInteger(env, "PDF_SCANNER_PORT", 8443, 65_535),
    secret,
    tlsCertificateFile: required(env, "PDF_SCANNER_TLS_CERT_FILE"),
    tlsKeyFile: required(env, "PDF_SCANNER_TLS_KEY_FILE")
  });
}

function oneHeader(request, name) {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

function authorized(request, secret) {
  const value = oneHeader(request, "authorization");
  if (!value?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(value.slice(7), "utf8");
  const expected = Buffer.from(secret, "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function json(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "cache-control": "no-store",
    connection: "close",
    "content-length": String(body.length),
    "content-type": "application/json",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

function rejectRequest(request, response, status, code) {
  json(response, status, { error: code });
  request.resume();
}

function log(value) {
  process.stdout.write(`${JSON.stringify({ component: "pdf-scanner", ...value })}\n`);
}

export function createRequestHandler(config, client) {
  let activeScans = 0;
  return async function handle(request, response) {
    if (request.method === "GET" && request.url === "/healthz") {
      json(response, 200, { status: "ok" });
      return;
    }
    if (request.method === "GET" && request.url === "/readyz") {
      try {
        const info = await client.info();
        json(response, 200, { scanner: info.scanner, status: "ready", version: info.version });
      } catch {
        json(response, 503, { error: "scanner_unavailable" });
      }
      return;
    }
    if (request.url !== "/v1/pdf:scan") {
      rejectRequest(request, response, 404, "not_found");
      return;
    }
    if (request.method !== "POST") {
      rejectRequest(request, response, 405, "method_not_allowed");
      return;
    }
    if (!authorized(request, config.secret)) {
      rejectRequest(request, response, 401, "unauthorized");
      return;
    }
    if (oneHeader(request, "x-liteasy-scan-protocol") !== "1") {
      rejectRequest(request, response, 400, "scan_protocol_invalid");
      return;
    }
    if (oneHeader(request, "content-type")?.toLowerCase() !== "application/pdf") {
      rejectRequest(request, response, 415, "content_type_invalid");
      return;
    }
    const lengthSource = oneHeader(request, "content-length");
    if (!lengthSource || !/^[1-9][0-9]*$/.test(lengthSource)) {
      rejectRequest(request, response, 411, "content_length_required");
      return;
    }
    const expectedLength = Number(lengthSource);
    if (!Number.isSafeInteger(expectedLength) || expectedLength > config.maximumBytes) {
      rejectRequest(request, response, 413, "pdf_too_large");
      return;
    }
    const expectedHash = oneHeader(request, "x-liteasy-content-sha256");
    if (!expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash)) {
      rejectRequest(request, response, 400, "content_hash_invalid");
      return;
    }
    if (activeScans >= config.maximumConcurrent) {
      rejectRequest(request, response, 503, "scanner_busy");
      return;
    }

    activeScans += 1;
    const startedAt = Date.now();
    try {
      const result = await client.scan(request, {
        expectedLength,
        maximumBytes: config.maximumBytes
      });
      if (result.byteLength !== expectedLength || result.contentHash !== expectedHash) {
        rejectRequest(request, response, 400, "content_integrity_mismatch");
        log({ durationMs: Date.now() - startedAt, result: "integrity_mismatch" });
        return;
      }
      json(response, 200, {
        clean: result.clean,
        contentHash: expectedHash,
        scanner: result.scanner,
        version: result.version
      });
      log({
        byteLength: result.byteLength,
        durationMs: Date.now() - startedAt,
        result: result.clean ? "clean" : "rejected",
        version: result.version
      });
    } catch (error) {
      if (!response.headersSent) rejectRequest(request, response, 503, "scanner_unavailable");
      log({
        code: typeof error?.code === "string" ? error.code : "scanner_failure",
        durationMs: Date.now() - startedAt,
        result: "failure"
      });
    } finally {
      activeScans -= 1;
    }
  };
}

async function main() {
  const config = loadScannerConfig();
  const client = new ClamAvClient(config.clamav);
  const info = await client.info();
  const server = https.createServer({
    cert: fs.readFileSync(config.tlsCertificateFile),
    key: fs.readFileSync(config.tlsKeyFile),
    minVersion: "TLSv1.2"
  }, createRequestHandler(config, client));
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1_000;
  server.maxHeadersCount = 32;
  server.maxRequestsPerSocket = 1;
  server.requestTimeout = Math.min(config.clamav.timeoutMs + 10_000, 300_000);
  server.on("checkContinue", (request, response) => {
    request.resume();
    json(response, 417, { error: "expectation_not_supported" });
  });
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  log({ event: "listening", port: config.port, version: info.version });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    log({ code: error?.message || "startup_failure", event: "startup_failed" });
    process.exitCode = 1;
  });
}
