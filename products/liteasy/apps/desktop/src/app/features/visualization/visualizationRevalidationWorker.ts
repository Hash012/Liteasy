import type { VisualizationArtifactV1 } from "./visualizationArtifact.types";
import type { VisualizationArtifactIndex } from "./visualizationRuntime";
import { runVisualizationValidators, type VisualizationValidationContext } from "./visualizationValidator";
import { getVisualizationValidators } from "./visualizationValidatorRegistry";

export type VisualizationRevalidationRequest = {
  artifact: VisualizationArtifactV1;
  artifactIndex: VisualizationArtifactIndex;
  requestId: string;
  type: "revalidate";
};

export type VisualizationRevalidationCancel = {
  requestId: string;
  type: "cancel";
};

export type VisualizationRevalidationResult = {
  outcome: "pass" | "fail";
  requestId: string;
  type: "result";
};

export type VisualizationRevalidationWorkerMessage =
  | VisualizationRevalidationRequest
  | VisualizationRevalidationCancel
  | VisualizationRevalidationResult;

export type VisualizationRevalidationWorkerPort = {
  addEventListener: (type: "message", listener: (event: MessageEvent<VisualizationRevalidationWorkerMessage>) => void) => void;
  postMessage: (message: VisualizationRevalidationWorkerMessage) => void;
  removeEventListener: (type: "message", listener: (event: MessageEvent<VisualizationRevalidationWorkerMessage>) => void) => void;
  terminate: () => void;
};

export type VisualizationRevalidationWorkerService = {
  revalidate: (input: Omit<VisualizationRevalidationRequest, "requestId" | "type">, signal?: AbortSignal) => Promise<"pass" | "fail">;
  terminate: () => void;
};

export async function revalidateVisualizationArtifactInWorker(
  request: VisualizationRevalidationRequest
): Promise<VisualizationRevalidationResult> {
  try {
    const validatorIds = Object.keys(request.artifactIndex.hardValidatorVersions);
    const validators = getVisualizationValidators(validatorIds);
    const validatorVersionsMatch = validators.every((validator, index) =>
      request.artifactIndex.hardValidatorVersions[validatorIds[index]] === validator.version
    );
    if (!validatorVersionsMatch || validators.some((validator) => validator.gate !== "hard")) {
      return workerResult(request.requestId, "fail");
    }
    const report = await runVisualizationValidators(toValidationContext(request.artifact), validators);
    return workerResult(request.requestId, report.outcome === "pass" ? "pass" : "fail");
  } catch {
    return workerResult(request.requestId, "fail");
  }
}

export function createVisualizationRevalidationWorkerClient(input: {
  workerFactory?: () => VisualizationRevalidationWorkerPort;
} = {}): VisualizationRevalidationWorkerService {
  const worker = (input.workerFactory ?? createBrowserWorker)();
  let requestSequence = 0;
  const pending = new Map<string, {
    reject: (reason?: unknown) => void;
    resolve: (outcome: "pass" | "fail") => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }>();

  const onMessage = (event: MessageEvent<VisualizationRevalidationWorkerMessage>) => {
    if (event.data.type !== "result") return;
    const request = pending.get(event.data.requestId);
    if (!request) return;
    pending.delete(event.data.requestId);
    if (request.signal && request.onAbort) request.signal.removeEventListener("abort", request.onAbort);
    request.resolve(event.data.outcome);
  };
  worker.addEventListener("message", onMessage);

  return {
    revalidate(input, signal) {
      if (signal?.aborted) return Promise.reject(new Error("visualization_revalidation_cancelled"));
      const requestId = `visualization-revalidation-${requestSequence += 1}`;
      return new Promise<"pass" | "fail">((resolve, reject) => {
        const onAbort = () => {
          pending.delete(requestId);
          worker.postMessage({ requestId, type: "cancel" });
          reject(new Error("visualization_revalidation_cancelled"));
        };
        pending.set(requestId, { onAbort, reject, resolve, signal });
        signal?.addEventListener("abort", onAbort, { once: true });
        worker.postMessage({ ...input, requestId, type: "revalidate" });
      });
    },
    terminate() {
      worker.removeEventListener("message", onMessage);
      worker.terminate();
      for (const [requestId, request] of pending) {
        if (request.signal && request.onAbort) request.signal.removeEventListener("abort", request.onAbort);
        request.reject(new Error("visualization_revalidation_terminated"));
        pending.delete(requestId);
      }
    }
  };
}

function toValidationContext(artifact: VisualizationArtifactV1): VisualizationValidationContext {
  return {
    accessibility: artifact.accessibility,
    artifactVersion: artifact.artifactVersion,
    evidenceBindings: artifact.evidenceBindings,
    interaction: artifact.interaction,
    modality: artifact.modality,
    repairCount: artifact.validation.repairCount,
    semanticObjects: artifact.semanticObjects,
    spec: artifact.spec
  };
}

function workerResult(requestId: string, outcome: "pass" | "fail"): VisualizationRevalidationResult {
  return { outcome, requestId, type: "result" };
}

function createBrowserWorker(): VisualizationRevalidationWorkerPort {
  return new Worker(new URL("./visualizationRevalidationWorker.ts", import.meta.url), {
    type: "module"
  }) as VisualizationRevalidationWorkerPort;
}

const workerScope = globalThis as unknown as {
  addEventListener?: (type: "message", listener: (event: MessageEvent<VisualizationRevalidationWorkerMessage>) => void) => void;
  postMessage?: (message: VisualizationRevalidationWorkerMessage) => void;
};
const cancelledRequestIds = new Set<string>();

if (typeof window === "undefined" && workerScope.addEventListener && workerScope.postMessage) {
  workerScope.addEventListener("message", async (event) => {
    if (event.data.type === "cancel") {
      cancelledRequestIds.add(event.data.requestId);
      return;
    }
    if (event.data.type !== "revalidate") return;
    const result = await revalidateVisualizationArtifactInWorker(event.data);
    if (!cancelledRequestIds.delete(event.data.requestId)) workerScope.postMessage?.(result);
  });
}
