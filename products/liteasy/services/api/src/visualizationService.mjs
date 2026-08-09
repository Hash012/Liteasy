const unavailableCapability = Object.freeze({
  allowed: false,
  availableModalities: [],
  enabled: false,
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

function capabilityProjection(value) {
  if (!value || typeof value !== "object") return unavailableCapability;
  const serviceAvailable = value.allowed === true && value.serviceAvailable === true;
  const quotaAvailable = serviceAvailable && value.quota?.available === true;
  const remainingBand = value.quota?.remainingBand;
  return {
    allowed: serviceAvailable,
    availableModalities: serviceAvailable && Array.isArray(value.availableModalities)
      ? value.availableModalities.filter((item) => typeof item === "string")
      : [],
    enabled: serviceAvailable && value.enabled === true,
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
  if (typeof code !== "string" || !code.startsWith("visualization_")) return error;
  const status = code === "visualization_provider_timeout" ? 504
    : code === "visualization_request_aborted" ? 499
      : code === "visualization_validation_failed" ? 422
        : new Set(["visualization_entitlement_revoked", "visualization_source_access_revoked"]).has(code) ? 403
          : code === "visualization_route_revision_changed" ? 409
            : 503;
  return new VisualizationServiceError(code, status);
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
    const entitlement = await this.repository.getEntitlement(subjectId);
    if (input?.enabled === true && entitlement.allowed !== true) return unavailableCapability;
    await this.repository.setPreference(subjectId, input);
    return this.accountCapability(subjectId);
  }

  async generate(subjectId, input, context = {}) {
    throwIfAborted(context.signal);
    const reserved = await this.repository.reserve(subjectId, input.reservation);
    const reservationId = reserved.reservation.reservationId;
    let costRecorded = false;
    try {
      const route = await this.repository.getProviderRoute(reserved.reservation.routeId);
      if (!route?.enabled || route.revision !== reserved.reservation.routeRevision) {
        throw new VisualizationServiceError("visualization_route_revision_changed", 409);
      }
      const { route: _ignoredRoute, routes: _ignoredRoutes, ...request } = input.providerRequest ?? {};
      const providerInput = {
        ...request,
        modality: reserved.reservation.modality,
        route,
        signal: context.signal
      };
      const result = input.providerRequest?.operation === "image_generation"
        ? await this.gateway.generateImage(providerInput)
        : await this.gateway.generateStructured(providerInput);
      throwIfAborted(context.signal);
      if (result?.cost) {
        await this.#recordProviderCost(result.cost, route, "succeeded", context.traceId);
        costRecorded = true;
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
      if (!costRecorded && error?.cost) {
        const route = await this.repository.getProviderRoute(reserved.reservation.routeId);
        await this.#recordProviderCost(error.cost, route, "failed", context.traceId);
      }
      await rollback(this.repository, subjectId, reservationId, error, context.traceId);
      throw publicError(error);
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
        settledUnits: input.settledUnits,
        traceId: context.traceId,
        validation
      });
    } catch (error) {
      await rollback(this.repository, subjectId, reservationId, error, context.traceId);
      throw publicError(error);
    }
  }

  async #recordProviderCost(cost, route, outcome, traceId) {
    await this.repository.recordProviderCost({
      amount: cost.amount,
      currency: cost.currency,
      invocationId: cost.invocationId,
      metadata: { outcome, traceId },
      providerId: route.providerId,
      providerRequestId: cost.providerRequestId,
      reasonCode: `provider_${outcome}`,
      routeId: route.routeId,
      units: cost.units
    });
  }

  async listProviderRoutes(principal, input = {}) {
    requirePlatformAdmin(principal);
    return this.repository.listProviderRoutes(input);
  }

  async saveProviderRoute(principal, input) {
    const actorId = requirePlatformAdmin(principal);
    mutationInput(input);
    const route = this.gateway.validateRoute(input.route);
    return this.repository.saveProviderRoute({ ...input, route, updatedBy: actorId });
  }

  async testProviderRoute(principal, input, signal) {
    requirePlatformAdmin(principal);
    mutationInput(input);
    return this.gateway.testRoute({ ...input.providerRequest, signal });
  }

  async getEntitlement(principal, input) {
    requirePlatformAdmin(principal);
    return { entitlement: await this.repository.getEntitlement(input.subjectId) };
  }

  async setEntitlement(principal, input) {
    const actorId = requirePlatformAdmin(principal);
    mutationInput(input);
    return this.repository.setEntitlement(input.subjectId, { ...input, grantedBy: actorId });
  }

  async listQuotaPolicies(principal, input = {}) {
    requirePlatformAdmin(principal);
    return this.repository.listQuotaPolicies(input);
  }

  async setQuotaPolicy(principal, input) {
    const actorId = requirePlatformAdmin(principal);
    mutationInput(input);
    return this.repository.setQuotaPolicy(input.subjectId, { ...input, updatedBy: actorId });
  }

  async listUsage(principal, input = {}) {
    requirePlatformAdmin(principal);
    return this.repository.listUsage(input);
  }

  async listAudit(principal, input = {}) {
    requirePlatformAdmin(principal);
    return this.repository.listAudit(input);
  }
}
