import { extractQuickAskAbstract, type PdfQuickAskRequest } from "./pdfQuickAsk";
import { readerContextDragMime } from "../assistant/readerContextDrag";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { Button } from "@fluentui/react-components";
import {
  CommentRegular,
  CopyRegular,
  DeleteRegular,
  DocumentRegular,
  EditRegular,
  PanelLeftContractRegular,
  PanelLeftExpandRegular,
  ShareRegular,
  WhiteboardRegular
} from "@fluentui/react-icons";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { compactPdfTextForSearch, normalizePdfTextForSearch } from "./pdfTextSearch";
import { joinPdfTextItems, normalizePdfPageText } from "./pdfTextItems";
import { ensureReadableStreamAsyncIterator } from "./pdfStreamCompatibility";
import type { Paper } from "../workspace/workspace.types";
import type { ReaderConversationContext } from "../assistant/assistantContext.types";
import {
  clearMigratedPdfAnnotationBrowserCache,
  loadPdfAnnotationBrowserMigrationState,
  loadPdfAnnotationAutoPublic,
  loadPdfAnnotations,
  recoverPdfAnnotationPrivateState,
  pdfAnnotationAutoPublicStorageKey,
  pdfAnnotationStorageKey,
  savePdfAnnotationAutoPublic,
  savePdfAnnotations,
  revisePdfAnnotation,
  type PdfAnnotation,
  type PdfAnnotationKind,
  type PdfAnnotationPublication,
  type PdfAnnotationRect,
  type PdfAnnotationV2,
  type PdfHighlightColor
} from "./pdfAnnotationStorage";
import { resolvePaperIdentity } from "../paper-identity/paperIdentity";
import { createPdfLiteratureHints } from "../paper-identity/literatureRecord";
import {
  isUserPaperArtifactStoreAvailable,
  loadUserPaperArtifact,
  saveUserPaperArtifact
} from "../library/userPaperArtifactClient";
import type { PdfPageText } from "./citationAttribution";
import { resolvePdfSelectionMenuPosition } from "./pdfSelectionPosition";
import {
  buildPageCharModelFromTextLayer,
  buildPdfSelectionRange,
  buildPdfSelectionText,
  clientPointToPdfPoint,
  hitTestPdfInsertion,
  type PageCharModel
} from "./pdfSelectionEngine";
import { sortPdfAnnotationsByReadingOrder } from "./pdfAnnotationReadingOrder";
import { PdfAnnotationMarkdown } from "./PdfAnnotationMarkdown";
import { PdfMarkdownTextBox } from "./PdfMarkdownTextBox";
import { usePdfCitationParsing } from "./usePdfCitationParsing";
import { usePdfFulltextStore } from "./usePdfFulltextStore";
import type { TeamAnnotation } from "../organization/teamAnnotationClient";
import { LiteratureVersionRelations } from "../forum/LiteratureVersionRelations";
import type {
  LiteratureRecord,
  LiteratureRelation,
  LiteratureRelationsResult
} from "../paper-identity/literature.types";
import {
  PdfReaderToolbar,
  type PdfPageLayoutMode
} from "./PdfReaderToolbar";
import {
  findPdfReaderSearchMatches,
  type PdfReaderSearchMatch
} from "./pdfReaderSearch";
import {
  PdfWhiteboard,
  pdfWhiteboardDragMime,
  type PdfWhiteboardDraggedExcerpt
} from "./pdf-whiteboard/PdfWhiteboard";
import {
  appendPdfWhiteboardNode,
  createEmptyPdfWhiteboard,
  createPdfWhiteboardNode,
  nextPdfWhiteboardNodePosition
} from "./pdf-whiteboard/pdfWhiteboardModel";
import {
  loadPdfWhiteboard,
  normalizePdfWhiteboardDocument,
  pdfWhiteboardStorageKey,
  savePdfWhiteboard
} from "./pdf-whiteboard/pdfWhiteboardStorage";
import type { PdfWhiteboardDocument } from "./pdf-whiteboard/pdfWhiteboard.types";

ensureReadableStreamAsyncIterator();
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type AnnotationKind = PdfAnnotationKind;
type HighlightColor = PdfHighlightColor;

type PdfSelection = {
  excerpt: string;
  menuLeft: number;
  menuPlacement: "above" | "below";
  menuTop: number;
  normalizedStart?: number;
  page: number;
  rects: PdfAnnotationRect[];
};

export type PdfReaderSelectionSnapshot = {
  excerpt: string;
  page: number;
  paperId: string;
  paperTitle: string;
  rects: PdfAnnotationRect[];
  selectionId: string;
};

function createPdfReaderSelectionId(
  paperId: string,
  page: number,
  normalizedStart: number | undefined,
  excerpt: string
) {
  let hash = 2166136261;
  for (let index = 0; index < excerpt.length; index += 1) {
    hash ^= excerpt.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${paperId}:${page}:${normalizedStart ?? "unknown"}:${excerpt.length}:${(hash >>> 0).toString(16)}`;
}

type PdfSelectionPreview = {
  page: number;
  rects: PdfAnnotationRect[];
};

type PdfDragSelection = {
  anchorOffset: number;
  headCharacterIndex: number;
  headOffset: number;
  page: number;
  pointerId: number;
};

type PdfAnnotationPopup = {
  annotationId: string;
  left: number;
  placement: "above" | "below";
  top: number;
};

type TextLayerPosition = {
  node: Text;
  offset: number;
  normalizedOffset: number;
};

type PublicationTransport = {
  operation: "publish" | "update" | "retract";
  promise: Promise<PdfAnnotationPublication>;
};

type PdfSidebarMode = "thumbnails" | "annotations";

const pdfPageLayoutStorageKey = "liteasy:pdf-reader:page-layout";
const pdfMarginCommentsStorageKey = "liteasy:pdf-reader:margin-comments";
const pdfMarginCommentConnectorsStorageKey = "liteasy:pdf-reader:margin-comment-connectors";
const pdfWhiteboardVisibleStorageKey = "liteasy:pdf-reader:whiteboard-visible";

export type PdfAnnotationPublicationChange = {
  annotation: PdfAnnotationV2;
  literatureHints?: ReturnType<typeof createPdfLiteratureHints>;
  operation: "publish" | "update" | "retract";
  paper: Paper;
  restartReplay?: true;
};

type PdfReaderProps = {
  onQuickAsk?: (request: PdfQuickAskRequest) => Promise<string>;
  readingControls?: ReactNode;
  allowServerPdfParsing?: boolean;
  /** Where the structured citation parser lives; its snapshot is what thin reading reads back. */
  externalKnowledgeEndpoint?: string;
  loadLiteratureHints?: typeof collectPdfLiteratureHints;
  loadLiteratureRelations?: (literatureId: string) => Promise<LiteratureRelationsResult>;
  loadPdfSource?: (sourcePath: string) => Promise<Uint8Array>;
  onAcquireLiteratureVersion?: (
    literature: LiteratureRecord,
    relation: LiteratureRelation
  ) => Promise<{ created: boolean; documentId: string } | void>;
  onOpenLiteratureVersion?: (literature: LiteratureRecord, relation: LiteratureRelation) => void | Promise<void>;
  pdfBackground?: string;
  onPaperAnnotated?: (paperId: string) => Promise<void>;
  selectedPapers: Paper[];
  targetEvidence?: PdfEvidenceTarget | null;
  zoom: number;
  onZoomChange?: (zoom: number) => void;
  onAddSelectionToConversation?: (context: ReaderConversationContext) => void;
  onSelectionChanged?: (selection: PdfReaderSelectionSnapshot | null) => void;
  onChangeAnnotationPublication?: (input: PdfAnnotationPublicationChange) => Promise<PdfAnnotationPublication>;
  loadOrganizationAnnotations?: (paper: Paper) => Promise<TeamAnnotation[]>;
  organizationAnnotationActorId?: string;
  canModerateOrganizationAnnotations?: boolean;
  onDeleteOrganizationAnnotation?: (input: {
    annotation: TeamAnnotation;
    paper: Paper;
  }) => Promise<void>;
  onShareAnnotationToOrganization?: (input: {
    annotation: PdfAnnotation;
    paper: Paper;
  }) => Promise<TeamAnnotation>;
  onUpdateOrganizationAnnotation?: (input: {
    annotation: TeamAnnotation;
    note: string;
    paper: Paper;
  }) => Promise<TeamAnnotation>;
};


export type PdfEvidenceTarget = {
  evidenceId: string;
  page: number;
  pageTextEnd?: number;
  pageTextStart?: number;
  textExtraction?: "embedded" | "mineru" | "ocr";
  paperId: string;
  quote: string;
  requestId: number;
};

type PdfMetadataSource = Pick<PDFDocumentProxy, "getMetadata">;

function metadataValue(metadata: { get?: (name: string) => unknown } | undefined, name: string) {
  try {
    return metadata?.get?.(name);
  } catch {
    return undefined;
  }
}

export async function collectPdfLiteratureHints(
  paper: Paper,
  pdfDocument: PdfMetadataSource | null,
  firstPageText?: string
) {
  let info: Record<string, unknown> = {};
  let metadata: { get?: (name: string) => unknown } | undefined;
  if (pdfDocument) {
    try {
      const result = await pdfDocument.getMetadata();
      info = result.info && typeof result.info === "object"
        ? result.info as Record<string, unknown>
        : {};
      metadata = result.metadata;
    } catch {
      // Bibliographic hints are optional; publication can still resolve from the paper record.
    }
  }
  const creationDate = info.CreationDate ?? metadataValue(metadata, "xmp:CreateDate");
  const yearMatch = typeof creationDate === "string" ? creationDate.match(/(?:D:)?(\d{4})/) : null;
  return createPdfLiteratureHints(paper, {
    embeddedMetadata: {
      arxivId: info.ArXiv ?? metadataValue(metadata, "arxiv:id"),
      authors: info.Author ?? metadataValue(metadata, "dc:creator"),
      doi: info.DOI ?? metadataValue(metadata, "prism:doi"),
      semanticScholarId: info.SemanticScholarId,
      title: info.Title ?? metadataValue(metadata, "dc:title"),
      year: yearMatch?.[1]
    },
    firstPageText
  });
}

function publicationStatus(publication: PdfAnnotationPublication) {
  if (publication.state === "published") return "已公开到论坛";
  if (publication.state === "pending_retract") return "正在从论坛撤回";
  if (publication.state === "pending_update") return "正在更新论坛版本";
  if (["pending_create", "resolving_identity", "needs_identity_selection", "needs_manual_identity"].includes(publication.state)) {
    return "正在公开到论坛";
  }
  if (publication.state === "failed" && publication.desiredVisibility === "private" && publication.remoteAnnotationId) {
    return `撤回失败，论坛仍公开${publication.lastError ? `：${publication.lastError}` : ""}`;
  }
  if (publication.state === "failed" && publication.remoteAnnotationId) {
    return `更新失败，论坛仍保留上一版本${publication.lastError ? `：${publication.lastError}` : ""}`;
  }
  if (publication.state === "failed") return `公开失败${publication.lastError ? `：${publication.lastError}` : ""}`;
  return "未公开到论坛";
}

function resolvePdfDisplaySource(sourcePath: string | undefined) {
  if (!sourcePath) {
    return undefined;
  }

  const trimmed = sourcePath.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith("blob:") || lower.startsWith("data:application/pdf")) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const canDisplay =
      ["http:", "https:"].includes(url.protocol) &&
      url.pathname.toLowerCase().endsWith(".pdf");
    return canDisplay ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

export function shouldLoadPdfFromLocalBytes(sourcePath: string | undefined) {
  if (!sourcePath) return false;
  const trimmed = sourcePath.trim();
  const lower = trimmed.toLowerCase().replace(/\\/g, "/");
  if (
    lower.startsWith("blob:") ||
    lower.startsWith("data:") ||
    lower.startsWith("http:") ||
    lower.startsWith("https:")
  ) {
    return false;
  }
  return lower.startsWith("/") || /^[a-z]:\//.test(lower);
}

function getAnnotationLabel(kind: AnnotationKind) {
  if (kind === "highlight") {
    return "高亮";
  }

  if (kind === "underline") {
    return "划线";
  }

  if (kind === "text") {
    return "Markdown 文本框";
  }

  return "注释";
}

function getHighlightColor(color: HighlightColor): string {
  switch (color) {
    case "yellow":
      return "#ffeaa7";
    case "red":
      return "#fab1a0";
    case "blue":
      return "#74b9ff";
    case "green":
      return "#55efc4";
    case "pink":
      return "#fd79a8";
    default:
      return "#ffeaa7";
  }
}

function getHighlightBorderColor(color: HighlightColor): string {
  switch (color) {
    case "yellow":
      return "#ffe69c";
    case "red":
      return "#f5c6cb";
    case "blue":
      return "#bee5eb";
    case "green":
      return "#c3e6cb";
    case "pink":
      return "#f5b7e9";
    default:
      return "#ffe69c";
  }
}

function getOverlayLabel(kind: AnnotationKind) {
  if (kind === "highlight") {
    return "高亮标注";
  }

  if (kind === "underline") {
    return "划线标注";
  }

  if (kind === "text") {
    return "Markdown 文本框";
  }

  return "旁注";
}

function getAnnotationText(kind: AnnotationKind) {
  return getAnnotationLabel(kind);
}

function clampPercent(value: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, value));
}

function getElementFromRange(range: Range) {
  const node = range.commonAncestorContainer;
  if (!node) {
    return null;
  }

  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function getSelectionPageElement(range: Range, stageElement: HTMLElement) {
  const ancestorElement = getElementFromRange(range);
  if (!ancestorElement || !stageElement.contains(ancestorElement)) {
    return null;
  }

  if (!ancestorElement.closest(".pdf-text-layer")) {
    return null;
  }

  return ancestorElement.closest<HTMLElement>(".pdf-page-shell");
}

function getElementContentRect(element: HTMLElement) {
  const borderRect = element.getBoundingClientRect();
  const left = borderRect.left + element.clientLeft;
  const top = borderRect.top + element.clientTop;
  const width = element.clientWidth || Math.max(0, borderRect.width - element.clientLeft * 2);
  const height = element.clientHeight || Math.max(0, borderRect.height - element.clientTop * 2);
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width
  } as DOMRect;
}

function getPdfPageSurfaceRect(pageElement: HTMLElement) {
  const textLayerRect = pageElement.querySelector<HTMLElement>(".pdf-text-layer")?.getBoundingClientRect();
  return textLayerRect && textLayerRect.width > 0 && textLayerRect.height > 0
    ? textLayerRect
    : getElementContentRect(pageElement);
}

function getAnnotationClientBounds(pageElement: HTMLElement, rects: PdfAnnotationRect[]) {
  if (rects.length === 0) return null;
  const pageRect = getPdfPageSurfaceRect(pageElement);
  const left = Math.min(...rects.map((rect) => pageRect.left + pageRect.width * rect.left / 100));
  const right = Math.max(...rects.map((rect) =>
    pageRect.left + pageRect.width * (rect.left + rect.width) / 100
  ));
  const top = Math.min(...rects.map((rect) => pageRect.top + pageRect.height * rect.top / 100));
  const bottom = Math.max(...rects.map((rect) =>
    pageRect.top + pageRect.height * (rect.top + rect.height) / 100
  ));
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
    x: left,
    y: top,
    toJSON: () => ({})
  } as DOMRect;
}

function getRangeClientRects(range: Range) {
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 1 && rect.height > 1
  );

  if (rects.length > 0) {
    return rects;
  }

  const fallbackRect = range.getBoundingClientRect();
  return fallbackRect.width > 1 && fallbackRect.height > 1 ? [fallbackRect] : [];
}

function getLineHeightPercent(rect: DOMRect, pageHeight: number) {
  return Math.max(1.1, Math.min(2.8, (rect.height / pageHeight) * 100));
}

function getVerticalCenter(rect: DOMRect) {
  return rect.top + rect.height / 2;
}

function mergeLineRects(rects: DOMRect[]) {
  if (rects.length <= 1) {
    return rects;
  }

  const sortedHeights = rects.map((rect) => rect.height).sort((left, right) => left - right);
  const referenceHeight =
    sortedHeights[Math.floor((sortedHeights.length - 1) * 0.25)] ?? sortedHeights[0] ?? 1;
  const lineSizedRects = rects.filter(
    (rect) => rect.height <= Math.max(referenceHeight * 1.8, referenceHeight + 4)
  );
  const sourceRects = lineSizedRects.length > 0 ? lineSizedRects : rects;
  const sortedRects = [...sourceRects].sort(
    (left, right) => left.top - right.top || left.left - right.left
  );
  const lines: DOMRect[][] = [];

  for (const rect of sortedRects) {
    const line = lines.find((candidate) => {
      const lineCenter =
        candidate.reduce((sum, item) => sum + getVerticalCenter(item), 0) / candidate.length;
      const tolerance = Math.max(3, Math.min(rect.height, candidate[0]?.height ?? rect.height) * 0.55);
      return Math.abs(getVerticalCenter(rect) - lineCenter) <= tolerance;
    });

    if (line) {
      line.push(rect);
    } else {
      lines.push([rect]);
    }
  }

  return lines.map((line) => {
    const left = Math.min(...line.map((rect) => rect.left));
    const right = Math.max(...line.map((rect) => rect.right));
    const top = Math.min(...line.map((rect) => rect.top));
    const bottom = Math.max(...line.map((rect) => rect.bottom));
    return {
      bottom,
      height: bottom - top,
      left,
      right,
      toJSON: () => ({}),
      top,
      width: right - left,
      x: left,
      y: top
    } as DOMRect;
  });
}

function buildAnnotationRects(range: Range, pageRect: DOMRect | undefined) {
  const pageWidth = pageRect?.width && pageRect.width > 0 ? pageRect.width : 760;
  const pageHeight = pageRect?.height && pageRect.height > 0 ? pageRect.height : 980;
  const pageLeft = pageRect?.left ?? 0;
  const pageTop = pageRect?.top ?? 0;

  const visibleRects = getRangeClientRects(range)
    .filter((rect) => {
      const pageBottom = pageTop + pageHeight;
      const pageRight = pageLeft + pageWidth;
      return rect.bottom >= pageTop && rect.top <= pageBottom && rect.right >= pageLeft && rect.left <= pageRight;
    })
    .map((rect) => {
      const left = Math.max(pageLeft, rect.left);
      const right = Math.min(pageLeft + pageWidth, rect.right);
      const top = Math.max(pageTop, rect.top);
      const bottom = Math.min(pageTop + pageHeight, rect.bottom);
      return {
        bottom,
        height: bottom - top,
        left,
        right,
        toJSON: () => ({}),
        top,
        width: right - left,
        x: left,
        y: top
      } as DOMRect;
    });

  return mergeLineRects(visibleRects)
    .map((rect) => ({
      height: getLineHeightPercent(rect, pageHeight),
      left: clampPercent(((rect.left - pageLeft) / pageWidth) * 100, 16),
      top: clampPercent(((rect.top - pageTop) / pageHeight) * 100, 22),
      width: Math.max(4, clampPercent((rect.width / pageWidth) * 100, 48))
    }));
}

function buildSelectionFromRange(stageElement: HTMLElement, selection: Selection): PdfSelection | null {
  if (selection.rangeCount === 0) {
    return null;
  }

  const originalRange = selection.getRangeAt(0);
  const range = originalRange;
  const selectionText = selection.toString();
  const excerpt = selectionText.trim().replace(/\s+/g, " ");
  if (!excerpt) {
    return null;
  }
  const rangeRect = originalRange.getBoundingClientRect();
  const pageElement = getSelectionPageElement(range, stageElement);
  if (!pageElement) {
    return null;
  }

  const pageRect = getElementContentRect(pageElement);
  const pageNumber = Number(pageElement?.dataset.page ?? "1");
  const rects = buildAnnotationRects(range, pageRect);
  if (rects.length === 0) {
    return null;
  }

  const stageRect = stageElement.getBoundingClientRect();
  const menuPosition = resolvePdfSelectionMenuPosition({
    contentWidth: stageElement.scrollWidth,
    rect: rangeRect,
    scrollLeft: stageElement.scrollLeft,
    scrollTop: stageElement.scrollTop,
    stageRect: {
      left: stageRect.left + stageElement.clientLeft,
      top: stageRect.top + stageElement.clientTop
    }
  });
  const textLayer = pageElement.querySelector<HTMLElement>(".pdf-text-layer");
  let normalizedStart: number | undefined;
  if (textLayer?.contains(range.startContainer)) {
    try {
      const prefix = document.createRange();
      prefix.selectNodeContents(textLayer);
      prefix.setEnd(range.startContainer, range.startOffset);
      normalizedStart = normalizeQuoteForSearch(prefix.toString()).length;
    } catch {
      // The excerpt still identifies the anchor. This hint only disambiguates repeated text.
    }
  }

  return {
    excerpt,
    menuLeft: menuPosition.left,
    menuPlacement: menuPosition.placement,
    menuTop: menuPosition.top,
    normalizedStart,
    page: Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : 1,
    rects
  };
}

function collectTextLayerNodes(textLayer: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE && current.textContent) {
      nodes.push(current as Text);
    }
    current = walker.nextNode();
  }
  return nodes;
}

function normalizeQuoteForSearch(value: string) {
  return normalizePdfTextForSearch(value);
}

function buildNormalizedTextLayerIndex(nodes: Text[]) {
  let text = "";
  const positions: TextLayerPosition[] = [];
  let previousWasWhitespace = true;

  for (const node of nodes) {
    const value = node.nodeValue ?? "";
    const firstContentOffset = value.search(/\S/);
    // PDF extraction joins text items with one space, while PDF.js often renders adjacent
    // positioned spans without a literal whitespace node. Keep both coordinate systems aligned
    // so a persisted pageTextStart still selects the intended occurrence of a repeated quote.
    if (text.length > 0 && !previousWasWhitespace && firstContentOffset >= 0) {
      text += " ";
      positions.push({
        node,
        normalizedOffset: text.length - 1,
        offset: firstContentOffset
      });
      previousWasWhitespace = true;
    }
    for (let offset = 0; offset < value.length; offset += 1) {
      const character = value[offset];
      if (/\s/.test(character)) {
        if (!previousWasWhitespace && text.length > 0) {
          text += " ";
          positions.push({ node, normalizedOffset: text.length - 1, offset });
          previousWasWhitespace = true;
        }
        continue;
      }

      const normalizedCharacter = character
        .normalize("NFKC")
        .replace(/[‐‑‒–—]/g, "-")
        .replace(/\u00ad/g, "")
        .toLowerCase();
      if (!normalizedCharacter) {
        continue;
      }
      for (const item of normalizedCharacter) {
        text += item;
        positions.push({ node, normalizedOffset: text.length - 1, offset });
      }
      previousWasWhitespace = false;
    }
  }

  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    positions.pop();
  }

  return { positions, text };
}

function buildCompactTextLayerIndex(index: ReturnType<typeof buildNormalizedTextLayerIndex>) {
  const positions: TextLayerPosition[] = [];
  let text = "";
  for (let offset = 0; offset < index.text.length; offset += 1) {
    const character = index.text[offset];
    if (/\s/.test(character) || character === "-") {
      continue;
    }
    text += character;
    const position = index.positions[offset];
    if (position) {
      positions.push(position);
    }
  }
  return { positions, text };
}

function compactQuoteForSearch(value: string) {
  return compactPdfTextForSearch(value);
}

function findQuoteRangeInIndex(input: {
  index: ReturnType<typeof buildNormalizedTextLayerIndex>;
  preferredStart?: number;
  query: string;
}) {
  let start = input.index.text.indexOf(input.query);
  if (start < 0) {
    return null;
  }
  if (typeof input.preferredStart === "number" && Number.isFinite(input.preferredStart)) {
    let closestStart = start;
    let closestDistance = Math.abs(
      (input.index.positions[start]?.normalizedOffset ?? start) - input.preferredStart
    );
    let nextStart = input.index.text.indexOf(input.query, start + 1);
    while (nextStart >= 0) {
      const distance = Math.abs(
        (input.index.positions[nextStart]?.normalizedOffset ?? nextStart) - input.preferredStart
      );
      if (distance < closestDistance) {
        closestStart = nextStart;
        closestDistance = distance;
      }
      nextStart = input.index.text.indexOf(input.query, nextStart + 1);
    }
    start = closestStart;
  }
  const end = start + input.query.length - 1;
  const startPosition = input.index.positions[start];
  const endPosition = input.index.positions[end];
  if (!startPosition || !endPosition) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startPosition.node, startPosition.offset);
  range.setEnd(endPosition.node, endPosition.offset + 1);
  return range;
}

export function findQuoteRangeInTextLayer(
  textLayer: HTMLElement,
  quote: string,
  preferredStart?: number
): Range | null {
  const query = normalizeQuoteForSearch(quote);
  if (!query) {
    return null;
  }

  const index = buildNormalizedTextLayerIndex(collectTextLayerNodes(textLayer));
  const exactRange = findQuoteRangeInIndex({ index, preferredStart, query });
  if (exactRange) {
    return exactRange;
  }

  const compactQuery = compactQuoteForSearch(quote);
  if (!compactQuery) {
    return null;
  }
  return findQuoteRangeInIndex({
    index: buildCompactTextLayerIndex(index),
    preferredStart,
    query: compactQuery
  });
}

export function buildTargetEvidenceRects(
  textLayer: HTMLElement,
  pageElement: HTMLElement,
  quote: string,
  preferredStart?: number
) {
  const range = findQuoteRangeInTextLayer(textLayer, quote, preferredStart);
  if (!range) {
    return [];
  }
  return buildAnnotationRects(range, getElementContentRect(pageElement)).slice(0, 8);
}

function getPageNumbers(pageCount: number) {
  return Array.from({ length: Math.max(1, pageCount) }, (_, index) => index + 1);
}

function loadPdfPageLayoutMode(): PdfPageLayoutMode {
  try {
    const stored = window.localStorage.getItem(pdfPageLayoutStorageKey);
    return stored === "single" || stored === "spread" || stored === "continuous"
      ? stored
      : "continuous";
  } catch {
    return "continuous";
  }
}

function loadPdfMarginCommentsVisible() {
  try {
    return window.localStorage.getItem(pdfMarginCommentsStorageKey) === "true";
  } catch {
    return false;
  }
}

function loadPdfMarginCommentConnectorsVisible() {
  try {
    return window.localStorage.getItem(pdfMarginCommentConnectorsStorageKey) !== "false";
  } catch {
    return true;
  }
}

function loadPdfWhiteboardVisible() {
  try {
    return window.localStorage.getItem(pdfWhiteboardVisibleStorageKey) === "true";
  } catch {
    return false;
  }
}

function getVisiblePageNumbers(
  layoutMode: PdfPageLayoutMode,
  focusedPage: number,
  pageCount: number
) {
  if (layoutMode === "continuous") return new Set(getPageNumbers(pageCount));
  if (layoutMode === "single") return new Set([focusedPage]);
  const firstPage = focusedPage % 2 === 0 ? focusedPage - 1 : focusedPage;
  return new Set([firstPage, Math.min(pageCount, firstPage + 1)]);
}

export function resolvePdfPageStageWidth(
  stageWidth: number,
  layoutMode: PdfPageLayoutMode,
  marginCommentsVisible: boolean
) {
  const layoutColumnWidth = layoutMode === "spread" ? stageWidth / 2 : stageWidth;
  return Math.max(360, layoutColumnWidth - (marginCommentsVisible ? 236 : 0));
}

function getScaleForStage(baseViewport: PageViewport, stageWidth: number, zoom: number) {
  const availableWidth = Math.max(300, stageWidth - 72);
  return Math.max(0.5, Math.min(2.8, (availableWidth / baseViewport.width) * (zoom / 100)));
}

function isJsdomRuntime() {
  return typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("jsdom");
}

function getCanvasContext(canvas: HTMLCanvasElement) {
  if (isJsdomRuntime()) {
    return null;
  }

  return canvas.getContext("2d");
}

function clearPdfCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) {
    return;
  }
  canvas.width = 0;
  canvas.height = 0;
}

function getOverlayStyle(kind: AnnotationKind, rect: PdfAnnotationRect, color?: HighlightColor): CSSProperties {
  if (kind === "note") {
    return {
      backgroundColor: "rgba(36, 80, 142, 0.95)",
      borderRadius: "999px",
      height: "2%",
      left: `${Math.max(0, rect.left - 1.2)}%`,
      top: `${rect.top + Math.min(rect.height, 1)}%`,
      width: "2%"
    };
  }

  if (kind === "underline") {
    return {
      border: "none",
      boxShadow: "none",
      background: "none",
      height: `${rect.height}%`,
      left: `${rect.left}%`,
      top: `${rect.top}%`,
      width: `${rect.width}%`,
      borderBottom: "2px solid rgba(27, 102, 179, 0.8)"
    };
  }

  const highlightColor = color ? getHighlightColor(color) : getHighlightColor("yellow");
  const verticalInset = rect.height * 0.05;

  return {
    backgroundColor: highlightColor,
    height: `${rect.height - verticalInset * 2}%`,
    left: `${rect.left - 0.1}%`,
    top: `${rect.top + verticalInset}%`,
    width: `${rect.width + 0.2}%`
  };
}

export function buildPdfTextBoxRect(input: {
  clientX: number;
  clientY: number;
  pageRect: Pick<DOMRect, "height" | "left" | "top" | "width">;
}): PdfAnnotationRect | null {
  if (input.pageRect.width <= 0 || input.pageRect.height <= 0) return null;
  const width = 10;
  const height = 4;
  const left = (input.clientX - input.pageRect.left) / input.pageRect.width * 100;
  const top = (input.clientY - input.pageRect.top) / input.pageRect.height * 100;
  return {
    height,
    left: Math.max(0, Math.min(100 - width, left)),
    top: Math.max(0, Math.min(100 - height, top)),
    width
  };
}

export function layoutPdfMarginComments(annotations: readonly PdfAnnotationV2[]) {
  let nextTop = 2;
  return annotations
    .filter((annotation) =>
      (annotation.kind === "highlight" || annotation.kind === "underline") &&
      Boolean(annotation.note?.trim()) && annotation.rects.length > 0
    )
    .sort((left, right) =>
      Math.min(...left.rects.map((rect) => rect.top)) -
      Math.min(...right.rects.map((rect) => rect.top))
    )
    .map((annotation) => {
      const anchorTop = Math.min(...annotation.rects.map((rect) => rect.top));
      const anchorRect = annotation.rects.reduce((rightmost, rect) =>
        rect.left + rect.width > rightmost.left + rightmost.width ? rect : rightmost
      );
      const top = Math.min(86, Math.max(anchorTop, nextTop));
      nextTop = top + 13;
      return { anchorRect, annotation, top };
    });
}

export function buildPdfMarginConnectorGeometry(input: {
  anchorRect: PdfAnnotationRect;
  pageHeight: number;
  pageWidth: number;
}) {
  const startX = input.pageWidth * Math.min(100, input.anchorRect.left + input.anchorRect.width) / 100;
  const startY = input.pageHeight * (
    input.anchorRect.top + input.anchorRect.height / 2
  ) / 100;
  const endX = input.pageWidth + 14;
  return {
    left: startX,
    length: Math.max(0, endX - startX),
    top: startY
  };
}

type PdfPageViewProps = {
  activeSearchMatch?: PdfReaderSearchMatch;
  annotations: PdfAnnotationV2[];
  activePaper: Paper | null;
  focused: boolean;
  layoutVisible: boolean;
  /** This page rendered but yielded no text, so nothing on it can be located by character. */
  noTextLayer?: boolean;
  onAnnotationActivate?: (
    annotation: PdfAnnotationV2,
    pageElement: HTMLElement,
    anchorElement: HTMLElement
  ) => void;
  activeTextAnnotationId?: string | null;
  onTextAnnotationActivate?: (annotationId: string) => void;
  onTextAnnotationCommit?: (
    annotationId: string,
    markdown: string,
    rect: PdfAnnotationRect
  ) => void;
  onTextAnnotationDelete?: (annotation: PdfAnnotationV2) => void;
  onTextAnnotationMove?: (annotationId: string, rect: PdfAnnotationRect) => void;
  onTextAnnotationOpacityChange?: (annotationId: string, opacity: number) => void;
  marginCommentConnectorsVisible?: boolean;
  marginCommentsVisible?: boolean;
  onEvidenceHighlightResolved?: (matched: boolean) => void;
  onPageCharModelRendered?: (pageNumber: number, model: PageCharModel | null) => void;
  onPageTextRendered?: (input: PdfPageText) => void;
  pageNumber: number;
  pdfDocument: PDFDocumentProxy | null;
  searchMatches?: PdfReaderSearchMatch[];
  searchQuery?: string;
  selectionPreviewRects?: PdfAnnotationRect[];
  stageWidth: number;
  targetEvidence?: PdfEvidenceTarget | null;
  zoom: number;
};

function PdfPageView({
  activeSearchMatch,
  activeTextAnnotationId,
  activePaper,
  annotations,
  focused,
  layoutVisible,
  marginCommentConnectorsVisible = true,
  marginCommentsVisible = false,
  noTextLayer = false,
  onAnnotationActivate,
  onEvidenceHighlightResolved,
  onPageCharModelRendered,
  onPageTextRendered,
  onTextAnnotationActivate,
  onTextAnnotationCommit,
  onTextAnnotationDelete,
  onTextAnnotationMove,
  onTextAnnotationOpacityChange,
  pageNumber,
  pdfDocument,
  searchMatches = [],
  searchQuery = "",
  selectionPreviewRects = [],
  stageWidth,
  targetEvidence,
  zoom
}: PdfPageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageShellRef = useRef<HTMLElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [pageSize, setPageSize] = useState({ height: 980, width: 760 });
  const [searchHighlightRects, setSearchHighlightRects] = useState<Array<{
    active: boolean;
    rect: PdfAnnotationRect;
  }>>([]);
  const [targetHighlightRects, setTargetHighlightRects] = useState<PdfAnnotationRect[]>([]);

  function updateTargetHighlightRects() {
    const textLayer = textLayerRef.current;
    const pageElement = pageShellRef.current;
    if (
      focused &&
      targetEvidence?.textExtraction === "ocr" &&
      targetEvidence.paperId === activePaper?.id
    ) {
      setTargetHighlightRects([]);
      onEvidenceHighlightResolved?.(false);
      return;
    }
    if (
      !focused ||
      !targetEvidence?.quote ||
      targetEvidence.paperId !== activePaper?.id ||
      !textLayer ||
      !pageElement
    ) {
      setTargetHighlightRects([]);
      return;
    }
    const rects = buildTargetEvidenceRects(
      textLayer,
      pageElement,
      targetEvidence.quote,
      targetEvidence.pageTextStart
    );
    setTargetHighlightRects(rects);
    onEvidenceHighlightResolved?.(rects.length > 0);
  }

  function updateSearchHighlightRects() {
    const textLayer = textLayerRef.current;
    const pageElement = pageShellRef.current;
    if (!textLayer || !pageElement || !searchQuery || searchMatches.length === 0) {
      setSearchHighlightRects([]);
      return;
    }
    const rects = searchMatches.flatMap((match) => {
      const range = findQuoteRangeInTextLayer(textLayer, searchQuery, match.start);
      if (!range) return [];
      const active = match === activeSearchMatch;
      return buildAnnotationRects(range, getElementContentRect(pageElement)).map((rect) => ({
        active,
        rect
      }));
    });
    setSearchHighlightRects(rects);
  }

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;

    async function renderPage() {
      if (!pdfDocument) {
        clearPdfCanvas(canvasRef.current);
        if (textLayerRef.current) {
          textLayerRef.current.replaceChildren();
        }
        setSearchHighlightRects([]);
        setTargetHighlightRects([]);
        onPageCharModelRendered?.(pageNumber, null);
        if (focused && targetEvidence?.paperId === activePaper?.id) {
          onEvidenceHighlightResolved?.(false);
        }
        return;
      }

      const canvas = canvasRef.current;
      const textLayer = textLayerRef.current;
      if (!canvas || !textLayer) {
        return;
      }

      try {
        const page: PDFPageProxy = await pdfDocument.getPage(pageNumber);
        if (cancelled) {
          return;
        }

        const baseViewport = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: getScaleForStage(baseViewport, stageWidth, zoom)
        });
        const outputScale = window.devicePixelRatio || 1;
        const context = getCanvasContext(canvas);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        textLayer.style.width = `${viewport.width}px`;
        textLayer.style.height = `${viewport.height}px`;
        textLayer.style.setProperty("--total-scale-factor", String(viewport.scale));
        setPageSize({ height: viewport.height, width: viewport.width });

        if (context) {
          context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
          renderTask = page.render({ canvas, canvasContext: context, viewport });
          await renderTask.promise;
        }

        if (cancelled) {
          return;
        }

        textLayer.innerHTML = "";
        const textContent = await page.getTextContent();
        const layer = new pdfjsLib.TextLayer({
          container: textLayer,
          textContentSource: textContent,
          viewport
        });
        await layer.render();
        if (!cancelled) {
          const pageElement = pageShellRef.current;
          if (pageElement) {
            onPageCharModelRendered?.(pageNumber, buildPageCharModelFromTextLayer({
              pageElement,
              pageIndex: pageNumber,
              textLayer
            }));
          }
          onPageTextRendered?.({
            page: pageNumber,
            text: normalizePdfPageText(joinPdfTextItems(textContent.items))
          });
          updateSearchHighlightRects();
          updateTargetHighlightRects();
        }
      } catch (error) {
        // Swallowing this silently hid a total failure of the text layer, and with it every
        // anchor, for as long as it took someone to inspect the DOM. A page that cannot render
        // is worth saying out loud.
        if (!cancelled) {
          console.error(`PDF 第 ${pageNumber} 页渲染失败`, error);
        }
        clearPdfCanvas(canvasRef.current);
        textLayerRef.current?.replaceChildren();
        setTargetHighlightRects([]);
        onPageCharModelRendered?.(pageNumber, null);
        if (focused && targetEvidence?.paperId === activePaper?.id) {
          onEvidenceHighlightResolved?.(false);
        }
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      onPageCharModelRendered?.(pageNumber, null);
    };
  }, [activePaper?.id, focused, onEvidenceHighlightResolved, onPageCharModelRendered, onPageTextRendered, pageNumber, pdfDocument, stageWidth, targetEvidence?.pageTextStart, targetEvidence?.quote, targetEvidence?.requestId, zoom]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateTargetHighlightRects);
    return () => window.cancelAnimationFrame(frame);
  }, [activePaper?.id, focused, pageNumber, pageSize.height, pageSize.width, targetEvidence?.pageTextStart, targetEvidence?.quote, targetEvidence?.requestId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateSearchHighlightRects);
    return () => window.cancelAnimationFrame(frame);
  }, [activeSearchMatch, pageNumber, pageSize.height, pageSize.width, searchMatches, searchQuery]);

  const pageAnnotations = annotations.filter((annotation) => annotation.page === pageNumber);
  const marginComments = marginCommentsVisible ? layoutPdfMarginComments(pageAnnotations) : [];

  return (
    <div
      className={`pdf-page-row ${layoutVisible ? "layout-visible" : ""} ${
        marginComments.length > 0 ? "has-margin-comments" : ""
      }`}
      style={{ minHeight: pageSize.height }}
    >
      {marginCommentConnectorsVisible ? marginComments.map(({ anchorRect, annotation }) => {
        const connector = buildPdfMarginConnectorGeometry({
          anchorRect,
          pageHeight: pageSize.height,
          pageWidth: pageSize.width
        });
        return (
          <span
            aria-hidden="true"
            className="pdf-margin-comment-connector"
            data-annotation-id={annotation.id}
            key={`margin-connector-${annotation.id}`}
            style={{
              left: connector.left,
              top: connector.top,
              width: connector.length
            }}
          />
        );
      }) : null}
      <article
        aria-label={`PDF.js 页面 ${pageNumber}`}
        className={`pdf-page-shell ${focused ? "evidence-target focused-page" : ""} ${
          layoutVisible ? "layout-visible" : ""
        }`}
        data-page={pageNumber}
        ref={pageShellRef}
        style={{ minHeight: pageSize.height, width: pageSize.width }}
      >
        <canvas aria-label={`PDF.js 页面画布 ${pageNumber}`} className="pdf-page-canvas" ref={canvasRef} />
      {/* Degrading in the open, as the plan requires. A page with no text layer can carry no
          character-level marks at all, and saying nothing leaves the reader believing the layer
          found nothing worth marking rather than that it could not look. */}
        {noTextLayer ? (
          <p className="pdf-page-scanned-notice" role="note">
            该页为扫描件，没有文本层，锚点只能页级定位
          </p>
        ) : null}
        <div aria-hidden="true" className="pdf-page-shadow" />
        <div className="textLayer pdf-text-layer" ref={textLayerRef} />
        <div aria-label={pageNumber === 1 ? "PDF 批注覆盖层" : undefined} className="pdf-annotation-overlay">
        {pageAnnotations.map((annotation) => annotation.kind === "text" ? (
          annotation.rects[0] && onTextAnnotationActivate && onTextAnnotationCommit &&
          onTextAnnotationDelete && onTextAnnotationMove && onTextAnnotationOpacityChange ? (
            <PdfMarkdownTextBox
              active={activeTextAnnotationId === annotation.id}
              annotation={annotation}
              key={annotation.id}
              onActivate={onTextAnnotationActivate}
              onCommit={onTextAnnotationCommit}
              onDelete={onTextAnnotationDelete}
              onMove={onTextAnnotationMove}
              onOpacityChange={onTextAnnotationOpacityChange}
              rect={annotation.rects[0]}
            />
          ) : null
        ) : annotation.rects.map((rect, index) => (
            <button
              aria-label={`${(annotation.quickAsk ? "速问" : getOverlayLabel(annotation.kind))}：第 ${annotation.page} 页：${annotation.excerpt}`}
              className={`pdf-overlay-mark ${annotation.kind} ${annotation.quickAsk ? "quick-ask" : ""}`}
              draggable={annotation.kind === "highlight" || annotation.kind === "underline"}
              onDragStart={(event) => {
                if (!activePaper) { event.preventDefault(); return; }
                event.stopPropagation();
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData(readerContextDragMime, JSON.stringify({
                  excerpt: annotation.excerpt, page: annotation.page,
                  paperId: activePaper.id, paperTitle: activePaper.title, source: "pdf_selection"
                } satisfies ReaderConversationContext));
                event.dataTransfer.setData("text/plain", annotation.excerpt);
              }}
              key={`${annotation.id}-${index}`}
              onClick={(event) => {
                const pageElement = pageShellRef.current;
                if (pageElement) {
                  onAnnotationActivate?.(annotation, pageElement, event.currentTarget);
                }
              }}
              onPointerDown={(event) => event.stopPropagation()}
              style={{ ...getOverlayStyle(
                annotation.kind,
                rect,
                annotation.kind === "highlight" ? annotation.color : undefined
              ), ...(annotation.quickAsk ? { borderBottomStyle: "dashed" } : {}) }}
              title={`第 ${annotation.page} 页：${annotation.excerpt}`}
              type="button"
            />
          ))
        )}
        {selectionPreviewRects.map((rect, index) => (
          <div
            aria-hidden="true"
            className="pdf-overlay-mark selection-preview"
            key={`selection-preview-${pageNumber}-${index}`}
            style={getOverlayStyle("highlight", rect, "blue")}
          />
        ))}
        {searchHighlightRects.map((item, index) => (
          <div
            aria-label={item.active ? `当前搜索结果：第 ${pageNumber} 页` : undefined}
            aria-hidden={item.active ? undefined : true}
            className={`pdf-overlay-mark search-result ${item.active ? "current" : ""}`}
            key={`search-result-${pageNumber}-${index}`}
            style={getOverlayStyle("highlight", item.rect, item.active ? "blue" : "yellow")}
          />
        ))}
        {targetHighlightRects.map((rect, index) => (
          <div
            aria-label={`Agent 引用证据高亮：第 ${pageNumber} 页：${targetEvidence?.quote ?? ""}`}
            className="pdf-overlay-mark highlight agent-evidence"
            key={`target-evidence-${targetEvidence?.requestId ?? pageNumber}-${index}`}
            style={getOverlayStyle("highlight", rect, "blue")}
            title={`Agent 引用证据：${targetEvidence?.quote ?? ""}`}
          />
        ))}
        </div>
      </article>
      {marginComments.length > 0 ? (
        <aside
          aria-label={`第 ${pageNumber} 页页外批注栏`}
          className="pdf-margin-comment-rail"
          style={{ height: pageSize.height }}
        >
          {marginComments.map(({ annotation, top }) => (
          <section
            aria-label={`第 ${annotation.page} 页${getAnnotationLabel(annotation.kind)}批注：${annotation.note}`}
            className="pdf-margin-comment"
            key={`margin-comment-${annotation.id}`}
            onPointerDown={(event) => event.stopPropagation()}
            style={{ top: `${top}%` }}
          >
            <header>
              <span>{getAnnotationLabel(annotation.kind)}</span>
              <Button
                aria-label={`编辑页边批注：${annotation.excerpt}`}
                appearance="subtle"
                icon={<EditRegular />}
                onClick={(event) => {
                  const pageElement = pageShellRef.current;
                  if (pageElement) onAnnotationActivate?.(annotation, pageElement, event.currentTarget);
                }}
                size="small"
                title="编辑批注"
              />
            </header>
            <PdfAnnotationMarkdown value={annotation.note ?? ""} />
          </section>
          ))}
        </aside>
      ) : null}
    </div>
  );
}

type PdfThumbnailProps = {
  active: boolean;
  annotations: PdfAnnotationV2[];
  onNavigate: (page: number) => void;
  pageNumber: number;
  pdfDocument: PDFDocumentProxy | null;
};

function PdfThumbnail({ active, annotations, onNavigate, pageNumber, pdfDocument }: PdfThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;

    async function renderThumbnail() {
      if (!pdfDocument) {
        clearPdfCanvas(canvasRef.current);
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      try {
        const page = await pdfDocument.getPage(pageNumber);
        if (cancelled) {
          return;
        }

        const viewport = page.getViewport({ scale: 0.18 });
        const context = getCanvasContext(canvas);
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = "100%";
        canvas.style.height = "auto";

        if (context) {
          renderTask = page.render({ canvas, canvasContext: context, viewport });
          await renderTask.promise;
        }
      } catch {
        clearPdfCanvas(canvasRef.current);
      }
    }

    void renderThumbnail();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pageNumber, pdfDocument]);

  return (
    <li className={active ? "active" : ""}>
      <button
        aria-current={active ? "page" : undefined}
        aria-label={`转到第 ${pageNumber} 页`}
        onClick={() => onNavigate(pageNumber)}
        title={`转到第 ${pageNumber} 页`}
        type="button"
      >
        <span className="pdf-thumbnail-page">
          <canvas aria-label={`PDF.js 缩略图 ${pageNumber}`} className="pdf-thumbnail-canvas" ref={canvasRef} />
          {annotations.filter((annotation) => annotation.page === pageNumber &&
            (annotation.kind === "highlight" || annotation.kind === "underline"))
            .flatMap((annotation) => annotation.rects.map((rect, index) => (
              <span
                aria-hidden="true"
                className={`pdf-thumbnail-mark ${annotation.kind}`}
                key={`${annotation.id}-${index}`}
                style={getOverlayStyle(annotation.kind, rect, annotation.kind === "highlight" ? annotation.color : undefined)}
              />
            )))}
        </span>
        <span className="pdf-thumbnail-number">{pageNumber}</span>
      </button>
    </li>
  );
}

export function PdfReader({
  readingControls,
  allowServerPdfParsing = false,
  externalKnowledgeEndpoint = "",
  loadLiteratureHints = collectPdfLiteratureHints,
  loadLiteratureRelations,
  loadPdfSource,
  onAcquireLiteratureVersion,
  onOpenLiteratureVersion,
  pdfBackground = "#ffffff",
  onPaperAnnotated,
  selectedPapers,
  targetEvidence,
  zoom,
  onZoomChange,
  onQuickAsk,
  onAddSelectionToConversation,
  onSelectionChanged,
  canModerateOrganizationAnnotations = false,
  loadOrganizationAnnotations,
  organizationAnnotationActorId,
  onChangeAnnotationPublication,
  onDeleteOrganizationAnnotation,
  onShareAnnotationToOrganization,
  onUpdateOrganizationAnnotation
}: PdfReaderProps) {
  const activePaper = selectedPapers[0] ?? null;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const documentFrameRef = useRef<HTMLDivElement | null>(null);
  const pageCharModelsRef = useRef(new Map<number, PageCharModel>());
  const dragSelectionRef = useRef<PdfDragSelection | null>(null);
  const [documentFrameWidth, setDocumentFrameWidth] = useState(0);
  const [annotations, setAnnotations] = useState<PdfAnnotationV2[]>([]);
  const annotationsRef = useRef<PdfAnnotationV2[]>([]);
  annotationsRef.current = annotations;
  const [selectedColor, setSelectedColor] = useState<HighlightColor>("yellow");
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [focusedPage, setFocusedPage] = useState(1);
  const [layoutMode, setLayoutMode] = useState<PdfPageLayoutMode>(loadPdfPageLayoutMode);
  const [marginCommentsVisible, setMarginCommentsVisible] = useState(loadPdfMarginCommentsVisible);
  const [marginCommentConnectorsVisible, setMarginCommentConnectorsVisible] = useState(
    loadPdfMarginCommentConnectorsVisible
  );
  const [whiteboardOpen, setWhiteboardOpen] = useState(loadPdfWhiteboardVisible);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchCase, setSearchMatchCase] = useState(false);
  const [searchWholeWords, setSearchWholeWords] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try { return Math.max(160, Math.min(480, Number(localStorage.getItem("liteasy.pdf-sidebar-width")) || 180)); }
    catch { return 180; }
  });
  const sidebarResizeRef = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    try { localStorage.setItem("liteasy.pdf-sidebar-width", String(sidebarWidth)); } catch { /* Width remains usable. */ }
  }, [sidebarWidth]);
  const [sidebarMode, setSidebarMode] = useState<PdfSidebarMode>("annotations");
  const [stageWidth, setStageWidth] = useState(960);
  const [status, setStatus] = useState("选择文段后可添加高亮、划线，或把选中文段交给 AI。");
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const [quickAskSelection, setQuickAskSelection] = useState<PdfSelection | null>(null);
  const [quickAskQuestion, setQuickAskQuestion] = useState("");
  const [quickAskPending, setQuickAskPending] = useState(false);
  const [quickAskError, setQuickAskError] = useState("");
  const quickAskAbortRef = useRef<AbortController | null>(null);

  const [selectionPreview, setSelectionPreview] = useState<PdfSelectionPreview | null>(null);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [activeTextAnnotationId, setActiveTextAnnotationId] = useState<string | null>(null);
  const [textBoxToolActive, setTextBoxToolActive] = useState(false);
  const [annotationNoteDraft, setAnnotationNoteDraft] = useState("");
  const [annotationPopup, setAnnotationPopup] = useState<PdfAnnotationPopup | null>(null);
  const publicationIntentsRef = useRef(new Map<string, "private" | "public">());
  const publicationTransportsRef = useRef(new Map<string, PublicationTransport>());
  const replayedPublicationKeysRef = useRef(new Set<string>());
  const [sharingAnnotationId, setSharingAnnotationId] = useState<string | null>(null);
  const [teamAnnotations, setTeamAnnotations] = useState<TeamAnnotation[]>([]);
  const [teamAnnotationMessage, setTeamAnnotationMessage] = useState("");
  const [editingTeamAnnotationId, setEditingTeamAnnotationId] = useState<string | null>(null);
  const [teamAnnotationNoteDraft, setTeamAnnotationNoteDraft] = useState("");
  const [mutatingTeamAnnotationId, setMutatingTeamAnnotationId] = useState<string | null>(null);
  const pdfDisplaySource = resolvePdfDisplaySource(activePaper?.sourcePath);
  const annotationStorageKey = pdfAnnotationStorageKey(activePaper);
  useEffect(() => {
    setQuickAskSelection(null);
    setQuickAskPending(false);
    setQuickAskError("");
    return () => { quickAskAbortRef.current?.abort(); quickAskAbortRef.current = null; };
  }, [annotationStorageKey]);
  const autoPublicStorageKey = pdfAnnotationAutoPublicStorageKey(activePaper);
  const whiteboardStorageKey = pdfWhiteboardStorageKey(activePaper);
  const [whiteboardState, setWhiteboardState] = useState<{
    document: PdfWhiteboardDocument;
    storageKey: string | null;
  }>(() => ({
    document: createEmptyPdfWhiteboard(activePaper?.id ?? ""),
    storageKey: null
  }));
  const [hydratedWhiteboardStorageKey, setHydratedWhiteboardStorageKey] = useState<string | null>(null);
  const [autoPublicAnnotations, setAutoPublicAnnotations] = useState(false);
  const [hydratedAnnotationStorageKey, setHydratedAnnotationStorageKey] = useState<string | null>(null);
  const fulltext = usePdfFulltextStore(activePaper?.id);

  useEffect(() => {
    if (!selection || !activePaper) {
      onSelectionChanged?.(null);
      return;
    }
    onSelectionChanged?.({
      excerpt: selection.excerpt,
      page: selection.page,
      paperId: activePaper.id,
      paperTitle: activePaper.title,
      rects: selection.rects.map((rect) => ({ ...rect })),
      selectionId: createPdfReaderSelectionId(
        activePaper.id,
        selection.page,
        selection.normalizedStart,
        selection.excerpt
      )
    });
  }, [activePaper, onSelectionChanged, selection]);
  const { documentHasNoTextLayer, pageTexts, scannedPages } = fulltext;
  const pageNumbers = useMemo(() => getPageNumbers(pageCount), [pageCount]);
  const visiblePageNumbers = useMemo(
    () => getVisiblePageNumbers(layoutMode, focusedPage, pageCount),
    [focusedPage, layoutMode, pageCount]
  );
  const hasVisibleMarginComments = marginCommentsVisible && annotations.some((annotation) =>
    (annotation.kind === "highlight" || annotation.kind === "underline") &&
    Boolean(annotation.note?.trim()) &&
    annotation.rects.length > 0
  );
  const searchMatches = useMemo(
    () => findPdfReaderSearchMatches(pageTexts, searchQuery, {
      matchCase: searchMatchCase,
      wholeWords: searchWholeWords
    }),
    [pageTexts, searchMatchCase, searchQuery, searchWholeWords]
  );
  const activeSearchMatch = activeSearchIndex >= 0 ? searchMatches[activeSearchIndex] : undefined;
  const annotationsInReadingOrder = useMemo(
    () => sortPdfAnnotationsByReadingOrder(annotations),
    [annotations]
  );
  const popupAnnotation = useMemo(
    () => annotations.find((annotation) => annotation.id === annotationPopup?.annotationId) ?? null,
    [annotationPopup?.annotationId, annotations]
  );
  /*
   * Structured citation parsing, kept in the reader because this is where the PDF bytes are.
   * Its snapshot is stored as the paper's `citations` artifact; thin reading reads it back when
   * attributing references to the concepts it generated.
   */
  const citationParsing = usePdfCitationParsing({
    activePaper,
    allowServerPdfParsing,
    endpoint: externalKnowledgeEndpoint,
    // Parsing a partially-extracted document would store a snapshot missing whole sections of
    // the bibliography, and nothing downstream could tell it apart from a complete one.
    fullDocumentTextReady: pageCount > 0 && Object.keys(pageTexts).length >= pageCount,
    loadPdfSource,
    pageTexts
  });
  const handleEvidenceHighlightResolved = useCallback((matched: boolean) => {
    if (!targetEvidence || targetEvidence.paperId !== activePaper?.id) {
      return;
    }
    setStatus(targetEvidence.textExtraction === "ocr"
      ? `已定位到第 ${targetEvidence.page} 页；该证据来自 OCR 识别，当前只能页级定位。`
      : matched
        ? `已定位并高亮第 ${targetEvidence.page} 页的 Agent 引用证据。`
        : `已定位到第 ${targetEvidence.page} 页；原文文本层未能精确匹配，当前为页级定位。`);
  }, [activePaper?.id, targetEvidence]);

  const handlePageTextRendered = fulltext.onPageTextRendered;
  const handlePageCharModelRendered = useCallback((pageNumber: number, model: PageCharModel | null) => {
    if (model) {
      pageCharModelsRef.current.set(pageNumber, model);
    } else {
      pageCharModelsRef.current.delete(pageNumber);
    }
  }, []);

  function navigateToPage(page: number, behavior: ScrollBehavior = "smooth") {
    const nextPage = Math.min(Math.max(1, Math.trunc(page || 1)), Math.max(1, pageCount));
    setFocusedPage(nextPage);
    setStatus(`已转到第 ${nextPage} 页。`);
    window.requestAnimationFrame(() => {
      const stageElement = stageRef.current;
      const pageElement = stageElement?.querySelector<HTMLElement>(`[data-page="${nextPage}"]`);
      if (!stageElement || !pageElement) return;
      if (layoutMode === "continuous" && typeof pageElement.scrollIntoView === "function") {
        pageElement.scrollIntoView({ behavior, block: "start" });
      } else if (typeof stageElement.scrollTo === "function") {
        stageElement.scrollTo({ behavior, left: 0, top: 0 });
      } else {
        stageElement.scrollTop = 0;
      }
    });
  }

  function moveSearchMatch(delta: number) {
    if (searchMatches.length === 0) return;
    const currentIndex = activeSearchIndex < 0 ? (delta > 0 ? -1 : 0) : activeSearchIndex;
    const nextIndex = (currentIndex + delta + searchMatches.length) % searchMatches.length;
    setActiveSearchIndex(nextIndex);
    navigateToPage(searchMatches[nextIndex].page);
  }

  function openSearch() {
    setSearchOpen(true);
    if (activeSearchIndex < 0 && searchMatches.length > 0) {
      setActiveSearchIndex(0);
      navigateToPage(searchMatches[0].page);
    }
  }

  function closeSearch() {
    setSearchOpen(false);
    setActiveSearchIndex(-1);
  }

  function changeLayoutMode(mode: PdfPageLayoutMode) {
    setLayoutMode(mode);
    window.requestAnimationFrame(() => {
      const stageElement = stageRef.current;
      if (stageElement) stageElement.scrollTop = 0;
    });
  }

  function handleStageScroll() {
    if (layoutMode !== "continuous") return;
    const stageElement = stageRef.current;
    if (!stageElement) return;
    const stageTop = stageElement.getBoundingClientRect().top;
    let nearestPage = focusedPage;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const pageElement of stageElement.querySelectorAll<HTMLElement>(".pdf-page-shell")) {
      const page = Number(pageElement.dataset.page);
      const distance = Math.abs(pageElement.getBoundingClientRect().top - stageTop - 18);
      if (Number.isFinite(page) && distance < nearestDistance) {
        nearestDistance = distance;
        nearestPage = page;
      }
    }
    if (nearestPage !== focusedPage) setFocusedPage(nearestPage);
  }

  function handleStageKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLElement && event.target.matches("input, textarea, [contenteditable=true]")) {
      return;
    }
    if (event.key === "PageUp") {
      navigateToPage(focusedPage - 1);
      event.preventDefault();
    } else if (event.key === "PageDown") {
      navigateToPage(focusedPage + 1);
      event.preventDefault();
    }
  }

  function handleStageCopy(event: ReactClipboardEvent<HTMLDivElement>) {
    if (!selection?.excerpt) return;
    event.clipboardData.setData("text/plain", selection.excerpt);
    event.preventDefault();
    setStatus("已复制选中的 PDF 内容。");
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(pdfPageLayoutStorageKey, layoutMode);
    } catch {
      // The selected mode remains active for this session when storage is unavailable.
    }
  }, [layoutMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(pdfMarginCommentsStorageKey, String(marginCommentsVisible));
    } catch {
      // The selected visibility remains active for this session when storage is unavailable.
    }
  }, [marginCommentsVisible]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        pdfMarginCommentConnectorsStorageKey,
        String(marginCommentConnectorsVisible)
      );
    } catch {
      // The selected visibility remains active for this session when storage is unavailable.
    }
  }, [marginCommentConnectorsVisible]);

  useEffect(() => {
    try {
      window.localStorage.setItem(pdfWhiteboardVisibleStorageKey, String(whiteboardOpen));
    } catch {
      // The selected visibility remains active for this session when storage is unavailable.
    }
  }, [whiteboardOpen]);

  useEffect(() => {
    let cancelled = false;
    const paperId = activePaper?.id ?? "";
    const browserDocument = loadPdfWhiteboard(whiteboardStorageKey, paperId);
    setHydratedWhiteboardStorageKey(null);
    setWhiteboardState({
      document: browserDocument,
      storageKey: whiteboardStorageKey
    });
    if (!whiteboardStorageKey || !paperId || !isUserPaperArtifactStoreAvailable()) {
      setHydratedWhiteboardStorageKey(whiteboardStorageKey);
      return () => {
        cancelled = true;
      };
    }
    void loadUserPaperArtifact<unknown>({ artifactKind: "whiteboard", paperId })
      .then((snapshot) => {
        if (cancelled) return;
        setWhiteboardState({
          document: snapshot === undefined
            ? browserDocument
            : normalizePdfWhiteboardDocument(snapshot, paperId),
          storageKey: whiteboardStorageKey
        });
        setHydratedWhiteboardStorageKey(whiteboardStorageKey);
      })
      .catch(() => {
        if (cancelled) return;
        setHydratedWhiteboardStorageKey(whiteboardStorageKey);
      });
    return () => {
      cancelled = true;
    };
  }, [activePaper?.id, whiteboardStorageKey]);

  useEffect(() => {
    if (whiteboardState.storageKey !== whiteboardStorageKey ||
      hydratedWhiteboardStorageKey !== whiteboardStorageKey) return;
    const timer = window.setTimeout(() => {
      if (isUserPaperArtifactStoreAvailable() && activePaper?.id) {
        void saveUserPaperArtifact({
          artifactKind: "whiteboard",
          paperId: activePaper.id,
          snapshot: whiteboardState.document
        }).catch((error) => {
          const detail = error instanceof Error ? error.message : "未知错误";
          setStatus(`白板保存失败：${detail}`);
        });
      } else {
        savePdfWhiteboard(whiteboardStorageKey, whiteboardState.document);
      }
    }, 240);
    return () => window.clearTimeout(timer);
  }, [activePaper?.id, hydratedWhiteboardStorageKey, whiteboardState, whiteboardStorageKey]);

  useEffect(() => {
    function handleFindShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        openSearch();
      }
    }
    window.addEventListener("keydown", handleFindShortcut);
    return () => window.removeEventListener("keydown", handleFindShortcut);
  });

  const searchSignature = `${searchQuery}\u0000${searchMatchCase}\u0000${searchWholeWords}`;
  const searchSignatureRef = useRef(searchSignature);
  useEffect(() => {
    const queryChanged = searchSignatureRef.current !== searchSignature;
    searchSignatureRef.current = searchSignature;
    if (!searchOpen || !searchQuery.trim() || searchMatches.length === 0) {
      setActiveSearchIndex(-1);
      return;
    }
    if (queryChanged || activeSearchIndex < 0 || activeSearchIndex >= searchMatches.length) {
      setActiveSearchIndex(0);
      navigateToPage(searchMatches[0].page, "auto");
    }
  }, [searchMatches, searchOpen, searchSignature]);

  useEffect(() => {
    setTeamAnnotations([]);
    setTeamAnnotationMessage("");
    setEditingTeamAnnotationId(null);
    if (!activePaper || !loadOrganizationAnnotations) return;
    let active = true;
    setTeamAnnotationMessage("正在加载团队批注...");
    void loadOrganizationAnnotations(activePaper)
      .then((items) => {
        if (!active) return;
        setTeamAnnotations(items);
        setTeamAnnotationMessage(items.length === 0 ? "暂无团队批注。" : "");
      })
      .catch((error: unknown) => {
        if (active) {
          setTeamAnnotationMessage(error instanceof Error ? error.message : "团队批注加载失败。");
        }
      });
    return () => {
      active = false;
    };
  }, [activePaper?.id, loadOrganizationAnnotations]);

  useEffect(() => {
    const stageElement = stageRef.current;
    if (!stageElement) {
      return undefined;
    }
    const measuredStageElement = stageElement;

    function updateLayout() {
      setStageWidth(measuredStageElement.clientWidth);
      // The graph is laid out in the frame's own pixels, which is the stage minus its padding.
      setDocumentFrameWidth(documentFrameRef.current?.clientWidth ?? 0);
    }

    updateLayout();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateLayout);
      return () => window.removeEventListener("resize", updateLayout);
    }

    const observer = new ResizeObserver(updateLayout);
    observer.observe(measuredStageElement);
    return () => observer.disconnect();
  }, []);


  useEffect(() => {
    const fallbackPaperIdentity = activePaper ? resolvePaperIdentity(activePaper) : undefined;
    const browserMigration = loadPdfAnnotationBrowserMigrationState(
      annotationStorageKey,
      autoPublicStorageKey,
      fallbackPaperIdentity
    );
    const browserState = recoverPdfAnnotationPrivateState({
      annotations: browserMigration?.annotations ?? loadPdfAnnotations(annotationStorageKey, fallbackPaperIdentity),
      autoPublic: browserMigration?.autoPublic ?? loadPdfAnnotationAutoPublic(autoPublicStorageKey),
      version: 2
    }, fallbackPaperIdentity);
    setHydratedAnnotationStorageKey(null);
    setAnnotations(browserState.annotations);
    annotationsRef.current = browserState.annotations;
    setAutoPublicAnnotations(browserState.autoPublic);
    let cancelled = false;

    if (!activePaper?.id) {
      setHydratedAnnotationStorageKey(annotationStorageKey);
      return undefined;
    }

    void loadUserPaperArtifact<unknown>({
      artifactKind: "annotations",
      paperId: activePaper.id
    })
      .then((snapshot) => {
        if (cancelled) return;
        const stored = snapshot === undefined
          ? browserState
          : recoverPdfAnnotationPrivateState(snapshot, fallbackPaperIdentity);
        setAnnotations(stored.annotations);
        annotationsRef.current = stored.annotations;
        setAutoPublicAnnotations(stored.autoPublic);
        if (stored.issues.length > 0) {
          setStatus("部分批注的论坛恢复信息损坏；本地批注已保留，可检查后重试。");
        }
        queueMicrotask(() => replayRecoveredPublications(stored));
      })
      .catch(() => {
        // The browser cache remains a compatibility fallback when the user store is unavailable.
        if (cancelled) return;
        if (isUserPaperArtifactStoreAvailable()) {
          setStatus("批注恢复信息暂时无法读取；本地批注已保留，未发送论坛重放请求。");
        } else {
          queueMicrotask(() => replayRecoveredPublications(browserState));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHydratedAnnotationStorageKey(annotationStorageKey);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activePaper, annotationStorageKey, autoPublicStorageKey]);

  useEffect(() => {
    setSelection(null);
    setSelectionPreview(null);
    dragSelectionRef.current = null;
    pageCharModelsRef.current.clear();
    setActiveAnnotationId(null);
    setActiveTextAnnotationId(null);
    setTextBoxToolActive(false);
    setAnnotationPopup(null);
    setPageCount(1);
    setFocusedPage(1);
    setSearchOpen(false);
    setSearchQuery("");
    setActiveSearchIndex(-1);

    const localSourcePath = loadPdfSource && shouldLoadPdfFromLocalBytes(activePaper?.sourcePath)
      ? activePaper!.sourcePath
      : undefined;
    if (!pdfDisplaySource && !localSourcePath) {
      setPdfDocument(null);
      if (activePaper?.sourcePath) {
        setStatus("浏览器不能直接打开此 PDF 路径。");
      } else if (activePaper) {
        // An entry with no body. Saying "select a paper" here would read as if nothing
        // were open, and hint that the full text is one click away when it is not.
        setStatus("本条目只有元数据，没有可阅读的全文。");
      } else {
        setStatus("选择文献后开始阅读，可在 PDF 文本层上选中文段。");
      }
      return undefined;
    }

    if (isJsdomRuntime()) {
      setPdfDocument(null);
      setStatus("PDF.js 测试画布已准备，可在浏览器中渲染真实 PDF。");
      return undefined;
    }

    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
    setStatus("正在用 PDF.js 加载文档。");

    const sourcePromise = localSourcePath
      ? loadPdfSource!(localSourcePath).then((data) => ({ data }))
      : Promise.resolve({ url: pdfDisplaySource! });
    sourcePromise
      .then((source) => {
        if (cancelled) return null;
        loadingTask = pdfjsLib.getDocument(source);
        return loadingTask.promise;
      })
      .then((document) => {
        if (!document) return;
        if (cancelled) {
          void document.destroy();
          return;
        }

        setPdfDocument(document);
        setPageCount(document.numPages);
        setStatus(`已加载 ${document.numPages} 页 PDF，可直接选中文本批注。`);
      })
      .catch((error) => {
        if (!cancelled) {
          setPdfDocument(null);
          const reason = error instanceof Error ? error.message : String(error);
          setStatus(`PDF.js 无法解析该文件：${reason}`);
        }
      });

    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [activePaper?.sourcePath, loadPdfSource, pdfDisplaySource]);

  useEffect(() => {
    if (annotationStorageKey && hydratedAnnotationStorageKey === annotationStorageKey) {
      savePdfAnnotations(annotationStorageKey, annotations);
      if (activePaper?.id) {
        void saveUserPaperArtifact({
          artifactKind: "annotations",
          paperId: activePaper.id,
          snapshot: {
            annotations,
            autoPublic: autoPublicAnnotations,
            version: 2
          }
        })
          .then(() => {
            clearMigratedPdfAnnotationBrowserCache(annotationStorageKey, autoPublicStorageKey);
          })
          .catch((error: unknown) => {
            const detail = error instanceof Error ? error.message : "未知错误";
            setStatus(`批注尚未写入本地文献库：${detail}。请检查库目录后重试。`);
          });
        if (annotations.length > 0 && onPaperAnnotated) {
          // Annotating a paper whose body is still in the disposable cache promotes it
          // into the library, so clearing the cache cannot strip the body out from under
          // the user's own marks.
          void onPaperAnnotated(activePaper.id).catch((error) => {
            const detail = error instanceof Error ? error.message : "未知错误";
            setStatus(`批注已保存，但 PDF 自动转入文献库失败：${detail}。清理缓存前请重试。`);
          });
        }
      }
    }
  }, [
    activePaper?.id,
    annotationStorageKey,
    annotations,
    autoPublicStorageKey,
    autoPublicAnnotations,
    hydratedAnnotationStorageKey,
    onPaperAnnotated
  ]);

  useEffect(() => {
    if (!targetEvidence || targetEvidence.paperId !== activePaper?.id) {
      return undefined;
    }

    const targetPage = Math.min(
      Math.max(1, Math.trunc(targetEvidence.page || 1)),
      Math.max(1, pageCount)
    );
    setFocusedPage(targetPage);
    setSidebarMode("thumbnails");
    setSidebarCollapsed(false);
    setStatus(`已定位到第 ${targetPage} 页的 Agent 引用证据。`);

    const frame = window.requestAnimationFrame(() => {
      const pageElement = stageRef.current?.querySelector<HTMLElement>(
        `[data-page="${targetPage}"]`
      );
      if (pageElement && typeof pageElement.scrollIntoView === "function") {
        pageElement.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activePaper?.id, pageCount, targetEvidence]);

  function clearBrowserSelection() {
    window.getSelection()?.removeAllRanges();
  }

  function buildSelectionFromLogicalRange(
    drag: PdfDragSelection,
    model: PageCharModel,
    pageElement: HTMLElement
  ): PdfSelection | null {
    const stageElement = stageRef.current;
    if (!stageElement) return null;
    const range = buildPdfSelectionRange(model, {
      anchorOffset: drag.anchorOffset,
      headOffset: drag.headOffset,
      pageIndex: drag.page
    });
    const clientBounds = getAnnotationClientBounds(pageElement, range.rects);
    if (!range.text || range.rects.length === 0 || !clientBounds) return null;
    const stageRect = stageElement.getBoundingClientRect();
    const menuPosition = resolvePdfSelectionMenuPosition({
      contentWidth: stageElement.scrollWidth,
      rect: clientBounds,
      scrollLeft: stageElement.scrollLeft,
      scrollTop: stageElement.scrollTop,
      stageRect: {
        left: stageRect.left + stageElement.clientLeft,
        top: stageRect.top + stageElement.clientTop
      }
    });
    return {
      excerpt: range.text,
      menuLeft: menuPosition.left,
      menuPlacement: menuPosition.placement,
      menuTop: menuPosition.top,
      normalizedStart: normalizeQuoteForSearch(
        buildPdfSelectionText(model.chars.slice(0, range.startOffset))
      ).length,
      page: drag.page,
      rects: range.rects
    };
  }

  function handleSelectionPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.isPrimary === false) return;
    const target = event.target instanceof Element ? event.target : null;
    if (textBoxToolActive) {
      const pageElement = target?.closest<HTMLElement>(".pdf-page-shell");
      const page = Number(pageElement?.dataset.page);
      if (!pageElement || !Number.isInteger(page) || page < 1 || !activePaper) return;
      const rect = buildPdfTextBoxRect({
        clientX: event.clientX,
        clientY: event.clientY,
        pageRect: getPdfPageSurfaceRect(pageElement)
      });
      if (!rect) return;
      const now = new Date().toISOString();
      const annotation: PdfAnnotationV2 = {
        createdAt: now,
        excerpt: "Markdown 文本框",
        id: `text-${Date.now()}-${annotationsRef.current.length}`,
        kind: "text",
        note: "",
        opacity: 0.96,
        page,
        paperIdentity: resolvePaperIdentity(activePaper),
        publication: { desiredVisibility: "private", state: "not_published" },
        rects: [rect],
        revision: 1,
        text: "Markdown 文本框",
        updatedAt: now
      };
      event.preventDefault();
      clearBrowserSelection();
      setCurrentAnnotations((current) => [...current, annotation]);
      setActiveTextAnnotationId(annotation.id);
      setTextBoxToolActive(false);
      setSidebarMode("annotations");
      setStatus(`已在第 ${page} 页添加 Markdown 文本框。`);
      return;
    }
    const textLayer = target?.closest<HTMLElement>(".pdf-text-layer");
    const pageElement = textLayer?.closest<HTMLElement>(".pdf-page-shell");
    const page = Number(pageElement?.dataset.page);
    const model = pageCharModelsRef.current.get(page);
    if (!pageElement || !model || model.chars.length === 0) return;
    const point = clientPointToPdfPoint(pageElement, event.clientX, event.clientY);
    if (!point) return;

    event.preventDefault();
    clearBrowserSelection();
    const sourceIndexValue = target?.closest<HTMLElement>("[data-pdf-source-index]")
      ?.dataset.pdfSourceIndex;
    const sourceIndex = sourceIndexValue === undefined ? undefined : Number(sourceIndexValue);
    const hit = hitTestPdfInsertion(model, point, {
      sourceIndex: Number.isInteger(sourceIndex) ? sourceIndex : undefined
    });
    dragSelectionRef.current = {
      anchorOffset: hit.offset,
      headCharacterIndex: hit.characterIndex,
      headOffset: hit.offset,
      page,
      pointerId: event.pointerId
    };
    setSelection(null);
    setSelectionPreview(null);
    setAnnotationPopup(null);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is a stability enhancement; selection still works without it.
    }
  }

  function updateSelectionPointer(event: ReactPointerEvent<HTMLDivElement>, finish: boolean) {
    const drag = dragSelectionRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const model = pageCharModelsRef.current.get(drag.page);
    const pageElement = stageRef.current?.querySelector<HTMLElement>(`[data-page="${drag.page}"]`);
    if (!model || !pageElement) {
      dragSelectionRef.current = null;
      setSelectionPreview(null);
      return;
    }
    const point = clientPointToPdfPoint(pageElement, event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    const hitElement = typeof document.elementFromPoint === "function"
      ? document.elementFromPoint(event.clientX, event.clientY)
      : null;
    const sourceIndexValue = hitElement
      ?.closest<HTMLElement>("[data-pdf-source-index]")
      ?.dataset.pdfSourceIndex;
    const sourceIndex = sourceIndexValue === undefined ? undefined : Number(sourceIndexValue);
    const hit = hitTestPdfInsertion(model, point, {
      previousCharacterIndex: drag.headCharacterIndex,
      selectionAnchorOffset: drag.anchorOffset,
      sourceIndex: Number.isInteger(sourceIndex) ? sourceIndex : undefined
    });
    drag.headCharacterIndex = hit.characterIndex;
    drag.headOffset = hit.offset;
    const range = buildPdfSelectionRange(model, {
      anchorOffset: drag.anchorOffset,
      headOffset: drag.headOffset,
      pageIndex: drag.page
    });
    setSelectionPreview(range.rects.length > 0 ? { page: drag.page, rects: range.rects } : null);

    if (!finish) return;
    setSelection(buildSelectionFromLogicalRange(drag, model, pageElement));
    stageRef.current?.focus({ preventScroll: true });
    dragSelectionRef.current = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // The WebView may already have released capture as part of pointerup.
    }
  }

  function handleSelectionPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    updateSelectionPointer(event, false);
  }

  function handleSelectionPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    updateSelectionPointer(event, true);
  }

  function handleSelectionPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragSelectionRef.current?.pointerId !== event.pointerId) return;
    dragSelectionRef.current = null;
    setSelection(null);
    setSelectionPreview(null);
  }

  function handleTextSelection(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".pdf-selection-menu")) {
      return;
    }
    // Real pages use the character-geometry engine. This fallback keeps reduced WebViews and the
    // DOM-only test harness usable when no page model could be constructed.
    if (pageCharModelsRef.current.size > 0) return;

    const stageElement = stageRef.current;
    const browserSelection = window.getSelection();
    if (!stageElement || !browserSelection) {
      return;
    }

    const nextSelection = buildSelectionFromRange(stageElement, browserSelection);
    setSelection(nextSelection);
  }

  function handleSelectionContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".pdf-selection-menu")) {
      return;
    }

    const stageElement = stageRef.current;
    if (stageElement && pageCharModelsRef.current.size > 0) {
      if (!selection) return;
      event.preventDefault();
      const stageRect = stageElement.getBoundingClientRect();
      const menuPosition = resolvePdfSelectionMenuPosition({
        contentWidth: stageElement.scrollWidth,
        rect: {
          bottom: event.clientY,
          left: event.clientX,
          top: event.clientY,
          width: 0
        },
        scrollLeft: stageElement.scrollLeft,
        scrollTop: stageElement.scrollTop,
        stageRect: {
          left: stageRect.left + stageElement.clientLeft,
          top: stageRect.top + stageElement.clientTop
        }
      });
      setSelection({
        ...selection,
        menuLeft: menuPosition.left,
        menuPlacement: menuPosition.placement,
        menuTop: menuPosition.top
      });
      return;
    }
    const browserSelection = window.getSelection();
    if (!stageElement || !browserSelection) {
      return;
    }

    const nextSelection = buildSelectionFromRange(stageElement, browserSelection);
    if (!nextSelection && !selection) {
      return;
    }

    event.preventDefault();
    const stageRect = stageElement.getBoundingClientRect();
    if (nextSelection) {
      const menuPosition = resolvePdfSelectionMenuPosition({
        contentWidth: stageElement.scrollWidth,
        rect: {
          bottom: event.clientY,
          left: event.clientX,
          top: event.clientY,
          width: 0
        },
        scrollLeft: stageElement.scrollLeft,
        scrollTop: stageElement.scrollTop,
        stageRect: {
          left: stageRect.left + stageElement.clientLeft,
          top: stageRect.top + stageElement.clientTop
        }
      });
      setSelection({
        ...nextSelection,
        menuLeft: menuPosition.left,
        menuPlacement: menuPosition.placement,
        menuTop: menuPosition.top
      });
    } else {
      setSelection(selection);
    }
  }

  async function copySelectedText() {
    if (!selection?.excerpt) return;
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("当前环境无法写入剪贴板。");
      }
      await navigator.clipboard.writeText(selection.excerpt);
      setStatus("已复制选中的 PDF 内容。");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setStatus(`复制失败：${detail}`);
    }
  }

  function resolvedWhiteboardDocument() {
    if (whiteboardState.storageKey === whiteboardStorageKey) return whiteboardState.document;
    return loadPdfWhiteboard(whiteboardStorageKey, activePaper?.id ?? "");
  }

  function updateWhiteboardDocument(document: PdfWhiteboardDocument) {
    setWhiteboardState({ document, storageKey: whiteboardStorageKey });
  }

  function addSelectionToWhiteboard() {
    if (!selection || !activePaper) return;
    const document = resolvedWhiteboardDocument();
    const node = createPdfWhiteboardNode({
      kind: "markdown",
      markdown: selection.excerpt,
      source: {
        excerpt: selection.excerpt,
        page: selection.page,
        paperId: activePaper.id,
        sourcePath: activePaper.sourcePath,
        type: "pdf"
      }
    }, nextPdfWhiteboardNodePosition(document.nodes.length));
    updateWhiteboardDocument(appendPdfWhiteboardNode(document, node));
    setWhiteboardOpen(true);
    setSelection(null);
    setSelectionPreview(null);
    clearBrowserSelection();
    setStatus("已将选中文段加入白板。");
  }

  function handleSelectionWhiteboardDragStart(event: ReactDragEvent<HTMLButtonElement>) {
    if (!selection || !activePaper) return;
    const payload: PdfWhiteboardDraggedExcerpt = {
      kind: "markdown",
      markdown: selection.excerpt,
      source: {
        excerpt: selection.excerpt,
        page: selection.page,
        paperId: activePaper.id,
        sourcePath: activePaper.sourcePath,
        type: "pdf"
      }
    };
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(pdfWhiteboardDragMime, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", selection.excerpt);
    setWhiteboardOpen(true);
    setStatus("把摘录拖到右侧白板的指定位置。点击按钮也可以直接加入。");
  }

  function setCurrentAnnotations(update: (current: PdfAnnotationV2[]) => PdfAnnotationV2[]) {
    setAnnotations((current) => {
      const next = update(current);
      annotationsRef.current = next;
      return next;
    });
  }

  function replayRecoveredPublications(recovery: ReturnType<typeof recoverPdfAnnotationPrivateState>) {
    if (!activePaper || !onChangeAnnotationPublication) return;
    for (const item of recovery.replayItems) {
      const annotation = recovery.annotations.find((candidate) => candidate.id === item.annotationId);
      if (!annotation || annotation.revision !== item.revision ||
        restartOperation(annotation) !== item.operation) continue;
      queueRestartPublication(annotation, item.operation, item.queueKey);
    }
  }

  function queueRestartPublication(
    annotation: PdfAnnotationV2,
    operation: "publish" | "update" | "retract",
    queueKey = annotation.publication.pendingCreateOperation?.queueKey ??
      `${annotation.paperIdentity.paperId}:${annotation.id}`
  ) {
    const attemptKey = `${queueKey}:${annotation.revision}:${operation}`;
    if (replayedPublicationKeysRef.current.has(attemptKey)) return;
    replayedPublicationKeysRef.current.add(attemptKey);
    publicationIntentsRef.current.set(annotation.id, operation === "retract" ? "private" : "public");
    void applyPublication(annotation, operation, true, attemptKey);
  }

  function restartOperation(annotation: PdfAnnotationV2) {
    if (annotation.publication.state === "pending_create") return "publish" as const;
    if (
      annotation.publication.state === "failed" &&
      annotation.publication.pendingCreateOperation
    ) return annotation.publication.desiredVisibility === "public" ? "publish" as const : "retract" as const;
    if (annotation.publication.state === "pending_update") return "update" as const;
    if (annotation.publication.state === "pending_retract") return "retract" as const;
    return undefined;
  }

  function pendingPublicationOperation(annotation: PdfAnnotationV2) {
    if (annotation.publication.state === "pending_create") return "publish" as const;
    if (annotation.publication.state === "pending_update") return "update" as const;
    if (annotation.publication.state === "pending_retract") return "retract" as const;
    if (annotation.publication.state === "failed" &&
      annotation.publication.desiredVisibility === "private") return "retract" as const;
    return undefined;
  }

  async function applyPublication(
    annotation: PdfAnnotationV2,
    operation: "publish" | "update" | "retract",
    restartReplay = false,
    restartAttemptKey?: string
  ): Promise<PdfAnnotationPublication | undefined> {
    if (!activePaper || !onChangeAnnotationPublication) {
      const publication: PdfAnnotationPublication = {
        ...annotation.publication,
        lastError: "论坛发布功能暂不可用。",
        state: "failed"
      };
      setCurrentAnnotations((current) => current.map((item) => item.id === annotation.id &&
        item.revision === annotation.revision
        ? { ...item, publication }
        : item));
      return publication;
    }
    const expectedIntent = operation === "retract" ? "private" : "public";
    const hints = operation === "retract"
      ? undefined
      : await loadLiteratureHints(activePaper, pdfDocument, pageTexts[1]);
    const current = annotationsRef.current.find((item) => item.id === annotation.id);
    const currentOperation = current
      ? (restartReplay ? restartOperation(current) : pendingPublicationOperation(current))
      : undefined;
    if (publicationIntentsRef.current.get(annotation.id) !== expectedIntent ||
      !current || current.revision !== annotation.revision || currentOperation !== operation) {
      if (restartReplay) {
        const restartCurrentOperation = current ? restartOperation(current) : undefined;
        if (restartAttemptKey) replayedPublicationKeysRef.current.delete(restartAttemptKey);
        if (current && restartCurrentOperation) {
          queueMicrotask(() => queueRestartPublication(current, restartCurrentOperation));
        }
      } else if (current && currentOperation &&
        publicationIntentsRef.current.get(annotation.id) === (currentOperation === "retract" ? "private" : "public")) {
        queueMicrotask(() => void applyPublication(current, currentOperation));
      }
      return;
    }
    if (restartReplay) {
      const currentOperation = current ? restartOperation(current) : undefined;
      if (!current || current.revision !== annotation.revision || currentOperation !== operation) {
        if (restartAttemptKey) replayedPublicationKeysRef.current.delete(restartAttemptKey);
        if (current && currentOperation) {
          queueMicrotask(() => queueRestartPublication(current, currentOperation));
        }
        return;
      }
    }
    let transport: PublicationTransport | undefined;
    try {
      const promise = Promise.resolve(onChangeAnnotationPublication({
        annotation: current,
        ...(hints ? { literatureHints: hints } : {}),
        operation,
        paper: activePaper,
        ...(restartReplay ? { restartReplay: true as const } : {})
      }));
      transport = { operation, promise };
      publicationTransportsRef.current.set(annotation.id, transport);
      const publication = await promise;
      if (publicationIntentsRef.current.get(annotation.id) !== expectedIntent) return publication;
      setCurrentAnnotations((current) => current.map((item) => item.id === annotation.id &&
        item.revision === annotation.revision
        ? { ...item, publication }
        : item));
      return publication;
    } catch (error) {
      const message = error instanceof Error ? error.message : "论坛发布请求失败。";
      const publication: PdfAnnotationPublication = {
        ...annotation.publication,
        desiredVisibility: expectedIntent,
        lastError: operation === "retract" ? `撤回未完成，论坛仍公开。${message}` : message,
        state: "failed"
      };
      if (publicationIntentsRef.current.get(annotation.id) !== expectedIntent) return publication;
      setCurrentAnnotations((current) => current.map((item) => item.id === annotation.id
        ? { ...item, publication }
        : item));
      return publication;
    } finally {
      if (transport && publicationTransportsRef.current.get(annotation.id) === transport) {
        publicationTransportsRef.current.delete(annotation.id);
      }
    }
  }

  function requestPublication(annotation: PdfAnnotationV2, operation: "publish" | "update" | "retract") {
    const desiredVisibility = operation === "retract" ? "private" : "public";
    publicationIntentsRef.current.set(annotation.id, desiredVisibility);
    const pending = revisePdfAnnotation(annotation, {
      publication: {
        ...annotation.publication,
        desiredVisibility,
        lastError: undefined,
        state: operation === "retract"
          ? "pending_retract"
          : operation === "update" ? "pending_update" : "pending_create"
      },
      updatedAt: new Date().toISOString()
    });
    setCurrentAnnotations((current) => current.map((item) => item.id === annotation.id ? pending : item));
    queueMicrotask(() => void applyPublication(pending, operation));
  }

  function addAnnotation(kind: Exclude<AnnotationKind, "note" | "text">) {
    if (!selection || !activePaper) {
      setStatus("请先在真实 PDF 文本层中选择文段。");
      return;
    }
    const activeSelection = selection;
    const now = new Date().toISOString();
    const annotation: PdfAnnotationV2 = {
      color: kind === "highlight" ? selectedColor : undefined,
      createdAt: now,
      excerpt: activeSelection.excerpt,
      id: `${kind}-${Date.now()}-${annotations.length}`,
      kind,
      normalizedStart: activeSelection.normalizedStart,
      page: activeSelection.page,
      paperIdentity: resolvePaperIdentity(activePaper),
      publication: { desiredVisibility: "private", state: "not_published" },
      rects: activeSelection.rects,
      revision: 1,
      text: getAnnotationText(kind),
      updatedAt: now
    };
    const duplicate = annotations.some(
      (item) =>
        item.kind === annotation.kind &&
        item.page === annotation.page &&
        item.excerpt === annotation.excerpt
    );
    if (!duplicate) {
      setCurrentAnnotations((current) => [...current, annotation]);
      if (autoPublicAnnotations) {
        queueMicrotask(() => requestPublication(annotation, "publish"));
      }
    }
    setStatus(
      duplicate
        ? `该文段已经有${getAnnotationLabel(kind)}批注。`
        : `已创建${getAnnotationLabel(kind)}批注。`
    );
    setSidebarMode("annotations");
    setSidebarCollapsed(false);
    setSelection(null);
    setSelectionPreview(null);
    clearBrowserSelection();
  }

  async function submitQuickAsk() {
    if (!quickAskSelection || !activePaper || !onQuickAsk || quickAskAbortRef.current ||
      !quickAskQuestion.trim() || hydratedAnnotationStorageKey !== annotationStorageKey) return;
    const abort = new AbortController();
    quickAskAbortRef.current = abort;
    setQuickAskPending(true);
    setQuickAskError("");
    const anchor = quickAskSelection;
    const paper = activePaper;
    const question = quickAskQuestion.trim();
    try {
      async function readPage(page: number) {
        if (pageTexts[page]?.trim()) return pageTexts[page];
        if (!pdfDocument) return "";
        const pdfPage = await pdfDocument.getPage(page);
        return normalizePdfPageText(joinPdfTextItems((await pdfPage.getTextContent()).items));
      }
      const [pageText, ...openingPages] = await Promise.all([
        readPage(anchor.page),
        ...Array.from({ length: Math.min(pdfDocument?.numPages ?? pageCount, 3) }, (_, index) => readPage(index + 1))
      ]);
      if (abort.signal.aborted) return;
      const abstractText = extractQuickAskAbstract(openingPages.join("\n\n"));
      if (!pageText.trim() || !abstractText.trim()) throw new Error("页面或摘要文本尚未就绪，请先完成论文解析后重试。");
      const answer = await onQuickAsk({ paper, page: anchor.page, excerpt: anchor.excerpt,
        question, pageText, abstractText, signal: abort.signal });
      if (abort.signal.aborted) return;
      if (!answer.trim()) throw new Error("未收到回答，请重试。");
      const now = new Date().toISOString();
      const annotation: PdfAnnotationV2 = {
        id: `quick-ask-${crypto.randomUUID()}`, kind: "underline", page: anchor.page,
        excerpt: anchor.excerpt, rects: anchor.rects, normalizedStart: anchor.normalizedStart,
        text: `速问 · 第 ${anchor.page} 页`, createdAt: now, updatedAt: now,
        paperIdentity: resolvePaperIdentity(paper), revision: 1,
        publication: { desiredVisibility: "private", state: "not_published" },
        quickAsk: { question, answer, pageText, abstractText }
      };
      setCurrentAnnotations((current) => [...current, annotation]);
      setQuickAskSelection(null);
      setActiveAnnotationId(annotation.id);
      setAnnotationPopup({ annotationId: annotation.id, left: anchor.menuLeft,
        top: anchor.menuTop, placement: anchor.menuPlacement });
      setStatus("");
    } catch (error) {
      if (!abort.signal.aborted) setQuickAskError(error instanceof Error ? error.message : "速问失败，请重试。");
    } finally {
      if (quickAskAbortRef.current === abort) {
        quickAskAbortRef.current = null;
        setQuickAskPending(false);
      }
    }
  }

  function addSelectionToConversation() {
    if (!selection) return;

    const context: ReaderConversationContext = {
      excerpt: selection.excerpt,
      page: selection.page,
      paperId: selectedPapers[0]?.id,
      paperTitle: selectedPapers[0]?.title,
      source: "pdf_selection"
    };

    onAddSelectionToConversation?.(context);
    setSelection(null);
    setSelectionPreview(null);
    clearBrowserSelection();
    setStatus("");
  }

  function openAnnotationEditor(annotation: PdfAnnotationV2) {
    if (annotation.kind === "text") {
      setActiveAnnotationId(null);
      setAnnotationPopup(null);
      setActiveTextAnnotationId(annotation.id);
      locateAnnotation(annotation);
      return;
    }
    setActiveAnnotationId(annotation.id);
    setAnnotationNoteDraft(annotation.note || "");
    setAnnotationPopup(null);
    // 如果是高亮，打开颜色选择器
    if (annotation.kind === "highlight" && annotation.color) {
      setSelectedColor(annotation.color);
    }
  }

  function openPageAnnotationEditor(
    annotation: PdfAnnotationV2,
    _pageElement: HTMLElement,
    anchorElement: HTMLElement
  ) {
    const stageElement = stageRef.current;
    if (!stageElement) return;
    const stageRect = stageElement.getBoundingClientRect();
    const position = resolvePdfSelectionMenuPosition({
      contentWidth: stageElement.scrollWidth,
      rect: anchorElement.getBoundingClientRect(),
      scrollLeft: stageElement.scrollLeft,
      scrollTop: stageElement.scrollTop,
      stageRect: {
        left: stageRect.left + stageElement.clientLeft,
        top: stageRect.top + stageElement.clientTop
      }
    });
    setActiveAnnotationId(annotation.id);
    setAnnotationNoteDraft(annotation.note || "");
    setAnnotationPopup({
      annotationId: annotation.id,
      left: position.left,
      placement: position.placement,
      top: position.top
    });
    setSelection(null);
    setSelectionPreview(null);
    setStatus(annotation.quickAsk ? "" : `正在编辑第 ${annotation.page} 页${getAnnotationLabel(annotation.kind)}的注释。`);
  }

  function cancelAnnotationEditing() {
    setActiveAnnotationId(null);
    setAnnotationNoteDraft("");
    setAnnotationPopup(null);
  }

  function locateAnnotation(annotation: PdfAnnotationV2) {
    setFocusedPage(annotation.page);
    setStatus(`已定位到第 ${annotation.page} 页的${getAnnotationLabel(annotation.kind)}。`);
    window.requestAnimationFrame(() => {
      const stageElement = stageRef.current;
      const pageElement = stageElement?.querySelector<HTMLElement>(`[data-page="${annotation.page}"]`);
      if (!stageElement || !pageElement) return;
      const stageRect = getElementContentRect(stageElement);
      const pageRect = getPdfPageSurfaceRect(pageElement);
      const firstRectTop = annotation.rects.length > 0
        ? Math.min(...annotation.rects.map((rect) => rect.top))
        : 0;
      const annotationClientTop = pageRect.top + pageRect.height * firstRectTop / 100;
      const top = Math.max(
        0,
        stageElement.scrollTop + annotationClientTop - stageRect.top - stageElement.clientHeight * 0.28
      );
      if (typeof stageElement.scrollTo === "function") {
        stageElement.scrollTo({ behavior: "smooth", top });
      } else if (typeof pageElement.scrollIntoView === "function") {
        pageElement.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }

  function saveAnnotationNote() {
    if (!activeAnnotationId) return;
    const annotation = annotationsRef.current.find((item) => item.id === activeAnnotationId);
    if (!annotation) return;
    const updated = revisePdfAnnotation(annotation, {
      note: annotationNoteDraft,
      publication: annotation.publication.state === "published"
        ? { ...annotation.publication, state: "pending_update" }
        : annotation.publication,
      updatedAt: new Date().toISOString()
    });
    setCurrentAnnotations((current) => current.map((item) => item.id === annotation.id ? updated : item));
    if (annotation.publication.state === "published") {
      publicationIntentsRef.current.set(annotation.id, "public");
      queueMicrotask(() => void applyPublication(updated, "update"));
    }
    setStatus("已保存批注。");
    setActiveAnnotationId(null);
    setAnnotationNoteDraft("");
    setAnnotationPopup(null);
  }

  function commitTextAnnotation(
    annotationId: string,
    markdown: string,
    rect: PdfAnnotationRect
  ) {
    const annotation = annotationsRef.current.find((item) => item.id === annotationId);
    setActiveTextAnnotationId(null);
    if (!annotation || annotation.kind !== "text") return;
    const previousRect = annotation.rects[0];
    const rectChanged = !previousRect ||
      previousRect.height !== rect.height ||
      previousRect.left !== rect.left ||
      previousRect.top !== rect.top ||
      previousRect.width !== rect.width;
    if (annotation.note === markdown && !rectChanged) return;
    const updated = revisePdfAnnotation(annotation, {
      note: markdown,
      rects: [rect],
      updatedAt: new Date().toISOString()
    });
    setCurrentAnnotations((current) => current.map((item) => item.id === annotationId ? updated : item));
    setStatus("已保存 Markdown 文本框。");
  }

  function moveTextAnnotation(annotationId: string, rect: PdfAnnotationRect) {
    const annotation = annotationsRef.current.find((item) => item.id === annotationId);
    const previousRect = annotation?.rects[0];
    if (!annotation || annotation.kind !== "text" || !previousRect || (
      previousRect.height === rect.height &&
      previousRect.left === rect.left &&
      previousRect.top === rect.top &&
      previousRect.width === rect.width
    )) return;
    const updated = revisePdfAnnotation(annotation, {
      rects: [rect],
      updatedAt: new Date().toISOString()
    });
    setCurrentAnnotations((current) => current.map((item) => item.id === annotationId ? updated : item));
    setStatus("已移动 Markdown 文本框。");
  }

  function changeTextAnnotationOpacity(annotationId: string, opacity: number) {
    const annotation = annotationsRef.current.find((item) => item.id === annotationId);
    if (!annotation || annotation.kind !== "text") return;
    const normalizedOpacity = Math.min(1, Math.max(0, opacity));
    if ((annotation.opacity ?? 0.96) === normalizedOpacity) return;
    const updated = revisePdfAnnotation(annotation, {
      opacity: normalizedOpacity,
      updatedAt: new Date().toISOString()
    });
    setCurrentAnnotations((current) => current.map((item) => item.id === annotationId ? updated : item));
    setStatus(`Markdown 文本框透明度已调整为 ${Math.round(normalizedOpacity * 100)}%。`);
  }

  function updateHighlightColor(annotationId: string, color: HighlightColor) {
    setCurrentAnnotations((current) =>
      current.map((annotation) =>
        annotation.id === annotationId
          ? revisePdfAnnotation(annotation, {
              color,
              updatedAt: new Date().toISOString()
            })
          : annotation
      )
    );
    setStatus("已更新高亮颜色。");
    setActiveAnnotationId(null);
    setAnnotationPopup(null);
  }

  function setAnnotationPublic(annotationId: string, isPublic: boolean) {
    const annotation = annotationsRef.current.find((item) => item.id === annotationId);
    if (!annotation) return;
    if (!isPublic && !publicationTransportsRef.current.has(annotationId) &&
      annotation.publication.state === "pending_create" && !annotation.publication.remoteAnnotationId) {
      publicationIntentsRef.current.set(annotationId, "private");
      const cancelled = revisePdfAnnotation(annotation, {
        publication: { desiredVisibility: "private", state: "not_published" },
        updatedAt: new Date().toISOString()
      });
      setCurrentAnnotations((current) => current.map((item) => item.id === annotationId ? cancelled : item));
      return;
    }
    requestPublication(
      annotation,
      isPublic
        ? annotation.publication.remoteAnnotationId ? "update" : "publish"
        : "retract"
    );
  }

  async function deleteAnnotation(annotation: PdfAnnotationV2) {
    const remove = () => {
      setCurrentAnnotations((current) => current.filter((item) => item.id !== annotation.id));
      setActiveAnnotationId(null);
      setActiveTextAnnotationId(null);
      setAnnotationPopup(null);
      setStatus("已删除批注。");
    };
    const pendingCreate = annotation.publication.state === "pending_create" &&
      !annotation.publication.remoteAnnotationId;
    let transport = publicationTransportsRef.current.get(annotation.id);

    publicationIntentsRef.current.set(annotation.id, "private");
    if (pendingCreate && !transport) {
      remove();
      return;
    }
    if (transport || annotation.publication.state === "pending_retract") {
      setActiveAnnotationId(null);
      setAnnotationPopup(null);
      let settledPublication: PdfAnnotationPublication | undefined;
      try {
        settledPublication = await transport?.promise;
      } catch (error) {
        const message = error instanceof Error ? error.message : "论坛发布请求失败。";
        settledPublication = {
          desiredVisibility: "private",
          lastError: `撤回未完成，论坛发布状态未知。${message}`,
          state: "failed"
        };
      }
      await Promise.resolve();
      const queuedTransport = publicationTransportsRef.current.get(annotation.id);
      if (queuedTransport && queuedTransport !== transport && queuedTransport.operation === "retract") {
        transport = queuedTransport;
        try {
          settledPublication = await queuedTransport.promise;
        } catch (error) {
          const message = error instanceof Error ? error.message : "论坛撤回请求失败。";
          settledPublication = {
            desiredVisibility: "private",
            lastError: `撤回未完成，论坛发布状态未知。${message}`,
            state: "failed"
          };
        }
      }
      const latest = annotationsRef.current.find((item) => item.id === annotation.id);
      if (settledPublication?.state === "not_published" || latest?.publication.state === "not_published") {
        remove();
        return;
      }
      if (transport?.operation === "retract" || annotation.publication.state === "pending_retract") {
        return;
      }
      const createdPublication = settledPublication ?? latest?.publication ?? annotation.publication;
      const pending = revisePdfAnnotation(annotation, {
        publication: createdPublication.remoteAnnotationId
          ? {
              ...createdPublication,
              desiredVisibility: "private",
              lastError: undefined,
              state: "pending_retract"
            }
          : {
              ...createdPublication,
              desiredVisibility: "private"
            },
        updatedAt: new Date().toISOString()
      });
      setCurrentAnnotations((current) => current.map((item) => item.id === annotation.id ? pending : item));
      await Promise.resolve();
      const retracted = await applyPublication(pending, "retract");
      if (retracted?.state === "not_published") remove();
      return;
    }
    if (!annotation.publication.remoteAnnotationId && !annotation.publication.pendingCreateOperation) {
      remove();
      return;
    }
    const pending = revisePdfAnnotation(annotation, {
      publication: {
        ...annotation.publication,
        desiredVisibility: "private",
        state: "pending_retract"
      },
      updatedAt: new Date().toISOString()
    });
    setCurrentAnnotations((current) => current.map((item) => item.id === annotation.id ? pending : item));
    setActiveAnnotationId(null);
    setAnnotationPopup(null);
    await Promise.resolve();
    const retracted = await applyPublication(pending, "retract");
    if (retracted?.state === "not_published") remove();
  }

  function setAutoPublic(value: boolean) {
    setAutoPublicAnnotations(value);
    savePdfAnnotationAutoPublic(autoPublicStorageKey, value);
  }

  async function shareAnnotationToOrganization(annotation: PdfAnnotation) {
    if (!activePaper || !onShareAnnotationToOrganization || sharingAnnotationId) return;
    setSharingAnnotationId(annotation.id);
    setTeamAnnotationMessage("");
    try {
      const shared = await onShareAnnotationToOrganization({ annotation, paper: activePaper });
      setTeamAnnotations((current) => current.some((item) => item.annotationId === shared.annotationId)
        ? current
        : [...current, shared]);
      setTeamAnnotationMessage("批注已共享到组织。");
    } catch (error) {
      setTeamAnnotationMessage(error instanceof Error ? error.message : "批注共享失败。");
    } finally {
      setSharingAnnotationId(null);
    }
  }

  async function updateOrganizationAnnotation(annotation: TeamAnnotation) {
    if (!activePaper || !onUpdateOrganizationAnnotation || mutatingTeamAnnotationId) return;
    setMutatingTeamAnnotationId(annotation.annotationId);
    setTeamAnnotationMessage("");
    try {
      const updated = await onUpdateOrganizationAnnotation({
        annotation,
        note: teamAnnotationNoteDraft,
        paper: activePaper
      });
      setTeamAnnotations((current) => current.map((item) =>
        item.annotationId === updated.annotationId ? updated : item
      ));
      setEditingTeamAnnotationId(null);
      setTeamAnnotationMessage("组织批注已更新。");
    } catch (error) {
      setTeamAnnotationMessage(error instanceof Error ? error.message : "组织批注更新失败。");
    } finally {
      setMutatingTeamAnnotationId(null);
    }
  }

  async function deleteOrganizationAnnotation(annotation: TeamAnnotation) {
    if (!activePaper || !onDeleteOrganizationAnnotation || mutatingTeamAnnotationId) return;
    if (!window.confirm("确定删除这条组织批注吗？删除后无法恢复。")) return;
    setMutatingTeamAnnotationId(annotation.annotationId);
    setTeamAnnotationMessage("");
    try {
      await onDeleteOrganizationAnnotation({ annotation, paper: activePaper });
      setTeamAnnotations((current) => current.filter((item) =>
        item.annotationId !== annotation.annotationId
      ));
      setEditingTeamAnnotationId(null);
      setTeamAnnotationMessage("组织批注已删除。");
    } catch (error) {
      setTeamAnnotationMessage(error instanceof Error ? error.message : "组织批注删除失败。");
    } finally {
      setMutatingTeamAnnotationId(null);
    }
  }

  return (
    <section
      aria-label="PDF 阅读器"
      className="pdf-reader fluid"
      data-pdf-source={pdfDisplaySource ?? ""}
      style={{ "--pdf-reading-background": pdfBackground } as CSSProperties}
    >
      <div
        aria-label="PDF 阅读工作区"
        style={{ "--pdf-sidebar-width": `${sidebarWidth}px` } as CSSProperties}
        className={`pdf-workspace ${sidebarCollapsed ? "sidebar-collapsed" : "sidebar-open"} ${
          whiteboardOpen ? "whiteboard-open" : ""
        }`}
      >
        <aside
          aria-label="PDF 左侧批注栏"
          className="pdf-left-sidebar"
        >
          {!sidebarCollapsed ? <div
            aria-label="调整批注栏宽度" aria-orientation="vertical" role="separator" tabIndex={0}
            aria-valuemin={160} aria-valuemax={480} aria-valuenow={sidebarWidth}
            className="pdf-sidebar-resizer"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              sidebarResizeRef.current = { x: event.clientX, width: sidebarWidth };
              event.currentTarget.setPointerCapture(event.pointerId);
              event.preventDefault();
            }}
            onPointerMove={(event) => {
              const drag = sidebarResizeRef.current;
              if (drag) setSidebarWidth(Math.max(160, Math.min(480, drag.width + event.clientX - drag.x)));
            }}
            onPointerUp={() => { sidebarResizeRef.current = null; }}
            onPointerCancel={() => { sidebarResizeRef.current = null; }}
            onLostPointerCapture={() => { sidebarResizeRef.current = null; }}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              setSidebarWidth((width) => event.key === "Home" ? 160 : event.key === "End" ? 480 :
                Math.max(160, Math.min(480, width + (event.key === "ArrowLeft" ? -16 : 16))));
            }}
          /> : null}
          {sidebarCollapsed ? (
            <button
              aria-label="展开 PDF 左侧栏"
              className="pdf-sidebar-collapse-button"
              onClick={() => setSidebarCollapsed(false)}
              title="展开 PDF 左侧栏"
              type="button"
            >
              <PanelLeftExpandRegular />
            </button>
          ) : (
            <>
              <div className="pdf-sidebar-switcher">
                <button
                  aria-label="缩略图"
                  className={sidebarMode === "thumbnails" ? "active" : ""}
                  onClick={() => setSidebarMode("thumbnails")}
                  title="显示页面缩略图"
                  type="button"
                >
                  <DocumentRegular />
                </button>
                <button
                  aria-label="批注"
                  className={sidebarMode === "annotations" ? "active" : ""}
                  onClick={() => setSidebarMode("annotations")}
                  title="显示当前文档批注"
                  type="button"
                >
                  <CommentRegular />
                </button>
                <button
                  aria-label="收起 PDF 左侧栏"
                  className="pdf-sidebar-collapse-button"
                  onClick={() => setSidebarCollapsed(true)}
                  title="收起 PDF 左侧栏"
                  type="button"
                >
                  <PanelLeftContractRegular />
                </button>
              </div>

              {sidebarMode === "thumbnails" ? (
                <ol className="pdf-thumbnail-list">
                  {pageNumbers.map((pageNumber) => (
                    <PdfThumbnail
                      active={pageNumber === focusedPage}
                      annotations={annotations}
                      key={pageNumber}
                      onNavigate={navigateToPage}
                      pageNumber={pageNumber}
                      pdfDocument={pdfDocument}
                    />
                  ))}
                </ol>
              ) : (
                <div className="pdf-sidebar-annotations">
                  {status ? <div aria-live="polite" className="pdf-status">
                    {status}
                  </div> : null}
                  {activePaper?.literature ? (
                    <>
                      <div
                        aria-label="文献身份来源"
                        className="pdf-status"
                        role="status"
                      >
                        文献身份：公共来源
                      </div>
                      <LiteratureVersionRelations
                        currentLiterature={activePaper.literature}
                        loadRelations={loadLiteratureRelations}
                        onAcquireVersion={onAcquireLiteratureVersion}
                        onOpenVersion={onOpenLiteratureVersion}
                      />
                    </>
                  ) : null}
                  <details className="pdf-annotation-options"><summary>批注选项</summary>
                  <label className="pdf-annotation-auto-public-toggle">
                    <input
                      checked={autoPublicAnnotations}
                      onChange={(event) => setAutoPublic(event.currentTarget.checked)}
                      type="checkbox"
                    />
                    新批注自动公开到论坛
                  </label></details>
                  {annotations.length > 0 ? (
                    <ul className="pdf-annotation-list">
                      {annotationsInReadingOrder.map((annotation) => (
                        <li
                          className={`pdf-annotation-item ${annotation.kind} ${
                            activeAnnotationId === annotation.id ? "expanded" : ""
                          }`}
                          key={annotation.id}
                        >
                          {annotation.kind === "highlight" && annotation.color && (
                            <div
                              className="annotation-color-indicator"
                              style={{ backgroundColor: getHighlightColor(annotation.color) }}
                            />
                          )}
                          <button
                            aria-expanded={activeAnnotationId === annotation.id}
                            aria-label={`编辑批注：${annotation.excerpt}`}
                            className="pdf-annotation-summary"
                            onClick={() => openAnnotationEditor(annotation)}
                            onDoubleClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              locateAnnotation(annotation);
                            }}
                            title="展开完整内容；双击定位到 PDF 原文"
                            type="button"
                          >
                            <span className="pdf-annotation-kind">{annotation.text}</span>
                            <span className="pdf-annotation-excerpt">{annotation.excerpt}</span>
                            {activeAnnotationId !== annotation.id && (annotation.quickAsk?.question || annotation.note) ?
                              <span className="pdf-annotation-summary-note"> · {annotation.quickAsk?.question ?? annotation.note}</span> : null}
                          </button>
                          {activeAnnotationId === annotation.id && annotation.kind !== "text" && annotation.note && (
                            <div className="annotation-divider" />
                          )}
                          {activeAnnotationId === annotation.id ? (
                            <div className="pdf-annotation-editor">
                              {annotation.quickAsk ? <>
                                <strong>{annotation.quickAsk.question}</strong>
                                <PdfAnnotationMarkdown value={annotation.quickAsk.answer} />
                              </> : <>

                              <div className="note-editor">
                                <textarea
                                  aria-label="补充批注笔记"
                                  maxLength={10_000}
                                  onChange={(e) => setAnnotationNoteDraft(e.target.value)}
                                  placeholder="添加注释，支持 Markdown..."
                                  rows={3}
                                  value={annotationNoteDraft}
                                />
                                <div aria-label="批注 Markdown 实时预览" aria-live="polite">
                                  <PdfAnnotationMarkdown
                                    value={annotationNoteDraft}
                                  />
                                </div>
                                <div className="editor-actions">
                                  <button onClick={saveAnnotationNote} type="button" className="save-button">
                                    保存笔记
                                  </button>
                                  <button onClick={cancelAnnotationEditing} type="button" className="cancel-button">
                                    取消
                                  </button>
                                </div>
                              </div>
                              {annotation.kind === "highlight" && (
                                <div className="color-selector">
                                  {(["yellow", "red", "blue", "green", "pink"] as HighlightColor[]).map((color) => (
                                    <button
                                      key={color}
                                      className={`color-option ${selectedColor === color ? "active" : ""}`}
                                      style={{ backgroundColor: getHighlightColor(color) }}
                                      onClick={() => {
                                        // 更新高亮颜色
                                        updateHighlightColor(annotation.id, color);
                                      }}
                                      title={`选择${color === "yellow" ? "黄色" : color === "red" ? "红色" : color === "blue" ? "蓝色" : color === "green" ? "绿色" : "粉色"}高亮`}
                                      type="button"
                                    />
                                  ))}
                                </div>
                              )}
                              </>}
                              <button
                                className="delete-button"
                                onClick={() => void deleteAnnotation(annotation)}
                                type="button"
                              >
                                删除
                              </button>
                            </div>
                          ) : null}
                          {activeAnnotationId === annotation.id && !annotation.quickAsk ? <>
                          {annotation.kind === "text" ? (
                            <small role="note">文本框保存在当前本地 PDF 批注中</small>
                          ) : (
                            <>
                              <label className="pdf-annotation-public-toggle">
                                <input
                                  aria-label={`将第 ${annotation.page} 页${getAnnotationLabel(annotation.kind)}批注公开到论坛：${annotation.excerpt}`}
                                  checked={annotation.publication.desiredVisibility === "public"}
                                  onChange={(event) => setAnnotationPublic(annotation.id, event.currentTarget.checked)}
                                  type="checkbox"
                                />
                                公开到论坛
                              </label>
                              <small aria-live="polite" role="status">
                                {publicationStatus(annotation.publication)}
                              </small>
                            </>
                          )}
                          {annotation.kind !== "text" && onShareAnnotationToOrganization ? (
                            <Button
                              appearance="subtle"
                              aria-label={`共享批注到组织：${annotation.excerpt}`}
                              disabled={sharingAnnotationId !== null}
                              icon={<ShareRegular />}
                              onClick={() => void shareAnnotationToOrganization(annotation)}
                              size="small"
                              type="button"
                            >
                              {sharingAnnotationId === annotation.id ? "共享中" : "共享到组织"}
                            </Button>
                          ) : null}
                          </> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="pdf-empty-note">暂无批注</div>
                  )}
                  {loadOrganizationAnnotations ? (
                    <section aria-label="团队批注" className="pdf-team-annotations">
                      <div className="pdf-sidebar-section-title">团队批注</div>
                      {teamAnnotations.length > 0 ? (
                        <ul className="pdf-annotation-list">
                          {teamAnnotations.map((annotation) => (
                            <li className="pdf-annotation-item note" key={annotation.annotationId}>
                              <span className="pdf-annotation-kind">
                                {annotation.uploadedBy} · 第 {annotation.body.page} 页
                              </span>
                              <span className="pdf-annotation-excerpt">{annotation.body.excerpt}</span>
                              {annotation.body.note ? (
                                <div className="annotation-note-preview">{annotation.body.note}</div>
                              ) : null}
                              {editingTeamAnnotationId === annotation.annotationId ? (
                                <div className="annotation-note-editor">
                                  <textarea
                                    aria-label="编辑组织批注备注"
                                    maxLength={10_000}
                                    onChange={(event) => setTeamAnnotationNoteDraft(event.currentTarget.value)}
                                    rows={3}
                                    value={teamAnnotationNoteDraft}
                                  />
                                  <div className="editor-actions">
                                    <Button
                                      disabled={mutatingTeamAnnotationId !== null}
                                      onClick={() => void updateOrganizationAnnotation(annotation)}
                                      size="small"
                                      type="button"
                                    >
                                      保存
                                    </Button>
                                    <Button
                                      appearance="subtle"
                                      disabled={mutatingTeamAnnotationId !== null}
                                      onClick={() => setEditingTeamAnnotationId(null)}
                                      size="small"
                                      type="button"
                                    >
                                      取消
                                    </Button>
                                  </div>
                                </div>
                              ) : null}
                              <div className="editor-actions">
                                {onUpdateOrganizationAnnotation &&
                                organizationAnnotationActorId === annotation.uploadedBy ? (
                                  <Button
                                    appearance="subtle"
                                    aria-label={`编辑组织批注：${annotation.body.excerpt}`}
                                    disabled={mutatingTeamAnnotationId !== null}
                                    icon={<EditRegular />}
                                    onClick={() => {
                                      setEditingTeamAnnotationId(annotation.annotationId);
                                      setTeamAnnotationNoteDraft(annotation.body.note ?? "");
                                    }}
                                    size="small"
                                    type="button"
                                  >
                                    编辑
                                  </Button>
                                ) : null}
                                {onDeleteOrganizationAnnotation && (
                                  canModerateOrganizationAnnotations ||
                                  organizationAnnotationActorId === annotation.uploadedBy
                                ) ? (
                                  <Button
                                    appearance="subtle"
                                    aria-label={`删除组织批注：${annotation.body.excerpt}`}
                                    disabled={mutatingTeamAnnotationId !== null}
                                    icon={<DeleteRegular />}
                                    onClick={() => void deleteOrganizationAnnotation(annotation)}
                                    size="small"
                                    type="button"
                                  >
                                    删除
                                  </Button>
                                ) : null}
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {teamAnnotationMessage ? (
                        <small aria-live="polite">{teamAnnotationMessage}</small>
                      ) : null}
                    </section>
                  ) : null}
                </div>
              )}
            </>
          )}
        </aside>


        <section
          aria-label="PDF 页面预览"
          className="pdf-main-stage"
        >
          <div className="pdf-reader-top">
            <PdfReaderToolbar
              readingControls={readingControls}
              activeSearchIndex={activeSearchIndex}
              currentPage={focusedPage}
              layoutMode={layoutMode}
              matchCase={searchMatchCase}
              marginCommentConnectorsVisible={marginCommentConnectorsVisible}
              marginCommentsVisible={marginCommentsVisible}
              whiteboardOpen={whiteboardOpen}
              onChangeLayoutMode={changeLayoutMode}
              onChangeMatchCase={setSearchMatchCase}
              onChangePage={navigateToPage}
              onChangeSearchQuery={setSearchQuery}
              onChangeWholeWords={setSearchWholeWords}
              onCloseSearch={closeSearch}
              onFindNext={() => moveSearchMatch(1)}
              onFindPrevious={() => moveSearchMatch(-1)}
              onNavigateNext={() => navigateToPage(focusedPage + 1)}
              onNavigatePrevious={() => navigateToPage(focusedPage - 1)}
              onOpenSearch={openSearch}
              onToggleMarginCommentConnectors={() => {
                setMarginCommentConnectorsVisible((current) => !current);
              }}
              onToggleMarginComments={() => setMarginCommentsVisible((current) => !current)}
              onToggleTextBoxTool={() => {
                setTextBoxToolActive((current) => !current);
                setActiveTextAnnotationId(null);
                setSelection(null);
                setSelectionPreview(null);
              }}
              onToggleWhiteboard={() => setWhiteboardOpen((current) => !current)}
              onZoomIn={() => onZoomChange?.(Math.min(180, zoom + 5))}
              onZoomOut={() => onZoomChange?.(Math.max(70, zoom - 5))}
              pageCount={pageCount}
              parserStatus={(
                <>
                  {citationParsing.loading ? (
                    <span role="status">正在提取结构化引用…</span>
                  ) : citationParsing.parser === "grobid" ? (
                    <span role="note">结构化引用已就绪</span>
                  ) : null}
                  {citationParsing.warning ? <span role="status">{citationParsing.warning}</span> : null}
                </>
              )}
              searchOpen={searchOpen}
              searchQuery={searchQuery}
              searchResultCount={searchMatches.length}
              textBoxToolActive={textBoxToolActive}
              wholeWords={searchWholeWords}
              zoom={zoom}
            />
            {targetEvidence?.paperId === activePaper?.id ? (
              <div aria-live="polite" className="pdf-evidence-status" role="status">
                {status}
              </div>
            ) : null}
          </div>
          <div
            aria-label="PDF 页面滚动区"
            className={`pdf-stage ${textBoxToolActive ? "text-box-tool-active" : ""}`}
            onContextMenu={handleSelectionContextMenu}
            onCopy={handleStageCopy}
            onMouseUp={handleTextSelection}
            onPointerCancel={handleSelectionPointerCancel}
            onPointerDown={handleSelectionPointerDown}
            onPointerMove={handleSelectionPointerMove}
            onPointerUp={handleSelectionPointerUp}
            onKeyDown={handleStageKeyDown}
            onScroll={handleStageScroll}
            ref={stageRef}
            tabIndex={0}
          >
            {documentHasNoTextLayer ? (
              <p className="pdf-page-text-unavailable" role="note">
                本篇没有可用文本层，无法按字符定位。完成 OCR 后才能选中正文与定位证据。
              </p>
            ) : null}
            <div className="pdf-document-frame" ref={documentFrameRef}>
              <div
                aria-label="PDF.js 页面列表"
                className={`pdf-page-list responsive layout-${layoutMode} ${
                  hasVisibleMarginComments ? "with-margin-comments" : ""
                }`}
              >
                {pageNumbers.map((pageNumber) => (
                  <PdfPageView
                    activeSearchMatch={activeSearchMatch}
                    activeTextAnnotationId={activeTextAnnotationId}
                    activePaper={activePaper}
                    annotations={annotations}
                    focused={pageNumber === focusedPage}
                    key={pageNumber}
                    layoutVisible={visiblePageNumbers.has(pageNumber)}
                    marginCommentConnectorsVisible={marginCommentConnectorsVisible}
                    marginCommentsVisible={marginCommentsVisible}
                    noTextLayer={scannedPages.has(pageNumber)}
                    onEvidenceHighlightResolved={handleEvidenceHighlightResolved}
                    onAnnotationActivate={openPageAnnotationEditor}
                    onPageCharModelRendered={handlePageCharModelRendered}
                    onPageTextRendered={handlePageTextRendered}
                    onTextAnnotationActivate={setActiveTextAnnotationId}
                    onTextAnnotationCommit={commitTextAnnotation}
                    onTextAnnotationDelete={(annotation) => void deleteAnnotation(annotation)}
                    onTextAnnotationMove={moveTextAnnotation}
                    onTextAnnotationOpacityChange={changeTextAnnotationOpacity}
                    pageNumber={pageNumber}
                    pdfDocument={pdfDocument}
                    searchMatches={searchOpen
                      ? searchMatches.filter((match) => match.page === pageNumber)
                      : undefined}
                    searchQuery={searchOpen ? searchQuery : undefined}
                    selectionPreviewRects={selectionPreview?.page === pageNumber
                      ? selectionPreview.rects
                      : undefined}
                    stageWidth={resolvePdfPageStageWidth(
                      stageWidth,
                      layoutMode,
                      hasVisibleMarginComments
                    )}
                    targetEvidence={targetEvidence}
                    zoom={zoom}
                  />
                ))}
              </div>
            </div>
            {selection ? (
              <div
                aria-label="选中文本批注菜单"
                className={`pdf-selection-menu is-${selection.menuPlacement}`}
                style={{ left: selection.menuLeft, top: selection.menuTop }}
              >
                <div className="selection-menu-row">
                  <button onClick={() => addAnnotation("highlight")} title="高亮选中文段" type="button">
                    高亮
                  </button>
                  <div className="color-selector">
                    {(["yellow", "red", "blue", "green", "pink"] as HighlightColor[]).map((color) => (
                      <button
                        key={color}
                        className={`color-option ${selectedColor === color ? "active" : ""}`}
                        style={{ backgroundColor: getHighlightColor(color) }}
                        onClick={() => setSelectedColor(color)}
                        title={`选择${color === "yellow" ? "黄色" : color === "red" ? "红色" : color === "blue" ? "蓝色" : color === "green" ? "绿色" : "粉色"}高亮`}
                        type="button"
                      />
                    ))}
                  </div>
                </div>
                <div className="selection-menu-row">
                  <button onClick={() => void copySelectedText()} title="复制选中的 PDF 内容" type="button">
                    <CopyRegular aria-hidden="true" />
                    复制
                  </button>
                </div>
                <div className="selection-menu-row">
                  <button
                    draggable
                    onClick={addSelectionToWhiteboard}
                    onDragStart={handleSelectionWhiteboardDragStart}
                    title="点击直接加入，或拖到右侧白板的指定位置"
                    type="button"
                  >
                    <WhiteboardRegular aria-hidden="true" />
                    加入白板
                  </button>
                </div>
                <div className="selection-menu-row">
                  <button onClick={() => addAnnotation("underline")} title="给选中文段添加下划线" type="button">
                    划线
                  </button>
                </div>
                {onQuickAsk ? <div className="selection-menu-row">
                  <button type="button" title="结合当前页和摘要提问" onClick={() => {
                    quickAskAbortRef.current?.abort(); quickAskAbortRef.current = null;
                    setQuickAskPending(false); setQuickAskSelection(selection); setQuickAskQuestion("");
                    setQuickAskError(""); setSelection(null); setSelectionPreview(null); clearBrowserSelection();
                    setAnnotationPopup(null);
                  }}>速问</button>
                </div> : null}
                <div className="selection-menu-row">
                  <button onClick={addSelectionToConversation} title="把选中文段加入右侧对话上下文" type="button" className="add-to-conversation">
                    加入对话
                  </button>
                </div>
              </div>
            ) : null}
            {quickAskSelection ? (
              <aside aria-label="速问" className="pdf-quick-ask-panel">
                <form onSubmit={(event) => { event.preventDefault(); void submitQuickAsk(); }}>
                  <header><strong>速问 · 第 {quickAskSelection.page} 页</strong></header>
                  <p className="pdf-annotation-excerpt">{quickAskSelection.excerpt}</p>
                  <textarea aria-label="速问问题" placeholder="想了解这段内容的什么？" autoFocus
                    value={quickAskQuestion} onChange={(event) => setQuickAskQuestion(event.target.value)}
                    disabled={quickAskPending} maxLength={4000} rows={3} />
                  <small>上下文：当前页全文与论文摘要</small>
                  {quickAskError ? <p role="alert">{quickAskError}</p> : null}
                  <div className="editor-actions">
                    <Button appearance="primary" type="submit" disabled={quickAskPending || !quickAskQuestion.trim() || hydratedAnnotationStorageKey !== annotationStorageKey}>
                      {quickAskPending ? "正在回答…" : "提问"}
                    </Button>
                    <Button type="button" onClick={() => {
                      quickAskAbortRef.current?.abort(); quickAskAbortRef.current = null;
                      setQuickAskPending(false); setQuickAskSelection(null);
                    }}>取消</Button>
                  </div>
                </form>
              </aside>
            ) : null}
            {annotationPopup && popupAnnotation ? (
              <aside
                aria-label={`${popupAnnotation.quickAsk ? "速问回答" : `${getAnnotationLabel(popupAnnotation.kind)}注释编辑器`}：${popupAnnotation.excerpt}`}
                className={`pdf-annotation-popover is-${annotationPopup.placement}`}
                onKeyDown={(event) => {
                  if (event.key === "Escape") cancelAnnotationEditing();
                }}
                style={{ left: annotationPopup.left, top: annotationPopup.top }}
              >
                <header>
                  <strong>{popupAnnotation.quickAsk ? "速问" : getAnnotationLabel(popupAnnotation.kind)} · 第 {popupAnnotation.page} 页</strong>
                  <button aria-label="关闭注释编辑器" onClick={cancelAnnotationEditing} type="button">×</button>
                </header>
                <p className="pdf-annotation-popover-excerpt">{popupAnnotation.excerpt}</p>
                {popupAnnotation.quickAsk ? <>
                  <strong>{popupAnnotation.quickAsk.question}</strong>
                  <PdfAnnotationMarkdown value={popupAnnotation.quickAsk.answer} />
                </> : <>
                <textarea
                  aria-label="页内批注内容"
                  autoFocus
                  maxLength={10_000}
                  onChange={(event) => setAnnotationNoteDraft(event.currentTarget.value)}
                  placeholder="添加注释，支持 Markdown..."
                  rows={4}
                  value={annotationNoteDraft}
                />
                <div aria-label="页内批注 Markdown 实时预览" aria-live="polite">
                  <PdfAnnotationMarkdown
                    value={annotationNoteDraft}
                  />
                </div>
                <div className="editor-actions">
                  <button className="save-button" onClick={saveAnnotationNote} type="button">保存注释</button>
                  <button className="cancel-button" onClick={cancelAnnotationEditing} type="button">取消</button>
                </div>
                </>}
              </aside>
            ) : null}
          </div>
        </section>
        {whiteboardOpen && activePaper ? (
          <PdfWhiteboard
            document={whiteboardState.storageKey === whiteboardStorageKey
              ? whiteboardState.document
              : createEmptyPdfWhiteboard(activePaper.id)}
            key={whiteboardStorageKey ?? activePaper.id}
            onChange={updateWhiteboardDocument}
            onClose={() => setWhiteboardOpen(false)}
            paperTitle={activePaper.title}
          />
        ) : null}
      </div>
    </section>
  );
}
