import type {
  PdfWhiteboardDocument,
  PdfWhiteboardEdge,
  PdfWhiteboardNode,
  PdfWhiteboardNodeInput,
  PdfWhiteboardPoint
} from "./pdfWhiteboard.types";

function createId(prefix: string) {
  const suffix = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

export function createEmptyPdfWhiteboard(paperId: string): PdfWhiteboardDocument {
  return {
    edges: [],
    nodes: [],
    paperId,
    updatedAt: new Date().toISOString(),
    version: 1
  };
}

export function createPdfWhiteboardNode(
  input: PdfWhiteboardNodeInput,
  position: PdfWhiteboardPoint
): PdfWhiteboardNode {
  const timestamp = new Date().toISOString();
  const base = {
    createdAt: timestamp,
    id: createId("whiteboard-node"),
    position,
    source: "source" in input ? input.source : undefined,
    updatedAt: timestamp
  };

  if (input.kind === "image") {
    return {
      ...base,
      content: {
        alt: input.alt,
        dataUrl: input.dataUrl,
        mimeType: input.mimeType,
        sourceName: input.sourceName
      },
      kind: "image",
      size: { height: 220, width: 280 }
    };
  }

  if (input.kind === "literature") {
    return {
      ...base,
      content: {
        literatureId: input.literatureId,
        sourcePath: input.sourcePath,
        title: input.title
      },
      kind: "literature",
      size: { height: 112, width: 240 }
    };
  }

  return {
    ...base,
    content: { markdown: input.markdown },
    kind: "markdown",
    size: { height: 120, width: 230 }
  };
}

export function createPdfWhiteboardEdge(
  sourceNodeId: string,
  targetNodeId: string
): PdfWhiteboardEdge {
  return {
    createdAt: new Date().toISOString(),
    id: createId("whiteboard-edge"),
    kind: "association",
    sourceNodeId,
    targetNodeId
  };
}

export function appendPdfWhiteboardNode(
  document: PdfWhiteboardDocument,
  node: PdfWhiteboardNode
): PdfWhiteboardDocument {
  return {
    ...document,
    nodes: [...document.nodes, node],
    updatedAt: new Date().toISOString()
  };
}

export function nextPdfWhiteboardNodePosition(nodeCount: number): PdfWhiteboardPoint {
  return {
    x: 160 + nodeCount % 4 * 28,
    y: 120 + nodeCount % 6 * 34
  };
}
