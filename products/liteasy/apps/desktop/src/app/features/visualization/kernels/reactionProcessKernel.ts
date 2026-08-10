import type {
  AccessibilityProjectionV1,
  InteractionContractV1,
  ReactionProcessSpecV1,
  SemanticObjectV1
} from "../visualizationArtifact.types";

export type ReactionProcessResultV1 = {
  accessibility: AccessibilityProjectionV1;
  equations: readonly { id: string; text: string }[];
  interaction: InteractionContractV1;
  semanticObjects: readonly SemanticObjectV1[];
};

type FormulaCounts = Record<string, number>;
type ReactionStep = ReactionProcessSpecV1["steps"][number];

export function parseChemicalFormula(formula: string): FormulaCounts {
  if (!/^(?:[A-Z][a-z]?\d*)+$/u.test(formula)) throw new Error("reaction_formula_invalid");
  const counts: FormulaCounts = {};
  for (const match of formula.matchAll(/([A-Z][a-z]?)(\d*)/gu)) {
    const element = match[1];
    const count = match[2] ? Number(match[2]) : 1;
    counts[element] = (counts[element] ?? 0) + count;
  }
  return counts;
}

export function balanceReaction(step: ReactionStep): Record<string, number> {
  return Object.fromEntries(
    [...step.reactants, ...step.products]
      .map((item) => [item.speciesId, item.coefficient])
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
  );
}

export function validateReactionProcess(spec: ReactionProcessSpecV1): ReactionProcessResultV1 {
  const speciesById = new Map(spec.species.map((species) => [species.id, species]));
  if (speciesById.size !== spec.species.length) throw new Error("reaction_species_duplicate");
  for (const species of spec.species) {
    if (species.evidenceClaimIds.length === 0) throw new Error("reaction_species_unbound");
    parseChemicalFormula(species.formula);
  }
  const equations: { id: string; text: string }[] = [];
  for (const step of spec.steps) {
    if (step.evidenceClaimIds.length === 0) throw new Error("reaction_step_unbound");
    for (const mechanism of step.mechanism ?? []) {
      if (mechanism.evidenceClaimIds.length === 0) throw new Error("reaction_mechanism_unbound");
    }
    assertReferences(step, speciesById);
    assertConserved(step, speciesById);
    equations.push({ id: step.id, text: equationText(step, speciesById) });
  }
  for (const condition of spec.conditions) {
    if (condition.evidenceClaimIds.length === 0) throw new Error("reaction_condition_unbound");
  }
  const selectableObjectIds = [...spec.species.map((species) => species.id), ...spec.steps.map((step) => step.id)];
  return {
    accessibility: {
      dataTable: equations.map((equation) => ({ label: equation.id, value: equation.text })),
      objectReadingOrder: selectableObjectIds,
      summary: equations.map((equation) => equation.text).join("; ")
    },
    equations,
    interaction: {
      pan: true,
      zoom: true,
      rotate: false,
      playback: "stepwise",
      parameterIds: spec.conditions.map((condition) => condition.id),
      selectableObjectIds
    },
    semanticObjects: selectableObjectIds.map((id) => {
      const species = speciesById.get(id);
      const step = spec.steps.find((item) => item.id === id);
      return {
        evidenceClaimIds: species?.evidenceClaimIds ?? step?.evidenceClaimIds ?? [],
        kind: species ? "chemical_species" : "reaction_step",
        label: species?.formula ?? id,
        objectId: id,
        objectPath: [id],
        selectable: true
      } satisfies SemanticObjectV1;
    })
  };
}

function assertReferences(step: ReactionStep, speciesById: ReadonlyMap<string, ReactionProcessSpecV1["species"][number]>): void {
  for (const item of [...step.reactants, ...step.products]) {
    if (!speciesById.has(item.speciesId) || !Number.isInteger(item.coefficient) || item.coefficient <= 0) {
      throw new Error("reaction_reference_invalid");
    }
  }
}

function assertConserved(step: ReactionStep, speciesById: ReadonlyMap<string, ReactionProcessSpecV1["species"][number]>): void {
  const reactants = aggregate(step.reactants, speciesById);
  const products = aggregate(step.products, speciesById);
  const elements = new Set([...Object.keys(reactants), ...Object.keys(products)]);
  for (const element of elements) {
    if ((reactants[element] ?? 0) !== (products[element] ?? 0)) throw new Error("reaction_conservation_failed");
  }
}

function aggregate(items: ReactionStep["reactants"], speciesById: ReadonlyMap<string, ReactionProcessSpecV1["species"][number]>): FormulaCounts {
  const counts: FormulaCounts = {};
  for (const item of items) {
    const species = speciesById.get(item.speciesId)!;
    for (const [element, count] of Object.entries(parseChemicalFormula(species.formula))) {
      counts[element] = (counts[element] ?? 0) + count * item.coefficient;
    }
  }
  return counts;
}

function equationText(step: ReactionStep, speciesById: ReadonlyMap<string, ReactionProcessSpecV1["species"][number]>): string {
  const side = (items: ReactionStep["reactants"]) => items
    .map((item) => `${item.coefficient === 1 ? "" : item.coefficient}${speciesById.get(item.speciesId)!.formula}`)
    .join(" + ");
  return `${side(step.reactants)} -> ${side(step.products)}`;
}
