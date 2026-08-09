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
  const allowed = value.allowed === true;
  const quotaAvailable = allowed && value.quota?.available === true;
  const remainingBand = value.quota?.remainingBand;
  return {
    allowed,
    availableModalities: allowed && Array.isArray(value.availableModalities)
      ? value.availableModalities.filter((item) => typeof item === "string")
      : [],
    enabled: allowed && value.enabled === true,
    quota: {
      available: quotaAvailable,
      ...(quotaAvailable && new Set(["none", "low", "available"]).has(remainingBand)
        ? { remainingBand }
        : {})
    },
    serviceAvailable: allowed && value.serviceAvailable === true
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
  const code = error?.code;
  if (typeof code !== "string" || !code.startsWith("visualization_")) return error;
  const status = code === "visualization_provider_timeout" ? 504
    : code === "visualization_request_aborted" ? 499
      : code === "visualization_validation_failed" ? 422
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
  constructor({ authorizeDocument, gateway, repository }) {
    if (!repository || !gateway || typeof authorizeDocument !== "function") {
      throw new Error("visualization_service_dependencies_invalid");
    }
    this.authorizeDocument = authorizeDocument;
    this.gateway = gateway;
    this.repository = repository;
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
    try {
      const providerInput = { ...input.providerRequest, signal: context.signal };
      const result = input.providerRequest?.operation === "image_generation"
        ? await this.gateway.generateImage(providerInput)
        : await this.gateway.generateStructured(providerInput);
      throwIfAborted(context.signal);
      return { reservation: reserved.reservation, result };
    } catch (error) {
      await rollback(this.repository, subjectId, reservationId, error, context.traceId);
      throw publicError(error);
    }
  }

  async submit(subjectId, input, context = {}) {
    const reservationId = identifier(input?.reservationId, "visualization_reservation_invalid");
    try {
      throwIfAborted(context.signal);
      const entitlement = await this.repository.getEntitlement(subjectId);
      if (entitlement.allowed !== true || !entitlement.allowedModalities?.includes(input.modality)) {
        throw new VisualizationServiceError("visualization_entitlement_revoked", 403);
      }
      const currentCapability = await this.repository.capability(subjectId);
      if (currentCapability.enabled !== true) {
        throw new VisualizationServiceError("visualization_preference_disabled", 403);
      }
      const route = await this.repository.getProviderRoute(input.routeId);
      if (!route?.enabled || Number(route.revision) !== input.routeRevision) {
        throw new VisualizationServiceError("visualization_route_revision_changed", 409);
      }
      const access = await this.authorizeDocument({
        document: input.document,
        subjectId
      });
      if (access?.allowed !== true || access.sourceIdentityHash !== input.document?.sourceIdentityHash) {
        throw new VisualizationServiceError("visualization_source_access_revoked", 403);
      }
      throwIfAborted(context.signal);
      return await this.repository.settle(subjectId, {
        artifact: input.artifact,
        document: input.document,
        reasonCode: "completed",
        reservationId,
        routeId: input.routeId,
        routeRevision: input.routeRevision,
        settledUnits: input.settledUnits,
        traceId: context.traceId
      });
    } catch (error) {
      await rollback(this.repository, subjectId, reservationId, error, context.traceId);
      throw publicError(error);
    }
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
