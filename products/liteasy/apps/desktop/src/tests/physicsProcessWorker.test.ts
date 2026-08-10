import { describe, expect, test } from "vitest";
import { runPhysicsProcessWorker } from "../app/features/visualization/workers/physicsProcess.worker";
import { projectileProcessFixture } from "./fixtures/processFixtures";

describe("runPhysicsProcessWorker", () => {
  test("resolves a bounded timeline", async () => {
    await expect(runPhysicsProcessWorker(projectileProcessFixture, new AbortController().signal)).resolves.toMatchObject({
      frames: expect.any(Array),
      replay: { algorithmId: "physics-process-euler/v1", seed: "seed-1" }
    });
  });

  test("cancels a stale worker request", async () => {
    const controller = new AbortController();
    const pending = runPhysicsProcessWorker(projectileProcessFixture, controller.signal);

    controller.abort();

    await expect(pending).rejects.toThrow("physics_worker_cancelled");
  });
});
