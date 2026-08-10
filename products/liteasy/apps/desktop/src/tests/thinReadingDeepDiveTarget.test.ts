import { describe, expect, test } from "vitest";
import { artifactWithSelectedObject, unknownObject } from "./fixtures/visualizationFixtures";
import { createThinReadingFixture } from "./fixtures/thinReadingFixtures";
import { createThinReadingDocument } from "../app/features/thin-reading/thinReadingProjection";
import {
  createGeneratedObjectTarget,
  createSourceFigureTarget,
  createSourceRegionTarget,
  isDeepDiveTargetBoundToNode
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

  test("rejects a generated artifact whose own node binding differs from its parent", () => {
    const document = createThinReadingDocument(createThinReadingFixture());
    const root = document.nodes[document.rootNodeId];
    const claimId = root.evidence.claims?.[0]?.id;
    if (!claimId) throw new Error("expected fixture claim");
    const artifact = {
      ...artifactWithSelectedObject,
      nodeId: "another-node",
      semanticObjects: [{ ...artifactWithSelectedObject.semanticObjects[0], evidenceClaimIds: [claimId] }],
      spec: {
        ...artifactWithSelectedObject.spec,
        payload: {
          ...artifactWithSelectedObject.spec.payload,
          claims: [{ ...artifactWithSelectedObject.spec.payload.claims[0], id: claimId }]
        }
      }
    };
    const node = { ...root, visualizations: [artifact] };

    expect(isDeepDiveTargetBoundToNode({
      artifactId: artifact.artifactId,
      evidenceClaimIds: [claimId],
      kind: "generated_object",
      nodeId: root.id,
      objectId: "object-1",
      objectPath: ["object-1"]
    }, node)).toBe(false);
  });
});
