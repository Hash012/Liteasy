import type { ReactionProcessSpecV1 } from "../../app/features/visualization/visualizationArtifact.types";
import { ReactionProcessRenderer, renderReactionProcess } from "../../app/features/visualization/renderers/reactionProcessRenderer";

const fixture = {
  atomMap: [],
  conditions: [],
  species: [
    { evidenceClaimIds: ["reaction-claim"], formula: "CH4", id: "ch4", state: "g" },
    { evidenceClaimIds: ["reaction-claim"], formula: "O2", id: "o2", state: "g" },
    { evidenceClaimIds: ["reaction-claim"], formula: "CO2", id: "co2", state: "g" },
    { evidenceClaimIds: ["reaction-claim"], formula: "H2O", id: "h2o", state: "l" }
  ],
  steps: [
    {
      evidenceClaimIds: ["reaction-claim"],
      id: "overall",
      products: [{ coefficient: 1, speciesId: "co2" }, { coefficient: 2, speciesId: "h2o" }],
      reactants: [{ coefficient: 1, speciesId: "ch4" }, { coefficient: 2, speciesId: "o2" }]
    }
  ]
} as const satisfies ReactionProcessSpecV1;

export default function ReactionProcessBrowserFixture() {
  const rendered = renderReactionProcess(fixture);

  return (
    <main data-testid="reaction-process-browser-fixture">
      <ReactionProcessRenderer rendered={rendered} />
      <output data-testid="reaction-process-scene-metadata">
        {rendered.equations[0]?.text}|{rendered.selectableObjectIds.join(",")}
      </output>
    </main>
  );
}
