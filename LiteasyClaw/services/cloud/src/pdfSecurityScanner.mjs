const maximumScannerResponseBytes = 16 * 1024;

export class PdfSecurityScannerError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function unavailable() {
  return new PdfSecurityScannerError("pdf_security_scanner_unavailable", 503);
}

function requiredHash(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw unavailable();
  return value;
}

function scannerIdentity(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/+ -]{0,99}$/.test(value)) {
    throw unavailable();
  }
  return value;
}

async function readScannerResponse(response) {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json" || !response.body) throw unavailable();
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumScannerResponseBytes) throw unavailable();

  const chunks = [];
  let byteLength = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += bytes.length;
    if (byteLength > maximumScannerResponseBytes) throw unavailable();
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw unavailable();
  }
}

function validateScannerResponse(value, expectedHash) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  const allowed = new Set(["clean", "contentHash", "scanner", "version"]);
  if (Object.keys(value).some((key) => !allowed.has(key)) || Object.keys(value).length !== allowed.size) {
    throw unavailable();
  }
  if (typeof value.clean !== "boolean" || requiredHash(value.contentHash) !== expectedHash) throw unavailable();
  const scanner = scannerIdentity(value.scanner);
  const version = scannerIdentity(value.version);
  if (!value.clean) throw new PdfSecurityScannerError("pdf_security_rejected", 422);
  return { contentHash: expectedHash, scanner, version };
}

export class HttpsPdfSecurityScanner {
  constructor(config, { fetchImpl = fetch, now = () => new Date() } = {}) {
    this.endpoint = config.endpoint;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.secret = config.secret;
    this.timeoutMs = config.timeoutMs;
  }

  async scan(readable, { byteLength, contentHash }) {
    if (!readable || typeof readable[Symbol.asyncIterator] !== "function" ||
      !Number.isSafeInteger(byteLength) || byteLength < 1) {
      throw unavailable();
    }
    const expectedHash = requiredHash(contentHash);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response;
      try {
        response = await this.fetchImpl(this.endpoint, {
          body: readable,
          duplex: "half",
          headers: {
            authorization: `Bearer ${this.secret}`,
            "content-length": String(byteLength),
            "content-type": "application/pdf",
            "x-liteasy-content-sha256": expectedHash,
            "x-liteasy-scan-protocol": "1"
          },
          method: "POST",
          redirect: "error",
          signal: controller.signal
        });
      } catch {
        throw unavailable();
      }
      if (!response.ok) throw unavailable();
      const result = validateScannerResponse(await readScannerResponse(response), expectedHash);
      const scannedAt = this.now();
      if (!(scannedAt instanceof Date) || !Number.isFinite(scannedAt.getTime())) throw unavailable();
      return { ...result, scannedAt: scannedAt.toISOString() };
    } catch (error) {
      if (error instanceof PdfSecurityScannerError) throw error;
      throw unavailable();
    } finally {
      clearTimeout(timeout);
    }
  }
}

export { maximumScannerResponseBytes };
