import { describe, expect, test } from "vitest";
import type { Geometry2DSpecV1 } from "../app/features/visualization/visualizationArtifact.types";
import { solveGeometry2D, validateGeometry2D } from "../app/features/visualization/kernels/geometry2dKernel";

const tangentFixture = {
  constraints: [{ evidenceClaimIds: ["claim-tangent"], id: "tangent", kind: "tangent", objectIds: ["circle", "line"] }],
  objects: [
    { data: { cx: 0, cy: 0, radius: 1 }, evidenceClaimIds: ["claim-circle"], id: "circle", kind: "circle" },
    { data: { x1: -1, x2: 1, y1: 1, y2: 1 }, evidenceClaimIds: ["claim-line"], id: "line", kind: "line" }
  ],
  viewport: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 }
} as const satisfies Geometry2DSpecV1;

describe("solveGeometry2D", () => {
  test("solves a tangent point deterministically", () => {
    expect(solveGeometry2D(tangentFixture).derivedPoints).toEqual([{ derived: true, id: "tangent-point", x: 0, y: 1 }]);
  });

  test("rejects a degenerate circle", () => {
    expect(() => validateGeometry2D({
      ...tangentFixture,
      objects: [{ ...tangentFixture.objects[0], data: { cx: 0, cy: 0, radius: 0 } }]
    })).toThrow("geometry_radius_invalid");
  });

  test("requires all geometric facts and constraints to bind evidence", () => {
    expect(() => validateGeometry2D({
      ...tangentFixture,
      constraints: [{ ...tangentFixture.constraints[0], evidenceClaimIds: [] }]
    })).toThrow("geometry_evidence_missing");
  });

  test("rejects degenerate bounded paths", () => {
    expect(() => validateGeometry2D({
      constraints: [],
      objects: [{ data: { points: [0, 0, 0, 0] }, evidenceClaimIds: ["claim-polygon"], id: "polygon", kind: "polygon" }],
      viewport: tangentFixture.viewport
    })).toThrow("geometry_polygon_invalid");
    expect(() => validateGeometry2D({
      constraints: [],
      objects: [{ data: { cx: 0, cy: 0, endAngle: 0, radius: 1, startAngle: 0 }, evidenceClaimIds: ["claim-arc"], id: "arc", kind: "arc" }],
      viewport: tangentFixture.viewport
    })).toThrow("geometry_arc_invalid");
  });
});
