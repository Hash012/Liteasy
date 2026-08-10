import { describe, expect, test } from "vitest";
import { runGeometry3DWorker } from "../app/features/visualization/workers/geometry3d.worker";
import { cubeSectionFixture } from "./fixtures/interactiveMathFixtures";

describe("runGeometry3DWorker", () => {
  test("resolves a bounded 3D solve result", async () => {
    await expect(runGeometry3DWorker(cubeSectionFixture, new AbortController().signal)).resolves.toMatchObject({
      sections: [{ id: "mid-section" }]
    });
  });

  test("cancels a stale worker request", async () => {
    const controller = new AbortController();
    const pending = runGeometry3DWorker(cubeSectionFixture, controller.signal);

    controller.abort();

    await expect(pending).rejects.toThrow("geometry_worker_cancelled");
  });
});
