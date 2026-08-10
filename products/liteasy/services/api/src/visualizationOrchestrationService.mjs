import { VisualizationServiceError } from "./visualizationService.mjs";

const publicReasons = new Set([
  "capability_unauthorized", "preference_disabled", "modality_unavailable", "quota_exhausted",
  "stale_artifact", "evidence_invalid", "source_access_revoked", "cancelled", "provider_unavailable",
  "validation_failed", "partial_generation_failed", "provider_result_recovery_required", "internal_failure"
]);

function record(value, fields, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.has(key))) {
    throw new VisualizationServiceError(code);
  }
  return value;
}

function identifier(value, code, maximum = 200) {
  if (typeof value !== "string" || value.length > maximum || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new VisualizationServiceError(code);
  }
  return value;
}

function subject(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 300) {
    throw new VisualizationServiceError("identity_subject_invalid", 401);
  }
  return value.trim();
}

function startInput(value) {
  const input = record(value, new Set(["artifactId", "nodeId", "requestId", "requestedArtifactCount"]), "visualization_request_invalid");
  if (!Number.isSafeInteger(input.requestedArtifactCount) || input.requestedArtifactCount < 1 || input.requestedArtifactCount > 2) {
    throw new VisualizationServiceError("visualization_requested_count_invalid");
  }
  return {
    artifactId: identifier(input.artifactId, "visualization_artifact_id_invalid", 160),
    nodeId: identifier(input.nodeId, "visualization_node_id_invalid", 160),
    requestId: identifier(input.requestId, "visualization_request_id_invalid"),
    requestedArtifactCount: input.requestedArtifactCount
  };
}

export function availableVisualizationModalities(source, capability, compilerRegistry) {
  const candidates = Array.isArray(source?.intent?.candidateModalities) ? source.intent.candidateModalities : [];
  const available = new Set(Array.isArray(capability?.availableModalities) ? capability.availableModalities : []);
  return candidates.filter((modality) => available.has(modality) && compilerRegistry.has(modality));
}

export function visualizationOrchestrationReason(error) {
  const code = error?.code ?? error?.message;
  if (publicReasons.has(code)) return code;
  if (code === "visualization_request_aborted" || error?.name === "AbortError" ||
    code === "visualization_request_cancelled") return "cancelled";
  if (code === "visualization_entitlement_revoked" || code === "visualization_not_allowed" ||
    code === "visualization_explicit_request_not_allowed" || code === "visualization_modality_not_allowed") {
    return "capability_unauthorized";
  }
  if (code === "visualization_preference_disabled") return "preference_disabled";
  if (code === "visualization_quota_exceeded" || code === "visualization_quota_unconfigured") return "quota_exhausted";
  if (code === "visualization_source_access_revoked" ||
    (typeof code === "string" && (code.includes("external_grant") || code.includes("external_source_expired")))) {
    return "source_access_revoked";
  }
  if (typeof code === "string" && (code.includes("source_invalid") || code.includes("evidence") ||
    code.includes("thin_reading_visualization_source"))) return "evidence_invalid";
  if (typeof code === "string" && (code.includes("validation") || code.includes("compiler") ||
    code.includes("proposal") || code.includes("artifact_schema"))) return "validation_failed";
  if (typeof code === "string" && (code.includes("provider") || code.includes("route"))) return "provider_unavailable";
  return "internal_failure";
}

function gateReason(source, capability, compilerRegistry, requestedArtifactCount) {
  if (capability?.allowed !== true) return "capability_unauthorized";
  if (source.intent.requestedBy === "explicit_user_request" && capability.explicitRequestsAllowed !== true) {
    return "capability_unauthorized";
  }
  if (capability.serviceAvailable === true && capability.enabled !== true) return "preference_disabled";
  if (capability.serviceAvailable !== true) return "modality_unavailable";
  if (capability.quota?.available !== true) return "quota_exhausted";
  if (source.intent.requestedBy === "automatic" && requestedArtifactCount !== 1) {
    throw new VisualizationServiceError("visualization_requested_count_invalid");
  }
  return availableVisualizationModalities(source, capability, compilerRegistry).length === 0
    ? "modality_unavailable"
    : null;
}

export class VisualizationOrchestrationService {
  constructor({ compilerRegistry, generationRepository, sourceResolver, visualizationService, worker }) {
    if (!compilerRegistry || !generationRepository || !sourceResolver || !visualizationService || !worker) {
      throw new Error("visualization_orchestration_dependencies_invalid");
    }
    this.compilerRegistry = compilerRegistry;
    this.generationRepository = generationRepository;
    this.sourceResolver = sourceResolver;
    this.visualizationService = visualizationService;
    this.worker = worker;
  }

  async start(subjectInput, inputValue, traceInput) {
    const subjectId = subject(subjectInput);
    const input = startInput(inputValue);
    const traceId = identifier(traceInput, "trace_id_invalid", 160);
    let source;
    try {
      source = await this.sourceResolver.resolve({
        artifactId: input.artifactId,
        nodeId: input.nodeId,
        subjectId
      });
    } catch (error) {
      throw new VisualizationServiceError(visualizationOrchestrationReason(error), error?.status ?? 422);
    }
    if (source.intent?.requestedBy === "automatic" && input.requestedArtifactCount !== 1) {
      throw new VisualizationServiceError("visualization_requested_count_invalid");
    }
    if (source.intent?.requestedBy !== "automatic" && source.intent?.requestedBy !== "explicit_user_request") {
      throw new VisualizationServiceError("evidence_invalid", 422);
    }
    const capability = await this.visualizationService.accountCapability(subjectId);
    const reasonCode = gateReason(source, capability, this.compilerRegistry, input.requestedArtifactCount);
    const projection = await this.generationRepository.create(subjectId, {
      ...input,
      artifactRevision: source.artifactRevision,
      intentHash: source.intentHash,
      traceId
    });
    if (projection.status !== "queued") return this.status(subjectId, input.requestId);
    if (reasonCode) {
      return this.generationRepository.markTerminal(subjectId, input.requestId, "omitted", reasonCode);
    }
    this.worker.schedule();
    return projection;
  }

  async status(subjectInput, requestInput) {
    const subjectId = subject(subjectInput);
    const requestId = identifier(requestInput, "visualization_request_id_invalid");
    const projection = await this.generationRepository.get(subjectId, requestId);
    if (projection.status !== "succeeded") return { ...projection, artifacts: [] };
    try {
      const artifacts = await this.visualizationService.publishedArtifacts(subjectId, projection.resultArtifactIds);
      return { ...projection, artifacts };
    } catch (error) {
      throw new VisualizationServiceError("validation_failed", 422);
    }
  }

  async cancel(subjectInput, requestInput, inputValue, _traceId) {
    const subjectId = subject(subjectInput);
    const requestId = identifier(requestInput, "visualization_request_id_invalid");
    const input = record(inputValue, new Set(["idempotencyKey"]), "visualization_cancel_invalid");
    const idempotencyKey = identifier(input.idempotencyKey, "idempotency_key_invalid");
    if (idempotencyKey.length < 8) throw new VisualizationServiceError("idempotency_key_invalid");
    const projection = await this.generationRepository.requestCancel(subjectId, requestId, idempotencyKey);
    this.worker.abort(subjectId, requestId);
    return projection;
  }

  drainOne() {
    return this.worker.drainOne();
  }

  recover() {
    return this.worker.recover();
  }

  close() {
    return this.worker.close();
  }
}
