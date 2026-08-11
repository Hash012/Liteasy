import { Geometry3DRenderer, renderGeometry3D } from "../../app/features/visualization/renderers/geometry3dRenderer";
import { cubeSectionFixture } from "./interactiveMathFixtures";

export default function Geometry3DBrowserFixture() {
  const rendered = renderGeometry3D(cubeSectionFixture);

  return (
    <main data-testid="geometry-3d-browser-fixture">
      <Geometry3DRenderer rendered={rendered} />
      <output data-testid="geometry-3d-scene-metadata">
        {rendered.sections[0]?.vertices.length ?? 0}|{rendered.selectableObjectIds.join(",")}
      </output>
    </main>
  );
}
