import { resolveLocalAccountKey } from "../../library/localAccountKey";
import { createEmptyPdfWhiteboard } from "./pdfWhiteboardModel";
import type {
  PdfWhiteboardDocument,
  PdfWhiteboardEdge,
  PdfWhiteboardNode,
  PdfWhiteboardNodeSource
} from "./pdfWhiteboard.types";

const storagePrefix = "liteasy:pdf-whiteboard:v1";

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSource(value: unknown): value is PdfWhiteboardNodeSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Partial<PdfWhiteboardNodeSource>;
  if (source.type === "pdf") {
    return typeof source.paperId === "string" &&
      (source.page === undefined || isFiniteNumber(source.page)) &&
      (source.excerpt === undefined || typeof source.excerpt === "string") &&
      (source.sourcePath === undefined || typeof source.sourcePath === "string");
  }
  return source.type === "external" &&
    (source.label === undefined || typeof source.label === "string") &&
    (source.uri === undefined || typeof source.uri === "string");
}

function hasNodeBase(value: unknown): value is PdfWhiteboardNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const node = value as Partial<PdfWhiteboardNode>;
  return typeof node.id === "string" && node.id.length > 0 &&
    typeof node.createdAt === "string" && typeof node.updatedAt === "string" &&
    Boolean(node.position) && isFiniteNumber(node.position?.x) && isFiniteNumber(node.position?.y) &&
    Boolean(node.size) && isFiniteNumber(node.size?.height) && isFiniteNumber(node.size?.width) &&
    node.size!.height >= 60 && node.size!.width >= 120 &&
    (node.source === undefined || isSource(node.source));
}

function isNode(value: unknown): value is PdfWhiteboardNode {
  if (!hasNodeBase(value)) return false;
  const node = value as PdfWhiteboardNode;
  if (!node.content || typeof node.content !== "object" || Array.isArray(node.content)) return false;
  if (node.kind === "markdown") return typeof node.content.markdown === "string";
  if (node.kind === "image") {
    return typeof node.content.alt === "string" && typeof node.content.dataUrl === "string" &&
      typeof node.content.mimeType === "string" &&
      (node.content.sourceName === undefined || typeof node.content.sourceName === "string");
  }
  if (node.kind === "literature") {
    return typeof node.content.title === "string" &&
      (node.content.literatureId === undefined || typeof node.content.literatureId === "string") &&
      (node.content.sourcePath === undefined || typeof node.content.sourcePath === "string");
  }
  return node.kind === "extension" && typeof node.content.renderer === "string" &&
    typeof node.content.title === "string" && Boolean(node.content.payload) &&
    typeof node.content.payload === "object" && !Array.isArray(node.content.payload);
}

function isEdge(value: unknown): value is PdfWhiteboardEdge {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const edge = value as Partial<PdfWhiteboardEdge>;
  return typeof edge.id === "string" && edge.id.length > 0 &&
    typeof edge.createdAt === "string" && typeof edge.sourceNodeId === "string" &&
    typeof edge.targetNodeId === "string" &&
    (edge.kind === "association" || edge.kind === "reference" || edge.kind === "sequence") &&
    (edge.label === undefined || typeof edge.label === "string");
}

export function normalizePdfWhiteboardDocument(
  value: unknown,
  paperId: string
): PdfWhiteboardDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createEmptyPdfWhiteboard(paperId);
  }
  const document = value as Partial<PdfWhiteboardDocument>;
  if (document.version !== 1 || document.paperId !== paperId ||
    !Array.isArray(document.nodes) || !document.nodes.every(isNode) ||
    !Array.isArray(document.edges) || !document.edges.every(isEdge)) {
    return createEmptyPdfWhiteboard(paperId);
  }
  const nodeIds = new Set(document.nodes.map((node) => node.id));
  return {
    edges: document.edges.filter((edge) =>
      nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId)
    ).map((edge) => ({ ...edge })),
    nodes: document.nodes.map((node) => ({
      ...node,
      content: { ...node.content },
      position: { ...node.position },
      size: { ...node.size },
      source: node.source ? { ...node.source } : undefined
    } as PdfWhiteboardNode)),
    paperId,
    updatedAt: typeof document.updatedAt === "string" ? document.updatedAt : new Date().toISOString(),
    version: 1,
    viewport: document.viewport && isFiniteNumber(document.viewport.x) &&
      isFiniteNumber(document.viewport.y) && isFiniteNumber(document.viewport.zoom)
      ? { ...document.viewport }
      : undefined
  };
}

export function pdfWhiteboardStorageKey(paper: { id: string; sourcePath?: string } | null) {
  if (!paper?.id) return null;
  return `${storagePrefix}:${resolveLocalAccountKey()}:${paper.id}:${stableHash(paper.sourcePath ?? "")}`;
}

export function loadPdfWhiteboard(storageKey: string | null, paperId: string) {
  if (!storageKey || typeof window === "undefined") return createEmptyPdfWhiteboard(paperId);
  try {
    return normalizePdfWhiteboardDocument(
      JSON.parse(window.localStorage.getItem(storageKey) ?? "null"),
      paperId
    );
  } catch {
    return createEmptyPdfWhiteboard(paperId);
  }
}

export function savePdfWhiteboard(
  storageKey: string | null,
  document: PdfWhiteboardDocument
) {
  if (!storageKey || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(document));
  } catch {
    // The current canvas remains usable if browser storage is unavailable or full.
  }
}
