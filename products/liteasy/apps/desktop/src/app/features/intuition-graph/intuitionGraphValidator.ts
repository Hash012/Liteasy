import type {
  GraphValidationResult,
  IntuitionGraphDocument,
  IntuitionGraphEdge,
  IntuitionGraphNode,
  IntuitionGraphPatch,
  IntuitionGraphCompleteNode
} from "./intuitionGraph.types";
import { IntuitionGraphDocumentSchema, IntuitionGraphPatchSchema } from "./intuitionGraph.schema";

const nodeKinds = new Set([
  "thesis", "historical_coordinate", "intuition", "concept", "mechanism", "derivation", "experiment", "limitation", "evidence", "gap"
]);
const edgeKinds = new Set([
  "expands", "explains", "supports", "contradicts", "requires", "compares", "derived_from", "intuits", "cites"
]);
const idPattern = /^[A-Za-z][A-Za-z0-9_-]*$/;

function hasUniqueIds(values: { id: string }[], label: string, errors: string[]) {
  const ids = new Set<string>();
  values.forEach(({ id }) => {
    if (!idPattern.test(id)) errors.push(`${label} id '${id}' is invalid.`);
    if (ids.has(id)) errors.push(`Duplicate ${label} id '${id}'.`);
    ids.add(id);
  });
}

function isComplete(node: IntuitionGraphNode): node is IntuitionGraphCompleteNode {
  return node.status === "complete";
}

function validateNode(node: IntuitionGraphNode, errors: string[]) {
  if (!node.label.trim()) errors.push(`Node '${node.id}' must have a label.`);
  if (!Array.isArray(node.tags)) errors.push(`Node '${node.id}' tags must be an array.`);
  if (node.status === "stub") {
    return;
  }
  if (!nodeKinds.has(node.kind)) errors.push(`Node '${node.id}' has an unknown kind.`);
  if (!Number.isInteger(node.baseLevel) || node.baseLevel < 0 || node.baseLevel > 4) {
    errors.push(`Node '${node.id}' has an invalid semantic level.`);
  }
  if (!node.summary.trim()) errors.push(`Complete node '${node.id}' must have a summary.`);
  if (node.confidence !== undefined && (node.confidence < 0 || node.confidence > 1)) {
    errors.push(`Node '${node.id}' confidence must be between 0 and 1.`);
  }
  if (node.kind === "intuition") {
    if (node.source.type !== "community" && node.source.type !== "user") {
      errors.push(`Intuition node '${node.id}' must have a community or user source.`);
    }
  } else if (node.kind !== "gap" && node.evidenceIds.length === 0) {
    errors.push(`Fact node '${node.id}' requires evidence.`);
  }
}

function validateEdges(nodes: IntuitionGraphNode[], edges: IntuitionGraphEdge[], errors: string[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  hasUniqueIds(edges, "edge", errors);
  edges.forEach((edge) => {
    const source = byId.get(edge.sourceNodeId);
    const target = byId.get(edge.targetNodeId);
    if (!edgeKinds.has(edge.kind)) errors.push(`Edge '${edge.id}' has an unknown kind.`);
    if (!source || !target) errors.push(`Edge '${edge.id}' references a missing node.`);
    if (edge.kind === "expands" && source && target && isComplete(source) && isComplete(target) && target.baseLevel <= source.baseLevel) {
      errors.push(`Expands edge '${edge.id}' must point to a deeper semantic level.`);
    }
  });

  const graph = new Map<string, string[]>();
  edges.filter((edge) => edge.kind === "expands").forEach((edge) => {
    graph.set(edge.sourceNodeId, [...(graph.get(edge.sourceNodeId) ?? []), edge.targetNodeId]);
  });
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) {
      errors.push("Expands edges must not form a cycle.");
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    (graph.get(id) ?? []).forEach(visit);
    visiting.delete(id);
    visited.add(id);
  }
  nodes.forEach((node) => visit(node.id));
}

export function validateIntuitionGraph(document: IntuitionGraphDocument): GraphValidationResult {
  const errors: string[] = [];
  const schema = IntuitionGraphDocumentSchema.safeParse(document);
  if (!schema.success) {
    return { valid: false, errors: schema.error.issues.map((issue) => `${issue.path.join(".") || "graph"}: ${issue.message}`) };
  }
  if (document.version !== "liteasy-intuition-graph/v1") errors.push("Unsupported graph version.");
  if (!document.workId.trim()) errors.push("Graph must have a workId.");
  if (!Number.isInteger(document.revision) || document.revision < 1) errors.push("Graph revision must be a positive integer.");
  hasUniqueIds(document.nodes, "node", errors);
  if (!document.nodes.some((node) => node.id === document.rootNodeId)) errors.push("Graph root node is missing.");
  document.nodes.forEach((node) => validateNode(node, errors));
  validateEdges(document.nodes, document.edges, errors);
  return errors.length === 0 ? { valid: true, errors: [] } : { valid: false, errors };
}

export function validateIntuitionGraphPatch(
  patch: IntuitionGraphPatch,
  graph: IntuitionGraphDocument,
  nodeBudget = 12
): GraphValidationResult {
  const errors: string[] = [];
  const schema = IntuitionGraphPatchSchema.safeParse(patch);
  if (!schema.success) {
    return { valid: false, errors: schema.error.issues.map((issue) => `${issue.path.join(".") || "patch"}: ${issue.message}`) };
  }
  if (patch.version !== "liteasy-intuition-graph-patch/v1") errors.push("Unsupported graph patch version.");
  if (patch.graphId !== graph.id) errors.push("Patch graph id does not match the current graph.");
  if (patch.baseRevision !== graph.revision) errors.push("Patch base revision conflicts with the current graph.");
  if (!graph.nodes.some((node) => node.id === patch.focusNodeId)) errors.push("Patch focus node is missing.");
  if (patch.upsertNodes.length > nodeBudget) errors.push(`Patch exceeds the ${nodeBudget}-node budget.`);
  if (patch.removeNodeIds.length > 0 || patch.removeEdgeIds.length > 0) errors.push("Model patches may not remove graph content.");
  if (!Number.isInteger(patch.targetLevel) || patch.targetLevel < 0 || patch.targetLevel > 4) errors.push("Patch target level is invalid.");

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  patch.upsertNodes.forEach((node) => nodeById.set(node.id, node));
  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  patch.upsertEdges.forEach((edge) => edgeById.set(edge.id, edge));
  const projected: IntuitionGraphDocument = {
    ...graph,
    nodes: [...nodeById.values()],
    edges: [...edgeById.values()]
  };
  const graphValidation = validateIntuitionGraph(projected);
  errors.push(...graphValidation.errors);
  return errors.length === 0 ? { valid: true, errors: [] } : { valid: false, errors: [...new Set(errors)] };
}
