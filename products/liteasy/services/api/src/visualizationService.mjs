const unavailableCapability = Object.freeze({
  allowed: false,
  availableModalities: [],
  enabled: false,
  explicitRequestsAllowed: false,
  quota: Object.freeze({ available: false }),
  serviceAvailable: false
});

function identifier(value, code) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(value)) {
    throw new VisualizationServiceError(code);
  }
  return value;
}

function requirePlatformAdmin(principal) {
  if (!principal?.roles?.includes("platform_admin")) {
    throw new VisualizationServiceError("platform_admin_required", 403);
  }
  return identifier(principal.subjectId, "identity_subject_invalid");
}

function mutationInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new VisualizationServiceError("visualization_admin_input_invalid");
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new VisualizationServiceError("visualization_revision_invalid");
  }
  if (typeof input.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,200}$/.test(input.idempotencyKey)) {
    throw new VisualizationServiceError("idempotency_key_invalid");
  }
  identifier(input.traceId, "trace_id_invalid");
  if (typeof input.reason !== "string" || input.reason.trim().length < 8 || input.reason.trim().length > 1000) {
    throw new VisualizationServiceError("visualization_reason_invalid");
  }
  return input;
}

export function normalizeVisualizationAuditQuery(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new VisualizationServiceError("visualization_audit_filter_invalid");
  }
  const allowed = new Set(["action", "from", "limit", "subjectId", "to"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new VisualizationServiceError("visualization_audit_filter_invalid");
  }
  const normalized = {};
  if (input.limit !== undefined) {
    const limit = typeof input.limit === "number" ? input.limit : Number(input.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new VisualizationServiceError("visualization_list_limit_invalid");
    }
    normalized.limit = limit;
  }
  if (input.subjectId !== undefined) {
    if (typeof input.subjectId !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(input.subjectId)) {
      throw new VisualizationServiceError("visualization_subject_invalid");
    }
    normalized.subjectId = input.subjectId;
  }
  if (input.action !== undefined) {
    if (typeof input.action !== "string" || !/^visualization_[A-Za-z0-9._:-]{1,120}$/.test(input.action)) {
      throw new VisualizationServiceError("visualization_audit_action_invalid");
    }
    normalized.action = input.action;
  }
  for (const key of ["from", "to"]) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input[key])) {
      throw new VisualizationServiceError("visualization_audit_date_invalid");
    }
    const parsed = new Date(`${input[key]}T00:00:00.000Z`);
    if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== input[key]) {
      throw new VisualizationServiceError("visualization_audit_date_invalid");
    }
    normalized[key] = input[key];
  }
  if (normalized.from && normalized.to && normalized.from > normalized.to) {
    throw new VisualizationServiceError("visualization_audit_date_range_invalid");
  }
  return normalized;
}

function capabilityProjection(value) {
  if (!value || typeof value !== "object") return unavailableCapability;
  const entitled = value.allowed === true;
  const serviceAvailable = entitled && value.serviceAvailable === true;
  const quotaAvailable = serviceAvailable && value.quota?.available === true;
  const remainingBand = value.quota?.remainingBand;
  return {
    allowed: entitled,
    availableModalities: serviceAvailable && Array.isArray(value.availableModalities)
      ? value.availableModalities.filter((item) => typeof item === "string")
      : [],
    enabled: entitled && value.enabled === true && serviceAvailable,
    explicitRequestsAllowed: entitled && value.explicitRequestsAllowed === true,
    quota: {
      available: quotaAvailable,
      ...(quotaAvailable && new Set(["none", "low", "available"]).has(remainingBand)
        ? { remainingBand }
        : {})
    },
    serviceAvailable
  };
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new VisualizationServiceError("visualization_request_aborted", 499);
  }
}

function rollbackReason(error) {
  const code = error?.code ?? error?.message;
  if (code === "visualization_request_aborted" || error?.name === "AbortError") return "cancelled";
  if (code === "visualization_provider_timeout" || error?.name === "TimeoutError") return "provider_timeout";
  if (code === "visualization_entitlement_revoked" || code === "visualization_preference_disabled") {
    return "entitlement_revoked";
  }
  if (code === "visualization_route_revision_changed") return "route_changed";
  if (code === "visualization_source_access_revoked") return "source_access_revoked";
  if (code === "visualization_validation_failed") return "validation_failed";
  if (typeof code === "string" && code.startsWith("visualization_provider_")) return "provider_failed";
  return "system_failure";
}

function publicError(error) {
  if (error instanceof VisualizationServiceError) return error;
  const code = error?.code ?? error?.message;
  if (typeof code !== "string" || (!code.startsWith("visualization_") && !code.startsWith("quota_") && !code.startsWith("idempotency_"))) return error;
  const status = error?.status ?? (code === "visualization_provider_timeout" ? 504
    : code === "visualization_request_aborted" ? 499
      : code === "visualization_validation_failed" ? 422
        : new Set(["visualization_entitlement_revoked", "visualization_source_access_revoked", "visualization_explicit_request_not_allowed", "visualization_not_allowed", "visualization_modality_not_allowed"]).has(code) ? 403
          : new Set(["visualization_route_revision_changed", "visualization_route_revision_conflict", "visualization_entitlement_revision_conflict", "visualization_quota_revision_conflict", "visualization_reservation_expired", "idempotency_key_reused"]).has(code) ? 409
            : code === "visualization_quota_exceeded" ? 429
              : code.endsWith("_invalid") ? 400
                : 503);
  return new VisualizationServiceError(code, status);
}

function providerProbeFailure(error) {
  const code = error?.code;
  if (code === "visualization_request_aborted" || error?.name === "AbortError") {
    return new VisualizationServiceError("visualization_request_aborted", 499);
  }
  if (code === "visualization_provider_timeout" || error?.name === "TimeoutError") {
    return new VisualizationServiceError("visualization_provider_timeout", 504);
  }
  return new VisualizationServiceError("visualization_provider_unavailable", 503);
}

async function rollback(repository, subjectId, reservationId, error, traceId) {
  await repository.rollback(subjectId, {
    reasonCode: rollbackReason(error),
    reservationId,
    traceId
  });
}

export class VisualizationServiceError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export class VisualizationService {
  constructor({ authorizeDocument, gateway, repository, validateArtifact }) {
    if (!repository || !gateway || typeof authorizeDocument !== "function" ||
      typeof validateArtifact !== "function") {
      throw new Error("visualization_service_dependencies_invalid");
    }
    this.authorizeDocument = authorizeDocument;
    this.gateway = gateway;
    this.repository = repository;
    this.validateArtifact = validateArtifact;
  }

  async accountCapability(subjectId) {
    try {
      return capabilityProjection(await this.repository.capability(subjectId));
    } catch {
      return unavailableCapability;
    }
  }

  async setPreference(subjectId, input) {
    try {
      const entitlement = await this.repository.getEntitlement(subjectId);
      if (input?.enabled === true && entitlement.allowed !== true) return unavailableCapability;
      await this.repository.setPreference(subjectId, input);
      return this.accountCapability(subjectId);
    } catch (error) {
      throw publicError(error);
    }
  }

  async generate(subjectId, input, context = {}) {
    throwIfAborted(context.signal);
    const providerRequest = input.providerRequest ?? {};
    const operation = providerRequest.operation ?? "structured_generation";
    const dataClass = providerRequest.dataClass ?? "paper";
    let reserved;
    try {
      reserved = await this.repository.reserve(subjectId, {
        ...input.reservation,
        dataClass,
        operation,
        requestedBy: input.reservation?.requestedBy ?? "automatic"
      });
    } catch (error) {
      throw publicError(error);
    }
    const reservationId = reserved.reservation.reservationId;
    let costRecorded = false;
    let invocationId = providerRequest.invocationId ?? `vinvoke_${randomUUID()}`;
    let invocationStarted = false;
    let providerCost;
    let providerRequestId;
    let providerRequestIdObserved = false;
    let finalizationAttempted = false;
    let route;
    try {
      route = await this.repository.getProviderRoute(reserved.reservation.routeId);
      if (!route?.enabled || route.revision !== reserved.reservation.routeRevision) {
        throw new VisualizationServiceError("visualization_route_revision_changed", 409);
      }
      const { route: _ignoredRoute, routes: _ignoredRoutes, ...request } = providerRequest;
      const providerInput = {
        ...request,
        modality: reserved.reservation.modality,
        route,
        signal: context.signal
      };
      providerRequestId = providerRequest.providerRequestId;
      if (typeof this.repository.startProviderInvocation === "function") {
        const invocation = await this.repository.startProviderInvocation({
          dataClass,
          idempotencyKey: reserved.reservation.idempotencyKey,
          invocationId,
          modality: reserved.reservation.modality,
          operation,
          reservationId,
          responseMaxBytes: operation === "image_generation" ? 16 * 1024 * 1024 : operation === "validation" ? 256 * 1024 : 2 * 1024 * 1024,
          routeId: route.routeId,
          routeRevision: route.revision,
          subjectId,
        });
        invocationId = invocation?.invocation_id ?? invocation?.invocationId ?? invocationId;
        if (invocation?.replayed === true || (invocation?.state && invocation.state !== "started")) {
          throw new VisualizationServiceError("visualization_invocation_replayed", 409);
        }
        invocationStarted = true;
      }
      providerInput.invocationId = invocationId;
      const result = operation === "image_generation"
        ? await this.gateway.generateImage(providerInput)
        : await this.gateway.generateStructured(providerInput);
      providerCost = result?.cost;
      providerRequestIdObserved = providerCost?.providerRequestId !== undefined;
      providerRequestId = providerCost?.providerRequestId ?? providerRequestId;
      if (providerCost) {
        const cost = this.#providerCostRecord(providerCost, route, "succeeded", context.traceId, { invocationId, providerRequestId });
        if (invocationStarted && typeof this.repository.finalizeProviderInvocation === "function") {
          finalizationAttempted = true;
          await this.repository.finalizeProviderInvocation({
            cost,
            invocationId,
            ...(providerRequestIdObserved ? { providerRequestId, providerUnits: providerCost.units } : {}),
            responseHash: createHash("sha256").update(JSON.stringify(result)).digest("hex"),
            state: "succeeded"
          });
          costRecorded = true;
        } else {
          await this.repository.recordProviderCost(cost);
          costRecorded = true;
        }
      }
      throwIfAborted(context.signal);
      if (invocationStarted && !finalizationAttempted && typeof this.repository.completeProviderInvocation === "function") {
        await this.repository.completeProviderInvocation({
          invocationId,
          ...(providerRequestIdObserved ? {
            providerRequestId,
            providerUnits: result?.cost?.units ?? 0
          } : {}),
          responseHash: createHash("sha256").update(JSON.stringify(result)).digest("hex"),
          state: "succeeded"
        });
      }
      const { cost: _cost, ...providerResult } = result;
      const validation = await this.validateArtifact({
        modality: reserved.reservation.modality,
        phase: "provider_result",
        providerResult,
        reservation: reserved.reservation
      });
      if (validation?.outcome !== "pass") {
        throw new VisualizationServiceError("visualization_validation_failed", 422);
      }
      return { reservation: reserved.reservation, result: providerResult, validation };
    } catch (error) {
      let accountingError;
      const failedCost = providerCost ?? error?.cost;
      providerRequestIdObserved = failedCost?.providerRequestId !== undefined;
      providerRequestId = failedCost?.providerRequestId ?? providerRequestId;
      if (!finalizationAttempted && invocationStarted && typeof this.repository.finalizeProviderInvocation === "function") {
        try {
          finalizationAttempted = true;
          await this.repository.finalizeProviderInvocation({
            ...(failedCost && route ? {
              cost: this.#providerCostRecord(failedCost, route, "failed", context.traceId, { invocationId, providerRequestId })
            } : {}),
            errorCode: typeof (error?.code ?? error?.message) === "string" ? (error.code ?? error.message).slice(0, 120) : "provider_failed",
            invocationId,
            ...(providerRequestIdObserved ? { providerRequestId, providerUnits: failedCost?.units ?? 0 } : {}),
            state: error?.code === "visualization_request_aborted" ? "cancelled" : error?.code === "visualization_provider_timeout" ? "timed_out" : "failed"
          });
          costRecorded = Boolean(failedCost);
        } catch (recordError) {
          accountingError = recordError;
        }
      } else if (!finalizationAttempted && !costRecorded && failedCost && route) {
        try {
          await this.#recordProviderCost(failedCost, route, "failed", context.traceId, { invocationId, providerRequestId });
          costRecorded = true;
        } catch (recordError) {
          accountingError = recordError;
        }
      }
      if (invocationStarted && !finalizationAttempted && typeof this.repository.completeProviderInvocation === "function") {
        const code = error?.code ?? error?.message;
        await this.repository.completeProviderInvocation({
          errorCode: typeof code === "string" ? code.slice(0, 120) : "provider_failed",
          invocationId,
          ...(providerRequestIdObserved ? {
            providerRequestId,
            providerUnits: failedCost?.units ?? 0
          } : {}),
          state: code === "visualization_request_aborted" ? "cancelled" : code === "visualization_provider_timeout" ? "timed_out" : "failed"
        }).catch(() => {});
      }
      await rollback(this.repository, subjectId, reservationId, error, context.traceId);
      throw publicError(accountingError ?? error);
    }
  }

  async submit(subjectId, input, context = {}) {
    const reservationId = identifier(input?.reservationId, "visualization_reservation_invalid");
    try {
      throwIfAborted(context.signal);
      const validation = await this.validateArtifact({
        artifact: input.artifact,
        modality: input.modality,
        phase: "publication"
      });
      if (validation?.outcome !== "pass") {
        throw new VisualizationServiceError("visualization_validation_failed", 422);
      }
      const access = await this.authorizeDocument({
        document: input.document,
        subjectId
      });
      if (access?.allowed !== true || access.sourceIdentityHash !== input.document?.sourceIdentityHash) {
        throw new VisualizationServiceError("visualization_source_access_revoked", 403);
      }
      throwIfAborted(context.signal);
      return await this.repository.publish(subjectId, {
        access,
        artifact: input.artifact,
        document: input.document,
        reservationId,
        routeId: input.routeId,
        routeRevision: input.routeRevision,
        traceId: context.traceId,
        validation
      });
    } catch (error) {
      await rollback(this.repository, subjectId, reservationId, error, context.traceId);
      throw publicError(error);
    }
  }

  #providerCostRecord(cost, route, outcome, traceId, identifiers = {}) {
    return {
      amount: cost.amount,
      currency: cost.currency,
      invocationId: identifiers.invocationId,
      metadata: { outcome, traceId },
      providerId: route.providerId,
      providerRequestId: identifiers.providerRequestId ?? cost.providerRequestId,
      reasonCode: `provider_${outcome}`,
      routeId: route.routeId,
      units: cost.units
    };
  }

  async #recordProviderCost(cost, route, outcome, traceId, identifiers = {}) {
    await this.repository.recordProviderCost(this.#providerCostRecord(cost, route, outcome, traceId, identifiers));
  }

  async listProviderRoutes(principal, input = {}) {
    requirePlatformAdmin(principal);
    try { return await this.repository.listProviderRoutes(input); } catch (error) { throw publicError(error); }
  }

  async saveProviderRoute(principal, input) {
    const actorId = requirePlatformAdmin(principal);
    mutationInput(input);
    const route = this.gateway.validateRoute(input.route);
    try { return await this.repository.saveProviderRoute({ ...input, route, updatedBy: actorId }); } catch (error) { throw publicError(error); }
  }

  async testProviderRoute(principal, input, signal) {
    const actorId = requirePlatformAdmin(principal);
    mutationInput(input);
    try {
      const routeId = identifier(input.routeId, "visualization_route_id_invalid");
      const probeInput = {
        actorId,
        expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        routeId,
        traceId: input.traceId
      };
      let claim;
      if (typeof this.repository.claimProviderProbe === "function") {
        claim = await this.repository.claimProviderProbe(probeInput);
        if (claim.replayed) return claim;
        if (claim.pending) {
          for (let attempt = 0; attempt < 40; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 25));
            const replay = await this.repository.getProviderProbeReplay(probeInput);
            if (replay) return replay;
          }
          throw new VisualizationServiceError("visualization_provider_probe_pending", 503);
        }
      } else if (typeof this.repository.getProviderProbeReplay === "function") {
        const replay = await this.repository.getProviderProbeReplay(probeInput);
        if (replay) return replay;
      }
      const route = claim?.route ?? await this.repository.getProviderRoute(routeId);
      if (!route || Number(route.revision) !== Number(input.expectedRevision)) {
        throw new VisualizationServiceError("visualization_route_revision_conflict", 409);
      }
      const { route: _ignoredRoute, routes: _ignoredRoutes, ...providerRequest } = input.providerRequest ?? {};
      const ownsClaim = typeof this.repository.claimProviderProbe !== "function"
        || (claim && !claim.pending && !claim.replayed);
      let result;
      try {
        throwIfAborted(signal);
        result = await this.gateway.testRoute({
          ...providerRequest,
          dataClass: input.providerRequest?.dataClass ?? route.dataClasses[0],
          modality: input.providerRequest?.modality ?? route.modalities[0],
          route,
          signal
        });
        throwIfAborted(signal);
      } catch (error) {
        const failure = providerProbeFailure(error);
        if (typeof this.repository.recordProviderProbe === "function" && ownsClaim) {
          await this.repository.recordProviderProbe({ ...probeInput, error: failure });
        }
        throw failure;
      }
      if (typeof this.repository.recordProviderProbe === "function" && ownsClaim) {
        return await this.repository.recordProviderProbe({
          ...probeInput,
          result: { authenticated: result.authenticated === true, capabilities: result.capabilities ?? [], reachable: result.reachable === true }
        });
      }
      return result;
    } catch (error) { throw publicError(error); }
  }

  async getEntitlement(principal, input) {
    requirePlatformAdmin(principal);
    try { return { entitlement: await this.repository.getEntitlement(input.subjectId) }; } catch (error) { throw publicError(error); }
  }

  async setEntitlement(principal, input) {
    const actorId = requirePlatformAdmin(principal);
    mutationInput(input);
    try { return await this.repository.setEntitlement(input.subjectId, { ...input, grantedBy: actorId }); } catch (error) { throw publicError(error); }
  }

  async listQuotaPolicies(principal, input = {}) {
    requirePlatformAdmin(principal);
    try { return await this.repository.listQuotaPolicies(input); } catch (error) { throw publicError(error); }
  }

  async setQuotaPolicy(principal, input) {
    const actorId = requirePlatformAdmin(principal);
    mutationInput(input);
    try { return await this.repository.setQuotaPolicy(input.subjectId, { ...input, updatedBy: actorId }); } catch (error) { throw publicError(error); }
  }

  async listUsage(principal, input = {}) {
    requirePlatformAdmin(principal);
    try { return await this.repository.listUsage(input); } catch (error) { throw publicError(error); }
  }

  async listAudit(principal, input = {}) {
    requirePlatformAdmin(principal);
    try { return await this.repository.listAudit(normalizeVisualizationAuditQuery(input)); } catch (error) { throw publicError(error); }
  }
}
import { createHash, randomUUID } from "node:crypto";
