import { lookup as systemDnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { EnvironmentVisualizationSecretStore, validateVisualizationSecretRef } from "./visualizationSecretStore.mjs";
import { VisualizationCircuitBreaker } from "./visualizationCircuitBreaker.mjs";

const credentialFieldPattern = /(api.?key|authorization|credential|password|secret|token)/i;
const routeFields = new Set([
  "circuitFailures", "circuitOpenUntil", "circuitState", "dataClasses", "enabled", "endpoint",
  "maxConcurrency", "modalities", "model", "operations", "priority", "providerId", "region",
  "revision", "routeId", "secretRef", "timeoutMs"
]);
const supportedOperations = new Set(["structured_generation", "image_generation", "validation"]);

export class VisualizationProviderError extends Error {
  constructor(code) {
    super(code);
    this.name = "VisualizationProviderError";
    this.code = code;
  }
}

function nonEmptyString(value, code, maximum = 160) {
  if (typeof value !== "string" || value.trim() === "" || value.trim().length > maximum) {
    throw new Error(code);
  }
  return value.trim();
}

function stringSet(value, code) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(code);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

function parseEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("visualization_route_endpoint_invalid");
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("visualization_route_endpoint_invalid");
  }
  return endpoint;
}

export function normalizeRoute(route) {
  if (!route || typeof route !== "object" || Array.isArray(route)) throw new Error("visualization_route_invalid");
  for (const key of Object.keys(route)) {
    if (key !== "secretRef" && credentialFieldPattern.test(key)) throw new Error("visualization_route_credential_material_rejected");
    if (!routeFields.has(key)) throw new Error("visualization_route_field_invalid");
  }
  const endpoint = parseEndpoint(nonEmptyString(route.endpoint, "visualization_route_endpoint_invalid", 2048));
  const operations = stringSet(route.operations, "visualization_route_operations_invalid");
  if (operations.some((operation) => !supportedOperations.has(operation))) throw new Error("visualization_route_operations_invalid");
  const circuitState = route.circuitState;
  if (!new Set(["closed", "open", "half_open"]).has(circuitState)) throw new Error("visualization_route_circuit_invalid");
  if (!Number.isInteger(route.circuitFailures) || route.circuitFailures < 0) throw new Error("visualization_route_circuit_invalid");
  if (circuitState === "open" && !route.circuitOpenUntil) throw new Error("visualization_route_circuit_invalid");
  if (route.circuitOpenUntil !== null && route.circuitOpenUntil !== undefined && Number.isNaN(new Date(route.circuitOpenUntil).getTime())) {
    throw new Error("visualization_route_circuit_invalid");
  }
  if (!Number.isInteger(route.maxConcurrency) || route.maxConcurrency < 1 || !Number.isInteger(route.priority) || route.priority < 0
    || !Number.isInteger(route.revision) || route.revision < 1 || !Number.isInteger(route.timeoutMs) || route.timeoutMs < 100 || route.timeoutMs > 300_000) {
    throw new Error("visualization_route_limits_invalid");
  }
  if (typeof route.enabled !== "boolean") throw new Error("visualization_route_enabled_invalid");
  const normalized = {
    circuitFailures: route.circuitFailures,
    circuitOpenUntil: route.circuitOpenUntil ?? null,
    circuitState,
    dataClasses: stringSet(route.dataClasses, "visualization_route_data_classes_invalid"),
    enabled: route.enabled,
    endpoint: endpoint.toString(),
    maxConcurrency: route.maxConcurrency,
    modalities: stringSet(route.modalities, "visualization_route_modalities_invalid"),
    model: nonEmptyString(route.model, "visualization_route_model_invalid"),
    operations,
    priority: route.priority,
    providerId: nonEmptyString(route.providerId, "visualization_route_provider_invalid"),
    region: nonEmptyString(route.region, "visualization_route_region_invalid", 80),
    revision: route.revision,
    routeId: nonEmptyString(route.routeId, "visualization_route_id_invalid", 120),
    secretRef: validateVisualizationSecretRef(route.secretRef),
    timeoutMs: route.timeoutMs
  };
  return Object.freeze(normalized);
}

function hostnameAllowed(hostname, allowedHostnames) {
  return allowedHostnames.some((allowed) => allowed === hostname || (allowed.startsWith("*.") && hostname.endsWith(allowed.slice(1))));
}

function ipv4Integer(address) {
  if (isIP(address) !== 4) return null;
  return address.split(".").reduce((value, octet) => (value * 256) + Number(octet), 0) >>> 0;
}

function ipv4InRange(value, base, bits) {
  const shift = 32 - bits;
  return (value >>> shift) === (ipv4Integer(base) >>> shift);
}

function publicIpv4(address) {
  const value = ipv4Integer(address);
  if (value === null) return false;
  return ![
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
    ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
    ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
  ].some(([base, bits]) => ipv4InRange(value, base, bits));
}

function ipv6Integer(address) {
  if (typeof address !== "string" || address.includes("%") || isIP(address) !== 6) return null;
  let source = address.toLowerCase();
  if (source.includes(".")) {
    const separator = source.lastIndexOf(":");
    const ipv4 = ipv4Integer(source.slice(separator + 1));
    if (ipv4 === null) return null;
    source = `${source.slice(0, separator)}:${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const sides = source.split("::");
  if (sides.length > 2) return null;
  const left = sides[0] ? sides[0].split(":") : [];
  const right = sides[1] ? sides[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((sides.length === 1 && missing !== 0) || (sides.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[a-f0-9]{1,4}$/.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function ipv6InRange(value, base, bits) {
  const baseValue = ipv6Integer(base);
  const shift = BigInt(128 - bits);
  return baseValue !== null && (value >> shift) === (baseValue >> shift);
}

function ipv4FromInteger(value) {
  return [24, 16, 8, 0].map((shift) => Number((value >> BigInt(shift)) & 0xffn)).join(".");
}

function publicIpv6(address) {
  const value = ipv6Integer(address);
  if (value === null) return false;
  if (ipv6InRange(value, "::ffff:0:0", 96)) return publicIpv4(ipv4FromInteger(value & 0xffffffffn));
  if (ipv6InRange(value, "64:ff9b::", 96)) return publicIpv4(ipv4FromInteger(value & 0xffffffffn));
  if (ipv6InRange(value, "2002::", 16)) {
    return publicIpv4(ipv4FromInteger((value >> 80n) & 0xffffffffn));
  }
  if (!ipv6InRange(value, "2000::", 3)) return false;
  return ![
    ["2001::", 23],
    ["2001:db8::", 32],
    ["3fff::", 20]
  ].some(([base, bits]) => ipv6InRange(value, base, bits));
}

function publicAddress(address) {
  return publicIpv4(address) || publicIpv6(address);
}

function canonicalAddress(address) {
  const value = ipv6Integer(address);
  if (value !== null && ipv6InRange(value, "::ffff:0:0", 96)) {
    return ipv4FromInteger(value & 0xffffffffn);
  }
  return String(address).toLowerCase();
}

function requestSignal(signal, timeoutMs, { clearTimeoutImpl, setTimeoutImpl }) {
  const controller = new AbortController();
  let disposed = false;
  let timeout;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (timeout !== undefined) clearTimeoutImpl(timeout);
    signal?.removeEventListener("abort", forwardAbort);
    controller.signal.removeEventListener("abort", dispose);
  };
  const forwardAbort = () => controller.abort(signal.reason ?? new DOMException("request aborted", "AbortError"));
  controller.signal.addEventListener("abort", dispose, { once: true });
  timeout = setTimeoutImpl(() => {
    controller.abort(new DOMException("provider route timed out", "TimeoutError"));
  }, timeoutMs);
  if (signal) {
    if (signal.aborted) forwardAbort();
    else signal.addEventListener("abort", forwardAbort, { once: true });
  }
  return Object.freeze({ dispose, signal: controller.signal });
}

function waitWithSignal(value, signal) {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new DOMException("aborted", "AbortError"));
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(value).then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("aborted", "AbortError");
}

function pinnedLookup(records) {
  const addresses = records.map((record) => ({
    address: record.address,
    family: record.family ?? isIP(record.address)
  }));
  return (_hostname, options, callback) => {
    const requestedFamily = typeof options === "number" ? options : options?.family;
    const compatible = requestedFamily ? addresses.filter((entry) => entry.family === requestedFamily) : addresses;
    if (compatible.length === 0) {
      callback(Object.assign(new Error("visualization_egress_address_family_unavailable"), { code: "EAI_ADDRFAMILY" }));
      return;
    }
    if (typeof options === "object" && options?.all) callback(null, compatible);
    else callback(null, compatible[0].address, compatible[0].family);
  };
}

async function pinnedHttpsFetch(url, init, security) {
  const parsed = new URL(url);
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const body = init.body;
  if (body !== undefined && typeof body !== "string" && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
    throw new VisualizationProviderError("visualization_provider_request_invalid");
  }
  return new Promise((resolve, reject) => {
    const request = httpsRequest(parsed, {
      headers,
      lookup: security.lookup,
      method: init.method ?? "GET",
      signal: init.signal
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => {
        const responseBody = [204, 205, 304].includes(response.statusCode) ? null : Buffer.concat(chunks);
        const result = new Response(responseBody, {
          headers: response.headers,
          status: response.statusCode,
          statusText: response.statusMessage
        });
        Object.defineProperty(result, "peerAddress", { value: response.socket.remoteAddress });
        resolve(result);
      });
    });
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

function normalizedProbeResult(result, route) {
  if (!result || typeof result !== "object" || result.reachable !== true || result.authenticated !== true) {
    throw new VisualizationProviderError("visualization_provider_unavailable");
  }
  const capabilities = stringSet(result.capabilities, "visualization_provider_capabilities_invalid");
  if (route.operations.some((operation) => !capabilities.includes(operation))) {
    throw new VisualizationProviderError("visualization_provider_capabilities_invalid");
  }
  return Object.freeze({ authenticated: true, capabilities, reachable: true });
}

function normalizedStructuredResult(result) {
  if (!result || typeof result !== "object" || typeof result.text !== "string" || result.text.trim() === "") {
    throw new VisualizationProviderError("visualization_provider_response_invalid");
  }
  return Object.freeze({ text: result.text });
}

function normalizedImageResult(result) {
  if (!result || typeof result !== "object" || typeof result.mimeType !== "string" || !/^image\/[a-z0-9.+-]+$/i.test(result.mimeType)) {
    throw new VisualizationProviderError("visualization_provider_response_invalid");
  }
  if (typeof result.data !== "string" && !(result.bytes instanceof Uint8Array)) {
    throw new VisualizationProviderError("visualization_provider_response_invalid");
  }
  return Object.freeze(result.bytes instanceof Uint8Array
    ? { bytes: result.bytes, mimeType: result.mimeType }
    : { data: result.data, mimeType: result.mimeType });
}

export class VisualizationProviderGateway {
  constructor({ adapter, adapters = {}, circuitBreaker = new VisualizationCircuitBreaker(), clearTimeoutImpl = clearTimeout, dnsLookup = systemDnsLookup, egressPolicy = {}, fetchImpl = pinnedHttpsFetch, secretStore = new EnvironmentVisualizationSecretStore(), setTimeoutImpl = setTimeout } = {}) {
    if ((!adapter || typeof adapter !== "object") && (!adapters || typeof adapters !== "object")) throw new Error("visualization_provider_adapter_invalid");
    if (typeof clearTimeoutImpl !== "function" || typeof setTimeoutImpl !== "function") throw new Error("visualization_provider_timer_invalid");
    this.adapter = adapter;
    this.adapters = adapters;
    this.circuitBreaker = circuitBreaker;
    this.dnsLookup = dnsLookup;
    this.egressPolicy = { allowedHostnames: [...new Set(egressPolicy.allowedHostnames ?? [])].map((host) => host.toLowerCase()) };
    this.fetchImpl = fetchImpl;
    this.secretStore = secretStore;
    this.timers = { clearTimeoutImpl, setTimeoutImpl };
    this.activeRequests = new Map();
  }

  validateRoute(route) {
    return normalizeRoute(route);
  }

  circuitState(route) {
    return this.circuitBreaker.state(normalizeRoute(route));
  }

  async generateStructured(input) {
    return this.#generate(input, "structured_generation", "generateStructured", normalizedStructuredResult);
  }

  async generateImage(input) {
    return this.#generate(input, "image_generation", "generateImage", normalizedImageResult);
  }

  async testRoute(input) {
    const route = this.#selectRoute(input, "validation", { allowCircuitOpen: true });
    const adapter = this.#adapterFor(route);
    const probe = adapter.probe ?? adapter.test;
    if (typeof probe !== "function") throw new Error("visualization_provider_adapter_invalid");
    const credential = this.secretStore.resolve(route.secretRef);
    const lifecycle = requestSignal(input?.signal, route.timeoutMs, this.timers);
    const { signal } = lifecycle;
    const request = this.#authenticatedRequest(route, signal, credential);
    this.#incrementActive(route);
    try {
      await this.#validateEgress(route.endpoint, signal);
      const result = await probe.call(adapter, {
        operation: "validation",
        route,
        signal,
        request
      });
      throwIfAborted(signal);
      return normalizedProbeResult(result, route);
    } catch (error) {
      throw this.#providerError(error, input?.signal);
    } finally {
      lifecycle.dispose();
      this.#decrementActive(route);
    }
  }

  #selectRoute(input, operation, { allowCircuitOpen = false } = {}) {
    const candidates = input?.routes ?? (input?.route ? [input.route] : []);
    if (!Array.isArray(candidates) || candidates.length === 0) throw new Error("visualization_route_unavailable");
    const modality = nonEmptyString(input?.modality, "visualization_modality_invalid", 80);
    const dataClass = nonEmptyString(input?.dataClass, "visualization_data_class_invalid", 80);
    const matching = candidates.map((candidate) => normalizeRoute(candidate)).filter((route) => (
      route.enabled && route.operations.includes(operation) && route.modalities.includes(modality)
      && route.dataClasses.includes(dataClass) && (allowCircuitOpen || this.circuitBreaker.state(route) !== "open")
      && (this.activeRequests.get(route.routeId) ?? 0) < route.maxConcurrency
    )).sort((left, right) => left.priority - right.priority || left.routeId.localeCompare(right.routeId));
    if (matching.length === 0) {
      const normalized = candidates.map((candidate) => normalizeRoute(candidate));
      if (normalized.some((candidate) => this.circuitBreaker.state(candidate) === "open")) {
        throw new VisualizationProviderError("visualization_circuit_open");
      }
      throw new Error("visualization_route_unavailable");
    }
    return matching[0];
  }

  async #generate(input, operation, adapterMethod, resultNormalizer) {
    const route = this.#selectRoute(input, operation);
    if (!this.circuitBreaker.allows(route)) throw new VisualizationProviderError("visualization_circuit_open");
    const adapter = this.#adapterFor(route);
    if (typeof adapter[adapterMethod] !== "function") throw new Error("visualization_provider_adapter_invalid");
    const credential = this.secretStore.resolve(route.secretRef);
    const lifecycle = requestSignal(input?.signal, route.timeoutMs, this.timers);
    const { signal } = lifecycle;
    const request = this.#authenticatedRequest(route, signal, credential);
    this.#incrementActive(route);
    let adapterInvoked = false;
    try {
      await this.#validateEgress(route.endpoint, signal);
      adapterInvoked = true;
      const result = await adapter[adapterMethod]({
        dataClass: input.dataClass,
        input: input.input,
        payload: input.payload,
        modality: input.modality,
        paperContent: input.paperContent,
        route,
        signal,
        request
      });
      throwIfAborted(signal);
      const normalized = resultNormalizer(result);
      this.circuitBreaker.recordSuccess(route);
      return normalized;
    } catch (error) {
      if (adapterInvoked && !input?.signal?.aborted) this.circuitBreaker.recordFailure(route);
      throw this.#providerError(error, input?.signal);
    } finally {
      lifecycle.dispose();
      this.#decrementActive(route);
    }
  }

  #adapterFor(route) {
    const adapter = this.adapters?.[route.providerId] ?? this.adapter;
    if (!adapter || typeof adapter !== "object") throw new Error("visualization_provider_adapter_invalid");
    return adapter;
  }

  #incrementActive(route) {
    this.activeRequests.set(route.routeId, (this.activeRequests.get(route.routeId) ?? 0) + 1);
  }

  #decrementActive(route) {
    const active = (this.activeRequests.get(route.routeId) ?? 1) - 1;
    if (active <= 0) this.activeRequests.delete(route.routeId);
    else this.activeRequests.set(route.routeId, active);
  }

  #providerError(error, signal) {
    if (error instanceof VisualizationProviderError) return error;
    if (signal?.aborted) return new VisualizationProviderError("visualization_request_aborted");
    if (error?.name === "AbortError" || error?.name === "TimeoutError") return new VisualizationProviderError("visualization_provider_timeout");
    return new VisualizationProviderError("visualization_provider_unavailable");
  }

  #authenticatedRequest(route, signal, credential) {
    const routeEndpoint = new URL(route.endpoint);
    return async (url = route.endpoint, init = {}) => {
      let target;
      try {
        target = new URL(url, routeEndpoint);
      } catch {
        throw new VisualizationProviderError("visualization_provider_request_origin_invalid");
      }
      if (target.origin !== routeEndpoint.origin || target.username || target.password) {
        throw new VisualizationProviderError("visualization_provider_request_origin_invalid");
      }
      const callerHeaders = new Headers(init.headers);
      callerHeaders.delete("authorization");
      return this.#fetchWithValidatedRedirects(target, {
        ...init,
        headers: { ...Object.fromEntries(callerHeaders), Authorization: `Bearer ${credential}` },
        signal
      });
    };
  }

  async #fetchWithValidatedRedirects(url, init) {
    let current = new URL(url).toString();
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const egress = await this.#validateEgress(current, init.signal);
      const response = await this.fetchImpl(current, { ...init, redirect: "manual" }, {
        addresses: egress.addresses,
        lookup: pinnedLookup(egress.records)
      });
      const peerAddress = response?.peerAddress;
      if (typeof peerAddress !== "string" || !egress.addresses.includes(canonicalAddress(peerAddress))) {
        throw new VisualizationProviderError("visualization_egress_denied");
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      if (!location || redirects === 5) throw new VisualizationProviderError("visualization_provider_redirect_invalid");
      const redirect = new URL(location, current);
      if (redirect.origin !== new URL(current).origin) {
        throw new VisualizationProviderError("visualization_provider_redirect_invalid");
      }
      current = redirect.toString();
    }
    throw new VisualizationProviderError("visualization_provider_redirect_invalid");
  }

  async #validateEgress(endpoint, signal) {
    const parsed = parseEndpoint(endpoint);
    if (!hostnameAllowed(parsed.hostname.toLowerCase(), this.egressPolicy.allowedHostnames)) {
      throw new VisualizationProviderError("visualization_egress_denied");
    }
    let addresses;
    try {
      addresses = await waitWithSignal(this.dnsLookup(parsed.hostname, { all: true, verbatim: true }), signal);
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      throw new VisualizationProviderError("visualization_egress_denied");
    }
    const records = Array.isArray(addresses) ? addresses.map((entry) => typeof entry === "string"
      ? { address: entry, family: isIP(entry) }
      : { address: entry.address, family: entry.family ?? isIP(entry.address) }) : [];
    const values = records.map((entry) => entry.address);
    if (values.length === 0 || values.some((address) => !publicAddress(address))) {
      throw new VisualizationProviderError("visualization_egress_denied");
    }
    return {
      addresses: [...new Set(values.map(canonicalAddress))],
      records
    };
  }
}
