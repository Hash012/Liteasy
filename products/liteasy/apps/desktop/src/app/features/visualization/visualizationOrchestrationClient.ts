import type {
  ThinReadingVisualizationGenerationRequest,
  ThinReadingVisualizationOmissionReason
} from "../artifacts/artifact.types";
import type { MultimodalVisualizationCapability } from "../account/accountCapabilitiesClient";
import { parseVisualizationArtifact } from "./visualizationArtifact.schema";
import type { VisualizationArtifactV1 } from "./visualizationArtifact.types";
import {
  createVisualizationPendingRequestStore,
  type PendingVisualizationRequest
} from "./visualizationPendingRequestStore";

type HttpResponse = {
  json(): Promise<unknown>;
  ok: boolean;
  status: number;
};

type ClientInput = {
  endpoint: string;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<HttpResponse>;
  getAccessToken: () => string | undefined;
  getCapability: () => MultimodalVisualizationCapability;
  now?: () => Date;
  setTimeoutImpl?: typeof setTimeout;
  storage?: Storage;
  subjectId: string;
};

type VisualizationCancellationReason = "preference_disabled" | "user_cancelled" | "workflow_disposed";

const activeStates = new Set(["cancel_requested", "queued", "running"]);
const terminalStates = new Set(["cancelled", "failed", "omitted", "succeeded"]);

export class VisualizationOrchestrationClientError extends Error {
  constructor(public readonly reasonCode: ThinReadingVisualizationOmissionReason) {
    super(reasonCode);
  }
}

function reason(code: unknown): ThinReadingVisualizationOmissionReason {
  if (code === "capability_unauthorized") return "capability_unavailable";
  if (code === "quota_exhausted") return "quota_unavailable";
  if (code === "stale_artifact" || code === "cancelled") return "stale_request";
  if (code === "evidence_invalid" || code === "validation_failed") return "result_invalid";
  if (code === "provider_unavailable") return "service_unavailable";
  if (code === "preference_disabled" || code === "modality_unavailable") return code;
  return "generation_failed";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function endpoint(value: string) {
  const url = new URL(value);
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("visualization_endpoint_invalid");
  return value.replace(/\/+$/, "");
}

function preflightCapability(capability: MultimodalVisualizationCapability, request: ThinReadingVisualizationGenerationRequest) {
  if (!capability.allowed) return "capability_unavailable";
  if (!capability.enabled) return "preference_disabled";
  if (!capability.serviceAvailable) return "service_unavailable";
  if (!capability.quota.available) return "quota_unavailable";
  if (request.requestedArtifactCount === 2 && !capability.explicitRequestsAllowed) {
    return "explicit_request_unavailable";
  }
  if (!request.candidateModalities.some((modality) => capability.availableModalities.includes(modality))) {
    return "modality_unavailable";
  }
  return null;
}

function wait(milliseconds: number, signal: AbortSignal, setTimeoutImpl: typeof setTimeout) {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeoutImpl(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function createVisualizationOrchestrationClient({
  endpoint: endpointInput,
  fetchImpl = fetch,
  getAccessToken,
  getCapability,
  now = () => new Date(),
  setTimeoutImpl = setTimeout,
  storage,
  subjectId
}: ClientInput) {
  const baseUrl = endpoint(endpointInput);
  const store = createVisualizationPendingRequestStore({ endpoint: baseUrl, now, storage, subjectId });

  async function request(path: string, init: RequestInit, signal?: AbortSignal) {
    const token = getAccessToken()?.trim();
    if (!token) throw new VisualizationOrchestrationClientError("capability_unavailable");
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {})
      },
      signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new VisualizationOrchestrationClientError("capability_unavailable");
      }
      throw new VisualizationOrchestrationClientError(reason(record(payload)?.code));
    }
    return payload;
  }

  async function terminalResult(value: unknown, pending: PendingVisualizationRequest) {
    const payload = record(value);
    if (!payload || !exactKeys(payload, [
      "artifacts", "reasonCode", "requestId", "resultArtifactIds", "retryAfterMs", "status"
    ]) || payload.requestId !== pending.requestId || typeof payload.status !== "string" ||
      !terminalStates.has(payload.status)) {
      throw new VisualizationOrchestrationClientError("result_invalid");
    }
    store.remove(pending.requestId);
    if (payload.status !== "succeeded") throw new VisualizationOrchestrationClientError(reason(payload.reasonCode));
    if (!Array.isArray(payload.artifacts) || !Array.isArray(payload.resultArtifactIds) ||
      payload.artifacts.length < 1 || payload.artifacts.length > pending.requestedArtifactCount ||
      payload.resultArtifactIds.length !== payload.artifacts.length ||
      !payload.resultArtifactIds.every((artifactId) => typeof artifactId === "string")) {
      throw new VisualizationOrchestrationClientError("result_invalid");
    }
    const resultArtifactIds = payload.resultArtifactIds as string[];
    let artifacts: VisualizationArtifactV1[];
    try {
      artifacts = payload.artifacts.map(parseVisualizationArtifact);
    } catch {
      throw new VisualizationOrchestrationClientError("result_invalid");
    }
    if (artifacts.some((artifact, index) => (
      artifact.artifactId !== resultArtifactIds[index] || artifact.nodeId !== pending.nodeId
    ))) {
      throw new VisualizationOrchestrationClientError("result_invalid");
    }
    return artifacts;
  }

  async function poll(pending: PendingVisualizationRequest, signal: AbortSignal, initial?: unknown) {
    let payload = initial;
    while (true) {
      const current = record(payload);
      if (current?.status && terminalStates.has(String(current.status))) return terminalResult(current, pending);
      if (payload !== undefined && (!current || !activeStates.has(String(current.status)) ||
        !exactKeys(current, ["requestId", "resultArtifactIds", "retryAfterMs", "status"]))) {
        throw new VisualizationOrchestrationClientError("result_invalid");
      }
      const delay = Math.max(250, Math.min(2_000,
        Number.isSafeInteger(current?.retryAfterMs) ? Number(current?.retryAfterMs) : 500
      ));
      if (payload !== undefined) await wait(delay, signal, setTimeoutImpl);
      payload = await request(
        `/v1/account/visualization/requests/${encodeURIComponent(pending.requestId)}`,
        { method: "GET" },
        signal
      );
    }
  }

  return {
    async cancel(input: {
      artifactId: string;
      nodeId: string;
      reason: VisualizationCancellationReason;
      requestId: string;
    }) {
      const controller = new AbortController();
      const timer = setTimeoutImpl(() => controller.abort(), 1_000);
      try {
        await request(`/v1/account/visualization/requests/${encodeURIComponent(input.requestId)}/cancel`, {
          body: JSON.stringify({ idempotencyKey: `${input.requestId}:cancel:${input.reason}` }),
          method: "POST"
        }, controller.signal);
        store.remove(input.requestId);
      } catch {
        // Pending coordinates remain available for recovery when cancellation is unconfirmed.
      } finally {
        clearTimeout(timer);
      }
    },
    pending() {
      return store.list();
    },
    async resumeAndWait(pending: PendingVisualizationRequest, signal: AbortSignal) {
      return poll(pending, signal);
    },
    async startAndWait(generation: ThinReadingVisualizationGenerationRequest) {
      const denied = preflightCapability(getCapability(), generation);
      if (denied) throw new VisualizationOrchestrationClientError(denied);
      const pending: PendingVisualizationRequest = {
        artifactId: generation.artifactId,
        createdAt: now().toISOString(),
        nodeId: generation.nodeId,
        requestId: generation.requestId,
        requestedArtifactCount: generation.requestedArtifactCount
      };
      store.put(pending);
      const initial = await request("/v1/account/visualization/requests", {
        body: JSON.stringify({
          artifactId: generation.artifactId,
          nodeId: generation.nodeId,
          requestId: generation.requestId,
          requestedArtifactCount: generation.requestedArtifactCount
        }),
        method: "POST"
      }, generation.signal);
      return poll(pending, generation.signal, initial);
    }
  };
}

export type VisualizationOrchestrationClient = ReturnType<typeof createVisualizationOrchestrationClient>;
