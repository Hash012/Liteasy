import { describe, expect, test } from "vitest";
import type { VisualizationValidator } from "../app/features/visualization/visualizationValidator";
import { runVisualizationValidators } from "../app/features/visualization/visualizationValidator";
import { evidenceBindingValidator } from "../app/features/visualization/validators/baseValidators";
import type { VisualizationValidationContext } from "../app/features/visualization/visualizationValidator";

const context: VisualizationValidationContext = {
  artifactVersion: "liteasy.visualization/v1",
  modality: "semantic_graph",
  spec: {
    modality: "semantic_graph",
    payload: {
      subtype: "flowchart",
      nodes: [{ id: "node-a", kind: "process", label: "A", objectPath: ["node-a"], evidenceClaimIds: ["claim-a"] }],
      edges: [],
      groups: [],
      hierarchy: [],
      timeOrder: [],
      claims: [{ id: "claim-a", text: "Claim A", evidenceIds: ["evidence-a"] }]
    }
  },
  evidenceBindings: [{ claimId: "claim-a", evidenceIds: ["evidence-a"], confidence: "direct" }],
  semanticObjects: [{ objectId: "node-a", kind: "process", label: "A", objectPath: ["node-a"], evidenceClaimIds: ["claim-a"], selectable: true }],
  interaction: { pan: true, zoom: true, rotate: false, playback: "none", parameterIds: [], selectableObjectIds: ["node-a"] },
  accessibility: { summary: "A", objectReadingOrder: ["node-a"] },
  repairCount: 0
};

const contextWithUnknownClaim: VisualizationValidationContext = {
  ...context,
  semanticObjects: [{ ...context.semanticObjects[0], evidenceClaimIds: ["claim-missing"] }]
};

const hardFailure: VisualizationValidator = {
  id: "hard-failure",
  version: "1.0.0",
  gate: "hard",
  validate: async () => ({ gate: "hard", validatorId: "hard-failure", validatorVersion: "1.0.0", outcome: "fail", diagnosticCode: "hard_failure" })
};

const advisoryFailure: VisualizationValidator = {
  id: "advisory-failure",
  version: "1.0.0",
  gate: "advisory",
  validate: async () => ({ gate: "advisory", validatorId: "advisory-failure", validatorVersion: "1.0.0", outcome: "warning", diagnosticCode: "advisory_failure" })
};

describe("visualization validator registry", () => {
  test("cannot publish when any hard validator fails", async () => {
    const report = await runVisualizationValidators(context, [hardFailure, advisoryFailure]);
    expect(report.outcome).toBe("fail");
    expect(report.checks.map((check) => check.gate)).toEqual(["hard", "advisory"]);
  });

  test("requires every scientific semantic object to reference a known claim", async () => {
    expect((await evidenceBindingValidator.validate(contextWithUnknownClaim)).outcome).toBe("fail");
  });
});

export { context, contextWithUnknownClaim };
