import assert from "node:assert/strict";
import test from "node:test";
import {
  balanceReaction,
  parseChemicalFormula,
  parseChemicalSpeciesFormula,
  validateReactionProcessPayload
} from "./reactionProcessValidation.mjs";

const combustionFixture = {
  atomMap: [],
  conditions: [],
  species: [
    { evidenceClaimIds: ["reaction-claim"], formula: "CH4", id: "ch4", state: "g" },
    { evidenceClaimIds: ["reaction-claim"], formula: "O2", id: "o2", state: "g" },
    { evidenceClaimIds: ["reaction-claim"], formula: "CO2", id: "co2", state: "g" },
    { evidenceClaimIds: ["reaction-claim"], formula: "H2O", id: "h2o", state: "l" }
  ],
  steps: [{
    evidenceClaimIds: ["reaction-claim"],
    id: "overall",
    products: [{ coefficient: 1, speciesId: "co2" }, { coefficient: 2, speciesId: "h2o" }],
    reactants: [{ coefficient: 1, speciesId: "ch4" }, { coefficient: 2, speciesId: "o2" }]
  }]
};

test("parses grouped, hydrated, state-qualified and charged chemical species", () => {
  assert.deepEqual(parseChemicalFormula("Al2(SO4)3"), { Al: 2, O: 12, S: 3 });
  assert.deepEqual(parseChemicalFormula("CuSO4·5H2O"), { Cu: 1, H: 10, O: 9, S: 1 });
  assert.deepEqual(parseChemicalSpeciesFormula("[Fe(CN)6]^4-(aq)"), {
    atomOrder: ["Fe", "C", "N", "C", "N", "C", "N", "C", "N", "C", "N", "C", "N"],
    atoms: { C: 6, Fe: 1, N: 6 },
    charge: -4
  });
  assert.equal(parseChemicalSpeciesFormula("NH4+").charge, 1);
  assert.equal(parseChemicalSpeciesFormula("Fe3+").charge, 3);
});

test("derives minimal integer coefficients with exact arithmetic", () => {
  const unbalanced = {
    ...combustionFixture.steps[0],
    products: combustionFixture.steps[0].products.map((item) => ({ ...item, coefficient: 1 })),
    reactants: combustionFixture.steps[0].reactants.map((item) => ({ ...item, coefficient: 1 }))
  };
  assert.deepEqual(balanceReaction(unbalanced, combustionFixture.species), { ch4: 1, co2: 1, h2o: 2, o2: 2 });
  assert.doesNotThrow(() => validateReactionProcessPayload(combustionFixture));
  assert.throws(() => validateReactionProcessPayload({
    ...combustionFixture,
    steps: [{
      ...combustionFixture.steps[0],
      products: combustionFixture.steps[0].products.map((item) => ({ ...item, coefficient: item.coefficient * 2 })),
      reactants: combustionFixture.steps[0].reactants.map((item) => ({ ...item, coefficient: item.coefficient * 2 }))
    }]
  }), /reaction_coefficients_not_minimal/);
});

test("checks ionic charge independently from element conservation", () => {
  assert.throws(() => validateReactionProcessPayload({
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
  }), /reaction_charge_conservation_failed/);
});

test("requires a complete one-to-one atom map and evidence-bound mechanisms", () => {
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
  };
  assert.doesNotThrow(() => validateReactionProcessPayload(mapped));
  assert.throws(() => validateReactionProcessPayload({ ...mapped, atomMap: mapped.atomMap.slice(0, 3) }), /reaction_atom_map_incomplete/);
  assert.throws(() => validateReactionProcessPayload({
    ...combustionFixture,
    steps: [{ ...combustionFixture.steps[0], mechanism: [{ evidenceClaimIds: [], id: "m1", label: "radical" }] }]
  }), /reaction_mechanism_unbound/);
});
