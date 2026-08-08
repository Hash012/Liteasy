import type { IntuitionGraphDocument, IntuitionGraphPatch } from "./intuitionGraph.types";
import { validateIntuitionGraphPatch } from "./intuitionGraphValidator";

export type ApplyGraphPatchResult =
  | { ok: true; graph: IntuitionGraphDocument }
  | { ok: false; errors: string[] };

export function applyIntuitionGraphPatch(
  graph: IntuitionGraphDocument,
  patch: IntuitionGraphPatch
): ApplyGraphPatchResult {
  const result = validateIntuitionGraphPatch(patch, graph);
  if (!result.valid) return { ok: false, errors: result.errors };
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  patch.upsertNodes.forEach((node) => nodes.set(node.id, node));
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  patch.upsertEdges.forEach((edge) => edges.set(edge.id, edge));
  return {
    ok: true,
    graph: {
      ...graph,
      revision: graph.revision + 1,
      nodes: [...nodes.values()],
      edges: [...edges.values()]
    }
  };
}
