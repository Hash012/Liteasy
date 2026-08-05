import { ProxyAgent } from "undici";

// Keep a stable reference so callers that temporarily adapt globalThis.fetch (for
// SDKs that do not accept a transport) cannot recursively invoke this helper.
const nativeFetch = globalThis.fetch;

function resolveProxyUrl(url) {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.startsWith("https://")) {
    return process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
  }

  if (lowerUrl.startsWith("http://")) {
    return process.env.HTTP_PROXY ?? process.env.http_proxy;
  }

  return undefined;
}

function shouldBypassProxy(url) {
  const noProxy = process.env.NO_PROXY ?? process.env.no_proxy ?? "";
  if (!noProxy.trim()) {
    return false;
  }

  const hostname = new URL(url).hostname;
  return noProxy
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((entry) => entry === "*" || hostname === entry || hostname.endsWith(entry.replace(/^\./, "")));
}

export async function fetchWithConfiguredProxy(url, options = {}) {
  const proxyUrl = shouldBypassProxy(url) ? undefined : resolveProxyUrl(url);
  if (!proxyUrl) {
    return nativeFetch(url, options);
  }

  return nativeFetch(url, {
    ...options,
    dispatcher: new ProxyAgent(proxyUrl)
  });
}
