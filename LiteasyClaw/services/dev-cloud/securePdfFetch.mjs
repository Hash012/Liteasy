import { createHash } from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";

const defaultMaximumBytes = 16 * 1024 * 1024;
const defaultMaximumRedirects = 4;
const defaultTimeoutMs = 12_000;
const blockedIpv6Ranges = new net.BlockList();
[
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b:1::", 48],
  ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["fc00::", 7],
  ["fe80::", 10], ["ff00::", 8]
].forEach(([network, prefix]) => blockedIpv6Ranges.addSubnet(network, prefix, "ipv6"));

export class SecurePdfFetchError extends Error {
  constructor(code, message, statusCode = 422) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function ipv4Number(address) {
  return address.split(".").reduce((value, part) => (value << 8) + Number(part), 0) >>> 0;
}

function inIpv4Range(address, base, prefix) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(base) & mask);
}

export function isPublicIpAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    return ![
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
      ["224.0.0.0", 4], ["240.0.0.0", 4]
    ].some(([base, prefix]) => inIpv4Range(address, base, prefix));
  }
  if (version === 6) {
    return !blockedIpv6Ranges.check(address, "ipv6");
  }
  return false;
}

async function resolvePublicAddresses(hostname, resolver) {
  const literalVersion = net.isIP(hostname);
  const records = literalVersion
    ? [{ address: hostname, family: literalVersion }]
    : await resolver(hostname, { all: true, verbatim: true });
  if (!Array.isArray(records) || records.length === 0 ||
    records.some((record) => !isPublicIpAddress(record.address))) {
    throw new SecurePdfFetchError("pdf_url_not_public", "PDF 地址解析到了本机、私网或保留网络，已拒绝访问。", 400);
  }
  return records;
}

function validatePdfUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SecurePdfFetchError("invalid_pdf_url", "PDF 地址格式无效。", 400);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new SecurePdfFetchError("invalid_pdf_url", "只允许不含凭据的 HTTPS PDF 地址。", 400);
  }
  return url;
}

function noProxyMatches(hostname, value) {
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry === "*") return true;
      const normalized = entry.replace(/^\./, "").split(":", 1)[0];
      return hostname === normalized || hostname.endsWith(`.${normalized}`);
    });
}

export function resolvePdfProxyUrl(url, env = process.env) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const noProxy = env.NO_PROXY ?? env.no_proxy ?? "";
  if (noProxyMatches(hostname, noProxy)) return undefined;
  return env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
}

function pinnedPdfUrl(url, address) {
  const pinned = new URL(url);
  pinned.hostname = net.isIP(address) === 6 ? `[${address}]` : address;
  return pinned;
}

async function readBoundedBody(response, maximumBytes) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new SecurePdfFetchError("pdf_too_large", `PDF 超过 ${maximumBytes} 字节上限。`, 413);
  }
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of response.body) {
    byteLength += chunk.byteLength;
    if (byteLength > maximumBytes) {
      throw new SecurePdfFetchError("pdf_too_large", `PDF 超过 ${maximumBytes} 字节上限。`, 413);
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function fetchSecurePdf(value, options = {}) {
  const maximumBytes = options.maximumBytes ?? defaultMaximumBytes;
  const maximumRedirects = options.maximumRedirects ?? defaultMaximumRedirects;
  const resolver = options.resolver ?? dns.lookup;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  let currentUrl = validatePdfUrl(value);

  for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
    const hostname = currentUrl.hostname.replace(/^\[|\]$/g, "");
    const records = await resolvePublicAddresses(hostname, resolver);
    const allowedAddresses = new Map(records.map((record) => [record.address, record.family]));
    const configuredProxyUrl = options.proxyUrl === false
      ? undefined
      : options.proxyUrl ?? resolvePdfProxyUrl(currentUrl, options.env);
    const [pinnedAddress] = allowedAddresses.entries().next().value;
    const requestUrl = configuredProxyUrl ? pinnedPdfUrl(currentUrl, pinnedAddress) : currentUrl;
    const dispatcher = options.transport
      ? undefined
      : configuredProxyUrl
        ? new ProxyAgent({
            requestTls: { servername: hostname },
            uri: configuredProxyUrl
          })
        : new Agent({
            connect: {
              lookup(_hostname, _options, callback) {
                const [address, family] = allowedAddresses.entries().next().value;
                callback(null, address, family);
              }
            }
          });
    const headers = {
      Accept: "application/pdf,application/octet-stream;q=0.8",
      ...(configuredProxyUrl ? { Host: currentUrl.host } : {})
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await (options.transport ?? undiciFetch)(requestUrl, {
        ...(dispatcher ? { dispatcher } : {}),
        headers,
        redirect: "manual",
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timeout);
      await dispatcher?.close();
      if (error instanceof SecurePdfFetchError) throw error;
      throw new SecurePdfFetchError(
        error instanceof Error && error.name === "AbortError" ? "pdf_fetch_timeout" : "pdf_fetch_failed",
        error instanceof Error && error.name === "AbortError" ? "PDF 下载超时。" : "PDF 下载失败。",
        502
      );
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      clearTimeout(timeout);
      await dispatcher?.close();
      if (redirectCount === maximumRedirects) {
        throw new SecurePdfFetchError("pdf_redirect_limit", "PDF 重定向次数超过上限。", 422);
      }
      const location = response.headers.get("location");
      if (!location) throw new SecurePdfFetchError("invalid_pdf_redirect", "PDF 重定向缺少目标地址。", 502);
      currentUrl = validatePdfUrl(new URL(location, currentUrl).toString());
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      clearTimeout(timeout);
      await dispatcher?.close();
      throw new SecurePdfFetchError("pdf_fetch_failed", `PDF 来源返回 HTTP ${response.status}。`, 502);
    }
    let bytes;
    try {
      bytes = await readBoundedBody(response, maximumBytes);
    } finally {
      clearTimeout(timeout);
      await dispatcher?.close();
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new SecurePdfFetchError("invalid_pdf_content", "下载内容未通过 PDF 魔数校验。", 422);
    }
    const verifiedContentType = ["application/pdf", "application/octet-stream", "binary/octet-stream"].includes(contentType)
      ? contentType
      : "application/pdf";
    return {
      bytes,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      contentType: verifiedContentType,
      finalUrl: currentUrl.toString()
    };
  }
  throw new SecurePdfFetchError("pdf_redirect_limit", "PDF 重定向次数超过上限。", 422);
}
