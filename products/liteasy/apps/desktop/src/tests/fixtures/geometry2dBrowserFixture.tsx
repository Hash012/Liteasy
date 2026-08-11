import type { Geometry2DSpecV1 } from "../../app/features/visualization/visualizationArtifact.types";
import { Geometry2DRenderer, renderGeometry2D } from "../../app/features/visualization/renderers/geometry2dRenderer";

const geometry2dFixture = {
  constraints: [{ evidenceClaimIds: ["claim-tangent"], id: "tangent", kind: "tangent", objectIds: ["circle", "line"] }],
  objects: [
    { data: { cx: 0, cy: 0, radius: 1 }, evidenceClaimIds: ["claim-circle"], id: "circle", kind: "circle" },
    { data: { x1: -1, x2: 1, y1: 1, y2: 1 }, evidenceClaimIds: ["claim-line"], id: "line", kind: "line" }
  ],
  viewport: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 }
} as const satisfies Geometry2DSpecV1;

export default function Geometry2DBrowserFixture() {
  const rendered = renderGeometry2D(geometry2dFixture);

  return (
    <main data-testid="geometry-2d-browser-fixture">
      <Geometry2DRenderer rendered={rendered} />
      <output data-testid="geometry-2d-scene-metadata">
        {rendered.derivedPoints.map((point) => `${point.x},${point.y}`).join("|")}|{rendered.selectableObjectIds.join(",")}
      </output>
    </main>
  );
}
