import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const endpoint = process.env.PDF_SCANNER_URL || "https://pdf-scanner:8443/v1/pdf:scan";
const secret = process.env.PDF_SCANNER_SECRET;
const mode = process.argv[2] || "full";

if (!secret || secret.length < 32) throw new Error("PDF_SCANNER_SECRET is missing or invalid");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function scan(bytes, { authorization = secret, contentHash = sha256(bytes) } = {}) {
  return fetch(endpoint, {
    body: bytes,
    duplex: "half",
    headers: {
      authorization: `Bearer ${authorization}`,
      "content-length": String(bytes.length),
      "content-type": "application/pdf",
      "x-liteasy-content-sha256": contentHash,
      "x-liteasy-scan-protocol": "1"
    },
    method: "POST",
    redirect: "error"
  });
}

async function body(response) {
  assert.equal(response.headers.get("content-type"), "application/json");
  return response.json();
}

async function expectFullAcceptance() {
  const cleanPdf = Buffer.from("%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n");
  const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
  const eicarPdf = Buffer.from([
    "%PDF-1.7",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 4 0 R >> endobj",
    `4 0 obj << /Length ${Buffer.byteLength(eicar)} >> stream`,
    eicar,
    "endstream endobj",
    "trailer << /Root 1 0 R >>",
    "%%EOF",
    ""
  ].join("\n"));

  const cleanResponse = await scan(cleanPdf);
  assert.equal(cleanResponse.status, 200);
  const cleanResult = await body(cleanResponse);
  assert.deepEqual(Object.keys(cleanResult).sort(), ["clean", "contentHash", "scanner", "version"]);
  assert.equal(cleanResult.clean, true);
  assert.equal(cleanResult.contentHash, sha256(cleanPdf));
  assert.equal(cleanResult.scanner, "clamav");

  const infectedResponse = await scan(eicarPdf);
  assert.equal(infectedResponse.status, 200);
  const infectedResult = await body(infectedResponse);
  assert.equal(infectedResult.clean, false);
  assert.equal(infectedResult.contentHash, sha256(eicarPdf));
  assert.equal(infectedResult.scanner, "clamav");

  const mismatchedResponse = await scan(cleanPdf, { contentHash: "0".repeat(64) });
  assert.equal(mismatchedResponse.status, 400);
  assert.deepEqual(await body(mismatchedResponse), { error: "content_integrity_mismatch" });

  const unauthorizedResponse = await scan(cleanPdf, { authorization: "incorrect-scanner-secret" });
  assert.equal(unauthorizedResponse.status, 401);
  assert.deepEqual(await body(unauthorizedResponse), { error: "unauthorized" });

  const readinessResponse = await fetch(new URL("/readyz", endpoint));
  assert.equal(readinessResponse.status, 200);
  const readiness = await body(readinessResponse);
  assert.equal(readiness.scanner, "clamav");
  assert.equal(readiness.status, "ready");

  process.stdout.write(JSON.stringify({
    cleanPdf: "accepted",
    eicarPdf: "rejected",
    integrityMismatch: "rejected",
    scanner: readiness.scanner,
    unauthorized: "rejected",
    version: readiness.version
  }) + "\n");
}

async function expectUnavailable() {
  const bytes = Buffer.from("%PDF-1.7\n%%EOF\n");
  const scanResponse = await scan(bytes);
  assert.equal(scanResponse.status, 503);
  assert.deepEqual(await body(scanResponse), { error: "scanner_unavailable" });
  const readinessResponse = await fetch(new URL("/readyz", endpoint));
  assert.equal(readinessResponse.status, 503);
  assert.deepEqual(await body(readinessResponse), { error: "scanner_unavailable" });
  process.stdout.write(JSON.stringify({ readiness: "unavailable", scan: "failed_closed" }) + "\n");
}

if (mode === "full") await expectFullAcceptance();
else if (mode === "unavailable") await expectUnavailable();
else throw new Error(`unsupported acceptance mode: ${mode}`);
