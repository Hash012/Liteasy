import { createHash, randomUUID } from "node:crypto";
import {
  availableVisualizationModalities,
  visualizationOrchestrationReason
} from "./visualizationOrchestrationService.mjs";
import { rasterProviderPayload } from "./visualizationRasterService.mjs";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function publicationEnvelope(artifact, source) {
  return {
    artifactId: artifact.artifactId,
    body: artifact,
    contentHash: null,
    evidenceHash: digest(source.evidence),
    modality: artifact.modality,
    nodeId: artifact.nodeId,
    specHash: digest(artifact.spec),
    state: "ready"
  };
}

export class VisualizationOrchestrationWorker {
  #active = new Set();
  #controllers = new Map();
  #recoveryScheduled = false;
  #scheduled = false;
  #closed = false;

  constructor({
    compilerRegistry,
    generationRepository,
    queueMicrotaskImpl = queueMicrotask,
    recoveryLimit = 50,
    sourceResolver,
    visualizationService,
    workerId = `visualization-worker-${randomUUID()}`
  }) {
    if (!compilerRegistry || !generationRepository || !sourceResolver || !visualizationService ||
      typeof queueMicrotaskImpl !== "function") {
      throw new Error("visualization_orchestration_worker_dependencies_invalid");
    }
    this.compilerRegistry = compilerRegistry;
    this.generationRepository = generationRepository;
    this.queueMicrotaskImpl = queueMicrotaskImpl;
    this.recoveryLimit = recoveryLimit;
    this.sourceResolver = sourceResolver;
    this.visualizationService = visualizationService;
    this.workerId = workerId;
  }

  #key(subjectId, requestId) {
    return `${subjectId}\u0000${requestId}`;
  }

  schedule() {
    if (this.#closed || this.#scheduled) return;
    this.#scheduled = true;
    this.queueMicrotaskImpl(() => {
      this.#scheduled = false;
      void this.drainOne().then((result) => {
        if (result) this.schedule();
      }).catch(() => {});
    });
  }

  scheduleRecovery() {
    if (this.#closed || this.#recoveryScheduled) return;
    this.#recoveryScheduled = true;
    this.queueMicrotaskImpl(() => {
      this.#recoveryScheduled = false;
      if (!this.#closed) void this.recover().catch(() => {});
    });
  }

  abort(subjectId, requestId) {
    this.#controllers.get(this.#key(subjectId, requestId))?.abort();
  }

  async #requestIsRunning(claim) {
    const projection = await this.generationRepository.get(claim.subjectId, claim.requestId);
    if (new Set(["cancel_requested", "cancelled"]).has(projection.status)) throw failure("cancelled");
    if (projection.status !== "running") throw failure("internal_failure");
  }

  async #currentSource(claim) {
    const source = await this.sourceResolver.resolve({
      artifactId: claim.artifactId,
      nodeId: claim.nodeId,
      subjectId: claim.subjectId
    });
    if (source.artifactRevision !== claim.artifactRevision || source.intentHash !== claim.intentHash ||
      source.nodeId !== claim.nodeId) {
      throw failure("stale_artifact");
    }
    return source;
  }

  async #rollback(subjectId, reservationId, error, traceId) {
    const reason = visualizationOrchestrationReason(error);
    const rollbackError = reason === "validation_failed" ? failure("visualization_validation_failed") : error;
    await this.visualizationService.rollbackGeneratedReservation(subjectId, reservationId, rollbackError, { traceId });
  }

  async #rollbackAll(subjectId, reservationIds, error, traceId) {
    const reason = visualizationOrchestrationReason(error);
    const rollbackError = reason === "validation_failed" ? failure("visualization_validation_failed") : error;
    if (typeof this.visualizationService.rollbackGeneratedReservations === "function") {
      await this.visualizationService.rollbackGeneratedReservations(subjectId, reservationIds, rollbackError, { traceId });
      return;
    }
    for (const reservationId of reservationIds) await this.#rollback(subjectId, reservationId, error, traceId);
  }

  async #generateOne(claim, index, signal) {
    await this.#requestIsRunning(claim);
    const source = await this.#currentSource(claim);
    const capability = await this.visualizationService.accountCapability(claim.subjectId);
    const modalities = availableVisualizationModalities(source, capability, this.compilerRegistry);
    if (capability.allowed !== true) throw failure("capability_unauthorized");
    if (source.intent.requestedBy === "explicit_user_request" && capability.explicitRequestsAllowed !== true) {
      throw failure("capability_unauthorized");
    }
    if (capability.serviceAvailable === true && capability.enabled !== true) throw failure("preference_disabled");
    if (capability.serviceAvailable !== true) throw failure("modality_unavailable");
    if (capability.quota?.available !== true) throw failure("quota_exhausted");
    if (modalities.length === 0) throw failure("modality_unavailable");
    const modality = modalities[index % modalities.length];
    await this.#requestIsRunning(claim);
    let generation = await this.visualizationService.generate(claim.subjectId, {
      providerRequest: {
        dataClass: "paper",
        input: source.providerInput,
        operation: "structured_generation",
        payload: this.compilerRegistry.providerPayload(modality, source)
      },
      reservation: {
        idempotencyKey: `${claim.requestId}:artifact:${index}`,
        modality,
        requestedBy: source.intent.requestedBy === "automatic" ? "automatic" : "explicit"
      }
    }, { signal, traceId: claim.traceId });
    const reservationIds = [generation.reservation.reservationId];
    let submissionStarted = false;
    try {
      let proposal = modality === "raster_illustration"
        ? this.compilerRegistry.prepareProposal({
            modality,
            nodeId: source.nodeId,
            proposal: generation.result.text,
            source
          })
        : generation.result.text;
      let primaryGeneration = generation;
      let rasterAsset;
      if (modality === "raster_illustration") {
        rasterProviderPayload(proposal.spec.payload);
        await this.#requestIsRunning(claim);
        await this.#currentSource(claim);
        primaryGeneration = await this.visualizationService.generate(claim.subjectId, {
          providerRequest: {
            dataClass: "paper",
            operation: "image_generation",
            payload: rasterProviderPayload(proposal.spec.payload)
          },
          reservation: {
            idempotencyKey: `${claim.requestId}:artifact:${index}:image`,
            modality,
            reservationGroupId: generation.reservation.reservationGroupId ?? generation.reservation.reservationId,
            requestedBy: source.intent.requestedBy === "automatic" ? "automatic" : "explicit"
          }
        }, { signal, traceId: claim.traceId });
        reservationIds.push(primaryGeneration.reservation.reservationId);
        rasterAsset = await this.visualizationService.materializeRasterAsset({
          image: primaryGeneration.result,
          sourceIdentityHashes: source.documents.map(({ sourceIdentityHash }) => sourceIdentityHash),
          spec: proposal.spec.payload
        }, { signal, traceId: claim.traceId });
      }
      const compile = () => this.compilerRegistry.compile({
        locale: source.locale,
        modality,
        nodeId: source.nodeId,
        proposal,
        ...(rasterAsset ? { rasterAsset } : {}),
        reservation: primaryGeneration.reservation,
        source
      });
      let artifact;
      try {
        artifact = await compile();
      } catch (error) {
        if (modality === "raster_illustration" || visualizationOrchestrationReason(error) !== "validation_failed") {
          throw error;
        }
        await this.#rollbackAll(claim.subjectId, [...reservationIds], error, claim.traceId);
        reservationIds.length = 0;
        const repairPayload = this.compilerRegistry.providerPayload(modality, source);
        generation = await this.visualizationService.generate(claim.subjectId, {
          providerRequest: {
            dataClass: "paper",
            input: source.providerInput,
            operation: "structured_generation",
            payload: {
              ...repairPayload,
              prompt: [
                repairPayload.prompt,
                "This is a validation repair attempt. Recheck every schema field, evidence binding, reference, uniqueness constraint, and acyclic graph constraint before returning JSON."
              ].join("\n")
            }
          },
          reservation: {
            idempotencyKey: `${claim.requestId}:artifact:${index}:repair:1`,
            modality,
            requestedBy: source.intent.requestedBy === "automatic" ? "automatic" : "explicit"
          }
        }, { signal, traceId: claim.traceId });
        reservationIds.push(generation.reservation.reservationId);
        primaryGeneration = generation;
        proposal = generation.result.text;
        artifact = await compile();
      }
      await this.#requestIsRunning(claim);
      const current = await this.#currentSource(claim);
      submissionStarted = true;
      const publication = await this.visualizationService.submit(claim.subjectId, {
        artifact: publicationEnvelope(artifact, current),
        documents: current.documents,
        modality,
        ...(modality === "raster_illustration" ? { auxiliaryReservationIds: [generation.reservation.reservationId] } : {}),
        reservationId: primaryGeneration.reservation.reservationId,
        routeId: primaryGeneration.reservation.routeId,
        routeRevision: primaryGeneration.reservation.routeRevision
      }, { signal, traceId: claim.traceId });
      return publication.artifact?.artifactId ?? artifact.artifactId;
    } catch (error) {
      if (!submissionStarted) {
        await this.#rollbackAll(claim.subjectId, reservationIds, error, claim.traceId);
      }
      throw error;
    }
  }

  async #finishTerminal(claim, state, reason) {
    try {
      return await this.generationRepository.markTerminal(claim.subjectId, claim.requestId, state, reason);
    } catch (error) {
      const current = await this.generationRepository.get(claim.subjectId, claim.requestId).catch(() => null);
      if (current && new Set(["cancelled", "failed", "omitted", "succeeded"]).has(current.status)) return current;
      throw error;
    }
  }

  async #process(claim, signal) {
    try {
      const results = await Promise.allSettled(
        Array.from({ length: claim.requestedArtifactCount }, (_, index) => this.#generateOne(claim, index, signal))
      );
      const artifactIds = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") {
        const reason = visualizationOrchestrationReason(failed.reason);
        if (artifactIds.length > 0 && reason !== "cancelled") {
          return this.generationRepository.markSucceeded(
            claim.subjectId,
            claim.requestId,
            artifactIds,
            "partial_generation_failed"
          );
        }
        throw failed.reason;
      }
      return await this.generationRepository.markSucceeded(claim.subjectId, claim.requestId, artifactIds);
    } catch (error) {
      const reason = visualizationOrchestrationReason(error);
      if (this.#closed && reason === "cancelled") return null;
      return this.#finishTerminal(claim, reason === "cancelled" ? "cancelled" : "failed", reason);
    }
  }

  async drainOne() {
    if (this.#closed) return null;
    const operation = (async () => {
      const claim = await this.generationRepository.claimNext(this.workerId);
      if (!claim) return null;
      const controller = new AbortController();
      const key = this.#key(claim.subjectId, claim.requestId);
      this.#controllers.set(key, controller);
      try {
        return await this.#process(claim, controller.signal);
      } finally {
        this.#controllers.delete(key);
      }
    })();
    this.#active.add(operation);
    try {
      return await operation;
    } finally {
      this.#active.delete(operation);
    }
  }

  async recover() {
    if (this.#closed) return null;
    const operation = (async () => {
      const recovery = await this.generationRepository.requeueExpired();
      let drained = 0;
      while (!this.#closed && drained < this.recoveryLimit) {
        const result = await this.drainOne();
        if (!result) break;
        drained += 1;
      }
      return { ...recovery, drained };
    })();
    this.#active.add(operation);
    try {
      return await operation;
    } finally {
      this.#active.delete(operation);
    }
  }

  async close() {
    this.#closed = true;
    for (const controller of this.#controllers.values()) controller.abort();
    await Promise.allSettled([...this.#active]);
  }
}
