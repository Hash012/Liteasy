import type { VisualizationArtifactV1 } from "./visualizationArtifact.types";
import type { VisualizationArtifactIndex } from "./visualizationRuntime";
import { runVisualizationValidators, type VisualizationValidationContext } from "./visualizationValidator";
import { getVisualizationValidators } from "./visualizationValidatorRegistry";

export type VisualizationRevalidationRequest = {
  artifact: VisualizationArtifactV1;
  artifactIndex: VisualizationArtifactIndex;
  expectedHardValidatorVersions: Record<string, string>;
  requestId: string;
  type: "revalidate";
};

export type VisualizationRevalidationResult = {
  outcome: "pass" | "fail";
  requestId: string;
  type: "result";
  usedHardValidatorVersions: Record<string, string>;
};

export type VisualizationRevalidationWorkerMessage =
  | VisualizationRevalidationRequest
  | VisualizationRevalidationResult;

export type VisualizationRevalidationWorkerPort = {
  addEventListener: (type: "message", listener: (event: MessageEvent<VisualizationRevalidationWorkerMessage>) => void) => void;
  postMessage: (message: VisualizationRevalidationWorkerMessage) => void;
  removeEventListener: (type: "message", listener: (event: MessageEvent<VisualizationRevalidationWorkerMessage>) => void) => void;
  terminate: () => void;
};

export type VisualizationRevalidationWorkerService = {
  revalidate: (input: Omit<VisualizationRevalidationRequest, "requestId" | "type">, signal?: AbortSignal) => Promise<VisualizationRevalidationOutcome>;
  terminate: () => void;
};

export type VisualizationRevalidationOutcome = Pick<VisualizationRevalidationResult, "outcome" | "usedHardValidatorVersions">;

export async function revalidateVisualizationArtifactInWorker(
  request: VisualizationRevalidationRequest
): Promise<VisualizationRevalidationResult> {
  try {
    const validatorIds = Object.keys(request.expectedHardValidatorVersions);
    if (validatorIds.length === 0) return workerResult(request.requestId, "fail", {});
    const validators = getVisualizationValidators(validatorIds);
    const validatorVersionsMatch = validators.every((validator, index) =>
      request.expectedHardValidatorVersions[validatorIds[index]] === validator.version
    );
    if (!validatorVersionsMatch || validators.some((validator) => validator.gate !== "hard")) {
      return workerResult(request.requestId, "fail", {});
    }
    const report = await runVisualizationValidators(toValidationContext(request.artifact), validators);
    return workerResult(
      request.requestId,
      report.outcome === "pass" ? "pass" : "fail",
      Object.fromEntries(validatorIds.map((id, index) => [id, validators[index].version]))
    );
  } catch {
    return workerResult(request.requestId, "fail", {});
  }
}

export function createVisualizationRevalidationWorkerClient(input: {
  workerFactory?: () => VisualizationRevalidationWorkerPort;
} = {}): VisualizationRevalidationWorkerService {
  const workerFactory = input.workerFactory ?? createBrowserWorker;
  let requestSequence = 0;
  const pending = new Map<string, {
    listener: (event: MessageEvent<VisualizationRevalidationWorkerMessage>) => void;
    worker: VisualizationRevalidationWorkerPort;
    reject: (reason?: unknown) => void;
    resolve: (outcome: VisualizationRevalidationOutcome) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }>();

  return {
    revalidate(input, signal) {
      if (signal?.aborted) return Promise.reject(new Error("visualization_revalidation_cancelled"));
      const requestId = `visualization-revalidation-${requestSequence += 1}`;
      const worker = workerFactory();
      return new Promise<VisualizationRevalidationOutcome>((resolve, reject) => {
        const onMessage = (event: MessageEvent<VisualizationRevalidationWorkerMessage>) => {
          if (event.data.type !== "result" || event.data.requestId !== requestId) return;
          const request = pending.get(requestId);
          if (!request) return;
          cleanup(requestId);
          request.resolve({ outcome: event.data.outcome, usedHardValidatorVersions: event.data.usedHardValidatorVersions });
        };
        const onAbort = () => {
          cleanup(requestId);
          reject(new Error("visualization_revalidation_cancelled"));
        };
        pending.set(requestId, { listener: onMessage, onAbort, reject, resolve, signal, worker });
        worker.addEventListener("message", onMessage);
        signal?.addEventListener("abort", onAbort, { once: true });
        worker.postMessage({ ...input, requestId, type: "revalidate" });
      });
    },
    terminate() {
      for (const [requestId, request] of pending) {
        cleanup(requestId);
        request.reject(new Error("visualization_revalidation_terminated"));
      }
    }
  };

  function cleanup(requestId: string) {
    const request = pending.get(requestId);
    if (!request) return;
    request.worker.removeEventListener("message", request.listener);
    request.worker.terminate();
    if (request.signal && request.onAbort) request.signal.removeEventListener("abort", request.onAbort);
    pending.delete(requestId);
  }
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

function workerResult(requestId: string, outcome: "pass" | "fail", usedHardValidatorVersions: Record<string, string>): VisualizationRevalidationResult {
  return { outcome, requestId, type: "result", usedHardValidatorVersions };
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
if (typeof window === "undefined" && workerScope.addEventListener && workerScope.postMessage) {
  workerScope.addEventListener("message", async (event) => {
    if (event.data.type !== "revalidate") return;
    const result = await revalidateVisualizationArtifactInWorker(event.data);
    workerScope.postMessage?.(result);
  });
}
