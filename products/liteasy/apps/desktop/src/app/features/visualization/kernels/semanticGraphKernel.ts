import type {
  AccessibilityProjectionV1,
  InteractionContractV1,
  SemanticGraphSpecV1,
  SemanticObjectV1
} from "../visualizationArtifact.types";
import type { StableLayoutResultV1 } from "../rendering/scene.types";
import { layoutStableGraph } from "../rendering/stableLayout";

type SemanticGraphValidationResult = {
  accessibility: AccessibilityProjectionV1;
  interaction: InteractionContractV1;
  layout: StableLayoutResultV1;
  semanticObjects: readonly SemanticObjectV1[];
};

const maxNodes = 512;
const maxEdges = 1024;

function assertUnique(ids: readonly string[], code: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(code);
}

function claimIds(spec: SemanticGraphSpecV1): Set<string> {
  return new Set(spec.claims.map((claim) => claim.id));
}

function requireEvidence(ids: readonly string[] | undefined, knownClaims: ReadonlySet<string>): void {
  if (!ids || ids.length === 0 || ids.some((id) => !knownClaims.has(id))) {
    throw new Error("semantic_graph_evidence_missing");
  }
}

function orderedDagNodes(nodeIds: readonly string[], edges: ReadonlyArray<{ from: string; to: string }>): string[] {
  const incoming = new Map(nodeIds.map((id) => [id, 0]));
  const outgoing = new Map(nodeIds.map((id) => [id, [] as string[]]));
  for (const edge of edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)!.push(edge.to);
  }

  const ready = [...nodeIds].filter((id) => incoming.get(id) === 0).sort();
  const ordered: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    ordered.push(id);
    for (const target of outgoing.get(id)!.sort()) {
      incoming.set(target, (incoming.get(target) ?? 0) - 1);
      if (incoming.get(target) === 0) ready.push(target);
    }
    ready.sort();
  }
  if (ordered.length !== nodeIds.length) throw new Error("semantic_graph_cycle");
  return ordered;
}

function validateSubtypeRules(spec: SemanticGraphSpecV1, nodeIds: readonly string[]): string[] {
  const factualEdges = spec.edges.filter((edge) => edge.kind !== "layout");
  if (spec.subtype === "flowchart" || spec.subtype === "causal_graph") {
    return orderedDagNodes(nodeIds, factualEdges);
  }
  if (spec.subtype === "timeline") {
    const ordered = [...spec.timeOrder];
    if (ordered.length !== nodeIds.length || new Set(ordered).size !== ordered.length || nodeIds.some((id) => !ordered.includes(id))) {
      throw new Error("semantic_graph_time_order_invalid");
    }
    orderedDagNodes(nodeIds, factualEdges);
    return ordered;
  }
  const childIds = spec.hierarchy.map((item) => item.childId);
  assertUnique(childIds, "semantic_graph_hierarchy_invalid");
  if (spec.hierarchy.length !== Math.max(0, nodeIds.length - 1)) throw new Error("semantic_graph_hierarchy_invalid");
  orderedDagNodes(nodeIds, spec.hierarchy.map((item) => ({ from: item.parentId, to: item.childId })));
  const roots = nodeIds.filter((id) => !childIds.includes(id));
  if (roots.length !== 1) throw new Error("semantic_graph_hierarchy_invalid");
  return orderedDagNodes(nodeIds, spec.hierarchy.map((item) => ({ from: item.parentId, to: item.childId })));
}

export function validateSemanticGraph(spec: SemanticGraphSpecV1, seed = "semantic-graph/v1"): SemanticGraphValidationResult {
  if (spec.nodes.length === 0 || spec.nodes.length > maxNodes || spec.edges.length > maxEdges) {
    throw new Error("semantic_graph_bounds_invalid");
  }

  const knownClaims = claimIds(spec);
  if (spec.claims.some((claim) => claim.evidenceIds.length === 0)) throw new Error("semantic_graph_evidence_missing");

  const nodeIds = spec.nodes.map((node) => node.id);
  const edgeIds = spec.edges.map((edge) => edge.id);
  assertUnique(nodeIds, "semantic_graph_id_duplicate");
  assertUnique(edgeIds, "semantic_graph_id_duplicate");

  const nodeIdSet = new Set(nodeIds);
  for (const node of spec.nodes) requireEvidence(node.evidenceClaimIds, knownClaims);
  for (const edge of spec.edges) {
    if (!nodeIdSet.has(edge.from) || !nodeIdSet.has(edge.to)) throw new Error("semantic_graph_reference_invalid");
    if (edge.kind !== "layout") requireEvidence(edge.evidenceClaimIds, knownClaims);
  }
  for (const group of spec.groups) {
    if (group.memberIds.some((id) => !nodeIdSet.has(id))) throw new Error("semantic_graph_reference_invalid");
  }
  for (const relation of spec.hierarchy) {
    if (!nodeIdSet.has(relation.parentId) || !nodeIdSet.has(relation.childId)) throw new Error("semantic_graph_reference_invalid");
  }

  const readingOrder = validateSubtypeRules(spec, nodeIds);
  const nodesById = new Map(spec.nodes.map((node) => [node.id, node]));
  const semanticObjects = readingOrder.map((id) => {
    const node = nodesById.get(id)!;
    return {
      evidenceClaimIds: [...node.evidenceClaimIds!],
      kind: node.kind,
      label: node.label,
      objectId: node.id,
      objectPath: [...node.objectPath],
      selectable: true
    } satisfies SemanticObjectV1;
  });
  const layout = layoutStableGraph({
    nodes: spec.nodes.map((node) => ({ id: node.id, label: node.label })),
    edges: spec.edges.map((edge) => ({
      factual: edge.kind !== "layout",
      from: edge.from,
      id: edge.id,
      label: edge.label,
      to: edge.to
    }))
  }, seed);

  if (layout.diagnostics.some((diagnostic) => diagnostic.code === "layout_reference_invalid")) {
    throw new Error("semantic_graph_reference_invalid");
  }
  if (layout.diagnostics.some((diagnostic) => diagnostic.code === "layout_cycle_detected") && spec.subtype !== "mindmap") {
    throw new Error("semantic_graph_cycle");
  }

  return {
    accessibility: {
      summary: spec.claims.map((claim) => claim.text).join("；"),
      objectReadingOrder: readingOrder
    },
    interaction: {
      pan: true,
      zoom: true,
      rotate: false,
      playback: spec.subtype === "timeline" ? "timeline" : "none",
      parameterIds: [],
      selectableObjectIds: readingOrder
    },
    layout,
    semanticObjects
  };
}
