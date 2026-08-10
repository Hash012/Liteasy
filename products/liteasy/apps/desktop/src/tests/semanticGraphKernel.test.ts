import { describe, expect, test } from "vitest";
import type { SemanticGraphSpecV1 } from "../app/features/visualization/visualizationArtifact.types";
import { validateSemanticGraph } from "../app/features/visualization/kernels/semanticGraphKernel";

const validFlowchartFixture = {
  subtype: "flowchart",
  nodes: [
    { id: "start", label: "输入", kind: "step", objectPath: ["start"], evidenceClaimIds: ["claim-1"] },
    { id: "end", label: "输出", kind: "step", objectPath: ["end"], evidenceClaimIds: ["claim-1"] }
  ],
  edges: [{ id: "edge-1", from: "start", to: "end", kind: "precedes", evidenceClaimIds: ["claim-1"] }],
  groups: [],
  hierarchy: [],
  timeOrder: [],
  claims: [{ id: "claim-1", text: "输入先于输出", evidenceIds: ["evidence-1"] }]
} as const satisfies SemanticGraphSpecV1;

describe("validateSemanticGraph", () => {
  test("rejects a cycle in a flowchart", () => {
    expect(() => validateSemanticGraph({
      ...validFlowchartFixture,
      edges: [
        { id: "e1", from: "start", to: "end", kind: "precedes", evidenceClaimIds: ["claim-1"] },
        { id: "e2", from: "end", to: "start", kind: "precedes", evidenceClaimIds: ["claim-1"] }
      ]
    })).toThrow("semantic_graph_cycle");
  });

  test("requires factual graph objects to bind to evidence claims", () => {
    expect(() => validateSemanticGraph({
      ...validFlowchartFixture,
      nodes: [{ id: "start", label: "输入", kind: "step", objectPath: ["start"], evidenceClaimIds: [] }]
    })).toThrow("semantic_graph_evidence_missing");
  });
});

