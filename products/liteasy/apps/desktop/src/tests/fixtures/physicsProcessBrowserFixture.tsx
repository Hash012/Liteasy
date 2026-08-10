import { PhysicsProcessRenderer, renderPhysicsProcess } from "../../app/features/visualization/renderers/physicsProcessRenderer";
import { projectileProcessFixture } from "./processFixtures";

export default function PhysicsProcessBrowserFixture() {
  const rendered = renderPhysicsProcess(projectileProcessFixture);

  return (
    <main data-testid="physics-process-browser-fixture">
      <PhysicsProcessRenderer rendered={rendered} />
      <output data-testid="physics-process-scene-metadata">
        {rendered.frames.length}|{rendered.selectableObjectIds.join(",")}
      </output>
    </main>
  );
}
