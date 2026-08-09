import { lookup as systemDnsLookup } from "node:dns/promises";
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

function normalizeRoute(route) {
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

function publicAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const [first, second] = address.split(".").map(Number);
    return first !== 0 && first !== 10 && first !== 127 && !(first === 169 && second === 254)
      && !(first === 172 && second >= 16 && second <= 31) && !(first === 192 && second === 168)
      && !(first === 100 && second >= 64 && second <= 127);
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return normalized !== "::" && normalized !== "::1" && !normalized.startsWith("fe80:") && !normalized.startsWith("fc") && !normalized.startsWith("fd");
  }
  return false;
}

function requestSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
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
  constructor({ adapter, circuitBreaker = new VisualizationCircuitBreaker(), dnsLookup = systemDnsLookup, egressPolicy = {}, fetchImpl = fetch, secretStore = new EnvironmentVisualizationSecretStore() } = {}) {
    if (!adapter || typeof adapter !== "object") throw new Error("visualization_provider_adapter_invalid");
    this.adapter = adapter;
    this.circuitBreaker = circuitBreaker;
    this.dnsLookup = dnsLookup;
    this.egressPolicy = { allowedHostnames: [...new Set(egressPolicy.allowedHostnames ?? [])].map((host) => host.toLowerCase()) };
    this.fetchImpl = fetchImpl;
    this.secretStore = secretStore;
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
    await this.#validateEgress(route.endpoint);
    if (typeof this.adapter.probe !== "function") throw new Error("visualization_provider_adapter_invalid");
    const signal = requestSignal(input?.signal, route.timeoutMs);
    try {
      const result = await this.adapter.probe({
        operation: "validation",
        route,
        signal,
        request: this.#authenticatedRequest(route, signal)
      });
      return normalizedProbeResult(result, route);
    } catch (error) {
      throw this.#providerError(error, input?.signal);
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
    if (typeof this.adapter[adapterMethod] !== "function") throw new Error("visualization_provider_adapter_invalid");
    const signal = requestSignal(input?.signal, route.timeoutMs);
    const request = this.#authenticatedRequest(route, signal);
    this.activeRequests.set(route.routeId, (this.activeRequests.get(route.routeId) ?? 0) + 1);
    let adapterInvoked = false;
    try {
      await this.#validateEgress(route.endpoint);
      adapterInvoked = true;
      const result = await this.adapter[adapterMethod]({
        dataClass: input.dataClass,
        input: input.input,
        modality: input.modality,
        paperContent: input.paperContent,
        route,
        signal,
        request
      });
      const normalized = resultNormalizer(result);
      this.circuitBreaker.recordSuccess(route);
      return normalized;
    } catch (error) {
      if (adapterInvoked && !input?.signal?.aborted) this.circuitBreaker.recordFailure(route);
      throw this.#providerError(error, input?.signal);
    } finally {
      const active = (this.activeRequests.get(route.routeId) ?? 1) - 1;
      if (active === 0) this.activeRequests.delete(route.routeId);
      else this.activeRequests.set(route.routeId, active);
    }
  }

  #providerError(error, signal) {
    if (error instanceof VisualizationProviderError) return error;
    if (signal?.aborted) return new VisualizationProviderError("visualization_request_aborted");
    if (error?.name === "AbortError" || error?.name === "TimeoutError") return new VisualizationProviderError("visualization_provider_timeout");
    return new VisualizationProviderError("visualization_provider_unavailable");
  }

  #authenticatedRequest(route, signal) {
    const credential = this.secretStore.resolve(route.secretRef);
    return async (url = route.endpoint, init = {}) => this.#fetchWithValidatedRedirects(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${credential}` },
      signal
    });
  }

  async #fetchWithValidatedRedirects(url, init) {
    let current = new URL(url).toString();
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      await this.#validateEgress(current);
      const response = await this.fetchImpl(current, { ...init, redirect: "manual" });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      if (!location || redirects === 5) throw new VisualizationProviderError("visualization_provider_redirect_invalid");
      current = new URL(location, current).toString();
    }
    throw new VisualizationProviderError("visualization_provider_redirect_invalid");
  }

  async #validateEgress(endpoint) {
    const parsed = parseEndpoint(endpoint);
    if (!hostnameAllowed(parsed.hostname.toLowerCase(), this.egressPolicy.allowedHostnames)) {
      throw new VisualizationProviderError("visualization_egress_denied");
    }
    let addresses;
    try {
      addresses = await this.dnsLookup(parsed.hostname, { all: true, verbatim: true });
    } catch {
      throw new VisualizationProviderError("visualization_egress_denied");
    }
    const values = Array.isArray(addresses) ? addresses.map((entry) => typeof entry === "string" ? entry : entry.address) : [];
    if (values.length === 0 || values.some((address) => !publicAddress(address))) {
      throw new VisualizationProviderError("visualization_egress_denied");
    }
  }
}
