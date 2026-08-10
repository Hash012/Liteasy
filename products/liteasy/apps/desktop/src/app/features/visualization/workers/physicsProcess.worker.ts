import type { PhysicsProcessSpecV1 } from "../visualizationArtifact.types";
import type { PhysicsProcessResultV1 } from "../kernels/physicsProcessKernel";
import { simulatePhysicsProcess } from "../kernels/physicsProcessKernel";

export function runPhysicsProcessWorker(
  spec: PhysicsProcessSpecV1,
  signal: AbortSignal,
  requestId = "physics-process-request"
): Promise<PhysicsProcessResultV1> {
  if (signal.aborted) return Promise.reject(new Error("physics_worker_cancelled"));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("physics_worker_cancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) {
        reject(new Error("physics_worker_cancelled"));
        return;
      }
      try {
        resolve(simulatePhysicsProcess(spec, spec.seed));
      } catch (error) {
        reject(error);
      }
    }, 0);
    signal.addEventListener("abort", onAbort, { once: true });
    void requestId;
  });
}
