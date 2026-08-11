import { describe, expect, test, vi } from "vitest";
import { simulatePhysicsProcess } from "../app/features/visualization/kernels/physicsProcessKernel";
import type {
  PhysicsProcessWorkerPort,
  PhysicsProcessWorkerRequest,
  PhysicsProcessWorkerResponse
} from "../app/features/visualization/workers/physicsProcess.worker";
import { runPhysicsProcessWorker } from "../app/features/visualization/workers/physicsProcess.worker";
import { projectileProcessFixture } from "./fixtures/processFixtures";

class FakePhysicsProcessWorker implements PhysicsProcessWorkerPort {
  private messageListeners = new Set<(event: MessageEvent<PhysicsProcessWorkerResponse>) => void>();
  private errorListeners = new Set<(event: ErrorEvent) => void>();
  postMessage = vi.fn((request: PhysicsProcessWorkerRequest) => {
    queueMicrotask(() => {
      const event = new MessageEvent<PhysicsProcessWorkerResponse>("message", {
        data: { requestId: request.requestId, result: simulatePhysicsProcess(request.spec, request.spec.seed) }
      });
      this.messageListeners.forEach((listener) => listener(event));
    });
  });
  terminate = vi.fn();

  addEventListener(type: "message" | "error", listener: ((event: MessageEvent<PhysicsProcessWorkerResponse>) => void) | ((event: ErrorEvent) => void)) {
    if (type === "message") this.messageListeners.add(listener as (event: MessageEvent<PhysicsProcessWorkerResponse>) => void);
    else this.errorListeners.add(listener as (event: ErrorEvent) => void);
  }

  removeEventListener(type: "message" | "error", listener: ((event: MessageEvent<PhysicsProcessWorkerResponse>) => void) | ((event: ErrorEvent) => void)) {
    if (type === "message") this.messageListeners.delete(listener as (event: MessageEvent<PhysicsProcessWorkerResponse>) => void);
    else this.errorListeners.delete(listener as (event: ErrorEvent) => void);
  }
}

describe("runPhysicsProcessWorker", () => {
  test("resolves a bounded timeline through the worker protocol", async () => {
    const worker = new FakePhysicsProcessWorker();
    await expect(runPhysicsProcessWorker(
      projectileProcessFixture,
      new AbortController().signal,
      "test-request",
      () => worker
    )).resolves.toMatchObject({
      frames: expect.any(Array),
      replay: { algorithmId: "physics-process-euler/v1", seed: "seed-1" }
    });
    expect(worker.postMessage).toHaveBeenCalledWith({ requestId: "test-request", spec: projectileProcessFixture });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  test("cancels a stale worker request and terminates it", async () => {
    const controller = new AbortController();
    const worker = new FakePhysicsProcessWorker();
    const pending = runPhysicsProcessWorker(projectileProcessFixture, controller.signal, "cancel-request", () => worker);

    controller.abort();

    await expect(pending).rejects.toThrow("physics_worker_cancelled");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
