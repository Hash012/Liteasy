import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const runtimeDirectory = process.argv[2];
if (!runtimeDirectory || !path.isAbsolute(runtimeDirectory)) {
  throw new Error("usage: node configure-runtime.mjs <absolute-runtime-directory>");
}

const scannerDirectory = path.join(runtimeDirectory, "pdf-scanner");
const scannerEnvFile = path.join(runtimeDirectory, "pdf-scanner.env");
const scannerCaFile = path.join(scannerDirectory, "tls", "ca.crt");
const rdsCaFile = path.join(runtimeDirectory, "aliyun-rds-ca.pem");
const legacyRdsOnlyCaFile = path.join(runtimeDirectory, "aliyun-rds-only-ca.pem");
const liteasyCaFile = path.join(runtimeDirectory, "liteasy-api-ca.pem");
const liteasyEnvFile = path.join(runtimeDirectory, "liteasy-api.env");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function writeAtomic(file, value, mode) {
  const temporary = `${file}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  fs.writeFileSync(temporary, value, { encoding: "utf8", flag: "wx", mode });
  fs.chmodSync(temporary, mode);
  fs.renameSync(temporary, file);
}

function certificate(value, name) {
  const matches = value.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  if (!matches?.length) throw new Error(`certificate_missing:${name}`);
  return matches.join("\n") + "\n";
}

function scannerSecret() {
  if (!fs.existsSync(scannerEnvFile)) {
    const generated = randomBytes(32).toString("hex");
    writeAtomic(scannerEnvFile, `PDF_SCANNER_SECRET=${generated}\n`, 0o600);
    return generated;
  }
  const source = read(scannerEnvFile);
  const matches = [...source.matchAll(/^PDF_SCANNER_SECRET=(.+)$/gm)];
  if (matches.length !== 1 || matches[0][1].length < 32 || matches[0][1].length > 4096) {
    throw new Error("scanner_secret_invalid");
  }
  return matches[0][1];
}

function replaceOne(source, name, value) {
  const pattern = new RegExp(`^${name}=.*$`, "gm");
  const matches = source.match(pattern);
  if (matches?.length !== 1) throw new Error(`environment_key_invalid:${name}`);
  return source.replace(pattern, () => `${name}=${value}`);
}

function replaceOrInsertAfter(source, name, value, precedingName) {
  const pattern = new RegExp(`^${name}=.*$`, "gm");
  const matches = source.match(pattern);
  if (matches?.length === 1) return source.replace(pattern, `${name}=${value}`);
  if (matches?.length) throw new Error(`environment_key_invalid:${name}`);

  const precedingPattern = new RegExp(`^${precedingName}=.*$`, "gm");
  const precedingMatches = source.match(precedingPattern);
  if (precedingMatches?.length !== 1) {
    throw new Error(`environment_key_invalid:${precedingName}`);
  }
  return source.replace(
    precedingPattern,
    () => `${precedingMatches[0]}\n${name}=${value}`
  );
}

const scannerCertificate = certificate(read(scannerCaFile), "scanner");
let rdsCertificate = certificate(read(rdsCaFile), "rds");
// Migrate the first host installation only while its RDS bundle still contains
// the scanner CA. A later operator-provided RDS CA update must remain authoritative.
if (fs.existsSync(legacyRdsOnlyCaFile) &&
  rdsCertificate.includes(scannerCertificate.trim())) {
  rdsCertificate = certificate(read(legacyRdsOnlyCaFile), "rds");
  writeAtomic(rdsCaFile, rdsCertificate, 0o644);
}
writeAtomic(liteasyCaFile, rdsCertificate + scannerCertificate, 0o644);

const secret = scannerSecret();
let liteasyEnvironment = read(liteasyEnvFile);
liteasyEnvironment = replaceOrInsertAfter(
  liteasyEnvironment,
  "LITEASY_S3_SECURITY_PROFILE",
  "aliyun-oss",
  "LITEASY_S3_PREFIX"
);
liteasyEnvironment = replaceOne(
  liteasyEnvironment,
  "LITEASY_PDF_SCANNER_URL",
  "https://pdf-scanner:8443/v1/pdf:scan"
);
liteasyEnvironment = replaceOne(liteasyEnvironment, "LITEASY_PDF_SCANNER_SECRET", secret);
writeAtomic(liteasyEnvFile, liteasyEnvironment, 0o600);

process.stdout.write("Configured the internal scanner URL, secret, and isolated CA bundle.\n");
