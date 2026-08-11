import { describe, expect, test } from "vitest";
import type { ReactionProcessSpecV1 } from "../app/features/visualization/visualizationArtifact.types";
import {
  balanceReaction,
  parseChemicalFormula,
  parseChemicalSpeciesFormula,
  validateReactionProcess
} from "../app/features/visualization/kernels/reactionProcessKernel";

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
  test("parses nested groups, hydrates, state suffixes and ionic charges", () => {
    expect(parseChemicalFormula("Al2(SO4)3")).toEqual({ Al: 2, O: 12, S: 3 });
    expect(parseChemicalFormula("CuSO4·5H2O")).toEqual({ Cu: 1, H: 10, O: 9, S: 1 });
    expect(parseChemicalSpeciesFormula("[Fe(CN)6]^4-(aq)")).toMatchObject({
      atoms: { C: 6, Fe: 1, N: 6 },
      charge: -4
    });
    expect(parseChemicalSpeciesFormula("NH4+").charge).toBe(1);
    expect(parseChemicalSpeciesFormula("Fe3+").charge).toBe(3);
  });

  test("derives the minimal integer balance using exact arithmetic", () => {
    const unbalancedStep = {
      ...combustionFixture.steps[0],
      products: combustionFixture.steps[0].products.map((item) => ({ ...item, coefficient: 1 })),
      reactants: combustionFixture.steps[0].reactants.map((item) => ({ ...item, coefficient: 1 }))
    };
    expect(balanceReaction(unbalancedStep, combustionFixture.species)).toEqual({ ch4: 1, co2: 1, h2o: 2, o2: 2 });
    expect(() => validateReactionProcess(combustionFixture)).not.toThrow();
  });

  test("checks charge conservation independently from element conservation", () => {
    const chargeMismatch = {
      atomMap: [],
      conditions: [],
      species: [
        { evidenceClaimIds: ["claim"], formula: "Na+", id: "sodiumIon", state: "aq" },
        { evidenceClaimIds: ["claim"], formula: "Na", id: "sodium", state: "s" }
      ],
      steps: [{
        evidenceClaimIds: ["claim"],
        id: "reduction",
        products: [{ coefficient: 1, speciesId: "sodium" }],
        reactants: [{ coefficient: 1, speciesId: "sodiumIon" }]
      }]
    } as const satisfies ReactionProcessSpecV1;
    expect(() => validateReactionProcess(chargeMismatch)).toThrow("reaction_charge_conservation_failed");
  });

  test("validates complete one-to-one atom maps across molecule instances", () => {
    const mapped = {
      atomMap: [
        { evidenceClaimIds: ["claim"], fromAtom: 0, fromSpeciesId: "h2", id: "h1", toAtom: 0, toMolecule: 0, toSpeciesId: "hcl" },
        { evidenceClaimIds: ["claim"], fromAtom: 1, fromSpeciesId: "h2", id: "h2", toAtom: 0, toMolecule: 1, toSpeciesId: "hcl" },
        { evidenceClaimIds: ["claim"], fromAtom: 0, fromSpeciesId: "cl2", id: "cl1", toAtom: 1, toMolecule: 0, toSpeciesId: "hcl" },
        { evidenceClaimIds: ["claim"], fromAtom: 1, fromSpeciesId: "cl2", id: "cl2", toAtom: 1, toMolecule: 1, toSpeciesId: "hcl" }
      ],
      conditions: [],
      species: [
        { evidenceClaimIds: ["claim"], formula: "H2", id: "h2", state: "g" },
        { evidenceClaimIds: ["claim"], formula: "Cl2", id: "cl2", state: "g" },
        { evidenceClaimIds: ["claim"], formula: "HCl", id: "hcl", state: "g" }
      ],
      steps: [{
        evidenceClaimIds: ["claim"],
        id: "overall",
        products: [{ coefficient: 2, speciesId: "hcl" }],
        reactants: [{ coefficient: 1, speciesId: "h2" }, { coefficient: 1, speciesId: "cl2" }]
      }]
    } as const satisfies ReactionProcessSpecV1;
    expect(() => validateReactionProcess(mapped)).not.toThrow();
    expect(() => validateReactionProcess({ ...mapped, atomMap: mapped.atomMap.slice(0, 3) })).toThrow("reaction_atom_map_incomplete");
    expect(() => validateReactionProcess({
      ...mapped,
      atomMap: mapped.atomMap.map((entry, index) => index === 0 ? { ...entry, toAtom: 1 } : entry)
    })).toThrow("reaction_atom_map_element_mismatch");
  });

  test("rejects a claimed mechanism without mechanism evidence", () => {
    expect(() => validateReactionProcess({
      ...combustionFixture,
      steps: [{ ...combustionFixture.steps[0], mechanism: [{ evidenceClaimIds: [], id: "m1", label: "radical" }] }]
    })).toThrow("reaction_mechanism_unbound");
  });

  test("rejects non-conserved and non-minimal authored reactions", () => {
    expect(() => validateReactionProcess({
      ...combustionFixture,
      steps: [{ ...combustionFixture.steps[0], products: [{ coefficient: 1, speciesId: "co2" }] }]
    })).toThrow("reaction_conservation_failed");
    expect(() => validateReactionProcess({
      ...combustionFixture,
      steps: [{
        ...combustionFixture.steps[0],
        products: combustionFixture.steps[0].products.map((item) => ({ ...item, coefficient: item.coefficient * 2 })),
        reactants: combustionFixture.steps[0].reactants.map((item) => ({ ...item, coefficient: item.coefficient * 2 }))
      }]
    })).toThrow("reaction_coefficients_not_minimal");
  });
});
