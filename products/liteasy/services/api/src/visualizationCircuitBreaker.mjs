function routeId(route) {
  if (typeof route?.routeId !== "string" || route.routeId.length === 0) {
    throw new Error("visualization_route_invalid");
  }
  return route.routeId;
}

function initialState(route) {
  const openUntil = route.circuitOpenUntil ? new Date(route.circuitOpenUntil).getTime() : null;
  return {
    failures: Number.isInteger(route.circuitFailures) ? route.circuitFailures : 0,
    halfOpenInFlight: false,
    openUntil: Number.isFinite(openUntil) ? openUntil : null,
    state: route.circuitState ?? "closed"
  };
}

export class VisualizationCircuitBreaker {
  constructor({ clock = () => Date.now(), cooldownMs = 30_000, failureThreshold = 3 } = {}) {
    if (!Number.isInteger(failureThreshold) || failureThreshold < 1) throw new Error("visualization_circuit_threshold_invalid");
    if (!Number.isInteger(cooldownMs) || cooldownMs < 1) throw new Error("visualization_circuit_cooldown_invalid");
    this.clock = clock;
    this.cooldownMs = cooldownMs;
    this.failureThreshold = failureThreshold;
    this.routes = new Map();
  }

  #entry(route) {
    const id = routeId(route);
    if (!this.routes.has(id)) this.routes.set(id, initialState(route));
    return this.routes.get(id);
  }

  allows(route) {
    const entry = this.#entry(route);
    if (entry.state !== "open") {
      if (entry.state === "half_open" && entry.halfOpenInFlight) return false;
      if (entry.state === "half_open") entry.halfOpenInFlight = true;
      return true;
    }
    if (entry.openUntil !== null && this.clock() >= entry.openUntil) {
      entry.state = "half_open";
      entry.halfOpenInFlight = true;
      return true;
    }
    return false;
  }

  recordSuccess(route) {
    const entry = this.#entry(route);
    entry.failures = 0;
    entry.halfOpenInFlight = false;
    entry.openUntil = null;
    entry.state = "closed";
  }

  recordFailure(route) {
    const entry = this.#entry(route);
    entry.failures += 1;
    entry.halfOpenInFlight = false;
    if (entry.failures >= this.failureThreshold || entry.state === "half_open") {
      entry.openUntil = this.clock() + this.cooldownMs;
      entry.state = "open";
    }
  }

  state(route) {
    const entry = this.#entry(route);
    if (entry.state === "open" && entry.openUntil !== null && this.clock() >= entry.openUntil) {
      return "half_open";
    }
    return entry.state;
  }
}
