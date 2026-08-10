import { describe, expect, test } from "vitest";
import { layoutStableGraph } from "../app/features/visualization/rendering/stableLayout";

describe("layoutStableGraph", () => {
  test("returns byte-identical output for equal input", () => {
    const graph = {
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [{ id: "e", from: "a", to: "b" }]
    };

    expect(layoutStableGraph(graph, "fixture-seed")).toEqual(layoutStableGraph(graph, "fixture-seed"));
  });

  test("keeps layout deterministic when input order changes", () => {
    const first = layoutStableGraph({
      nodes: [{ id: "b" }, { id: "a" }, { id: "c" }],
      edges: [
        { id: "e2", from: "b", to: "c" },
        { id: "e1", from: "a", to: "b" }
      ]
    }, "fixture-seed");
    const second = layoutStableGraph({
      nodes: [{ id: "c" }, { id: "a" }, { id: "b" }],
      edges: [
        { id: "e1", from: "a", to: "b" },
        { id: "e2", from: "b", to: "c" }
      ]
    }, "fixture-seed");

    expect(second.nodes).toEqual(first.nodes);
    expect(second.edges).toEqual(first.edges);
    expect(second.diagnostics).toEqual([]);
  });
});
