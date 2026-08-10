import { describe, expect, test } from "vitest";
import type { ReactionProcessSpecV1 } from "../app/features/visualization/visualizationArtifact.types";
import { balanceReaction, parseChemicalFormula, validateReactionProcess } from "../app/features/visualization/kernels/reactionProcessKernel";

const combustionFixture = {
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

describe("reaction process kernel", () => {
  test("parses chemical formulas and conserves atoms", () => {
    expect(parseChemicalFormula("CH4")).toEqual({ C: 1, H: 4 });
    expect(balanceReaction(combustionFixture.steps[0])).toEqual({ ch4: 1, co2: 1, h2o: 2, o2: 2 });
    expect(() => validateReactionProcess(combustionFixture)).not.toThrow();
  });

  test("rejects a claimed mechanism without mechanism evidence", () => {
    expect(() => validateReactionProcess({
      ...combustionFixture,
      steps: [{ ...combustionFixture.steps[0], mechanism: [{ evidenceClaimIds: [], id: "m1", label: "radical" }] }]
    })).toThrow("reaction_mechanism_unbound");
  });

  test("rejects non-conserved reactions", () => {
    expect(() => validateReactionProcess({
      ...combustionFixture,
      steps: [{ ...combustionFixture.steps[0], products: [{ coefficient: 1, speciesId: "co2" }] }]
    })).toThrow("reaction_conservation_failed");
  });
});
