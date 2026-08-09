import assert from "node:assert/strict";
import test from "node:test";
import { EnvironmentVisualizationSecretStore } from "./visualizationSecretStore.mjs";
import { VisualizationCircuitBreaker } from "./visualizationCircuitBreaker.mjs";
import { VisualizationProviderGateway } from "./visualizationProviderGateway.mjs";

const route = Object.freeze({
  circuitFailures: 0,
  circuitOpenUntil: null,
  circuitState: "closed",
  dataClasses: ["paper"],
  enabled: true,
  endpoint: "https://provider.example/v1/generate",
  maxConcurrency: 1,
  modalities: ["semantic_graph"],
  model: "provider-model-v1",
  operations: ["structured_generation", "image_generation", "validation"],
  priority: 10,
  providerId: "provider-1",
  region: "ap-southeast-1",
  revision: 1,
  routeId: "route-1",
  secretRef: "viz-secret:provider-1",
  timeoutMs: 1_000
});
const publicAddress = "93.184.216.34";

function secretStore() {
  return new EnvironmentVisualizationSecretStore({
    LITEASY_VISUALIZATION_SECRETS_JSON: JSON.stringify({
      "viz-secret:provider-1": "deployment-managed-value"
    })
  });
}

function gatewayWithFailingAdapter({ threshold = 3 } = {}) {
  const probeRequests = [];
  const adapter = {
    async generateStructured() {
      throw new Error("provider outage carrying private details");
    },
    async probe(input) {
      probeRequests.push(input);
      return { capabilities: ["structured_generation", "image_generation", "validation"], authenticated: true, reachable: true };
    }
  };
  return {
    gateway: new VisualizationProviderGateway({
      adapter,
      circuitBreaker: new VisualizationCircuitBreaker({ failureThreshold: threshold }),
      dnsLookup: async () => [publicAddress],
      egressPolicy: { allowedHostnames: ["provider.example"] },
      secretStore: secretStore()
    }),
    probeRequests
  };
}

async function failThreeCalls(gateway) {
  for (let index = 0; index < 3; index += 1) {
    await assert.rejects(
      () => gateway.generateStructured({
        dataClass: "paper",
        modality: "semantic_graph",
        paperContent: "private paper content must stay out of health probes",
        route
      }),
      /visualization_provider_unavailable/
    );
  }
}

test("rejects credential material in routes and resolves only deployment secret references", () => {
  const store = secretStore();
  assert.equal(store.resolve("viz-secret:provider-1"), "deployment-managed-value");
  assert.throws(() => store.resolve("provider-token"), /visualization_secret_ref_invalid/);
  assert.throws(() => store.resolve("viz-secret:missing"), /visualization_secret_not_found/);

  const { gateway } = gatewayWithFailingAdapter({});
  assert.throws(
    () => gateway.validateRoute({ ...route, apiKey: "do-not-store-credentials" }),
    /visualization_route_credential_material_rejected/
  );
});

test("opens the route circuit after three failures without sending paper content in probes", async () => {
  const { gateway, probeRequests } = gatewayWithFailingAdapter({ threshold: 3 });
  await failThreeCalls(gateway);

  await assert.rejects(
    () => gateway.generateStructured({
      dataClass: "paper",
      modality: "semantic_graph",
      paperContent: "private paper content must stay out of health probes",
      route
    }),
    /visualization_circuit_open/
  );
  assert.equal(gateway.circuitState(route), "open");

  const health = await gateway.testRoute({
    dataClass: "paper",
    modality: "semantic_graph",
    paperContent: "private paper content must stay out of health probes",
    route
  });
  assert.deepEqual(health, { authenticated: true, capabilities: ["structured_generation", "image_generation", "validation"], reachable: true });
  assert.equal(probeRequests.length, 1);
  assert.equal(JSON.stringify(probeRequests).includes("private paper content"), false);
  assert.equal(JSON.stringify(probeRequests).includes("deployment-managed-value"), false);
});

test("selects the lowest-priority enabled route compatible with the requested operation", async () => {
  const observed = [];
  const gateway = new VisualizationProviderGateway({
    adapter: {
      async generateStructured(input) {
        observed.push(input.route.routeId);
        return { text: "normalized graph" };
      }
    },
    dnsLookup: async () => [publicAddress],
    egressPolicy: { allowedHostnames: ["provider.example"] },
    secretStore: secretStore()
  });
  const alternateRoute = { ...route, priority: 20, routeId: "route-2" };
  const result = await gateway.generateStructured({
    dataClass: "paper",
    modality: "semantic_graph",
    routes: [alternateRoute, route]
  });

  assert.deepEqual(result, { text: "normalized graph" });
  assert.deepEqual(observed, ["route-1"]);
});

test("rejects routes whose endpoint resolves outside the deployment egress policy", async () => {
  const gateway = new VisualizationProviderGateway({
    adapter: {
      async generateStructured() { return { text: "not reached" }; },
      async probe() { return { capabilities: route.operations, authenticated: true, reachable: true }; }
    },
    dnsLookup: async () => ["10.0.0.9"],
    egressPolicy: { allowedHostnames: ["provider.example"] },
    secretStore: secretStore()
  });

  await assert.rejects(
    () => gateway.generateStructured({ dataClass: "paper", modality: "semantic_graph", route }),
    /visualization_egress_denied/
  );
});

test("fails before invoking an adapter when the route secret reference is missing", async () => {
  let invoked = false;
  const gateway = new VisualizationProviderGateway({
    adapter: {
      async generateStructured() {
        invoked = true;
        return { text: "not reached" };
      }
    },
    dnsLookup: async () => [publicAddress],
    egressPolicy: { allowedHostnames: ["provider.example"] },
    secretStore: new EnvironmentVisualizationSecretStore({ LITEASY_VISUALIZATION_SECRETS_JSON: "{}" })
  });

  await assert.rejects(
    () => gateway.generateStructured({ dataClass: "paper", modality: "semantic_graph", route }),
    /visualization_secret_not_found/
  );
  assert.equal(invoked, false);
});

test("does not exceed the selected route concurrency while DNS validation is asynchronous", async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const gateway = new VisualizationProviderGateway({
    adapter: {
      async generateStructured() {
        calls += 1;
        await waiting;
        return { text: "generated" };
      }
    },
    dnsLookup: async () => [publicAddress],
    egressPolicy: { allowedHostnames: ["provider.example"] },
    secretStore: secretStore()
  });
  const input = { dataClass: "paper", modality: "semantic_graph", route };
  const first = gateway.generateStructured(input);
  const second = gateway.generateStructured(input);

  await assert.rejects(second, /visualization_route_unavailable/);
  release();
  assert.deepEqual(await first, { text: "generated" });
  assert.equal(calls, 1);
});

test("propagates caller cancellation to image generation and redacted route probes", async () => {
  const seen = [];
  const aborted = new DOMException("request aborted", "AbortError");
  const starts = [];
  const gateway = new VisualizationProviderGateway({
    adapter: {
      async generateImage(input) {
        seen.push(input.signal);
        starts.shift()();
        await new Promise((resolve, reject) => input.signal.addEventListener("abort", () => reject(aborted), { once: true }));
        resolve();
      },
      async probe(input) {
        seen.push(input.signal);
        starts.shift()();
        await new Promise((resolve, reject) => input.signal.addEventListener("abort", () => reject(aborted), { once: true }));
        resolve();
      }
    },
    dnsLookup: async () => [publicAddress],
    egressPolicy: { allowedHostnames: ["provider.example"] },
    secretStore: secretStore()
  });
  const imageAbort = new AbortController();
  let imageStarted;
  const imageStart = new Promise((resolve) => { imageStarted = resolve; });
  starts.push(imageStarted);
  const image = gateway.generateImage({ dataClass: "paper", modality: "semantic_graph", route, signal: imageAbort.signal });
  await imageStart;
  imageAbort.abort();
  await assert.rejects(image, /visualization_request_aborted/);

  const probeAbort = new AbortController();
  let probeStarted;
  const probeStart = new Promise((resolve) => { probeStarted = resolve; });
  starts.push(probeStarted);
  const probe = gateway.testRoute({ dataClass: "paper", modality: "semantic_graph", route, signal: probeAbort.signal });
  await probeStart;
  probeAbort.abort();
  await assert.rejects(probe, /visualization_request_aborted/);
  assert.equal(seen.length, 2);
  assert.equal(seen.every((signal) => signal.aborted), true);
});

test("rejects cross-origin redirects before forwarding authorization or POST bodies", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ authorization: init.headers.Authorization, body: init.body, url });
    const response = new Response(null, {
      headers: { location: "https://redirect.example/collect" },
      status: 307
    });
    Object.defineProperty(response, "peerAddress", { value: publicAddress });
    return response;
  };
  const gateway = new VisualizationProviderGateway({
    adapter: {
      async generateStructured(input) {
        await input.request(input.route.endpoint, { body: "private-paper-body", method: "POST" });
        return { text: "not reached" };
      }
    },
    dnsLookup: async () => [publicAddress],
    egressPolicy: { allowedHostnames: ["provider.example", "redirect.example"] },
    fetchImpl,
    secretStore: secretStore()
  });

  await assert.rejects(
    () => gateway.generateStructured({ dataClass: "paper", modality: "semantic_graph", route }),
    /visualization_provider_redirect_invalid/
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, route.endpoint);
  assert.equal(calls.some((call) => call.url.includes("redirect.example")), false);
});

test("rejects every non-global address class including mapped private IPv6", async () => {
  const nonGlobalAddresses = [
    "0.0.0.1", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1",
    "192.0.0.1", "192.0.2.1", "192.168.0.1", "198.18.0.1", "198.51.100.1",
    "203.0.113.1", "224.0.0.1", "240.0.0.1", "255.255.255.255", "::", "::1",
    "::ffff:10.0.0.1", "64:ff9b::a00:1", "100::1", "2001:2::1", "2001:db8::1",
    "3fff::1", "fc00::1", "fe80::1", "ff02::1"
  ];

  for (const address of nonGlobalAddresses) {
    const gateway = new VisualizationProviderGateway({
      adapter: { async generateStructured() { return { text: "not reached" }; } },
      dnsLookup: async () => [address],
      egressPolicy: { allowedHostnames: ["provider.example"] },
      secretStore: secretStore()
    });
    await assert.rejects(
      () => gateway.generateStructured({ dataClass: "paper", modality: "semantic_graph", route }),
      /visualization_egress_denied/,
      address
    );
  }
});

test("rejects a connection whose peer differs from the DNS-validated address", async () => {
  let pinnedAddress;
  const fetchImpl = async (_url, _init, security) => {
    pinnedAddress = await new Promise((resolve, reject) => {
      security.lookup("provider.example", {}, (error, address) => error ? reject(error) : resolve(address));
    });
    const response = new Response("{}", { status: 200 });
    Object.defineProperty(response, "peerAddress", { value: "10.0.0.9" });
    return response;
  };
  const gateway = new VisualizationProviderGateway({
    adapter: {
      async generateStructured(input) {
        await input.request(input.route.endpoint, { method: "POST" });
        return { text: "not reached" };
      }
    },
    dnsLookup: async () => [publicAddress],
    egressPolicy: { allowedHostnames: ["provider.example"] },
    fetchImpl,
    secretStore: secretStore()
  });

  await assert.rejects(
    () => gateway.generateStructured({ dataClass: "paper", modality: "semantic_graph", route }),
    /visualization_egress_denied/
  );
  assert.equal(pinnedAddress, publicAddress);
});

test("counts route probes against max concurrency", async () => {
  let releaseProbe;
  const waiting = new Promise((resolve) => { releaseProbe = resolve; });
  let started;
  const probeStarted = new Promise((resolve) => { started = resolve; });
  const gateway = new VisualizationProviderGateway({
    adapter: {
      async probe() {
        started();
        await waiting;
        return { capabilities: route.operations, authenticated: true, reachable: true };
      }
    },
    dnsLookup: async () => [publicAddress],
    egressPolicy: { allowedHostnames: ["provider.example"] },
    secretStore: secretStore()
  });
  const input = { dataClass: "paper", modality: "semantic_graph", route };
  const first = gateway.testRoute(input);
  await probeStarted;
  await assert.rejects(() => gateway.testRoute(input), /visualization_route_unavailable/);
  releaseProbe();
  assert.equal((await first).reachable, true);
});

test("cancels stalled DNS validation on caller abort and route timeout", async () => {
  const stalledLookup = async () => new Promise(() => {});
  const gateway = new VisualizationProviderGateway({
    adapter: {
      async generateStructured() { return { text: "not reached" }; },
      async probe() { return { capabilities: route.operations, authenticated: true, reachable: true }; }
    },
    dnsLookup: stalledLookup,
    egressPolicy: { allowedHostnames: ["provider.example"] },
    secretStore: secretStore()
  });
  const controller = new AbortController();
  const cancelled = gateway.generateStructured({
    dataClass: "paper",
    modality: "semantic_graph",
    route,
    signal: controller.signal
  });
  controller.abort();
  await assert.rejects(cancelled, /visualization_request_aborted/);

  const timedRoute = { ...route, timeoutMs: 100 };
  await assert.rejects(
    () => gateway.testRoute({ dataClass: "paper", modality: "semantic_graph", route: timedRoute }),
    /visualization_provider_timeout/
  );
});

test("rejects an adapter direct request outside the normalized route origin", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ authorization: init.headers.Authorization, body: init.body, url });
    const response = new Response("{}", { status: 200 });
    Object.defineProperty(response, "peerAddress", { value: publicAddress });
    return response;
  };
  const gateway = new VisualizationProviderGateway({
    adapter: {
      async generateStructured(input) {
        await input.request(input.route.endpoint, { body: "route-health-body", method: "POST" });
        await input.request("https://second.example/collect", { body: "private-paper-body", method: "POST" });
        return { text: "not reached" };
      }
    },
    dnsLookup: async () => [publicAddress],
    egressPolicy: { allowedHostnames: ["provider.example", "second.example"] },
    fetchImpl,
    secretStore: secretStore()
  });

  await assert.rejects(
    () => gateway.generateStructured({ dataClass: "paper", modality: "semantic_graph", route }),
    /visualization_provider_request_origin_invalid/
  );
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).origin, new URL(route.endpoint).origin);
  assert.equal(calls.some((call) => call.url.includes("second.example") || call.body === "private-paper-body"), false);
});

test("disposes route timers and caller abort listeners after successful generation and probes", async () => {
  const scheduled = [];
  const cleared = [];
  const callerListeners = new Set();
  const callerSignal = {
    aborted: false,
    addEventListener(type, listener) {
      if (type === "abort") callerListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "abort") callerListeners.delete(listener);
    }
  };
  const gateway = new VisualizationProviderGateway({
    adapter: {
      async generateStructured() { return { text: "generated" }; },
      async probe() { return { authenticated: true, capabilities: route.operations, reachable: true }; }
    },
    clearTimeoutImpl(timer) { cleared.push(timer); },
    dnsLookup: async () => [publicAddress],
    egressPolicy: { allowedHostnames: ["provider.example"] },
    secretStore: secretStore(),
    setTimeoutImpl(callback, delay) {
      const timer = { callback, delay, id: scheduled.length + 1 };
      scheduled.push(timer);
      return timer;
    }
  });
  const input = { dataClass: "paper", modality: "semantic_graph", route, signal: callerSignal };

  assert.deepEqual(await gateway.generateStructured(input), { text: "generated" });
  assert.equal(callerListeners.size, 0);
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0], scheduled[0]);

  assert.equal((await gateway.testRoute(input)).reachable, true);
  assert.equal(callerListeners.size, 0);
  assert.equal(cleared.length, 2);
  assert.equal(cleared[1], scheduled[1]);
});
