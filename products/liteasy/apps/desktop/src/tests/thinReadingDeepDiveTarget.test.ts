import { describe, expect, test } from "vitest";
import { artifactWithSelectedObject, unknownObject } from "./fixtures/visualizationFixtures";
import {
  createGeneratedObjectTarget,
  createSourceFigureTarget,
  createSourceRegionTarget
} from "../app/features/thin-reading/thinReadingDeepDiveTarget";

describe("thin reading deep-dive targets", () => {
  test("normalizes a drag rectangle against intrinsic image dimensions", () => {
    expect(createSourceRegionTarget({
      displayRect: { left: 100, top: 50, width: 400, height: 200 },
      drag: { startX: 200, startY: 100, endX: 360, endY: 190 },
      evidenceIds: ["e-1"], figureId: "fig-1", nodeId: "node-1",
      sourcePixelSize: { width: 1600, height: 800 }
    }).bbox).toEqual({ x: 0.25, y: 0.25, width: 0.4, height: 0.45 });
  });

  test("rejects an object whose claim IDs are not present on the artifact", () => {
    expect(() => createGeneratedObjectTarget(artifactWithSelectedObject, unknownObject))
      .toThrow("deep_dive_target_evidence_invalid");
  });

  test("requires an exact source figure identity and evidence", () => {
    expect(() => createSourceFigureTarget({
      artifact: artifactWithSelectedObject,
      nodeId: "node-1",
      sourceFigureId: "figure-missing",
      evidenceIds: ["e-1"]
    })).toThrow("deep_dive_target_source_figure_invalid");
  });
});
