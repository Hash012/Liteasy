import { describe, expect, test } from "vitest";
import { solveGeometry3D, validateGeometry3D } from "../app/features/visualization/kernels/geometry3dKernel";
import { cubeSectionFixture } from "./fixtures/interactiveMathFixtures";

describe("solveGeometry3D", () => {
  test("computes a cube-plane section without degenerate faces", () => {
    expect(solveGeometry3D(cubeSectionFixture).sections[0].vertices).toHaveLength(6);
  });

  test("rejects zero-area mesh faces", () => {
    expect(() => validateGeometry3D({
      ...cubeSectionFixture,
      objects: [{ ...cubeSectionFixture.objects[0], faces: [[0, 0, 0]] }]
    })).toThrow("geometry_3d_face_degenerate");
  });

  test("requires objects and sections to bind evidence", () => {
    expect(() => validateGeometry3D({
      ...cubeSectionFixture,
      sections: [{ ...cubeSectionFixture.sections[0], evidenceClaimIds: [] }]
    })).toThrow("geometry_3d_evidence_missing");
  });
});
