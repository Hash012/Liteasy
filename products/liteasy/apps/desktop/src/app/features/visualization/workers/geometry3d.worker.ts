import type { Geometry3DSpecV1 } from "../visualizationArtifact.types";
import type { Geometry3DSolveResultV1 } from "../kernels/geometry3dKernel";

export type Geometry3DWorkerRequest = {
  requestId: string;
  spec: Geometry3DSpecV1;
};

export type Geometry3DWorkerResponse =
  | { requestId: string; result: Geometry3DSolveResultV1 }
  | { diagnostic: string; requestId: string };

export type Geometry3DWorkerPort = {
  addEventListener(type: "message", listener: (event: MessageEvent<Geometry3DWorkerResponse>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  postMessage(request: Geometry3DWorkerRequest): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<Geometry3DWorkerResponse>) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  terminate(): void;
};

type WorkerFactory = () => Geometry3DWorkerPort;

export function createGeometry3DWorker(): Geometry3DWorkerPort {
  if (typeof Worker === "undefined") throw new Error("geometry_worker_unavailable");
  return new Worker(new URL("./geometry3d.worker.runtime.ts", import.meta.url), {
    name: "liteasy-geometry-3d",
    type: "module"
  });
}

export function runGeometry3DWorker(
  spec: Geometry3DSpecV1,
  signal: AbortSignal,
  requestId = createRequestId(),
  workerFactory: WorkerFactory = createGeometry3DWorker
): Promise<Geometry3DSolveResultV1> {
  if (signal.aborted) return Promise.reject(new Error("geometry_worker_cancelled"));

  return new Promise((resolve, reject) => {
    let worker: Geometry3DWorkerPort;
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
    const onAbort = () => settle(() => reject(new Error("geometry_worker_cancelled")));
    const onError = () => settle(() => reject(new Error("geometry_worker_failed")));
    const onMessage = (event: MessageEvent<Geometry3DWorkerResponse>) => {
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
  return `geometry-3d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
