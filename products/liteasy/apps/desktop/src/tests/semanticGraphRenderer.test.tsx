import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { EvidenceBindingV1, SemanticGraphSpecV1 } from "../app/features/visualization/visualizationArtifact.types";
import { SemanticGraphRenderer, renderSemanticGraph } from "../app/features/visualization/renderers/semanticGraphRenderer";

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

const evidenceBindings: EvidenceBindingV1[] = [{
  claimId: "claim-1",
  confidence: "direct",
  evidenceIds: ["evidence-1"]
}];

describe("renderSemanticGraph", () => {
  test("a partial projection uses the same names in SVG, buttons and reading order without losing objects", () => {
    const rendered = renderSemanticGraph(validFlowchartFixture, { evidenceBindings, semanticObjects: [{
      objectId: "start", label: "输入资料", kind: "step", objectPath: ["start"], evidenceClaimIds: ["claim-1"], selectable: true
    }] });
    render(<SemanticGraphRenderer rendered={rendered} />);
    expect(screen.getByRole("img", { name: /输入资料, 输出/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "输入资料" })).toHaveAttribute("data-object-id", "start");
    expect(screen.getByRole("button", { name: "输出" })).toHaveAttribute("data-object-id", "end");
    expect(within(screen.getByRole("list", { name: "语义图阅读顺序" })).getAllByRole("listitem").map(item => item.textContent)).toEqual(["输入资料", "输出"]);
  });
  test("renders selectable objects with accessible reading order", () => {
    const artifact = renderSemanticGraph(validFlowchartFixture, { evidenceBindings, semanticObjects: [] });

    expect(artifact.svg).toContain('role="img"');
    expect(artifact.selectableObjectIds).toEqual(["start", "end"]);
    expect(artifact.accessibility.objectReadingOrder).toEqual(["start", "end"]);
    expect(artifact.svg).not.toContain("<script>");
  });

  test("projects the trusted SVG and accessible object buttons", () => {
    const rendered = renderSemanticGraph(validFlowchartFixture, { evidenceBindings, semanticObjects: [] });
    render(<SemanticGraphRenderer rendered={rendered} />);

    expect(screen.getByRole("img", { name: /输入, 输出/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "输入" })).toHaveAttribute("data-object-id", "start");
    expect(screen.getByText("输入先于输出")).toBeInTheDocument();
  });
});
