import type { Edge, Node } from "@xyflow/react";
import { describe, expect, test } from "vitest";
import {
  advanceMermaidForceLayout,
  projectMermaidFlowchart
} from "../app/features/mermaid/MermaidPreview";

const nodes: Node[] = [
  { data: { label: "输入" }, id: "input", position: { x: 0, y: 0 }, type: "mermaid" },
  { data: { label: "输出" }, id: "output", position: { x: 640, y: 0 }, type: "mermaid" }
];

const edges: Edge[] = [{ id: "input-output", source: "input", target: "output" }];

describe("Mermaid force-directed projection", () => {
  test("keeps every parsed Mermaid relationship as an edge for the adaptive view", () => {
    const projection = projectMermaidFlowchart(`
      flowchart LR
      source[原始输入] --> encoder[编码器]
      encoder --> result[最终结果]
    `);

    expect(projection.nodes.map((node) => node.id)).toEqual(["source", "encoder", "result"]);
    expect(projection.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["source", "encoder"],
      ["encoder", "result"]
    ]);
  });

  test("pulls linked nodes together while retaining the graph structure", () => {
    const next = advanceMermaidForceLayout(nodes, edges, new Map());

    expect(next).toHaveLength(2);
    expect(next[0].id).toBe("input");
    expect(next[1].id).toBe("output");
    expect(next[0].position.x).toBeGreaterThan(nodes[0].position.x);
    expect(next[1].position.x).toBeLessThan(nodes[1].position.x);
  });

  test("keeps the actively dragged node at the user position while the rest adapts", () => {
    const next = advanceMermaidForceLayout(nodes, edges, new Map(), "input");

    expect(next[0].position).toEqual(nodes[0].position);
    expect(next[1].position.x).toBeLessThan(nodes[1].position.x);
  });
});
