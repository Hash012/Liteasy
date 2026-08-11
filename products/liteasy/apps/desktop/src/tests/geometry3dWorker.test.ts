import { describe, expect, test, vi } from "vitest";
import { solveGeometry3D } from "../app/features/visualization/kernels/geometry3dKernel";
import type {
  Geometry3DWorkerPort,
  Geometry3DWorkerRequest,
  Geometry3DWorkerResponse
} from "../app/features/visualization/workers/geometry3d.worker";
import { runGeometry3DWorker } from "../app/features/visualization/workers/geometry3d.worker";
import { cubeSectionFixture } from "./fixtures/interactiveMathFixtures";

class FakeGeometry3DWorker implements Geometry3DWorkerPort {
  private messageListeners = new Set<(event: MessageEvent<Geometry3DWorkerResponse>) => void>();
  private errorListeners = new Set<(event: ErrorEvent) => void>();
  postMessage = vi.fn((request: Geometry3DWorkerRequest) => {
    queueMicrotask(() => {
      const event = new MessageEvent<Geometry3DWorkerResponse>("message", {
        data: { requestId: request.requestId, result: solveGeometry3D(request.spec) }
      });
      this.messageListeners.forEach((listener) => listener(event));
    });
  });
  terminate = vi.fn();

  addEventListener(type: "message" | "error", listener: ((event: MessageEvent<Geometry3DWorkerResponse>) => void) | ((event: ErrorEvent) => void)) {
    if (type === "message") this.messageListeners.add(listener as (event: MessageEvent<Geometry3DWorkerResponse>) => void);
    else this.errorListeners.add(listener as (event: ErrorEvent) => void);
  }

  removeEventListener(type: "message" | "error", listener: ((event: MessageEvent<Geometry3DWorkerResponse>) => void) | ((event: ErrorEvent) => void)) {
    if (type === "message") this.messageListeners.delete(listener as (event: MessageEvent<Geometry3DWorkerResponse>) => void);
    else this.errorListeners.delete(listener as (event: ErrorEvent) => void);
  }
}

describe("runGeometry3DWorker", () => {
  test("resolves a bounded 3D solve result", async () => {
    const worker = new FakeGeometry3DWorker();
    await expect(runGeometry3DWorker(
      cubeSectionFixture,
      new AbortController().signal,
      "test-request",
      () => worker
    )).resolves.toMatchObject({
      sections: [{ id: "mid-section" }]
    });
    expect(worker.postMessage).toHaveBeenCalledWith({ requestId: "test-request", spec: cubeSectionFixture });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  test("cancels a stale worker request", async () => {
    const controller = new AbortController();
    const worker = new FakeGeometry3DWorker();
    const pending = runGeometry3DWorker(cubeSectionFixture, controller.signal, "cancelled-request", () => worker);

    controller.abort();

    await expect(pending).rejects.toThrow("geometry_worker_cancelled");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
