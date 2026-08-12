import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("configure-runtime.mjs", import.meta.url));

function certificate(name) {
  return `-----BEGIN CERTIFICATE-----\n${name}\n-----END CERTIFICATE-----\n`;
}

test("configures an isolated CA bundle and stable scanner secret", (t) => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-scanner-runtime-"));
  t.after(() => fs.rmSync(runtime, { force: true, recursive: true }));
  fs.mkdirSync(path.join(runtime, "pdf-scanner", "tls"), { recursive: true });

  const rds = certificate("RDS-ONLY");
  const scanner = certificate("SCANNER-ONLY");
  fs.writeFileSync(path.join(runtime, "aliyun-rds-ca.pem"), rds + scanner);
  fs.writeFileSync(path.join(runtime, "aliyun-rds-only-ca.pem"), rds);
  fs.writeFileSync(path.join(runtime, "pdf-scanner", "tls", "ca.crt"), scanner);
  fs.writeFileSync(path.join(runtime, "liteasy-api.env"), [
    "LITEASY_S3_PREFIX=documents",
    "LITEASY_PDF_SCANNER_URL=https://replace-with-private-pdf-scanner.example",
    "LITEASY_PDF_SCANNER_SECRET=replace-with-root-only-secret-at-least-32-characters",
    ""
  ].join("\n"), { mode: 0o600 });

  execFileSync(process.execPath, [script, runtime], { stdio: "pipe" });
  const firstEnvironment = fs.readFileSync(path.join(runtime, "liteasy-api.env"), "utf8");
  const firstScannerEnvironment = fs.readFileSync(path.join(runtime, "pdf-scanner.env"), "utf8");
  assert.match(firstEnvironment, /^LITEASY_S3_SECURITY_PROFILE=aliyun-oss$/m);
  assert.match(firstEnvironment, /^LITEASY_PDF_SCANNER_URL=https:\/\/pdf-scanner:8443\/v1\/pdf:scan$/m);
  const secret = /^PDF_SCANNER_SECRET=([a-f0-9]{64})$/m.exec(firstScannerEnvironment)?.[1];
  assert.ok(secret);
  assert.match(firstEnvironment, new RegExp(`^LITEASY_PDF_SCANNER_SECRET=${secret}$`, "m"));
  assert.equal(fs.readFileSync(path.join(runtime, "aliyun-rds-ca.pem"), "utf8"), rds);
  assert.equal(fs.readFileSync(path.join(runtime, "liteasy-api-ca.pem"), "utf8"), rds + scanner);
  assert.equal(fs.statSync(path.join(runtime, "liteasy-api.env")).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(runtime, "pdf-scanner.env")).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(runtime, "liteasy-api-ca.pem")).mode & 0o777, 0o644);

  execFileSync(process.execPath, [script, runtime], { stdio: "pipe" });
  assert.equal(fs.readFileSync(path.join(runtime, "pdf-scanner.env"), "utf8"), firstScannerEnvironment);
  assert.equal(fs.readFileSync(path.join(runtime, "liteasy-api.env"), "utf8"), firstEnvironment);

  const renewedRds = certificate("RENEWED-RDS");
  fs.writeFileSync(path.join(runtime, "aliyun-rds-ca.pem"), renewedRds);
  execFileSync(process.execPath, [script, runtime], { stdio: "pipe" });
  assert.equal(fs.readFileSync(path.join(runtime, "aliyun-rds-ca.pem"), "utf8"), renewedRds);
  assert.equal(
    fs.readFileSync(path.join(runtime, "liteasy-api-ca.pem"), "utf8"),
    renewedRds + scanner
  );
});
