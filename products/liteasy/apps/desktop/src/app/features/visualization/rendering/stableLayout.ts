import type {
  SceneEdgeV1,
  SceneNodeV1,
  StableLayoutDiagnosticV1,
  StableLayoutInput,
  StableLayoutResultV1
} from "./scene.types";

const defaultWidth = 960;
const defaultHeight = 540;
const nodeWidth = 144;
const nodeHeight = 56;
const marginX = 48;
const marginY = 48;

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableSort<T extends { id: string }>(values: readonly T[], seed: string): T[] {
  return [...values].sort((left, right) => {
    const byHash = stableHash(`${seed}:${left.id}`) - stableHash(`${seed}:${right.id}`);
    return byHash || left.id.localeCompare(right.id);
  });
}

function uniqueIds(values: readonly { id: string }[]): Set<string> {
  const ids = new Set<string>();
  for (const value of values) ids.add(value.id);
  return ids;
}

function buildLayers(input: StableLayoutInput, seed: string): { layers: string[][]; diagnostics: StableLayoutDiagnosticV1[] } {
  const nodeIds = uniqueIds(input.nodes);
  const diagnostics: StableLayoutDiagnosticV1[] = [];
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const node of input.nodes) {
    incoming.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  for (const edge of input.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      diagnostics.push({ code: "layout_reference_invalid", objectIds: [edge.id, edge.from, edge.to] });
      continue;
    }
    outgoing.get(edge.from)!.push(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }

  const ready = stableSort(input.nodes.filter((node) => incoming.get(node.id) === 0), seed).map((node) => node.id);
  const layerByNode = new Map<string, number>();
  const processed = new Set<string>();

  while (ready.length > 0) {
    const id = ready.shift()!;
    processed.add(id);
    const currentLayer = layerByNode.get(id) ?? 0;
    for (const target of stableSort(outgoing.get(id)!.map((targetId) => ({ id: targetId })), seed)) {
      incoming.set(target.id, (incoming.get(target.id) ?? 0) - 1);
      layerByNode.set(target.id, Math.max(layerByNode.get(target.id) ?? 0, currentLayer + 1));
      if (incoming.get(target.id) === 0) ready.push(target.id);
    }
    ready.sort((left, right) => {
      const byLayer = (layerByNode.get(left) ?? 0) - (layerByNode.get(right) ?? 0);
      return byLayer || stableHash(`${seed}:${left}`) - stableHash(`${seed}:${right}`) || left.localeCompare(right);
    });
  }

  if (processed.size !== input.nodes.length) {
    const cyclicIds = input.nodes.filter((node) => !processed.has(node.id)).map((node) => node.id).sort();
    diagnostics.push({ code: "layout_cycle_detected", objectIds: cyclicIds });
    for (const id of cyclicIds) layerByNode.set(id, layerByNode.get(id) ?? 0);
  }

  const maxLayer = Math.max(0, ...[...layerByNode.values()]);
  const layers = Array.from({ length: maxLayer + 1 }, () => [] as string[]);
  for (const node of stableSort(input.nodes, seed)) {
    layers[layerByNode.get(node.id) ?? 0]!.push(node.id);
  }
  return { layers, diagnostics };
}

export function layoutStableGraph(input: StableLayoutInput, seed = "liteasy-static-science-v1"): StableLayoutResultV1 {
  const width = input.width ?? defaultWidth;
  const height = input.height ?? defaultHeight;
  const { layers, diagnostics } = buildLayers(input, seed);
  const nodesById = new Map(input.nodes.map((node) => [node.id, node]));
  const maxRows = Math.max(1, ...layers.map((layer) => layer.length));
  const columnSpacing = layers.length > 1 ? (width - marginX * 2 - nodeWidth) / (layers.length - 1) : 0;
  const rowSpacing = maxRows > 1 ? (height - marginY * 2 - nodeHeight) / (maxRows - 1) : 0;

  const nodes: SceneNodeV1[] = layers.flatMap((layer, layerIndex) => layer.map((id, rowIndex) => {
    const source = nodesById.get(id)!;
    return {
      id,
      label: source.label ?? id,
      x: Math.max(marginX, marginX + columnSpacing * layerIndex),
      y: Math.max(marginY, marginY + rowSpacing * rowIndex),
      width: source.width ?? nodeWidth,
      height: source.height ?? nodeHeight
    };
  })).sort((left, right) => left.id.localeCompare(right.id));

  const edges: SceneEdgeV1[] = [...input.edges]
    .filter((edge) => nodesById.has(edge.from) && nodesById.has(edge.to))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      label: edge.label,
      factual: edge.factual ?? true
    }));

  return { width, height, nodes, edges, diagnostics };
}
