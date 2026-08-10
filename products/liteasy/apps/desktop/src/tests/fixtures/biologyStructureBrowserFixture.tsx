import { BiologyStructureRenderer, renderBiologyStructure } from "../../app/features/visualization/renderers/biologyStructureRenderer";
import { neuralFixture } from "./staticScienceFixtures";

export default function BiologyStructureBrowserFixture() {
  const rendered = renderBiologyStructure(neuralFixture());
  return (
    <main data-testid="biology-structure-browser-fixture">
      <BiologyStructureRenderer rendered={rendered} />
      <output data-testid="biology-structure-metadata">
        {rendered.selectableObjectIds.join(",")}
      </output>
    </main>
  );
}
