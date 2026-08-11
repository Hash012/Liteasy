/// <reference lib="webworker" />

import { simulatePhysicsProcess } from "../kernels/physicsProcessKernel";
import type { PhysicsProcessWorkerRequest, PhysicsProcessWorkerResponse } from "./physicsProcess.worker";

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.addEventListener("message", (event: MessageEvent<PhysicsProcessWorkerRequest>) => {
  const { requestId, spec } = event.data;
  try {
    const response = {
      requestId,
      result: simulatePhysicsProcess(spec, spec.seed)
    } satisfies PhysicsProcessWorkerResponse;
    workerScope.postMessage(response);
  } catch (error) {
    const response = {
      diagnostic: error instanceof Error ? error.message : "physics_worker_failed",
      requestId
    } satisfies PhysicsProcessWorkerResponse;
    workerScope.postMessage(response);
  }
});
