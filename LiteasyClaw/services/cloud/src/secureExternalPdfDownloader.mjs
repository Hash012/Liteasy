import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { ExternalRetrievalError } from "./externalRetrievalConnectors.mjs";

function isPublicIpv4(address) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return !(octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || octets[0] >= 224 ||
    (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && (octets[1] === 0 || octets[1] === 168)) ||
    (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19 || octets[1] === 51)) ||
    (octets[0] === 203 && octets[1] === 0));
}

export function isPublicNetworkAddress(address) {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;
  const normalized = address.toLowerCase();
  return /^[23]/.test(normalized) && !normalized.startsWith("2001:db8:") &&
    !normalized.startsWith("2001:10:") && !normalized.startsWith("2001:20:") &&
    !normalized.includes("::ffff:");
}

function validatedUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ExternalRetrievalError("external_pdf_url_invalid");
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash ||
    !url.hostname || isIP(url.hostname)) {
    throw new ExternalRetrievalError("external_pdf_url_invalid");
  }
  return url;
}

async function resolvePinnedAddress(hostname) {
  let addresses;
  try {
    addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ExternalRetrievalError("external_pdf_upstream_unavailable", 502);
  }
  if (addresses.length === 0 || addresses.some((entry) => !isPublicNetworkAddress(entry.address))) {
    throw new ExternalRetrievalError("external_pdf_network_forbidden", 403);
  }
  return addresses[0];
}

function requestPinned(url, address, { signal, userAgent }) {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      headers: { Accept: "application/pdf, application/octet-stream;q=0.8", "User-Agent": userAgent },
      lookup(_hostname, _options, callback) {
        callback(null, address.address, address.family);
      },
      signal
    }, (response) => resolve({
      body: response,
      headers: response.headers,
      status: response.statusCode ?? 0
    }));
    request.once("error", reject);
    request.end();
  });
}

function header(headers, name) {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

export class SecureExternalPdfDownloader {
  constructor(config, dependencies = {}) {
    this.maximumBytes = config.maximumBytes;
    this.timeoutMs = config.timeoutMs;
    this.userAgent = `Liteasy/0.1 (mailto:${config.contactEmail})`;
    this.resolveAddress = dependencies.resolveAddress ?? resolvePinnedAddress;
    this.request = dependencies.request ?? requestPinned;
  }

  async download(value, signal) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      let url = validatedUrl(value);
      for (let redirects = 0; redirects <= 3; redirects += 1) {
        const address = await this.resolveAddress(url.hostname);
        if (!isPublicNetworkAddress(address.address)) {
          throw new ExternalRetrievalError("external_pdf_network_forbidden", 403);
        }
        const response = await this.request(url, address, {
          signal: controller.signal,
          userAgent: this.userAgent
        });
        if (new Set([301, 302, 303, 307, 308]).has(response.status)) {
          const location = header(response.headers, "location");
          response.body?.resume?.();
          if (!location || redirects === 3) {
            throw new ExternalRetrievalError("external_pdf_redirect_invalid", 502);
          }
          url = validatedUrl(new URL(location, url).toString());
          continue;
        }
        if (response.status < 200 || response.status >= 300) {
          response.body?.resume?.();
          throw new ExternalRetrievalError("external_pdf_upstream_unavailable", 502);
        }
        const declaredLength = Number(header(response.headers, "content-length") ?? 0);
        if (declaredLength > this.maximumBytes) {
          response.body?.resume?.();
          throw new ExternalRetrievalError("external_pdf_too_large", 413);
        }
        const contentType = String(header(response.headers, "content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
        if (!new Set(["application/pdf", "application/octet-stream"]).has(contentType)) {
          response.body?.resume?.();
          throw new ExternalRetrievalError("external_pdf_type_invalid", 415);
        }
        const chunks = [];
        let byteLength = 0;
        for await (const chunk of response.body) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          byteLength += bytes.length;
          if (byteLength > this.maximumBytes) {
            response.body?.destroy?.();
            throw new ExternalRetrievalError("external_pdf_too_large", 413);
          }
          chunks.push(bytes);
        }
        const bytes = Buffer.concat(chunks);
        if (bytes.byteLength < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
          throw new ExternalRetrievalError("external_pdf_header_invalid", 415);
        }
        return {
          byteLength: bytes.byteLength,
          bytes,
          contentHash: createHash("sha256").update(bytes).digest("hex"),
          contentType: "application/pdf",
          finalUrl: url.toString()
        };
      }
      throw new ExternalRetrievalError("external_pdf_redirect_invalid", 502);
    } catch (error) {
      if (error instanceof ExternalRetrievalError) throw error;
      throw new ExternalRetrievalError(
        controller.signal.aborted ? "external_pdf_timeout" : "external_pdf_upstream_unavailable",
        502
      );
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}
