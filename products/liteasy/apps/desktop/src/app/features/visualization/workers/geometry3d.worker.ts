import type { Geometry3DSpecV1 } from "../visualizationArtifact.types";
import type { Geometry3DSolveResultV1 } from "../kernels/geometry3dKernel";
import { solveGeometry3D } from "../kernels/geometry3dKernel";

export type Geometry3DWorkerRequest = {
  requestId: string;
  spec: Geometry3DSpecV1;
};

export type Geometry3DWorkerResponse =
  | { requestId: string; result: Geometry3DSolveResultV1 }
  | { diagnostic: string; requestId: string };

export function runGeometry3DWorker(spec: Geometry3DSpecV1, signal: AbortSignal, requestId = "geometry-3d-request"): Promise<Geometry3DSolveResultV1> {
  if (signal.aborted) return Promise.reject(new Error("geometry_worker_cancelled"));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("geometry_worker_cancelled"));
    };
    const timer = windowLikeSetTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) {
        reject(new Error("geometry_worker_cancelled"));
        return;
      }
      try {
        resolve(solveGeometry3D(spec));
      } catch (error) {
        reject(error);
      }
    }, 0);
    signal.addEventListener("abort", onAbort, { once: true });
    void requestId;
  });
}

function windowLikeSetTimeout(callback: () => void, timeout: number): ReturnType<typeof setTimeout> {
  return setTimeout(callback, timeout);
}
