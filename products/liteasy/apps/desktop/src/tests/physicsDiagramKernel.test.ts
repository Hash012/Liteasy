import { describe, expect, test } from "vitest";
import { validatePhysicsDiagram } from "../app/features/visualization/kernels/physicsDiagramKernel";
import { projectileFixture } from "./fixtures/staticScienceFixtures";

describe("validatePhysicsDiagram", () => {
  test("rejects a physics vector with incompatible dimensions", () => {
    expect(() => validatePhysicsDiagram(projectileFixture({ vectorUnit: "kg" }))).toThrow("physics_dimension_mismatch");
  });

  test("accepts finite force vectors bound to evidence", () => {
    expect(validatePhysicsDiagram(projectileFixture()).selectableObjectIds).toEqual(["projectile", "gravity"]);
  });
});
