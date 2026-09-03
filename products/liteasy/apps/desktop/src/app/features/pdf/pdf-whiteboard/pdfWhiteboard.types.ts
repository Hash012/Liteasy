export type PdfWhiteboardPoint = {
  x: number;
  y: number;
};

export type PdfWhiteboardSize = {
  height: number;
  width: number;
};

export type PdfWhiteboardPdfSource = {
  excerpt?: string;
  page?: number;
  paperId: string;
  sourcePath?: string;
  type: "pdf";
};

export type PdfWhiteboardExternalSource = {
  label?: string;
  type: "external";
  uri?: string;
};

export type PdfWhiteboardNodeSource = PdfWhiteboardPdfSource | PdfWhiteboardExternalSource;

type PdfWhiteboardNodeBase = {
  createdAt: string;
  id: string;
  position: PdfWhiteboardPoint;
  size: PdfWhiteboardSize;
  source?: PdfWhiteboardNodeSource;
  updatedAt: string;
};

export type PdfWhiteboardMarkdownNode = PdfWhiteboardNodeBase & {
  content: {
    markdown: string;
  };
  kind: "markdown";
};

export type PdfWhiteboardImageNode = PdfWhiteboardNodeBase & {
  content: {
    alt: string;
    dataUrl: string;
    mimeType: string;
    sourceName?: string;
  };
  kind: "image";
};

/**
 * Reserved first-class node for the next literature-aware iteration. Keeping it in the persisted
 * union now means the canvas and edge model will not need a migration when literature links land.
 */
export type PdfWhiteboardLiteratureNode = PdfWhiteboardNodeBase & {
  content: {
    literatureId?: string;
    sourcePath?: string;
    title: string;
  };
  kind: "literature";
};

/** Extensible payload for feature modules that have not yet earned a first-class node kind. */
export type PdfWhiteboardExtensionNode = PdfWhiteboardNodeBase & {
  content: {
    payload: Record<string, unknown>;
    renderer: string;
    title: string;
  };
  kind: "extension";
};

export type PdfWhiteboardNode =
  | PdfWhiteboardMarkdownNode
  | PdfWhiteboardImageNode
  | PdfWhiteboardLiteratureNode
  | PdfWhiteboardExtensionNode;

export type PdfWhiteboardEdge = {
  createdAt: string;
  id: string;
  kind: "association" | "reference" | "sequence";
  label?: string;
  sourceNodeId: string;
  targetNodeId: string;
};

export type PdfWhiteboardViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type PdfWhiteboardDocument = {
  edges: PdfWhiteboardEdge[];
  nodes: PdfWhiteboardNode[];
  paperId: string;
  updatedAt: string;
  version: 1;
  viewport?: PdfWhiteboardViewport;
};

export type PdfWhiteboardNodeInput =
  | { kind: "markdown"; markdown: string; source?: PdfWhiteboardNodeSource }
  | {
      alt: string;
      dataUrl: string;
      kind: "image";
      mimeType: string;
      source?: PdfWhiteboardNodeSource;
      sourceName?: string;
    }
  | {
      kind: "literature";
      literatureId?: string;
      sourcePath?: string;
      title: string;
    };

export type PdfWhiteboardNodeRendererRegistry = Record<
  string,
  (node: PdfWhiteboardExtensionNode) => unknown
>;
