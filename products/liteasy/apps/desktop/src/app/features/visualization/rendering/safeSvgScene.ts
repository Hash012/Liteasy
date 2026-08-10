import type { SceneEdgeV1, SceneNodeV1, SvgSceneV1 } from "./scene.types";

const minSceneWidth = 160;
const maxSceneWidth = 1600;
const minSceneHeight = 120;
const maxSceneHeight = 1200;
const idPattern = /^[A-Za-z][A-Za-z0-9_-]{0,119}$/;

type SafeSvgSceneInput = Omit<SvgSceneV1, "svg">;

function assertFiniteNumber(value: number, code: string): void {
  if (!Number.isFinite(value)) throw new Error(code);
}

function assertStableId(value: string): void {
  if (!idPattern.test(value)) throw new Error("scene_id_invalid");
}

function escapeText(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function numericAttribute(value: number): string {
  assertFiniteNumber(value, "scene_geometry_invalid");
  return Number(value.toFixed(3)).toString();
}

function centerOf(node: SceneNodeV1): { x: number; y: number } {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2
  };
}

function validateScene(input: SafeSvgSceneInput): void {
  assertFiniteNumber(input.width, "scene_size_invalid");
  assertFiniteNumber(input.height, "scene_size_invalid");
  if (input.width < minSceneWidth || input.width > maxSceneWidth || input.height < minSceneHeight || input.height > maxSceneHeight) {
    throw new Error("scene_size_invalid");
  }

  const nodeIds = new Set<string>();
  for (const node of input.nodes) {
    assertStableId(node.id);
    if (nodeIds.has(node.id)) throw new Error("scene_reference_invalid");
    nodeIds.add(node.id);
    if (node.label.length > 500 || node.role?.length && node.role.length > 80) throw new Error("scene_text_invalid");
    for (const value of [node.x, node.y, node.width, node.height]) assertFiniteNumber(value, "scene_geometry_invalid");
    if (node.width <= 0 || node.height <= 0 || node.x < 0 || node.y < 0 || node.x + node.width > input.width || node.y + node.height > input.height) {
      throw new Error("scene_geometry_invalid");
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of input.edges) {
    assertStableId(edge.id);
    if (edgeIds.has(edge.id)) throw new Error("scene_reference_invalid");
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error("scene_reference_invalid");
    if (edge.label && edge.label.length > 500) throw new Error("scene_text_invalid");
  }
}

function renderEdge(edge: SceneEdgeV1, nodesById: ReadonlyMap<string, SceneNodeV1>): string {
  const from = centerOf(nodesById.get(edge.from)!);
  const to = centerOf(nodesById.get(edge.to)!);
  const label = edge.label
    ? `<text x="${numericAttribute((from.x + to.x) / 2)}" y="${numericAttribute((from.y + to.y) / 2 - 8)}" text-anchor="middle" fill="#334155">${escapeText(edge.label)}</text>`
    : "";
  return `<g id="edge-${escapeText(edge.id)}" data-factual="${edge.factual === false ? "false" : "true"}"><path d="M ${numericAttribute(from.x)} ${numericAttribute(from.y)} L ${numericAttribute(to.x)} ${numericAttribute(to.y)}" fill="none" stroke="#475569" stroke-width="1.5"/>${label}</g>`;
}

function renderNode(node: SceneNodeV1): string {
  const role = node.role ? ` data-role="${escapeText(node.role)}"` : "";
  const labelX = node.x + node.width / 2;
  const labelY = node.y + node.height / 2 + 4;
  return `<g id="object-${escapeText(node.id)}"${role} tabindex="0"><rect x="${numericAttribute(node.x)}" y="${numericAttribute(node.y)}" width="${numericAttribute(node.width)}" height="${numericAttribute(node.height)}" rx="6" fill="#F8FAFC" stroke="#64748B" stroke-width="1"/><text x="${numericAttribute(labelX)}" y="${numericAttribute(labelY)}" text-anchor="middle" fill="#0F172A">${escapeText(node.label)}</text></g>`;
}

export function createSafeSvgScene(input: SafeSvgSceneInput): SvgSceneV1 {
  validateScene(input);
  const nodes = [...input.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const edges = [...input.edges].sort((a, b) => a.id.localeCompare(b.id));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const summary = nodes.map((node) => node.label).join(", ").slice(0, 400);
  const svg = [
    `<svg viewBox="0 0 ${numericAttribute(input.width)} ${numericAttribute(input.height)}" width="${numericAttribute(input.width)}" height="${numericAttribute(input.height)}" role="img" aria-labelledby="scene-title scene-desc" xmlns="http://www.w3.org/2000/svg">`,
    `<title id="scene-title">Liteasy visualization scene</title>`,
    `<desc id="scene-desc">${escapeText(summary || "Visualization scene")}</desc>`,
    `<rect x="0" y="0" width="${numericAttribute(input.width)}" height="${numericAttribute(input.height)}" fill="#FFFFFF"/>`,
    ...edges.map((edge) => renderEdge(edge, nodesById)),
    ...nodes.map(renderNode),
    `</svg>`
  ].join("");

  return { ...input, nodes, edges, svg };
}
