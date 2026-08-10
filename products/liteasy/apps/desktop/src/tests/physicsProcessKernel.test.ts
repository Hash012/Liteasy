import { describe, expect, test } from "vitest";
import { simulatePhysicsProcess, validatePhysicsProcess } from "../app/features/visualization/kernels/physicsProcessKernel";
import { projectileProcessFixture } from "./fixtures/processFixtures";

describe("simulatePhysicsProcess", () => {
  test("replays the same seeded timeline byte-for-byte", () => {
    expect(simulatePhysicsProcess(projectileProcessFixture, "seed-1")).toEqual(
      simulatePhysicsProcess(projectileProcessFixture, "seed-1")
    );
  });

  test("fails the hard gate when accumulated error exceeds the declared threshold", () => {
    expect(() => simulatePhysicsProcess({ ...projectileProcessFixture, errorTolerance: 0 }, "seed-1")).toThrow("physics_error_tolerance_exceeded");
  });

  test("requires equations and invariants to bind evidence", () => {
    expect(() => validatePhysicsProcess({
      ...projectileProcessFixture,
      equations: [{ ...projectileProcessFixture.equations[0], evidenceClaimIds: [] }]
    })).toThrow("physics_process_evidence_missing");
  });
});
