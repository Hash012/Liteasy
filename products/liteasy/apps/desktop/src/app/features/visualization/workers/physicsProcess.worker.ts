import type { PhysicsProcessSpecV1 } from "../visualizationArtifact.types";
import type { PhysicsProcessResultV1 } from "../kernels/physicsProcessKernel";

export type PhysicsProcessWorkerRequest = {
  requestId: string;
  spec: PhysicsProcessSpecV1;
};

export type PhysicsProcessWorkerResponse =
  | { requestId: string; result: PhysicsProcessResultV1 }
  | { diagnostic: string; requestId: string };

export type PhysicsProcessWorkerPort = {
  addEventListener(type: "message", listener: (event: MessageEvent<PhysicsProcessWorkerResponse>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  postMessage(request: PhysicsProcessWorkerRequest): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<PhysicsProcessWorkerResponse>) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  terminate(): void;
};

type WorkerFactory = () => PhysicsProcessWorkerPort;

export function createPhysicsProcessWorker(): PhysicsProcessWorkerPort {
  if (typeof Worker === "undefined") throw new Error("physics_worker_unavailable");
  return new Worker(new URL("./physicsProcess.worker.runtime.ts", import.meta.url), {
    name: "liteasy-physics-process",
    type: "module"
  });
}

export function runPhysicsProcessWorker(
  spec: PhysicsProcessSpecV1,
  signal: AbortSignal,
  requestId = createRequestId(),
  workerFactory: WorkerFactory = createPhysicsProcessWorker
): Promise<PhysicsProcessResultV1> {
  if (signal.aborted) return Promise.reject(new Error("physics_worker_cancelled"));

  return new Promise((resolve, reject) => {
    let worker: PhysicsProcessWorkerPort;
    try {
      worker = workerFactory();
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.terminate();
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => settle(() => reject(new Error("physics_worker_cancelled")));
    const onError = () => settle(() => reject(new Error("physics_worker_failed")));
    const onMessage = (event: MessageEvent<PhysicsProcessWorkerResponse>) => {
      const response = event.data;
      if (response.requestId !== requestId) return;
      if ("diagnostic" in response) {
        settle(() => reject(new Error(response.diagnostic)));
        return;
      }
      settle(() => resolve(response.result));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({ requestId, spec });
  });
}

function createRequestId(): string {
  return `physics-process-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
