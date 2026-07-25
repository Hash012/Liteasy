import type { IntuitionGraphDocument, IntuitionGraphNode, SemanticLevel } from "../intuition-graph/intuitionGraph.types";
import type { GraphViewState } from "./layeredReading.types";

function levelOf(node: IntuitionGraphNode): SemanticLevel { return node.status === "complete" ? node.baseLevel : node.suggestedLevel ?? 4; }

export function projectIntuitionGraph(graph: IntuitionGraphDocument, view: GraphViewState) {
  const focus = view.focusNodeId ?? graph.rootNodeId;
  const allowedLevel = view.semanticLevel === "auto" ? 4 : view.semanticLevel;
  const visible = new Map(graph.nodes.filter((node) => levelOf(node) <= allowedLevel && (node.status === "stub" || !view.hiddenKinds.includes(node.kind))).map((node) => [node.id, node]));
  const neighbors = new Map<string, string[]>();
  graph.edges.forEach((edge) => {
    neighbors.set(edge.sourceNodeId, [...(neighbors.get(edge.sourceNodeId) ?? []), edge.targetNodeId]);
    neighbors.set(edge.targetNodeId, [...(neighbors.get(edge.targetNodeId) ?? []), edge.sourceNodeId]);
  });
  const distances = new Map([[focus, 0]]);
  const queue = [focus];
  while (queue.length) {
    const current = queue.shift()!;
    const distance = distances.get(current)!;
    if (distance >= view.graphRadius) continue;
    (neighbors.get(current) ?? []).forEach((next) => {
      if (!distances.has(next)) { distances.set(next, distance + 1); queue.push(next); }
    });
  }
  const nodeIds = new Set([...distances.keys()].filter((id) => visible.has(id)));
  return {
    focusNodeId: focus,
    nodes: [...visible.values()].filter((node) => nodeIds.has(node.id)),
    edges: graph.edges.filter((edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId))
  };
}
