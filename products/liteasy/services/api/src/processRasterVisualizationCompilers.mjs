function pass() {
  return { outcome: "pass" };
}

function fail(diagnosticCode) {
  return { diagnosticCode, outcome: "fail" };
}

function requireEvidence(ids, code) {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error(code);
}

function proposalSchema(modality) {
  return {
    additionalProperties: false,
    properties: {
      accessibility: { additionalProperties: true, type: "object" },
      evidenceBindings: { type: "array" },
      interaction: { type: "object" },
      semanticObjects: { type: "array" },
      spec: {
        additionalProperties: false,
        properties: {
          modality: { const: modality },
          payload: { type: "object" }
        },
        required: ["modality", "payload"],
        type: "object"
      }
    },
    required: ["accessibility", "evidenceBindings", "interaction", "semanticObjects", "spec"],
    type: "object"
  };
}

function validatePhysicsProcess({ artifact }) {
  try {
    const payload = artifact.spec.payload;
    if (!Number.isFinite(payload.duration) || payload.duration <= 0 || !Number.isFinite(payload.frameRate) || payload.frameRate <= 0) throw new Error("physics_process_time_invalid");
    if (Math.ceil(payload.duration * payload.frameRate) > 120) throw new Error("physics_process_frame_limit");
    if (!Number.isFinite(payload.errorTolerance) || payload.errorTolerance <= 0) throw new Error("physics_error_tolerance_exceeded");
    requireEvidence(payload.evidenceBindings, "physics_process_evidence_missing");
    for (const value of Object.values(payload.initialState)) {
      if (!Number.isFinite(value)) throw new Error("physics_process_state_invalid");
    }
    for (const parameter of payload.parameters) {
      requireEvidence(parameter.evidenceClaimIds, "physics_process_evidence_missing");
      if (!Number.isFinite(parameter.value) || parameter.value < parameter.min || parameter.value > parameter.max) throw new Error("physics_process_parameter_invalid");
    }
    for (const equation of payload.equations) {
      requireEvidence(equation.evidenceClaimIds, "physics_process_evidence_missing");
      if (/[[\]{};'"]|globalThis|window|document/u.test(equation.expression)) throw new Error("physics_process_expression_invalid");
    }
    for (const invariant of payload.invariants) {
      requireEvidence(invariant.evidenceClaimIds, "physics_process_evidence_missing");
    }
    return pass();
  } catch (error) {
    return fail(error.message);
  }
}

function validateReactionProcess({ artifact }) {
  try {
    const payload = artifact.spec.payload;
    const speciesById = new Map(payload.species.map((species) => [species.id, species]));
    if (speciesById.size !== payload.species.length) throw new Error("reaction_species_duplicate");
    for (const species of payload.species) {
      requireEvidence(species.evidenceClaimIds, "reaction_species_unbound");
      parseFormula(species.formula);
    }
    for (const step of payload.steps) {
      requireEvidence(step.evidenceClaimIds, "reaction_step_unbound");
      for (const mechanism of step.mechanism ?? []) requireEvidence(mechanism.evidenceClaimIds, "reaction_mechanism_unbound");
      assertConserved(step, speciesById);
    }
    return pass();
  } catch (error) {
    return fail(error.message);
  }
}

function validateRasterIllustration({ artifact }) {
  try {
    const payload = artifact.spec.payload;
    requireEvidence(payload.evidenceClaimIds, "raster_evidence_missing");
    if (!Number.isFinite(payload.composition.width) || !Number.isFinite(payload.composition.height) ||
      payload.composition.width <= 0 || payload.composition.height <= 0 ||
      Math.abs(payload.composition.width / payload.composition.height - payload.composition.aspectRatio) > 1e-6) {
      throw new Error("raster_dimensions_invalid");
    }
    if (payload.styleLock?.prohibitDecorativeClaims !== true) throw new Error("raster_style_lock_invalid");
    for (const label of payload.labels) requireEvidence(label.evidenceClaimIds, "raster_evidence_missing");
    if (/(?:https?:|<script|foreignObject)/iu.test(payload.visualSchema)) throw new Error("raster_external_reference");
    return pass();
  } catch (error) {
    return fail(error.message);
  }
}

function parseFormula(formula) {
  if (!/^(?:[A-Z][a-z]?\d*)+$/u.test(formula)) throw new Error("reaction_formula_invalid");
  const counts = {};
  for (const match of formula.matchAll(/([A-Z][a-z]?)(\d*)/gu)) {
    counts[match[1]] = (counts[match[1]] ?? 0) + (match[2] ? Number(match[2]) : 1);
  }
  return counts;
}

function assertConserved(step, speciesById) {
  const reactants = aggregate(step.reactants, speciesById);
  const products = aggregate(step.products, speciesById);
  const elements = new Set([...Object.keys(reactants), ...Object.keys(products)]);
  for (const element of elements) {
    if ((reactants[element] ?? 0) !== (products[element] ?? 0)) throw new Error("reaction_conservation_failed");
  }
}

function aggregate(items, speciesById) {
  const counts = {};
  for (const item of items) {
    const species = speciesById.get(item.speciesId);
    if (!species) throw new Error("reaction_reference_invalid");
    for (const [element, count] of Object.entries(parseFormula(species.formula))) {
      counts[element] = (counts[element] ?? 0) + count * item.coefficient;
    }
  }
  return counts;
}

function descriptor({
  kernelId,
  modality,
  rendererId,
  skillId,
  validator
}) {
  return {
    hardValidators: [{ id: `${modality.replaceAll("_", "-")}-hard`, validate: validator, version: "1.0.0" }],
    implementation: {
      ...(kernelId ? { kernelId, kernelVersion: "1.0.0" } : {}),
      rendererId,
      rendererVersion: "1.0.0",
      skillId,
      skillVersion: "1.0.0"
    },
    modality,
    proposalSchema: proposalSchema(modality)
  };
}

export const productionProcessRasterVisualizationCompilers = Object.freeze({
  physics_process: descriptor({
    kernelId: "physics-process-v1",
    modality: "physics_process",
    rendererId: "physics-process-svg",
    skillId: "physics-process",
    validator: validatePhysicsProcess
  }),
  raster_illustration: descriptor({
    modality: "raster_illustration",
    rendererId: "raster-illustration-svg",
    skillId: "raster-illustration",
    validator: validateRasterIllustration
  }),
  reaction_process: descriptor({
    kernelId: "reaction-process-v1",
    modality: "reaction_process",
    rendererId: "reaction-process-svg",
    skillId: "reaction-process",
    validator: validateReactionProcess
  })
});
