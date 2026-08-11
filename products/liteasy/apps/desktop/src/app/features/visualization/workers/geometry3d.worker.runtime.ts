/// <reference lib="webworker" />

import { solveGeometry3D } from "../kernels/geometry3dKernel";
import type { Geometry3DWorkerRequest, Geometry3DWorkerResponse } from "./geometry3d.worker";

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.addEventListener("message", (event: MessageEvent<Geometry3DWorkerRequest>) => {
  const { requestId, spec } = event.data;
  try {
    const response = { requestId, result: solveGeometry3D(spec) } satisfies Geometry3DWorkerResponse;
    workerScope.postMessage(response);
  } catch (error) {
    const response = {
      diagnostic: error instanceof Error ? error.message : "geometry_worker_failed",
      requestId
    } satisfies Geometry3DWorkerResponse;
    workerScope.postMessage(response);
  }
});
