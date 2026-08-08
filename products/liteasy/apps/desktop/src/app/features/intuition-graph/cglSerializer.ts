import type { GraphNodeSource, IntuitionGraphDocument, IntuitionGraphEdge, IntuitionGraphNode } from "./intuitionGraph.types";

function quote(value: string) { return JSON.stringify(value); }
function sourceToCgl(source: GraphNodeSource) {
  if (source.type === "paper") return `paper(run=${quote(source.analysisRunId)})`;
  if (source.type === "community") return `community(note=${quote(source.intuitionNoteId)}, author=${quote(source.authorId)})`;
  if (source.type === "user") return `user(note=${quote(source.localNoteId)})`;
  return `system(rule=${quote(source.ruleId)})`;
}
function edgeToCgl(edge: IntuitionGraphEdge) {
  const args = [
    `id=${quote(edge.id)}`, `target=${edge.targetNodeId}`, `kind=${edge.kind}`,
    ...(edge.label ? [`description=${quote(edge.label)}`] : []),
    ...(edge.hover ? [`hover=${quote(edge.hover)}`] : []),
    `evidence=[${edge.evidenceIds.map(quote).join(", ")}]`
  ];
  return `  to(${args.join(", ")})`;
}
function nodeToCgl(node: IntuitionGraphNode, edges: IntuitionGraphEdge[]) {
  if (node.status === "stub") return "";
  const lines = [
    `${node.id} {`, `  level=${node.baseLevel}`, `  kind=${node.kind}`, `  label:${quote(node.label)}`,
    `  description:${quote(node.summary)}`, ...(node.hover ? [`  hover:${quote(node.hover.text)}`] : []),
    `  evidence=[${node.evidenceIds.map(quote).join(", ")}]`, `  source=${sourceToCgl(node.source)}`,
    ...(node.confidence === undefined ? [] : [`  confidence=${node.confidence}`]), `  expandable=${node.expandable}`,
    `  tags=[${node.tags.map(quote).join(", ")}]`, ...edges.map(edgeToCgl), "}"
  ];
  return lines.join("\n");
}

export function serializeCglDocument(document: IntuitionGraphDocument): string {
  const edgeBySource = new Map<string, IntuitionGraphEdge[]>();
  document.edges.forEach((edge) => edgeBySource.set(edge.sourceNodeId, [...(edgeBySource.get(edge.sourceNodeId) ?? []), edge]));
  const nodeDeclarations = document.nodes.map((node) => `Node ${node.id}`).join("\n");
  const blocks = document.nodes.map((node) => nodeToCgl(node, edgeBySource.get(node.id) ?? [])).filter(Boolean).join("\n\n");
  return [
    `Graph ${document.id}`, `version=${quote("liteasy-customized-graph/v1")}`, `work=${quote(document.workId)}`,
    `root=${document.rootNodeId}`, "", nodeDeclarations, blocks ? `\n${blocks}` : ""
  ].join("\n").trimEnd() + "\n";
}
