import type { QuickAskTransferInput, QuickAskTransferResult } from "./quickAskTransfer";
import { highlightSearchText } from "../search/searchDomHighlight";
import { SearchHighlight, SearchOptions } from "../search/SearchOptions";
import { noteLabels } from "../notes/noteLabels";
import { comparePdfAnnotations, type PdfAnnotationSort } from "./pdfAnnotationSort";
import { navigatePdfAnnotationList } from "./pdfAnnotationNavigation";
import { PdfAnnotationDeleteDialog } from "./PdfAnnotationDeleteDialog";
import { PdfAnnotationSortPicker } from "./PdfAnnotationSortPicker";
import { PdfAnnotationFilters, emptyPdfAnnotationFacets, matchesPdfAnnotationFacets } from "./PdfAnnotationFilters";
import { compilePdfAnnotationQuery, teamPdfAnnotation } from "./pdfAnnotationQuery";
import { usePaperSearchMetadata } from "../search/usePaperSearchMetadata";
import { NoteLabelFilter, emptyNoteFilter, matchesNoteFilter } from "../notes/NoteLabelFilter";
import { annotationNoteLabels } from "../notes/noteLabels";
import { paperSourceReferences } from "../resource-filesystem/assetSourceReferences";
import { applyPdfReadingColors, pdfReadingPalette } from "./pdfReadingColors";
import { PdfAppearanceControl, type PdfAppearance } from "./PdfAppearanceControl";
import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { ReaderExtensionActions } from "../extensions/ReaderExtensionActions";
import { PaperSelectionTools } from "./PaperSelectionTools";
import { PdfSelectionMenu } from "./PdfSelectionMenu";
import { resolveReadingQuoteRects } from "./readingAnnotationGeometry";
import type { ReadingMarkStyle } from "./pdfReadingAnnotations";
import { pdfCanvasSize } from "./pdfRenderBudget";
import { usePdfPageWindow } from "./usePdfPageWindow";
import { usePdfViewportAnchor } from "./usePdfViewportAnchor";
import { schedulePdfPageRender } from "./pdfPageRenderQueue";
import { pdfReaderContentRevision } from "./pdfReaderPosition";
import { usePdfReaderFeedback } from "./usePdfReaderFeedback";
import { usePdfReaderPosition } from "./usePdfReaderPosition";
import { getHighlightColor, getOverlayStyle, pdfAnnotationColorLabels } from "./pdfAnnotationAppearance";
import { CheckmarkRegular, DrawShapeRegular, EraserRegular, ArrowUndoRegular } from "@fluentui/react-icons";
import { PdfInkLayer } from "./PdfInkLayer";
import { canGroupPdfInkStroke, pdfInkGroupBounds, pdfInkStrokes, type PdfInkMode, type PdfInkStroke } from "./pdfInk";
import { PdfPaneResizeHandle } from "./PdfPaneResizeHandle";
import { GenerationPromptDialog } from "../ai-prompts/GenerationPromptDialog";
import { GenerationPromptEditor } from "../ai-prompts/GenerationPromptEditor";
import { type PdfQuickAskRequest, type QuickAskGenerationReceipt, type QuickAskContextSnapshot } from "./pdfQuickAsk";
import { preparePdfQuickAskContext } from "./quickAskContext";
import { useQuickAskTask } from "./useQuickAskTask";
import { QuickAskProvenance } from "./QuickAskProvenance";
import { QuickAskSurface } from "./QuickAskSurface";
import { ResponsiveOverlay, DisclosureSection, InfoPopover, IconAction, InlineNotice, ActionButton } from "../../shared/ui/productPrimitives";
import { resolveLocalAccountKey } from "../library/localAccountKey";
import { useQuickAskPresets } from "../quick-ask-presets/useQuickAskPresets";
import { QuickAskPresetPicker } from "../quick-ask-presets/QuickAskPresetPicker";
import { QuickAskPresetManager } from "../quick-ask-presets/QuickAskPresetManager";
import { resolveQuickAskInstruction, quickAskPrimaryAction } from "../quick-ask-presets/quickAskPresets";
import { readerContextDragMime } from "../assistant/readerContextDrag";
import { LiteratureGuideControls } from "../paper-reading/LiteratureGuideControls";
import { useLiteratureGuide } from "../paper-reading/useLiteratureGuide";
import type { GuideGenerator } from "../paper-reading/literatureGuide";
import { guideCategories } from "../paper-reading/literatureGuide.types";
import { isUntouchedGuide, mergePdfGuides } from "./pdfGuideAnnotations";
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
import { Button, Checkbox, Input, Popover, PopoverTrigger, PopoverSurface, Tooltip } from "@fluentui/react-components";
import { useObjectWorkbench } from "../objects/objectWorkbenchPort";
import {
  SearchRegular,
  ChatHelpRegular,
  SparkleRegular,
  ArrowClockwiseRegular,
  GlobeRegular,
  LocationRegular,
  ChevronUpRegular,
  CommentRegular,
  DismissRegular,
  DragRegular,
  CopyRegular,
  DeleteRegular,
  DocumentRegular,
  TextBulletListLtrRegular,
  EditRegular,
  HighlightRegular,
  PanelLeftContractRegular,
  PanelLeftExpandRegular,
  ShareRegular,
  SettingsRegular,
  TextFieldRegular,
  TextUnderlineRegular,
  WhiteboardRegular
} from "@fluentui/react-icons";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { clearPdfPageData, loadPdfPageText, loadPdfPageGlyphs } from "./pdfPageData";
import { usePdfPixelRatio } from "./usePdfPixelRatio";
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { compactPdfTextForSearch, normalizePdfTextForSearch } from "./pdfTextSearch";
import { joinPdfTextItems, normalizePdfPageText } from "./pdfTextItems";
import { ensureReadableStreamAsyncIterator } from "./pdfStreamCompatibility";
import type { Paper } from "../workspace/workspace.types";
import type { ReaderConversationContext } from "../assistant/assistantContext.types";
import {
  loadPdfAnnotationBrowserMigrationState,
  loadPdfAnnotationAutoPublic,
  loadPdfAnnotations,
  recoverPdfAnnotationPrivateState,
  pdfAnnotationAutoPublicStorageKey,
  pdfAnnotationStorageKey,
  savePdfAnnotationAutoPublic,
  revisePdfAnnotation,
  type PdfAnnotation,
  type PdfAnnotationKind,
  type PdfAnnotationReview as PdfAnnotationReviewValue,
  type PdfAnnotationPublication,
  type PdfAnnotationRect,
  type PdfAnnotationV2,
  pdfHighlightColors,
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
import { PdfAnnotationEditor } from "./PdfAnnotationEditor";
import { PdfAnnotationStatus } from "./PdfAnnotationStatus";
import { PdfAnnotationReview } from "./PdfAnnotationReview";
import { usePdfAnnotationReview } from "./usePdfAnnotationReview";
import { PaperReviewShareControl, PaperReviewShareStatus, usePaperReviewShare } from "./PaperReviewSharePanel";
import { persistPdfAnnotationState } from "./pdfAnnotationPersistence";
import { readingQuoteRects, type PdfReadingAnnotations } from "./pdfReadingAnnotations";
import { SelectionLookupCard } from "../selection-lookup/SelectionLookupCard";
import { selectionLookupContext } from "../selection-lookup/selectionLookupText";
import type { SelectionLookupPort } from "../selection-lookup/selectionLookup.types";
import "./pdfAnnotationList.css";
import { PdfInternalLinks } from "./PdfInternalLinks";
import type { PdfBookmarkTarget } from "./pdfBookmarkDestination";
import { PdfOutline } from "./PdfOutline";
import { PdfThumbnail } from "./PdfThumbnail";
import { PdfPagesOverview } from "./PdfPagesOverview";
import { PdfAnnotationsOverview } from "./PdfAnnotationsOverview";
import "./pdfNavigationViews.css";
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
  sourcePages?: number[];
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

type PdfSidebarMode = "thumbnails" | "annotations" | "outline";
type PdfReaderView = "document" | "pages" | "annotations";

const pdfPageLayoutStorageKey = "liteasy:pdf-reader:page-layout";
const pdfMarginCommentsStorageKey = "liteasy:pdf-reader:margin-comments";
const pdfMarginCommentConnectorsStorageKey = "liteasy:pdf-reader:margin-comment-connectors";
const pdfWhiteboardVisibleStorageKey = "liteasy:pdf-reader:whiteboard-visible";

export type PdfAnnotationPublicationChange = {
  annotation: PdfAnnotationV2;
  literatureHints?: ReturnType<typeof createPdfLiteratureHints>;
  operation: "publish" | "update" | "retract";
  paper: Paper;
  newPublication?: true;
  resumePublication?: true;
  onPreparedPublication?: (publication: PdfAnnotationPublication) => Promise<void>;
  restartReplay?: true;
};

type PdfReaderProps = {
  selectionLookup?: SelectionLookupPort;
  onDocumentInfo?: (info: import("./pdfDocumentInfo").PdfDocumentInfo) => void;
  onQuickAsk?: (request: PdfQuickAskRequest) => Promise<string>;
  onQuickAskTransfer?: (input: QuickAskTransferInput) => Promise<QuickAskTransferResult>;
  onGenerateGuide?: GuideGenerator;
  readingControls?: ReactNode;
  readingView?: (annotations: PdfReadingAnnotations) => ReactNode;
  onEnterReadingMode?: () => void;
  onExitReadingMode?: () => void;
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
  pdfAppearance?: PdfAppearance;
  onPdfAppearanceChange?: (value: PdfAppearance) => void;
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
  sourceRects?: Array<{ x: number; y: number; width: number; height: number }>;
  documentHash?: string;
  pageOnly?: boolean;
  searchAnnotation?: { id: string; quote: string };
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
  if (publication.state === "failed" && publication.outcome === "unknown") {
    return `${publication.desiredVisibility === "private" ? "撤回" : "发布"}结果待核实${publication.lastError ? `：${publication.lastError}` : ""}`;
  }
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
  if (kind === "ink") return "手绘";
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

function getAnnotationIcon(annotation: PdfAnnotationV2) {
  if (annotation.quickAsk) return <ChatHelpRegular />;
  switch (annotation.kind) {
    case "highlight": return <HighlightRegular />;
    case "underline": return <TextUnderlineRegular />;
    case "text": return <TextFieldRegular />;
    case "ink": return <DrawShapeRegular />;
    default: return <CommentRegular />;
  }
}

function getAnnotationSummaryText(annotation: PdfAnnotationV2) {
  if (annotation.kind !== "text" && annotation.kind !== "ink") return annotation.excerpt;
  // These annotations have generated excerpts; show their content instead of repeating the type.
  const note = annotation.note?.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim();
  return annotation.kind === "ink"
    ? note || `${pdfInkStrokes(annotation).length} 笔`
    : note || "空白笔记";
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
      return getHighlightColor(color);
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
  const startElement = range.startContainer instanceof Element ? range.startContainer : range.startContainer?.parentElement;
  const pageElement = getSelectionPageElement(range, stageElement) ??
    (startElement?.closest(".pdf-text-layer") && stageElement.contains(startElement) ? startElement.closest<HTMLElement>(".pdf-page-shell") : null);
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
    sourcePages: Array.from(stageElement.querySelectorAll<HTMLElement>(".pdf-page-shell")).filter(element => {
      const text = element.querySelector(".pdf-text-layer");
      return text && (typeof range.intersectsNode === "function" ? range.intersectsNode(text) : element === pageElement);
    }).map(element => Number(element.dataset.page)).filter(page => Number.isInteger(page) && page > 0),
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
  return Math.max(360, layoutColumnWidth - (marginCommentsVisible ? 228 : 0));
}

function getScaleForStage(baseViewport: Pick<PageViewport, "width">, stageWidth: number, zoom: number) {
  const availableWidth = Math.max(300, stageWidth - 6);
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
  const endX = input.pageWidth + 8;
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
  inkMode?: PdfInkMode;
  inkColor?: string;
  inkWidth?: number;
  onInkCreate?: (page: number, stroke: PdfInkStroke) => void;
  onInkDeleteStroke?: (annotation: PdfAnnotationV2, strokeIndex: number) => void;
  onAnnotationDrag?: (annotation: PdfAnnotationV2, dataTransfer: DataTransfer) => void;
  activeTextAnnotationId?: string | null;
  onTextAnnotationActivate?: (annotationId: string) => void;
  onTextAnnotationCommit?: (
    annotationId: string,
    markdown: string,
    rect: PdfAnnotationRect,
    images?: PdfAnnotationV2["images"]
  ) => void;
  onTextAnnotationDelete?: (annotation: PdfAnnotationV2) => void;
  onTextAnnotationMove?: (annotationId: string, rect: PdfAnnotationRect, manualSize?: boolean) => void;
  onTextAnnotationOpacityChange?: (annotationId: string, opacity: number) => void;
  marginCommentConnectorsVisible?: boolean;
  marginCommentsVisible?: boolean;
  onEvidenceHighlightResolved?: (matched: boolean) => void;
  onPageCharModelRendered?: (pageNumber: number, model: PageCharModel | null) => void;
  onPageTextRendered?: (input: PdfPageText) => void;
  pageNumber: number;
  renderActive: boolean;
  renderPriority?: number;
  defaultPageSize: { width: number; height: number };
  pixelRatio: number;
  readingBackground: string;
  preserveImages: boolean;
  pdfDocument: PDFDocumentProxy | null;
  onInternalNavigate: (target: PdfBookmarkTarget) => void;
  linksEnabled: boolean;
  searchMatches?: PdfReaderSearchMatch[];
  searchQuery?: string;
  selectionPreviewRects?: PdfAnnotationRect[];
  stageWidth: number;
  targetEvidence?: PdfEvidenceTarget | null;
  zoom: number;
};

export function PdfPageView({
  activeSearchMatch,
  inkMode = null, inkColor = "#1b66b3", inkWidth = .3, onInkCreate, onInkDeleteStroke, onAnnotationDrag,
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
  renderActive,
  renderPriority = 0,
  defaultPageSize,
  pixelRatio, readingBackground, preserveImages,
  pdfDocument,
  onInternalNavigate, linksEnabled,
  searchMatches = [],
  searchQuery = "",
  selectionPreviewRects = [],
  stageWidth,
  targetEvidence,
  zoom
}: PdfPageViewProps) {
  const [nativeCharModel, setNativeCharModel] = useState<PageCharModel>();
  const [pageStageMessage, setPageStageMessage] = useState("");
  const selecting = useRef(false);
  const pendingRefinement = useRef<(() => void) | undefined>();
  useEffect(() => {
    let frame = 0;
    const finish = () => { selecting.current = false; cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (selecting.current) return; const refine = pendingRefinement.current; pendingRefinement.current = undefined; refine?.(); }); };
    window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", finish);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish); pendingRefinement.current = undefined; };
  }, []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageShellRef = useRef<HTMLElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [measuredPage, setMeasuredPage] = useState<{ document: PDFDocumentProxy; width: number; height: number }>();
  const basePageSize = measuredPage?.document === pdfDocument ? measuredPage : defaultPageSize;
  const pageScale = getScaleForStage(basePageSize, stageWidth, zoom);
  const dimensions = pdfCanvasSize(basePageSize.width * pageScale, basePageSize.height * pageScale, pixelRatio);
  const pageSize = { height: dimensions.height / dimensions.ratio, width: dimensions.width / dimensions.ratio };
  const [textLayerRevision, setTextLayerRevision] = useState(0);
  const [searchHighlightRects, setSearchHighlightRects] = useState<Array<{
    active: boolean;
    rect: PdfAnnotationRect;
  }>>([]);
  const [targetHighlightRects, setTargetHighlightRects] = useState<PdfAnnotationRect[]>([]);

  function updateTargetHighlightRects() {
    const textLayer = textLayerRef.current;
    const pageElement = pageShellRef.current;
    if (focused && targetEvidence && targetEvidence.paperId === activePaper?.id && targetEvidence.page === pageNumber && (targetEvidence.sourceRects?.length || targetEvidence.pageOnly)) {
      const rects = targetEvidence.sourceRects?.map((rect) => ({ left: rect.x, top: rect.y, width: rect.width, height: rect.height })) ?? [];
      setTargetHighlightRects(rects); onEvidenceHighlightResolved?.(rects.length > 0); return;
    }
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
      const range = findQuoteRangeInTextLayer(textLayer, match.quote ?? searchQuery, match.start);
      if (!range) return [];
      const active = match === activeSearchMatch;
      return buildAnnotationRects(range, getElementContentRect(pageElement)).map((rect) => ({
        active,
        rect
      }));
    });
    setSearchHighlightRects(rects);
  }

  const renderJob = useRef<ReturnType<typeof schedulePdfPageRender>>();
  useEffect(() => { renderJob.current?.setPriority(renderPriority); }, [renderPriority]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    let layer: InstanceType<typeof pdfjsLib.TextLayer> | null = null;
    let renderedPage: PDFPageProxy | undefined;
    const ownedCanvas = canvasRef.current;
    const ownedTextLayer = textLayerRef.current;

    async function renderPage() {
      if (!pdfDocument || !renderActive) {
        clearPdfCanvas(canvasRef.current);
        if (textLayerRef.current) {
          textLayerRef.current.replaceChildren();
        }
        setSearchHighlightRects([]);
        setTargetHighlightRects([]);
        setNativeCharModel(undefined);
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

      setPageStageMessage("");
      try {
        const page: PDFPageProxy = await pdfDocument.getPage(pageNumber);
        if (cancelled) {
          return;
        }

        renderedPage = page;
        const baseViewport = page.getViewport({ scale: 1 });
        setMeasuredPage({ document: pdfDocument, width: baseViewport.width, height: baseViewport.height });
        const viewport = page.getViewport({
          scale: getScaleForStage(baseViewport, stageWidth, zoom)
        });
        const context = getCanvasContext(canvas);
        const output = pdfCanvasSize(viewport.width, viewport.height, pixelRatio);
        canvas.width = output.width;
        canvas.height = output.height;
        // Present each rendered pixel at one screen pixel. Keep CSS sizes tied to
        // that pixel grid so layout constraints cannot resample the finished page.
        const width = canvas.width / output.ratio;
        const height = canvas.height / output.ratio;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        textLayer.style.width = `${viewport.width}px`;
        textLayer.style.height = `${viewport.height}px`;
        textLayer.style.setProperty("--total-scale-factor", String(viewport.scale));

        if (context) {
          renderTask = page.render({ canvas, canvasContext: context, viewport,
            recordImages: preserveImages && readingBackground !== "#ffffff",
            transform: [output.ratio, 0, 0, output.ratio, 0, 0] });
          await renderTask.promise;
          if (!cancelled) {
            try { await applyPdfReadingColors(context, readingBackground, preserveImages ? page.imageCoordinates : null, () => cancelled); }
            catch { if (!cancelled) setPageStageMessage("阅读配色暂不可用，已保留原始页面。"); }
          }
        }

        if (cancelled) {
          return;
        }

        try {
        textLayer.innerHTML = "";
        const textContent = await loadPdfPageText(pdfDocument, pageNumber, page);
        if (cancelled) return;
        layer = new pdfjsLib.TextLayer({
          container: textLayer,
          textContentSource: textContent,
          viewport
        });
        await layer.render();
        if (!cancelled) {
          const pageElement = pageShellRef.current;
          if (pageElement) {
            const install = (glyphs: Awaited<ReturnType<typeof loadPdfPageGlyphs>>) => {
              if (cancelled) return;
              const model = buildPageCharModelFromTextLayer({ glyphs, pageElement, pageIndex: pageNumber, textLayer });
              setNativeCharModel(model); onPageCharModelRendered?.(pageNumber, model);
            };
            // Native DOM selection is ready before the optional operator-list pass.
            install([]);
            void loadPdfPageGlyphs(pdfDocument, pageNumber, page).then(glyphs => {
              if (cancelled || !glyphs.length) return;
              if (selecting.current) pendingRefinement.current = () => install(glyphs);
              else install(glyphs);
            }).catch(() => { /* The DOM model remains usable. */ });
          }
          onPageTextRendered?.({
            page: pageNumber,
            text: normalizePdfPageText(joinPdfTextItems(textContent.items))
          });
          // Re-evaluate overlays with the latest search/evidence props, even if they changed
          // while this render was awaiting PDF.js. They need no new canvas or character model.
          setTextLayerRevision((revision) => revision + 1);
        }
        } catch {
          if (!cancelled) {
            textLayer.replaceChildren(); setNativeCharModel(undefined);
            onPageCharModelRendered?.(pageNumber, null);
            setPageStageMessage("本页文字层暂不可用，仍可阅读并使用区域批注。");
          }
        }
      } catch (error) {
        // A cancelled zoom/DPI render must not clear the newer render's shared canvas.
        if (cancelled) return;
        // Swallowing this silently hid a total failure of the text layer, and with it every
        // anchor, for as long as it took someone to inspect the DOM. A page that cannot render
        // is worth saying out loud.
        if (!cancelled) {
          console.error(`PDF 第 ${pageNumber} 页渲染失败`, error);
        }
        setPageStageMessage("本页暂时无法绘制，请重新打开文献后重试。");
        clearPdfCanvas(canvasRef.current);
        textLayerRef.current?.replaceChildren();
        setTargetHighlightRects([]);
        onPageCharModelRendered?.(pageNumber, null);
        if (focused && targetEvidence?.paperId === activePaper?.id) {
          onEvidenceHighlightResolved?.(false);
        }
      }
    }

    const job = pdfDocument && renderActive ? schedulePdfPageRender(pdfDocument, renderPriority, renderPage) : undefined;
    renderJob.current = job;
    if (!job) void renderPage();

    return () => {
      cancelled = true;
      job?.cancel();
      if (renderJob.current === job) renderJob.current = undefined;
      pendingRefinement.current = undefined;
      renderTask?.cancel();
      layer?.cancel();
      clearPdfCanvas(ownedCanvas);
      ownedTextLayer?.replaceChildren();
      if (renderedPage) {
        renderedPage.cleanup();
      }
      onPageCharModelRendered?.(pageNumber, null);
    };
  // Focus changes while scrolling must not tear down the text layer in the middle of a drag.
  // Evidence/search overlays have their own effects below and do not require repainting the PDF.
  }, [activePaper?.id, onPageCharModelRendered, onPageTextRendered, pageNumber, pixelRatio, pdfDocument, renderActive, stageWidth, zoom, readingBackground, preserveImages]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateTargetHighlightRects);
    return () => window.cancelAnimationFrame(frame);
  }, [activePaper?.id, focused, pageNumber, pageSize.height, pageSize.width, targetEvidence?.pageTextStart, targetEvidence?.quote, targetEvidence?.requestId, textLayerRevision]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateSearchHighlightRects);
    return () => window.cancelAnimationFrame(frame);
  }, [activeSearchMatch, pageNumber, pageSize.height, pageSize.width, searchMatches, searchQuery, textLayerRevision]);

  // Re-anchor existing AI marks from their complete source quote when a page is rendered.
  // This also repairs previously saved partial geometry without changing notes or revisions.
  const pageAnnotations = useMemo(() => annotations.filter((annotation) => annotation.page === pageNumber).map((annotation) => {
    if (!annotation.aiGuide || !renderActive) return annotation;
    const rects = readingQuoteRects(nativeCharModel, annotation.excerpt);
    return rects.length ? { ...annotation, rects } : annotation;
  }), [annotations, pageNumber, nativeCharModel, renderActive]);
  const marginComments = marginCommentsVisible ? layoutPdfMarginComments(pageAnnotations) : [];

  return (
    <div
      className={`pdf-page-row ${layoutVisible ? "layout-visible" : ""} ${
        marginCommentsVisible ? "has-margin-comments" : ""
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
        onPointerDownCapture={() => { selecting.current = true; }}
        style={{ minHeight: pageSize.height, width: pageSize.width }}
      >
        <canvas aria-label={`PDF.js 页面画布 ${pageNumber}`} className="pdf-page-canvas" ref={canvasRef} />
        {pageStageMessage ? <span className="pdf-page-stage-message" role="status">{pageStageMessage}</span> : null}
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
        {pdfDocument && renderActive && linksEnabled ? <PdfInternalLinks
          document={pdfDocument} pageNumber={pageNumber} onNavigate={onInternalNavigate} /> : null}
        <div aria-label={pageNumber === 1 ? "PDF 批注覆盖层" : undefined} className="pdf-annotation-overlay">
        {onInkCreate && onTextAnnotationDelete ? <PdfInkLayer
          annotations={pageAnnotations.filter((annotation) => annotation.kind === "ink")}
          mode={inkMode} color={inkColor} width={inkWidth} aspectRatio={basePageSize.height / basePageSize.width}
          onCreate={(stroke) => onInkCreate(pageNumber, stroke)} onDelete={onTextAnnotationDelete} onDeleteStroke={onInkDeleteStroke} /> : null}
        {pageAnnotations.filter((annotation) => annotation.kind !== "ink").map((annotation) => annotation.kind === "text" ? (
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
              onDragToBoard={onAnnotationDrag ? (annotation, data) => onAnnotationDrag(annotation, data) : undefined}
              rect={annotation.rects[0]}
            />
          ) : null
        ) : annotation.rects.map((rect, index) => (
            <button
              aria-label={`${annotation.aiGuide ? "AI 讲解" : (annotation.quickAsk ? "速问" : getOverlayLabel(annotation.kind))}：第 ${annotation.page} 页：${annotation.excerpt}`}
              className={`pdf-overlay-mark ${annotation.kind} ${annotation.quickAsk ? "quick-ask" : ""} ${annotation.aiGuide ? "ai-guide" : ""}`}
              draggable={Boolean(onAnnotationDrag) || annotation.kind === "highlight" || annotation.kind === "underline"}
              onDragStart={(event) => {
                if (!activePaper) { event.preventDefault(); return; }
                event.stopPropagation();
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData(readerContextDragMime, JSON.stringify({
                  excerpt: annotation.excerpt, page: annotation.page,
                  paperId: activePaper.id, paperTitle: activePaper.title, source: "pdf_selection"
                } satisfies ReaderConversationContext));
                event.dataTransfer.setData("text/plain", annotation.excerpt);
                onAnnotationDrag?.(annotation, event.dataTransfer);
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
                annotation.color
              ), ...(annotation.quickAsk || annotation.aiGuide ? { borderBottomStyle: "dashed" } : {}) }}
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

export function PdfReader({
  selectionLookup,
  onDocumentInfo,
  readingControls,
  readingView, onEnterReadingMode, onExitReadingMode,
  allowServerPdfParsing = false,
  externalKnowledgeEndpoint = "",
  loadLiteratureHints = collectPdfLiteratureHints,
  loadLiteratureRelations,
  loadPdfSource,
  onAcquireLiteratureVersion,
  onOpenLiteratureVersion,
  pdfBackground = "#ffffff", pdfAppearance, onPdfAppearanceChange,
  onPaperAnnotated,
  selectedPapers,
  targetEvidence,
  zoom,
  onZoomChange,
  onQuickAsk,
  onQuickAskTransfer,
  onGenerateGuide,
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
  const pixelRatio = usePdfPixelRatio();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const documentFrameRef = useRef<HTMLDivElement | null>(null);
  const objectWorkbench = useObjectWorkbench();
  const pageCharModelsRef = useRef(new Map<number, PageCharModel>());
  const dragSelectionRef = useRef<PdfDragSelection | null>(null);
  const [documentFrameWidth, setDocumentFrameWidth] = useState(0);
  const [annotations, setAnnotations] = useState<PdfAnnotationV2[]>([]);
  const annotationsRef = useRef<PdfAnnotationV2[]>([]);
  annotationsRef.current = annotations;
  const onPaperAnnotatedRef = useRef(onPaperAnnotated);
  onPaperAnnotatedRef.current = onPaperAnnotated;
  const [selectedColor, setSelectedColor] = useState<HighlightColor>("yellow");
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [defaultPageSize, setDefaultPageSize] = useState({ width: 760, height: 980 });
  const documentInfoSource = useRef<{ paperId?: string; sourcePath?: string; contentHash?: string; document?: PDFDocumentProxy }>({});
  const [pageCount, setPageCount] = useState(1);
  const [focusedPage, setFocusedPage] = useState(1);
  const [pageOffset, setPageOffset] = useState<{ page: number; topRatio: number }>();
  const loadedPositionDocument = pdfDocument && documentInfoSource.current.document === pdfDocument &&
    documentInfoSource.current.paperId === activePaper?.id && documentInfoSource.current.sourcePath === activePaper?.sourcePath &&
    documentInfoSource.current.contentHash === activePaper?.contentHash ? pdfDocument : null;
  const readerPosition = usePdfReaderPosition({
    scopeId: objectWorkbench?.scopeId, paperId: activePaper?.id, sourcePath: activePaper?.sourcePath,
    document: loadedPositionDocument,
    contentRevision: loadedPositionDocument ? pdfReaderContentRevision(activePaper?.contentHash, loadedPositionDocument.fingerprints) : null,
    pageCount, page: focusedPage, topRatio: pageOffset?.page === focusedPage ? pageOffset.topRatio : undefined, hasNavigationTarget: targetEvidence?.paperId === activePaper?.id,
    restorePage: (page, stillCurrent, topRatio) => navigateToPage(page, "auto", topRatio, stillCurrent)
  });
  const [layoutMode, setLayoutMode] = useState<PdfPageLayoutMode>(loadPdfPageLayoutMode);
  const [marginCommentsVisible, setMarginCommentsVisible] = useState(loadPdfMarginCommentsVisible);
  const [marginCommentConnectorsVisible, setMarginCommentConnectorsVisible] = useState(
    loadPdfMarginCommentConnectorsVisible
  );
  const [legacyBoardPreview, setLegacyBoardPreview] = useState(false);
  const [whiteboardOpen, setWhiteboardOpen] = useState(loadPdfWhiteboardVisible);
  const [whiteboardWidth, setWhiteboardWidth] = useState(() => {
    try { return Math.max(220, Math.min(900, Number(localStorage.getItem("liteasy.pdf-whiteboard-width")) || 360)); }
    catch { return 360; }
  });
  useEffect(() => {
    try { localStorage.setItem("liteasy.pdf-whiteboard-width", String(whiteboardWidth)); } catch { /* Keep the current width. */ }
  }, [whiteboardWidth]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchCase, setSearchMatchCase] = useState(false);
  const [searchWholeWords, setSearchWholeWords] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try { return Math.max(160, Math.min(1600, Number(localStorage.getItem("liteasy.pdf-sidebar-width")) || 180)); }
    catch { return 180; }
  });
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [sidebarLimit, setSidebarLimit] = useState(480);
  const visibleSidebarWidth = Math.min(sidebarWidth, sidebarLimit);
  useEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;
    const measure = () => {
      if (element.clientWidth > 0) setSidebarLimit(Math.max(160, Math.floor(element.clientWidth * 0.7)));
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : undefined;
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  const sidebarResizeRef = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    try { localStorage.setItem("liteasy.pdf-sidebar-width", String(sidebarWidth)); } catch { /* Width remains usable. */ }
  }, [sidebarWidth]);
  const [readerView, setReaderView] = useState<PdfReaderView>("document");
  const readingScrollTop = useRef(0);
  const [annotationFilter, setAnnotationFilter] = useState(emptyNoteFilter);
  const [annotationQuery, setAnnotationQuery] = useState("");
  const [annotationFacets, setAnnotationFacets] = useState(emptyPdfAnnotationFacets);
  const [annotationSort, setAnnotationSort] = useState<PdfAnnotationSort>("reading");
  const [sidebarMode, setSidebarMode] = useState<PdfSidebarMode>("annotations");
  const [stageWidth, setStageWidth] = useState(960);
  const { status, setStatus, announcement, announceNavigation } = usePdfReaderFeedback();
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupMode, setLookupMode] = useState<"auto" | "explain">("auto");
  const [lookupDismissed, setLookupDismissed] = useState(false);
  useEffect(() => { setLookupOpen(false); setLookupDismissed(false); setLookupMode("auto"); }, [selection?.excerpt, selection?.page, activePaper?.id]);
  const quickAskAccount = objectWorkbench?.scopeId ?? resolveLocalAccountKey();
  const quickAskRevision = pdfReaderContentRevision(activePaper?.contentHash, loadedPositionDocument?.fingerprints) ?? "unresolved";
  const quickAskScope = `${quickAskAccount}\u0000${activePaper?.id ?? ""}\u0000${quickAskRevision}\u0000${JSON.stringify([activePaper?.sourcePath, activePaper?.libraryReference])}`;
  const quickAskScopeRef = useRef(quickAskScope);
  const quickAskGeneration = useRef(0);
  if (quickAskScopeRef.current !== quickAskScope) quickAskGeneration.current++;
  quickAskScopeRef.current = quickAskScope;
  const quickAskTask = useQuickAskTask<PdfSelection, PdfAnnotationV2>(quickAskScope);
  const quickAskSelection = quickAskTask.draft.selection;
  const quickAskQuestion = quickAskTask.draft.instruction;
  const quickAskPrompt = quickAskTask.draft.preference;
  const quickAskPending = quickAskTask.busy;
  const [quickAskContext, setQuickAskContext] = useState<QuickAskContextSnapshot>();
  const quickAskPresets = useQuickAskPresets({ scopeId: quickAskAccount });
  const [quickAskPresetManagerOpen, setQuickAskPresetManagerOpen] = useState(false);
  const [quickAskCustomDraft, setQuickAskCustomDraft] = useState("");
  const [reviewPromptId, setReviewPromptId] = useState<string>();

  const [selectionPreview, setSelectionPreview] = useState<PdfSelectionPreview | null>(null);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [activeTextAnnotationId, setActiveTextAnnotationId] = useState<string | null>(null);
  const [textBoxToolActive, setTextBoxToolActive] = useState(false);
  const [inkMode, setInkMode] = useState<PdfInkMode>(null);
  const [inkColor, setInkColor] = useState("#1b66b3");
  const [inkWidth, setInkWidth] = useState(.3);
  useEffect(() => {
    const stop = (event: KeyboardEvent) => { if (event.key === "Escape") setInkMode(null); };
    window.addEventListener("keydown", stop);
    return () => window.removeEventListener("keydown", stop);
  }, []);
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
  const searchMetadata = usePaperSearchMetadata(activePaper, objectWorkbench?.scopeId);
  const annotationStorageKey = pdfAnnotationStorageKey(activePaper);
  const annotationScopeRef = useRef(annotationStorageKey);
  annotationScopeRef.current = annotationStorageKey;
  const annotationMutationScope = useMemo(() => ({}), [annotationStorageKey, activePaper?.contentHash]);
  const annotationMutationScopeRef = useRef<object | null>(annotationMutationScope);
  annotationMutationScopeRef.current = annotationMutationScope;
  const deletionRunsRef = useRef(new Map<string, Promise<void>>());
  const [deletingAnnotationIds, setDeletingAnnotationIds] = useState<Set<string>>(() => new Set());
  const [annotationToDelete, setAnnotationToDelete] = useState<{ annotation: PdfAnnotationV2; scope: object; returnFocus: HTMLElement | null } | null>(null);
  const annotationMutationIsCurrent = () => annotationMutationScopeRef.current === annotationMutationScope;
  useEffect(() => {
    annotationMutationScopeRef.current = annotationMutationScope;
    publicationIntentsRef.current.clear();
    publicationTransportsRef.current.clear();
    replayedPublicationKeysRef.current.clear();
    deletionRunsRef.current.clear();
    setDeletingAnnotationIds(new Set());
    setAnnotationToDelete(null);
    return () => { annotationMutationScopeRef.current = null; };
  }, [annotationMutationScope]);
  const [readingAnnotationId, setReadingAnnotationId] = useState<string>();
  useEffect(() => {
    setReaderView("document");
    readingScrollTop.current = 0;
  }, [annotationStorageKey, pdfDisplaySource]);
  useEffect(() => { setQuickAskContext(undefined); setQuickAskPresetManagerOpen(false); }, [quickAskScope]);
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
  const [hydratedAnnotationSource, setHydratedAnnotationSource] = useState<{
    storageKey: string | null;
    contentHash?: string;
  } | null>(null);
  // A replacement at the same path must finish reading before its hash can be saved.
  const hydratedAnnotationStorageKey = hydratedAnnotationSource?.storageKey === annotationStorageKey &&
    hydratedAnnotationSource.contentHash === activePaper?.contentHash ? annotationStorageKey : null;
  const [annotationLoadError, setAnnotationLoadError] = useState("");
  const [annotationSaveError, setAnnotationSaveError] = useState("");
  const [annotationLoadAttempt, setAnnotationLoadAttempt] = useState(0);
  const fulltext = usePdfFulltextStore(activePaper?.id, activePaper?.contentHash);
  const annotationReview = usePdfAnnotationReview({
    scopeKey: annotationStorageKey,
    getAnnotation: (id) => annotationsRef.current.find((annotation) => annotation.id === id),
    request: async (annotation, signal, systemPrompt) => {
      if (!objectWorkbench?.reviewAnnotation) throw new Error("AI review 暂不可用。");
      return objectWorkbench.reviewAnnotation(annotationCaptureInput(annotation), signal, systemPrompt);
    },
    commit: saveAnnotationReview,
  });

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
  const renderedPages = usePdfPageWindow(stageRef, documentFrameRef, {
    enabled: !readingView && readerView === "document", document: pdfDocument,
    focusedPage, pageCount, layout: layoutMode, zoom, width: stageWidth,
    onVisiblePage: (page, topRatio) => {
      if (readerPosition.isRestoring()) return;
      if (page !== focusedPage || pageOffset?.page !== page || pageOffset.topRatio !== topRatio) {
        readerPosition.markNavigation(); setFocusedPage(page); setPageOffset({ page, topRatio });
      }
    }
  });
  const viewportAnchor = usePdfViewportAnchor(stageRef, documentFrameRef, {
    enabled: !readingView && readerView === "document", document: pdfDocument,
    focusedPage, layout: layoutMode, zoom, width: stageWidth
  });
  const hasVisibleMarginComments = marginCommentsVisible && annotations.some((annotation) =>
    (annotation.kind === "highlight" || annotation.kind === "underline") &&
    Boolean(annotation.note?.trim()) &&
    annotation.rects.length > 0
  );
  const searchMatches = useMemo(
    () => findPdfReaderSearchMatches(pageTexts, searchQuery, {
      matchCase: searchMatchCase,
      wholeWords: searchWholeWords, metadata: searchMetadata
    }),
    [pageTexts, searchMatchCase, searchQuery, searchWholeWords, searchMetadata]
  );
  const activeSearchMatch = activeSearchIndex >= 0 ? searchMatches[activeSearchIndex] : undefined;
  const annotationsInReadingOrder = useMemo(
    () => sortPdfAnnotationsByReadingOrder(annotations),
    [annotations]
  );
  const annotationSearch = useMemo(() => compilePdfAnnotationQuery(annotationQuery, searchMetadata), [annotationQuery, searchMetadata]);
  const sortedAnnotations = useMemo(() => [...annotations].sort((left, right) => comparePdfAnnotations(left, right, annotationSort)), [annotations, annotationSort]);
  const filteredAnnotations = sortedAnnotations.filter((annotation) =>
    matchesNoteFilter(annotationNoteLabels(annotation), annotationFilter) &&
    matchesPdfAnnotationFacets(annotation, annotationFacets) && annotationSearch.matches(annotation));
  const filteredTeamAnnotations = teamAnnotations.filter((team) => {
    if (!activePaper) return false;
    const annotation = teamPdfAnnotation(team, resolvePaperIdentity(activePaper));
    return matchesNoteFilter(annotationNoteLabels(annotation as PdfAnnotationV2), annotationFilter) &&
      matchesPdfAnnotationFacets(annotation, annotationFacets) && annotationSearch.matches(annotation, team.uploadedBy);
  }).sort((left, right) => comparePdfAnnotations(teamPdfAnnotation(left, resolvePaperIdentity(activePaper!)), teamPdfAnnotation(right, resolvePaperIdentity(activePaper!)), annotationSort));
  const activeAnnotationVisible = filteredAnnotations.some((annotation) => annotation.id === activeAnnotationId);
  useEffect(() => {
    if (!activeAnnotationId || !activeAnnotationVisible || sidebarCollapsed || sidebarMode !== "annotations" || readerView !== "document") return;
    const entry = Array.from(workspaceRef.current?.querySelectorAll<HTMLElement>("[data-search-annotation]") ?? [])
      .find((element) => element.dataset.searchAnnotation === activeAnnotationId);
    entry?.scrollIntoView?.({ block: "nearest" });
  }, [activeAnnotationId, activeAnnotationVisible, sidebarCollapsed, sidebarMode, readerView]);
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

  function openOverview(view: "pages" | "annotations") {
    if (readerView === "document") readingScrollTop.current = stageRef.current?.scrollTop ?? 0;
    setSelection(null);
    setSelectionPreview(null);
    setAnnotationPopup(null);
    quickAskTask.close();
    setTextBoxToolActive(false);
    setInkMode(null);
    clearBrowserSelection();
    setReaderView(view);
  }

  function closeOverview() {
    setReaderView("document");
    window.requestAnimationFrame(() => {
      if (stageRef.current) stageRef.current.scrollTop = readingScrollTop.current;
    });
  }

  function navigateToPage(page: number, behavior: ScrollBehavior = "smooth", topRatio?: number, restoringPosition?: () => boolean) {
    if (!restoringPosition) readerPosition.markNavigation();
    setReaderView("document");
    const nextPage = Math.min(Math.max(1, Math.trunc(page || 1)), Math.max(1, pageCount));
    viewportAnchor.reset(nextPage, topRatio ?? 0);
    setFocusedPage(nextPage);
    setPageOffset({ page: nextPage, topRatio: topRatio ?? 0 });
    announceNavigation(`已转到第 ${nextPage} 页。`);
    window.requestAnimationFrame(() => {
      if (restoringPosition && !restoringPosition()) return;
      const stageElement = stageRef.current;
      const pageElement = stageElement?.querySelector<HTMLElement>(`[data-page="${nextPage}"]`);
      if (!stageElement || !pageElement) return;
      if (topRatio !== undefined && typeof stageElement.scrollTo === "function") {
        const rect = getPdfPageSurfaceRect(pageElement);
        stageElement.scrollTo({ behavior, top: Math.max(0, stageElement.scrollTop + rect.top - getElementContentRect(stageElement).top + rect.height * topRatio) });
      } else if (layoutMode === "continuous" && typeof pageElement.scrollIntoView === "function") {
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
    viewportAnchor.capture();
    setLayoutMode(mode);
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
    if (objectWorkbench || whiteboardState.storageKey !== whiteboardStorageKey ||
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
        try { savePdfWhiteboard(whiteboardStorageKey, whiteboardState.document); } catch (e) { setStatus((e as Error).message); }
      }
    }, 240);
    return () => window.clearTimeout(timer);
  }, [activePaper?.id, hydratedWhiteboardStorageKey, whiteboardState, whiteboardStorageKey]);

  useEffect(() => {
    function handleFindShortcut(event: KeyboardEvent) {
      if (readingView || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
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
      if (measuredStageElement.clientWidth === 0) return;
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
  }, [readerView]);


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
    setHydratedAnnotationSource(null);
    setAnnotationLoadError("");
    setAnnotationSaveError("");
    setReadingAnnotationId(undefined);
    setAnnotations(browserState.annotations);
    annotationsRef.current = browserState.annotations;
    setAutoPublicAnnotations(browserState.autoPublic);
    let cancelled = false;
    let readSucceeded = !isUserPaperArtifactStoreAvailable();

    if (!activePaper?.id) {
      setHydratedAnnotationSource({ storageKey: annotationStorageKey, contentHash: activePaper?.contentHash });
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
        readSucceeded = true;
        setAnnotations(stored.annotations);
        annotationsRef.current = stored.annotations;
        setAutoPublicAnnotations(stored.autoPublic);
        if (stored.issues.length > 0) {
          setStatus("部分批注附加信息损坏；用户内容已保留，可检查后重试。");
        }
        queueMicrotask(() => replayRecoveredPublications(stored));
      })
      .catch((error: unknown) => {
        // A failed native read must never be followed by writing an empty browser fallback.
        if (cancelled) return;
        if (isUserPaperArtifactStoreAvailable()) {
          const detail = error instanceof Error ? error.message : "未知错误";
          setAnnotationLoadError(`无法读取批注：${detail}。请重试恢复，磁盘内容保持不变。`);
          setStatus("批注尚未恢复，保存暂不可用。");
        } else {
          queueMicrotask(() => replayRecoveredPublications(browserState));
        }
      })
      .finally(() => {
        if (!cancelled && readSucceeded) {
          setHydratedAnnotationSource({ storageKey: annotationStorageKey, contentHash: activePaper.contentHash });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activePaper, activePaper?.contentHash, annotationStorageKey, autoPublicStorageKey, annotationLoadAttempt]);

  useEffect(() => {
    setSelection(null);
    setSelectionPreview(null);
    dragSelectionRef.current = null;
    pageCharModelsRef.current.clear();
    setActiveAnnotationId(null);
    setActiveTextAnnotationId(null);
    setTextBoxToolActive(false);
    setAnnotationPopup(null);
    documentInfoSource.current = {};
    setPdfDocument(null);
    setPageCount(1);
    setFocusedPage(1);
    setPageOffset(undefined);
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
    let loadedDocument: PDFDocumentProxy | undefined;
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
      .then(async (document) => {
        if (!document) return;
        if (cancelled) {
          void document.destroy();
          return;
        }

        loadedDocument = document;
        const viewport = (await document.getPage(1)).getViewport({ scale: 1 });
        if (cancelled) return;
        setDefaultPageSize({ width: viewport.width, height: viewport.height });
        documentInfoSource.current = { paperId: activePaper?.id, sourcePath: activePaper?.sourcePath, contentHash: activePaper?.contentHash, document };
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
      if (loadedDocument) clearPdfPageData(loadedDocument);
      void loadingTask?.destroy();
    };
  }, [activePaper?.id, activePaper?.sourcePath, activePaper?.contentHash, loadPdfSource, pdfDisplaySource]);

  useEffect(() => {
    if (!pdfDocument || !activePaper || !onDocumentInfo ||
      documentInfoSource.current.paperId !== activePaper.id ||
      documentInfoSource.current.sourcePath !== activePaper.sourcePath) return;
    let cancelled = false;
    const info = { paperId: activePaper.id, sourcePath: activePaper.sourcePath, pageCount: pdfDocument.numPages };
    onDocumentInfo(info);
    // PDF.js reports the existing download; no second fetch or parsing pass.
    void pdfDocument.getDownloadInfo().then(({ length }) => {
      if (!cancelled) onDocumentInfo({ ...info, size: length });
    }).catch(() => { /* Page count remains useful when byte length is unavailable. */ });
    return () => { cancelled = true; };
  }, [pdfDocument, activePaper?.id, activePaper?.sourcePath, onDocumentInfo]);

  useEffect(() => {
    if (annotationStorageKey && hydratedAnnotationStorageKey === annotationStorageKey) {
      if (activePaper?.id) {
        void persistPdfAnnotationState({
          annotationStorageKey,
          autoPublicStorageKey,
          paperId: activePaper.id,
          contentHash: activePaper.contentHash,
          snapshot: { annotations, autoPublic: autoPublicAnnotations, version: 2 }
        })
          .then(() => { if (annotationScopeRef.current === annotationStorageKey) setAnnotationSaveError(""); })
          .catch((error: unknown) => {
            if (annotationScopeRef.current !== annotationStorageKey) return;
            const detail = error instanceof Error ? error.message : "未知错误";
            setAnnotationSaveError(`批注尚未写入本地文献库：${detail}。`);
            setStatus(`批注尚未写入本地文献库：${detail}。请检查库目录后重试。`);
          });
        if (annotations.length > 0 && onPaperAnnotatedRef.current) {
          // Annotating a paper whose body is still in the disposable cache promotes it
          // into the library, so clearing the cache cannot strip the body out from under
          // the user's own marks.
          // Parent callbacks can change when a save invalidates search; that alone
          // must not cause another save and another invalidation.
          void onPaperAnnotatedRef.current(activePaper.id).catch((error) => {
            const detail = error instanceof Error ? error.message : "未知错误";
            setStatus(`批注已保存，但 PDF 自动转入文献库失败：${detail}。清理缓存前请重试。`);
          });
        }
      }
    }
  }, [
    activePaper?.id,
    activePaper?.contentHash,
    annotationStorageKey,
    annotations,
    autoPublicStorageKey,
    autoPublicAnnotations,
    hydratedAnnotationStorageKey
  ]);

  useEffect(() => {
    if (!targetEvidence || targetEvidence.paperId !== activePaper?.id) {
      return undefined;
    }

    readerPosition.markNavigation();
    const targetPage = Math.min(
      Math.max(1, Math.trunc(targetEvidence.page || 1)),
      Math.max(1, pageCount)
    );
    setReaderView("document");
    viewportAnchor.reset(targetPage);
    setFocusedPage(targetPage);
    setSidebarMode(targetEvidence.searchAnnotation ? "annotations" : "thumbnails");
    if (targetEvidence.searchAnnotation) { setAnnotationQuery(""); setAnnotationFilter(emptyNoteFilter); setAnnotationFacets(emptyPdfAnnotationFacets); setActiveAnnotationId(targetEvidence.searchAnnotation.id); }
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

  useEffect(() => {
    const target = targetEvidence?.paperId === activePaper?.id ? targetEvidence.searchAnnotation : undefined;
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      const element = [...(workspaceRef.current?.querySelectorAll<HTMLElement>("[data-search-annotation]") ?? [])].find((element) => element.dataset.searchAnnotation === target.id);
      if (element) { element.scrollIntoView?.({ block: "nearest" }); highlightSearchText(element, JSON.stringify(target.quote)); }
    });
    return () => cancelAnimationFrame(frame);
  }, [targetEvidence, activePaper?.id, annotations, activeAnnotationId]);

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
    if (objectWorkbench) {
      void objectWorkbench.capturePdf({ paper: activePaper, ...selection }, "board").then(() => {
        setSelection(null); setSelectionPreview(null); clearBrowserSelection(); setStatus("摘录已保存到研究白板。");
      }).catch((error) => setStatus(error.message));
      return;
    }
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
    if (objectWorkbench) { objectWorkbench.dragPdf({ paper: activePaper, ...selection }, event.dataTransfer); return; }
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
    if (!annotationMutationIsCurrent()) return;
    const next = update(annotationsRef.current);
    annotationsRef.current = next;
    setAnnotations(next);
  }

  function replayRecoveredPublications(recovery: ReturnType<typeof recoverPdfAnnotationPrivateState>) {
    if (!annotationMutationIsCurrent() || !activePaper || !onChangeAnnotationPublication) return;
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
    if (!annotationMutationIsCurrent()) return;
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
    restartAttemptKey?: string,
    explicitIntent?: { newPublication?: true; resumePublication?: true }
  ): Promise<PdfAnnotationPublication | undefined> {
    if (!annotationMutationIsCurrent()) return;
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
    if (!annotationMutationIsCurrent()) return;
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
        ...explicitIntent,
        onPreparedPublication: async (publication) => {
          if (!annotationMutationIsCurrent()) throw new Error("文献已切换，发布结果未写入当前文献。");
          assertReadingAnnotationsReady();
          const latest = annotationsRef.current.find((item) => item.id === annotation.id);
          if (!latest || latest.revision !== annotation.revision ||
            publicationIntentsRef.current.get(annotation.id) !== expectedIntent) {
            throw new Error("批注或发布范围已变化，请重新确认。");
          }
          setCurrentAnnotations((items) => items.map((item) => item.id === annotation.id ? { ...item, publication } : item));
          await persistReadingAnnotations();
        },
        ...(restartReplay ? { restartReplay: true as const } : {})
      }));
      transport = { operation, promise };
      publicationTransportsRef.current.set(annotation.id, transport);
      const publication = await promise;
      if (!annotationMutationIsCurrent() || publicationIntentsRef.current.get(annotation.id) !== expectedIntent) return publication;
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
        lastError: operation === "retract" ? `撤回结果待核实。${message}` : message,
        state: "failed"
      };
      if (!annotationMutationIsCurrent() || publicationIntentsRef.current.get(annotation.id) !== expectedIntent) return publication;
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
    queueMicrotask(() => void applyPublication(pending, operation, false, undefined,
      annotation.publication.state === "not_published" && !annotation.publication.remoteAnnotationId &&
        !annotation.publication.pendingOperation && !annotation.publication.pendingCreateOperation
        ? { newPublication: true } : { resumePublication: true }));
  }

  function addAnnotation(kind: Exclude<AnnotationKind, "note" | "text" | "ink">) {
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
      textRepresentationRevision: fulltext.representationForPage(activeSelection.page), sourceHash: activePaper.contentHash,
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

  useEffect(() => {
    if (!loadedPositionDocument || !activePaper || quickAskRevision === "unresolved") return;
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      void preparePdfQuickAskContext({ source: { scopeId: quickAskAccount, paperId: activePaper.id, documentRevision: quickAskRevision, extractorRevision: "pdfjs-sections-v1" },
        pageCount: loadedPositionDocument.numPages, sourcePages: [], excerpt: "", signal: abort.signal,
        readPage: async page => { const pdfPage = await loadedPositionDocument.getPage(page); return normalizePdfPageText(joinPdfTextItems((await pdfPage.getTextContent()).items)); }
      }).catch(() => { /* Preparation reports exact unavailable sources when the user submits. */ });
    }, 800);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [loadedPositionDocument, quickAskScope]);

  async function answerSelectionQuestion(anchor: Pick<PdfSelection, "page" | "excerpt" | "rects" | "normalizedStart" | "sourcePages">, question: string, signal: AbortSignal, systemPrompt?: string, onDelta?: (text: string) => void, attemptId: string = crypto.randomUUID()) {
    assertReadingAnnotationsReady();
    if (!activePaper || !onQuickAsk) throw new Error("速问暂不可用。");
    const paper = activePaper;
    const scope = quickAskScope;
    const source = { scopeId: quickAskAccount, paperId: paper.id, documentRevision: quickAskRevision, extractorRevision: "pdfjs-sections-v1" };
    async function readPage(page: number) {
      if (pageTexts[page]?.trim()) return pageTexts[page];
      if (!pdfDocument) return "";
      const pdfPage = await pdfDocument.getPage(page);
      return normalizePdfPageText(joinPdfTextItems((await pdfPage.getTextContent()).items));
    }
    let receipt: QuickAskGenerationReceipt | undefined;
    const parts = await preparePdfQuickAskContext({ source, pageCount: pdfDocument?.numPages ?? pageCount, sourcePages: anchor.sourcePages?.length ? anchor.sourcePages : [anchor.page], excerpt: anchor.excerpt, readPage, signal });
    signal.throwIfAborted();
    const textFor = (role: "page" | "abstract" | "introduction") => parts.filter(part => part.roles.includes(role)).map(part => part.text).join("\n\n");
    const pageText = textFor("page"), abstractText = textFor("abstract"), introductionText = textFor("introduction");
    const preset = quickAskPresets.selectedPreset;
    const answer = await onQuickAsk({ paper, page: anchor.page, excerpt: anchor.excerpt,
      question, pageText, abstractText, introductionText, source, sourcePages: anchor.sourcePages?.length ? anchor.sourcePages : [anchor.page],
      selectionId: createPdfReaderSelectionId(paper.id, anchor.page, anchor.normalizedStart, anchor.excerpt),
      attemptId, requestId: attemptId, scopeGeneration: quickAskGeneration.current,
      presetSnapshot: { id: preset.id, revision: preset.revision, instruction: preset.instruction },
      loadContext: async () => parts,
      onDelta: (_delta, accumulated) => { if (!signal.aborted && quickAskScopeRef.current === scope) onDelta?.(accumulated); },
      onContext: (context) => { if (!signal.aborted && quickAskScopeRef.current === scope) setQuickAskContext(context); },
      onReceipt: (value) => { receipt = value; },
      signal, ...(systemPrompt !== undefined ? { systemPrompt } : {}) });
    signal.throwIfAborted();
    if (quickAskScopeRef.current !== scope) throw new Error("文献或账号已变化，回答未写入新文献。");
    if (!answer.trim()) throw new Error("未收到回答，请重试。");
    const now = new Date().toISOString();
    const annotation: PdfAnnotationV2 = {
      id: `quick-ask-${crypto.randomUUID()}`, kind: anchor.rects.length ? "underline" : "note", page: anchor.page,
      excerpt: anchor.excerpt, rects: anchor.rects, normalizedStart: anchor.normalizedStart,
      text: `速问 · 第 ${anchor.page} 页`, createdAt: now, updatedAt: now,
      paperIdentity: resolvePaperIdentity(paper), revision: 1,
      publication: { desiredVisibility: "private", state: "not_published" },
      quickAsk: { question, answer, pageText, abstractText, introductionText, ...(receipt ? { receipt: structuredClone(receipt) } : {}) }
    };
    assertReadingAnnotationsReady();
    return annotation;
  }

  useEffect(() => setReviewPromptId(undefined), [annotationStorageKey]);

  async function saveQuickAskAnnotation(annotation: PdfAnnotationV2) {
    assertReadingAnnotationsReady();
    const scope = quickAskScope;
    if (annotation.paperIdentity.paperId !== activePaper!.id ||
      (annotation.quickAsk?.receipt && annotation.quickAsk.receipt.context.source.documentRevision !== quickAskRevision)) throw new Error("文献版本已变化，回答仍保留在原草稿。");
    if (annotation.quickAsk?.receipt) annotation.quickAsk.receipt.saved = { annotationId: annotation.id, revision: String(annotation.revision), committedAt: new Date().toISOString() };
    const current = annotationsRef.current;
    const next = current.some(item => item.id === annotation.id) ? current : [...current, annotation];
    await persistPdfAnnotationState({ annotationStorageKey: annotationStorageKey!, autoPublicStorageKey,
      paperId: activePaper!.id, contentHash: activePaper!.contentHash,
      snapshot: { annotations: next, autoPublic: autoPublicAnnotations, version: 2 } });
    if (quickAskScopeRef.current !== scope) return;
    setCurrentAnnotations(items => items.some(item => item.id === annotation.id) ? items : [...items, annotation]);
    setActiveAnnotationId(annotation.id);
    await quickAskPresets.markCompleted(annotation.quickAsk?.receipt?.presetSnapshot.id ?? quickAskPresets.selectedPreset.id);
  }

  async function submitQuickAsk() {
    if (!quickAskSelection || !activePaper || !onQuickAsk || quickAskPending || hydratedAnnotationStorageKey !== annotationStorageKey) return;
    let question: string;
    try { question = resolveQuickAskInstruction(quickAskQuestion, quickAskPresets.selectedPreset); }
    catch (error) { quickAskTask.update({ error: error instanceof Error ? error.message : "指令无效。" }); return; }
    const anchor = quickAskSelection;
    await quickAskTask.start(async (signal, onDelta, attemptId) => {
      const result = await answerSelectionQuestion(anchor, question, signal, quickAskPrompt, onDelta, attemptId);
      return { text: result.quickAsk!.answer, result };
    }, saveQuickAskAnnotation);
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
      setActiveAnnotationId(annotation.id);
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

  function locateAnnotation(annotation: PdfAnnotation) {
    readerPosition.markNavigation();
    setReaderView("document");
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

  async function saveAnnotationReview(id: string, expectedRevision: number, review: PdfAnnotationReviewValue) {
    if (!activePaper || !annotationStorageKey || hydratedAnnotationStorageKey !== annotationStorageKey) {
      throw new Error("批注仍在恢复，请稍后保存 review。");
    }
    const annotation = annotationsRef.current.find((item) => item.id === id);
    if (!annotation) throw new Error("该批注已删除，review 未写入其他条目。");
    if (annotation.revision !== expectedRevision) throw new Error("批注已更改，请重新核对并保存 review。");
    const updated = revisePdfAnnotation(annotation, { review, updatedAt: new Date().toISOString() });
    const next = annotationsRef.current.map((item) => item.id === id ? updated : item);
    annotationsRef.current = next;
    setAnnotations(next);
    await persistPdfAnnotationState({
      annotationStorageKey,
      autoPublicStorageKey,
      paperId: activePaper.id,
      contentHash: activePaper.contentHash,
      snapshot: { annotations: next, autoPublic: autoPublicAnnotations, version: 2 }
    });
    setStatus("AI review 已随批注保存。");
  }

  function renderAnnotationReviewButton(annotation: PdfAnnotationV2) {
    if (!objectWorkbench?.reviewAnnotation) return null;
    const dirtyNote = activeAnnotationId === annotation.id && annotation.kind !== "text" &&
      !annotation.quickAsk && annotationNoteDraft !== (annotation.note ?? "");
    const tooltip = dirtyNote ? "请先保存批注，再进行 AI review" : annotation.review ? "重新生成 AI review" : "AI review";
    return <Tooltip content={tooltip} relationship="description">
      <Button aria-label={`AI review：${annotation.excerpt}`} appearance="subtle" size="small" icon={<SparkleRegular />}
        disabled={dirtyNote || hydratedAnnotationStorageKey !== annotationStorageKey || annotationReview.states[annotation.id]?.pending}
        onClick={() => setReviewPromptId(annotation.id)} />
    </Tooltip>;
  }

  function renderAnnotationReview(annotation: PdfAnnotationV2) {
    return <PdfAnnotationReview key={annotation.id} annotation={annotation} state={annotationReview.states[annotation.id]}
      onCancel={() => annotationReview.cancel(annotation.id)}
      onSave={(revision, review) => annotationReview.save(annotation.id, revision, review)} />;
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

  function assertReadingAnnotationsReady() {
    if (!activePaper || !annotationStorageKey || annotationScopeRef.current !== annotationStorageKey ||
      hydratedAnnotationStorageKey !== annotationStorageKey || annotationLoadError) {
      throw new Error("批注尚未恢复或论文已切换，请稍后重试。");
    }
  }

  async function persistReadingAnnotations() {
    assertReadingAnnotationsReady();
    await persistPdfAnnotationState({ annotationStorageKey: annotationStorageKey!, autoPublicStorageKey,
      paperId: activePaper!.id, contentHash: activePaper!.contentHash, snapshot: { annotations: annotationsRef.current, autoPublic: autoPublicAnnotations, version: 2 } });
  }

  async function createReadingAnnotation(input: { page: number; excerpt: string; note: string; lookupKind?: PdfAnnotationV2["lookupKind"] } & ReadingMarkStyle) {
    assertReadingAnnotationsReady();
    if (!Number.isInteger(input.page) || input.page < 1 || (pdfDocument && input.page > pdfDocument.numPages) || (!input.note.trim() && !input.excerpt.trim())) throw new Error("请选择页码并填写批注。");
    const duplicate = annotationsRef.current.find((item) => item.page === input.page && item.excerpt === input.excerpt && item.note === input.note.trim() && (!input.kind || item.kind === input.kind) && (!input.color || item.color === input.color));
    if (duplicate) { await persistReadingAnnotations(); return; }
    const now = new Date().toISOString();
    const scope = annotationStorageKey;
    let rects = readingQuoteRects(pageCharModelsRef.current.get(input.page), input.excerpt);
    if (!rects.length && input.excerpt && pdfDocument) rects = await resolveReadingQuoteRects(pdfDocument, input.page, input.excerpt);
    assertReadingAnnotationsReady();
    if (annotationScopeRef.current !== scope) throw new Error("论文已切换，请重新选择原文。");
    if ((input.kind === "highlight" || input.kind === "underline") && !rects.length)
      throw new Error("这段文字无法唯一对应到 PDF。请在 PDF 中划线，或改为页批注；不会猜测高亮位置。");
    const annotation: PdfAnnotationV2 = { id: `reading-${crypto.randomUUID()}`, kind: input.kind ?? (rects.length ? "highlight" : "note"),
      color: rects.length ? input.color ?? "yellow" : undefined, createdAt: now, updatedAt: now, revision: 1,
      textRepresentationRevision: fulltext.representationForPage(input.page), sourceHash: activePaper?.contentHash,
      page: input.page, excerpt: input.excerpt, note: input.note.trim(), text: "阅读批注", rects,
      ...(input.lookupKind ? { lookupKind: input.lookupKind } : {}),
      paperIdentity: resolvePaperIdentity(activePaper!), publication: { desiredVisibility: "private", state: "not_published" } };
    setCurrentAnnotations((current) => [...current, annotation]);
    // Creating a mark in reading mode is not a request to navigate or open its sidebar.
    await persistReadingAnnotations();
  }

  async function readingSelectionGeometry(input: { page: number; excerpt: string }) {
    assertReadingAnnotationsReady();
    if (!Number.isInteger(input.page) || input.page < 1 || input.page > pageCount || !input.excerpt.trim()) throw new Error("请先选择原文与页码。");
    const rects = pdfDocument ? await resolveReadingQuoteRects(pdfDocument, input.page, input.excerpt) : [];
    // The complete quote is matched against native glyphs, with a text-layer fallback for
    // unsupported fonts. Do not prefer a cached, potentially distorted DOM measurement.
    assertReadingAnnotationsReady();
    return { ...input, rects };
  }

  async function updateReadingAnnotation(id: string, revision: number, note: string, style: ReadingMarkStyle = {}) {
    assertReadingAnnotationsReady();
    const annotation = annotationsRef.current.find((item) => item.id === id);
    if (!annotation) throw new Error("批注已删除，请重新打开后编辑。");
    if (annotation.revision !== revision) {
      // A failed disk write leaves the edited value in memory; retry that value without a new revision.
      if (annotation.note === note && (!style.kind || annotation.kind === style.kind) && (!style.color || annotation.color === style.color)) { await persistReadingAnnotations(); return; }
      throw new Error("批注已变化，请重新打开后编辑。");
    }
    const updated = revisePdfAnnotation(annotation, { note, ...style, updatedAt: new Date().toISOString(),
      publication: annotation.publication.state === "published" ? { ...annotation.publication, state: "pending_update" } : annotation.publication });
    setCurrentAnnotations((current) => current.map((item) => item.id === id ? updated : item));
    if (annotation.publication.state === "published") {
      publicationIntentsRef.current.set(id, "public");
      queueMicrotask(() => void applyPublication(updated, "update"));
    }
    await persistReadingAnnotations();
  }

  const guide = useLiteratureGuide({
    scope: annotationStorageKey, title: activePaper?.title ?? "", pageCount,
    sourceReference: activePaper ? paperSourceReferences(activePaper)[0] : undefined,
    ready: Boolean(pdfDocument && annotationStorageKey && hydratedAnnotationStorageKey === annotationStorageKey && !annotationLoadError),
    count: annotations.filter((annotation) => annotation.aiGuide).length, generate: onGenerateGuide,
    readPage: async (page) => {
      if (pageTexts[page]?.trim()) return pageTexts[page];
      if (!pdfDocument) throw new Error("PDF 文本尚未就绪。");
      const source = await pdfDocument.getPage(page);
      return normalizePdfPageText(joinPdfTextItems((await source.getTextContent()).items));
    },
    save: async (batch, pages, mode, runId, signal, options) => {
      assertReadingAnnotationsReady();
      const scope = annotationStorageKey;
      const now = new Date().toISOString();
      const additions: PdfAnnotationV2[] = [];
      for (const item of batch.items) {
        signal.throwIfAborted();
        const anchor = await readingSelectionGeometry({ page: item.page, excerpt: item.quote });
        signal.throwIfAborted();
        if (!anchor.rects.length) continue;
        additions.push({ id: `ai-guide-${crypto.randomUUID()}`, kind: "underline", color: "blue", page: item.page,
          excerpt: item.quote, rects: anchor.rects, text: item.title, note: item.explanation,
          aiGuide: { mode, level: batch.level, category: item.category, runId },
          createdAt: now, updatedAt: now, revision: 1, paperIdentity: resolvePaperIdentity(activePaper!),
          publication: { desiredVisibility: "private", state: "not_published" } });
      }
      signal.throwIfAborted(); assertReadingAnnotationsReady();
      if (scope !== annotationScopeRef.current) throw new Error("论文已切换，未保存标注。");
      if (batch.items.length && !additions.length) throw new Error("未能在 PDF 原文定位本批讲解，原有标注已保留。");
      // Regeneration only replaces untouched AI marks on successfully processed pages.
      // User highlights and edited/published explanations remain intact.
      const invalidPages = batch.items.filter((item) => !additions.some((mark) => mark.page === item.page && mark.excerpt === item.quote)).map((item) => item.page);
      const replacePages = batch.rejected ? [] : pages.filter((page) => !invalidPages.includes(page));
      let savedCount = 0;
      setCurrentAnnotations((current) => {
        const merged = mergePdfGuides(current, additions, replacePages, options);
        savedCount = additions.filter((mark) => merged.includes(mark)).length;
        return merged;
      });
      await persistReadingAnnotations();
      return savedCount;
    },
    clear: async () => {
      assertReadingAnnotationsReady();
      setCurrentAnnotations((current) => current.filter((mark) => !isUntouchedGuide(mark)));
      await persistReadingAnnotations();
    }
  });
  const guideControls = onGenerateGuide ? <LiteratureGuideControls guide={guide} /> : null;
  const visibleAnnotations = guide.visible ? annotations : annotations.filter((annotation) => !annotation.aiGuide);

  function createInkAnnotation(page: number, ink: PdfInkStroke) {
    if (!activePaper || hydratedAnnotationStorageKey !== annotationStorageKey) return;
    readerPosition.markNavigation();
    setFocusedPage(page);
    const now = new Date().toISOString();
    setCurrentAnnotations((current) => {
      const nearby = [...current].reverse().find((annotation) =>
        canGroupPdfInkStroke(annotation, page, ink, Date.parse(now))
      );
      if (nearby) {
        const strokes = [...pdfInkStrokes(nearby), ink];
        const updated = revisePdfAnnotation(nearby, {
          ink: strokes[0], inkStrokes: strokes, inkLastStrokeAt: now,
          rects: [pdfInkGroupBounds(strokes)], updatedAt: now
        });
        return current.map((annotation) => annotation.id === nearby.id ? updated : annotation);
      }
      return [...current, {
        id: `ink-${crypto.randomUUID()}`, kind: "ink", ink, inkStrokes: [ink], page,
        inkLastStrokeAt: now, rects: [pdfInkGroupBounds([ink])], paperIdentity: resolvePaperIdentity(activePaper),
        text: "手绘", excerpt: "手绘笔记", createdAt: now, updatedAt: now, revision: 1,
        publication: { desiredVisibility: "private", state: "not_published" }
      }];
    });
  }

  function deleteInkStroke(annotation: PdfAnnotationV2, strokeIndex: number) {
    const current = annotationsRef.current.find((item) => item.id === annotation.id);
    if (!current) return;
    const strokes = pdfInkStrokes(current).filter((_, index) => index !== strokeIndex);
    if (!strokes.length) { void deleteAnnotation(current); return; }
    const updated = revisePdfAnnotation(current, {
      ink: strokes[0], inkStrokes: strokes, rects: [pdfInkGroupBounds(strokes)],
      updatedAt: new Date().toISOString()
    });
    setCurrentAnnotations((items) => items.map((item) => item.id === current.id ? updated : item));
    setStatus("已移除一笔，手绘笔记的其余笔迹已保留。");
  }

  function annotationCaptureInput(annotation: PdfAnnotationV2) {
    const pageElement = stageRef.current?.querySelector<HTMLElement>(`[data-page="${annotation.page}"]`);
    const pageRect = pageElement?.getBoundingClientRect();
    const pageAspectRatio = pageRect && pageRect.width > 0 ? pageRect.height / pageRect.width : undefined;
    return { paper: activePaper!, annotation, pageAspectRatio };
  }

  function dragAnnotation(annotation: PdfAnnotationV2, dataTransfer: DataTransfer) {
    if (!activePaper || !objectWorkbench) return;
    dataTransfer.effectAllowed = "copy";
    if (objectWorkbench.dragAnnotation) {
      objectWorkbench.dragAnnotation(annotationCaptureInput(annotation), dataTransfer);
    } else {
      objectWorkbench.dragPdf({ paper: activePaper, page: annotation.page,
        excerpt: annotation.excerpt, rects: annotation.rects, normalizedStart: annotation.normalizedStart
      }, dataTransfer);
    }
  }

  function commitTextAnnotation(
    annotationId: string,
    markdown: string,
    rect: PdfAnnotationRect,
    images?: PdfAnnotationV2["images"]
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
    if (annotation.note === markdown && !rectChanged && images === annotation.images) return;
    const updated = revisePdfAnnotation(annotation, {
      note: markdown,
      images,
      rects: [rect],
      updatedAt: new Date().toISOString()
    });
    setCurrentAnnotations((current) => current.map((item) => item.id === annotationId ? updated : item));
    setStatus("已保存 Markdown 文本框。");
  }

  function moveTextAnnotation(annotationId: string, rect: PdfAnnotationRect, manualSize?: boolean) {
    const annotation = annotationsRef.current.find((item) => item.id === annotationId);
    const previousRect = annotation?.rects[0];
    if (!annotation || annotation.kind !== "text" || !previousRect || (
      previousRect.height === rect.height &&
      previousRect.left === rect.left &&
      previousRect.top === rect.top &&
      previousRect.width === rect.width &&
      (!manualSize || annotation.manualSize)
    )) return;
    const updated = revisePdfAnnotation(annotation, {
      rects: [rect],
      ...(manualSize ? { manualSize: true } : {}),
      updatedAt: new Date().toISOString()
    });
    setCurrentAnnotations((current) => current.map((item) => item.id === annotationId ? updated : item));
    setStatus(manualSize ? "已调整 Markdown 文本框大小。" : "已移动 Markdown 文本框。");
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

  function requestAnnotationDeletion(annotation: PdfAnnotationV2) {
    if (!annotationMutationIsCurrent() || deletionRunsRef.current.has(annotation.id)) return;
    setAnnotationToDelete({ annotation, scope: annotationMutationScope, returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null });
  }

  function confirmAnnotationDeletion() {
    if (!annotationToDelete || annotationToDelete.scope !== annotationMutationScope) return;
    const annotation = annotationToDelete.annotation;
    setAnnotationToDelete(null);
    void deleteAnnotation(annotation);
  }

  function deleteAnnotation(annotation: PdfAnnotationV2): Promise<void> {
    if (!annotationMutationIsCurrent()) return Promise.resolve();
    const existing = deletionRunsRef.current.get(annotation.id);
    if (existing) return existing;
    const operation = performAnnotationDeletion(annotation).finally(() => {
      if (deletionRunsRef.current.get(annotation.id) !== operation) return;
      deletionRunsRef.current.delete(annotation.id);
      if (annotationMutationIsCurrent()) setDeletingAnnotationIds((current) => {
        const next = new Set(current); next.delete(annotation.id); return next;
      });
    });
    deletionRunsRef.current.set(annotation.id, operation);
    setDeletingAnnotationIds((current) => new Set(current).add(annotation.id));
    return operation;
  }

  async function performAnnotationDeletion(annotation: PdfAnnotationV2) {
    let expectedRevision = annotation.revision;
    const stillCurrent = () => {
      if (!annotationMutationIsCurrent()) return false;
      const current = annotationsRef.current.find((item) => item.id === annotation.id);
      if (current?.revision === expectedRevision) return true;
      if (current) setStatus("批注已更新，删除已取消。请核对后重试。");
      return false;
    };
    if (!stillCurrent()) return;
    const remove = () => {
      if (!stillCurrent()) return;
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
      if (!stillCurrent()) return;
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
      if (!stillCurrent()) return;
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
      expectedRevision = pending.revision;
      setCurrentAnnotations((current) => current.map((item) => item.id === annotation.id ? pending : item));
      await Promise.resolve();
      if (!stillCurrent()) return;
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
    expectedRevision = pending.revision;
    setCurrentAnnotations((current) => current.map((item) => item.id === annotation.id ? pending : item));
    setActiveAnnotationId(null);
    setAnnotationPopup(null);
    await Promise.resolve();
    if (!stillCurrent()) return;
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

  const reviewShare = usePaperReviewShare({ scopeKey: annotationStorageKey,
    ready: Boolean(activePaper && annotationStorageKey && hydratedAnnotationStorageKey === annotationStorageKey && !annotationLoadError),
    source: { title: activePaper?.title ?? "", annotations, pageTexts } });

  return (
    <section
      aria-label="PDF 阅读器"
      className={`pdf-reader fluid${quickAskSelection && !quickAskTask.draft.open ? " has-quick-ask-resume" : ""}`}
      data-pdf-source={pdfDisplaySource ?? ""}
      data-pdf-night={pdfReadingPalette(pdfBackground).dark}
      style={{ "--pdf-reading-background": pdfBackground } as CSSProperties}
    >
      <span className="pdf-navigation-announcement" aria-live="polite" aria-atomic="true"><span key={announcement.sequence}>{announcement.text}</span></span>
      <PaperReviewShareStatus controller={reviewShare} />
      {annotationToDelete?.scope === annotationMutationScope ? <PdfAnnotationDeleteDialog annotation={annotationToDelete.annotation}
        onCancel={() => setAnnotationToDelete(null)} onConfirm={confirmAnnotationDeletion} restoreFocus={() => {
          if (annotationToDelete.scope !== annotationMutationScopeRef.current) return;
          if (annotationToDelete.returnFocus?.isConnected) annotationToDelete.returnFocus.focus();
          else workspaceRef.current?.querySelector<HTMLButtonElement>(".pdf-sidebar-switcher button[aria-label='批注']")?.focus();
        }} /> : null}
      {quickAskSelection && !quickAskTask.draft.open ? <Button className="quick-ask-reopen" onClick={() => quickAskTask.update({ open: true })}>返回速问{quickAskPending ? "（正在回答）" : ""}</Button> : null}
      {readingView?.({ scopeKey: annotationStorageKey ?? "", ready: Boolean(annotationStorageKey && hydratedAnnotationStorageKey === annotationStorageKey && !annotationLoadError),
        searchMetadata, lookup: selectionLookup, paperId: activePaper?.id, paperTitle: activePaper?.title,
        error: annotationLoadError || annotationSaveError, annotations: hydratedAnnotationStorageKey === annotationStorageKey ? annotationsInReadingOrder.filter((annotation) => guide.visible || !annotation.aiGuide) : [], guideControls,
        pageTexts, pageCount, focusedPage, selectedId: readingAnnotationId,
        create: createReadingAnnotation, update: updateReadingAnnotation,
        extensionActions: activePaper ? (input) => <ReaderExtensionActions input={{ paper: activePaper, ...input, rects: [] }} resolve={async () => ({ paper: activePaper, ...await readingSelectionGeometry(input) })} /> : undefined,
        capture: async (input, target) => {
          assertReadingAnnotationsReady();
          if (target === "conversation") {
            onAddSelectionToConversation?.({ ...input, paperId: activePaper!.id, paperTitle: activePaper!.title, source: "pdf_selection" }); return;
          }
          if (!objectWorkbench) throw new Error("研究白板暂不可用。");
          const anchor = await readingSelectionGeometry(input);
          await objectWorkbench.capturePdf({ paper: activePaper!, ...anchor }, target);
        },
        openQuickAsk: onQuickAsk ? input => {
          assertReadingAnnotationsReady();
          if (!Number.isInteger(input.page) || input.page < 1 || input.page > pageCount || !input.excerpt.trim()) return;
          quickAskTask.open({ page: input.page, excerpt: input.excerpt, rects: readingQuoteRects(pageCharModelsRef.current.get(input.page), input.excerpt),
            menuLeft: 24, menuTop: 24, menuPlacement: "below" }, input.question ?? "");
          setQuickAskContext(undefined);
        } : undefined,
        quickAsk: onQuickAsk ? async (input, signal) => {
          const anchor = await readingSelectionGeometry(input);
          const annotation = await answerSelectionQuestion(anchor, input.question.trim(), signal, input.systemPrompt);
          signal.throwIfAborted(); assertReadingAnnotationsReady();
          await saveQuickAskAnnotation(annotation);
          setReadingAnnotationId(annotation.id);
        } : undefined,
        annotationTools: (annotation) => <>{renderAnnotationReviewButton(annotation)}{renderAnnotationReview(annotation)}
          {objectWorkbench?.captureAnnotation ? <Button size="small" onClick={() => void objectWorkbench.captureAnnotation!(annotationCaptureInput(annotation), "board").catch((failure) => setStatus(String(failure)))}>加入白板</Button> : null}</>,
        remove: async (id) => {
          assertReadingAnnotationsReady();
          const annotation = annotationsRef.current.find((item) => item.id === id);
          if (!annotation) return;
          await deleteAnnotation(annotation);
          if (annotationsRef.current.some((item) => item.id === id)) throw new Error("批注尚未删除，请在 PDF 模式检查公开状态后重试。");
          await persistReadingAnnotations();
        },
        openPdf: (id) => {
          const annotation = annotationsRef.current.find((item) => item.id === id);
          if (!annotation) return;
          onExitReadingMode?.();
          openAnnotationEditor(annotation);
          locateAnnotation(annotation);
        },
      })}
            {quickAskSelection ? <>
              <QuickAskSurface returnFocusRef={stageRef} open={quickAskTask.draft.open && !quickAskPresetManagerOpen} onClose={quickAskTask.close}
                page={quickAskSelection.page} excerpt={quickAskSelection.excerpt} width={documentFrameWidth || stageWidth}
                anchor={{ getBoundingClientRect: () => { const stage = stageRef.current; const rect = stage?.getBoundingClientRect(); return new DOMRect((rect?.left ?? 0) + quickAskSelection.menuLeft - (stage?.scrollLeft ?? 0), (rect?.top ?? 0) + quickAskSelection.menuTop - (stage?.scrollTop ?? 0), 1, 1); } }}
                instruction={quickAskQuestion} onInstruction={instruction => quickAskTask.update({ instruction })}
                taskPicker={<><QuickAskPresetPicker presets={quickAskPresets.presets} selectedPresetId={quickAskPresets.selectedPreset.id}
                  onSelect={quickAskPresets.selectPreset} customInstruction={quickAskQuestion}
                  onUsePreset={() => { setQuickAskCustomDraft(quickAskQuestion); quickAskTask.update({ instruction: "" }); }} />
                  {quickAskCustomDraft && !quickAskQuestion ? <Button size="small" onClick={() => quickAskTask.update({ instruction: quickAskCustomDraft })}>恢复本次指令草稿</Button> : null}
                  <Button size="small" appearance="subtle" onClick={() => setQuickAskPresetManagerOpen(true)}>管理快捷指令</Button>
                  {quickAskPresets.fallbackNotice ? <p role="status">{quickAskPresets.fallbackNotice}</p> : null}
                  {quickAskPresets.error ? <p role="alert">{quickAskPresets.error}</p> : null}</>}
                primaryAction={quickAskPrimaryAction(quickAskQuestion, quickAskPresets.selectedPreset)}
                phase={quickAskTask.draft.phase} busy={quickAskPending} ready={hydratedAnnotationStorageKey === annotationStorageKey}
                text={quickAskTask.draft.text} error={quickAskTask.draft.error} context={quickAskTask.draft.result?.quickAsk?.receipt?.context ?? quickAskContext}
                onTransfer={onQuickAskTransfer && quickAskTask.draft.result?.quickAsk?.receipt ? () => {
                  const answer = quickAskTask.draft.result!.quickAsk!;
                  void onQuickAskTransfer({ paperTitle: activePaper?.title ?? "", excerpt: quickAskSelection.excerpt,
                    answer: answer.answer, receipt: answer.receipt! }).then(() => setStatus("已转到独立对话。"), error => quickAskTask.update({ error: error instanceof Error ? error.message : "转到对话失败。" }));
                } : undefined}
                onSubmit={() => void submitQuickAsk()} onStop={quickAskTask.stop}
                onRetrySave={() => void quickAskTask.retrySave(saveQuickAskAnnotation)} onDiscard={quickAskTask.discard}
                onSavePreset={() => setQuickAskPresetManagerOpen(true)}
                preferences={<GenerationPromptEditor context="quick" task="selection_explanation" value={quickAskPrompt} onChange={preference => quickAskTask.update({ preference })} disabled={quickAskPending} />} />
              {quickAskPresetManagerOpen ? <ResponsiveOverlay open title="管理快捷指令" onClose={() => setQuickAskPresetManagerOpen(false)} availableWidth={documentFrameWidth || stageWidth}><QuickAskPresetManager key={quickAskAccount} repository={quickAskPresets.repository} initialInstruction={quickAskQuestion}
                onSaved={() => { setQuickAskPresetManagerOpen(false); setStatus("快捷指令已保存。"); }} onClose={() => setQuickAskPresetManagerOpen(false)} /></ResponsiveOverlay> : null}
            </> : null}
      <div
        aria-label="PDF 阅读工作区"
        hidden={Boolean(readingView)}
        ref={workspaceRef}
        style={{ "--pdf-sidebar-width": `${visibleSidebarWidth}px`, "--pdf-whiteboard-width": `${whiteboardWidth}px` } as CSSProperties}
        className={`pdf-workspace ${sidebarCollapsed ? "sidebar-collapsed" : "sidebar-open"} ${
          whiteboardOpen && (!objectWorkbench || legacyBoardPreview) ? "whiteboard-open" : ""
        }`}
      >
        <aside
          aria-label="PDF 左侧批注栏"
          className="pdf-left-sidebar"
        >
          {!sidebarCollapsed ? <div
            aria-label="调整批注栏宽度" aria-orientation="vertical" role="separator" tabIndex={0}
            aria-valuemin={160} aria-valuemax={sidebarLimit} aria-valuenow={visibleSidebarWidth}
            className="pdf-sidebar-resizer"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              sidebarResizeRef.current = { x: event.clientX, width: visibleSidebarWidth };
              event.currentTarget.setPointerCapture(event.pointerId);
              event.preventDefault();
            }}
            onPointerMove={(event) => {
              const drag = sidebarResizeRef.current;
              if (drag) setSidebarWidth(Math.max(160, Math.min(sidebarLimit, drag.width + event.clientX - drag.x)));
            }}
            onPointerUp={() => { sidebarResizeRef.current = null; }}
            onPointerCancel={() => { sidebarResizeRef.current = null; }}
            onLostPointerCapture={() => { sidebarResizeRef.current = null; }}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              setSidebarWidth((width) => event.key === "Home" ? 160 : event.key === "End" ? sidebarLimit :
                Math.max(160, Math.min(sidebarLimit, Math.min(width, sidebarLimit) + (event.key === "ArrowLeft" ? -16 : 16))));
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
              <div className="pdf-sidebar-controls">
              <div className="pdf-sidebar-switcher">
                <button aria-label="目录" aria-pressed={sidebarMode === "outline"}
                  className={sidebarMode === "outline" ? "active" : ""}
                  onClick={() => setSidebarMode("outline")} title="查看 PDF 书签目录" type="button">
                  <TextBulletListLtrRegular />
                </button>
                <button
                  aria-label="缩略图"
                  className={sidebarMode === "thumbnails" ? "active" : ""}
                  aria-pressed={sidebarMode === "thumbnails"}
                  onClick={() => setSidebarMode("thumbnails")}
                  onDoubleClick={() => openOverview("pages")}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setSidebarMode("thumbnails"); openOverview("pages"); } }}
                  title="页面缩略图；双击或按 Enter 展开全部页面"
                  type="button"
                >
                  <DocumentRegular />
                </button>
                <button
                  aria-label="批注"
                  className={sidebarMode === "annotations" ? "active" : ""}
                  aria-pressed={sidebarMode === "annotations"}
                  onClick={() => setSidebarMode("annotations")}
                  onDoubleClick={() => openOverview("annotations")}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setSidebarMode("annotations"); openOverview("annotations"); } }}
                  title="文档批注；双击或按 Enter 展开全部批注"
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

              {sidebarMode === "annotations" && <>
                <div className="pdf-annotation-search">
                  <Input aria-label="搜索批注内容" placeholder="搜索摘录、批注、页码或作者" size="small" contentBefore={<SearchRegular />}
                    value={annotationQuery} onChange={(_, data) => setAnnotationQuery(data.value)} />
                  <SearchOptions query={annotationQuery} onChange={setAnnotationQuery} tags={Object.values(noteLabels)} />
                  {annotationQuery ? <Tooltip content="清除批注搜索" relationship="description"><Button aria-label="清除批注搜索" size="small" appearance="subtle"
                    icon={<DismissRegular />} onClick={() => setAnnotationQuery("")} /></Tooltip> : null}
                </div>
                <PdfAnnotationFilters annotations={[...annotations, ...teamAnnotations.map((item) => item.body)]} value={annotationFacets} onChange={setAnnotationFacets} />
                <div className="pdf-annotation-list-options"><NoteLabelFilter compact value={annotationFilter} onChange={setAnnotationFilter} />
                  <PdfAnnotationSortPicker value={annotationSort} onChange={setAnnotationSort} /></div>
                <p className="pdf-annotation-result-count" role="status" aria-label="批注检索结果">{filteredAnnotations.length + filteredTeamAnnotations.length} / {annotations.length + teamAnnotations.length} 条批注</p>
                {activeAnnotationId && !activeAnnotationVisible && annotations.some((annotation) => annotation.id === activeAnnotationId) ?
                  <Tooltip content="清除筛选并显示已选中的批注" relationship="description"><Button size="small" appearance="subtle" icon={<LocationRegular />}
                    onClick={() => { setAnnotationQuery(""); setAnnotationFilter(emptyNoteFilter); setAnnotationFacets(emptyPdfAnnotationFacets); }}>显示选中批注</Button></Tooltip> : null}
              </>}
              </div>
              {sidebarMode === "outline" ? (
                <PdfOutline document={pdfDocument} onNavigate={({ page, topRatio }) => navigateToPage(page, "auto", topRatio)} />
              ) : ((readerView === "pages" && sidebarMode === "thumbnails") || (readerView === "annotations" && sidebarMode === "annotations")) ? (
                <div className="pdf-overview-sidebar-note">
                  <p>{readerView === "pages" ? "全部页面已在阅读区展开。" : "全部批注已在阅读区展开。"}</p>
                  <Button onClick={closeOverview}>返回 PDF</Button>
                </div>
              ) : sidebarMode === "thumbnails" ? (
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
                  {annotationLoadError ? <div className="pdf-annotation-load-error" role="alert">
                    <p>{annotationLoadError}</p>
                    <Tooltip content="重试恢复批注" relationship="description">
                      <Button aria-label="重试恢复批注" appearance="subtle" size="small" icon={<ArrowClockwiseRegular />}
                        onClick={() => setAnnotationLoadAttempt((attempt) => attempt + 1)} />
                    </Tooltip>
                  </div> : null}
                  <div className="pdf-annotation-toolbar" role="toolbar" aria-label="批注工具">
                    <InfoPopover label="文献信息">
                      <h3>{activePaper?.title ?? "文献信息"}</h3>
                      {activePaper?.literature ? <LiteratureVersionRelations embedded key={activePaper.literature.literatureId}
                        currentLiterature={activePaper.literature} loadRelations={loadLiteratureRelations}
                        onAcquireVersion={onAcquireLiteratureVersion} onOpenVersion={onOpenLiteratureVersion} /> : <p>此文献尚无公共来源身份信息。</p>}
                      <h4>引用解析</h4><p>{citationParsing.modeDescription}</p>
                      {citationParsing.warning ? <p>{citationParsing.warning}</p> : null}
                    </InfoPopover>
                    <PaperReviewShareControl controller={reviewShare} />
                    <Popover positioning={{ position: "below", align: "start", autoSize: "always" }}><PopoverTrigger disableButtonEnhancement>
                      <IconAction label="批注选项" appearance="subtle" density="compact" icon={<SettingsRegular />} />
                    </PopoverTrigger><PopoverSurface aria-label="批注选项设置" className="pdf-annotation-settings-popover">
                      <Checkbox checked={autoPublicAnnotations} onChange={(_, data) => setAutoPublic(data.checked === true)} label="新批注自动公开到论坛" />
                    </PopoverSurface></Popover>
                  </div>
                  {readerPosition.error ? <InlineNotice intent="error" message={readerPosition.error} action={readerPosition.canRetry ? <ActionButton size="small" onClick={readerPosition.retrySave}>重试保存阅读位置</ActionButton> : undefined} /> : null}
                  {citationParsing.loading ? <InlineNotice intent="busy" message="正在提取结构化引用…" /> : null}
                  {citationParsing.warning ? <InlineNotice intent="warning" message="引用解析受限" action={<InfoPopover label="查看引用解析问题"><p>{citationParsing.warning}</p><p>{citationParsing.modeDescription}</p></InfoPopover>} /> : null}
                  {filteredAnnotations.length > 0 ? (
                    <ul className="pdf-annotation-list">
                      {filteredAnnotations.map((annotation) => (
                        <li
                          className={`pdf-annotation-item ${annotation.kind} ${
                            activeAnnotationId === annotation.id ? "expanded" : ""
                          }`}
                          key={annotation.id}
                          data-search-annotation={annotation.id}
                        >
                          {annotation.kind === "highlight" && annotation.color && (
                            <div
                              className="annotation-color-indicator"
                              style={{ backgroundColor: `var(--annotation-marker-${annotation.color}, ${getHighlightColor(annotation.color)})` }}
                            />
                          )}
                          <button
                            aria-expanded={activeAnnotationId === annotation.id}
                            aria-label={`编辑批注：${annotation.excerpt}`}
                            aria-description={`${annotation.quickAsk ? "速问" : getAnnotationLabel(annotation.kind)}，第 ${annotation.page} 页，${annotation.kind === "text" || annotation.kind === "ink" || annotation.quickAsk ? "仅保存在本地" : publicationStatus(annotation.publication)}`}
                            className="pdf-annotation-summary"
                            draggable={Boolean(objectWorkbench)}
                            onDragStart={(event) => dragAnnotation(annotation, event.dataTransfer)}
                            onClick={() => openAnnotationEditor(annotation)}
                            onKeyDown={(event) => navigatePdfAnnotationList(event, () => locateAnnotation(annotation))}
                            aria-keyshortcuts="Control+Enter Meta+Enter ArrowUp ArrowDown Home End"
                            onDoubleClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              locateAnnotation(annotation);
                            }}
                            title={`${annotation.quickAsk ? "速问" : getAnnotationLabel(annotation.kind)} · 第 ${annotation.page} 页；展开完整内容；双击或 Ctrl/⌘+Enter 定位原文；方向键浏览批注；拖到白板或对话添加引用`}
                            type="button"
                          >
                            <Tooltip content={annotation.quickAsk ? "速问" : getAnnotationLabel(annotation.kind)} relationship="description">
                              <span aria-label={annotation.quickAsk ? "速问" : getAnnotationLabel(annotation.kind)}
                                className="pdf-annotation-kind" role="img">{getAnnotationIcon(annotation)}</span>
                            </Tooltip>
                            <span className="pdf-annotation-summary-content">
                              <span className="pdf-annotation-excerpt"><SearchHighlight text={getAnnotationSummaryText(annotation)} query={annotationQuery} /></span>
                              {annotation.conflictOf ? <span className="pdf-annotation-type">同步冲突副本</span> : null}
                              {annotation.kind !== "text" && annotation.kind !== "ink" && activeAnnotationId !== annotation.id && (annotation.quickAsk?.question || annotation.note) ?
                                <span className="pdf-annotation-summary-note"><CommentRegular /><span><SearchHighlight text={annotation.quickAsk?.question ?? annotation.note ?? ""} query={annotationQuery} /></span></span> : null}
                            </span>
                            <Tooltip content={`第 ${annotation.page} 页；双击条目定位原文`} relationship="description">
                              <span className="pdf-annotation-page" aria-label={`第 ${annotation.page} 页`}><DocumentRegular />{annotation.page}</span>
                            </Tooltip>
                            <PdfAnnotationStatus
                              label={annotation.kind === "text" || annotation.kind === "ink" || annotation.quickAsk ? "仅保存在本地" : publicationStatus(annotation.publication)}
                              state={annotation.publication.state === "failed" ? "failed" : annotation.publication.state === "published" ? "public" :
                                annotation.publication.state === "not_published" ? "private" : "pending"}
                              live={activeAnnotationId === annotation.id}
                            />
                          </button>
                          {activeAnnotationId === annotation.id ? <div className="pdf-annotation-actions" role="toolbar" aria-label={`批注操作：${annotation.excerpt}`}>
                            <Tooltip content="定位到 PDF 原文" relationship="description">
                              <Button aria-label={`定位批注：${annotation.excerpt}`} appearance="subtle" size="small" icon={<LocationRegular />}
                                onClick={() => locateAnnotation(annotation)} />
                            </Tooltip>
                            {renderAnnotationReviewButton(annotation)}
                            {onEnterReadingMode ? <Tooltip content="在阅读模式查看批注" relationship="description">
                              <Button aria-label={`阅读模式查看批注：${annotation.excerpt}`} appearance="subtle" size="small" icon={<DocumentRegular />}
                                onClick={() => { setReadingAnnotationId(annotation.id); onEnterReadingMode(); }} />
                            </Tooltip> : null}
                            {objectWorkbench ? <>
                              <Tooltip content="拖动批注到研究白板" relationship="description">
                                <Button aria-label={`拖动批注到研究白板：${annotation.excerpt}`} appearance="subtle" size="small"
                                  icon={<DragRegular />} draggable onDragStart={(event) => dragAnnotation(annotation, event.dataTransfer)} />
                              </Tooltip>
                              {objectWorkbench.captureAnnotation ? <Tooltip content="加入研究白板" relationship="description">
                                <Button aria-label={`加入研究白板：${annotation.excerpt}`} appearance="subtle" size="small" icon={<WhiteboardRegular />}
                                  onClick={() => { if (activePaper) void objectWorkbench.captureAnnotation?.(annotationCaptureInput(annotation), "board").catch((error) => setStatus(error.message)); }} />
                              </Tooltip> : null}
                            </> : null}
                            {annotation.kind !== "text" && annotation.kind !== "ink" && !annotation.quickAsk ? <>
                              <Tooltip content={annotation.publication.desiredVisibility === "public" ? "取消勾选以从论坛撤回" : "公开到论坛"} relationship="description">
                                <Checkbox aria-label={`将第 ${annotation.page} 页${getAnnotationLabel(annotation.kind)}批注公开到论坛：${annotation.excerpt}`}
                                  checked={annotation.publication.desiredVisibility === "public"}
                                  onChange={(_, data) => setAnnotationPublic(annotation.id, data.checked === true)}
                                  label={<GlobeRegular />} />
                              </Tooltip>
                              {onShareAnnotationToOrganization ? <Tooltip content={sharingAnnotationId === annotation.id ? "正在共享到组织" : "共享批注到组织"} relationship="description">
                                <Button appearance="subtle" aria-label={`共享批注到组织：${annotation.excerpt}`} disabled={sharingAnnotationId !== null}
                                  icon={<ShareRegular />} onClick={() => void shareAnnotationToOrganization(annotation)} size="small" />
                              </Tooltip> : null}
                            </> : null}
                            <Tooltip content="删除批注" relationship="description">
                              <Button aria-label="删除" appearance="subtle" size="small" icon={<DeleteRegular />} disabled={deletingAnnotationIds.has(annotation.id)} onClick={() => requestAnnotationDeletion(annotation)} />
                            </Tooltip>
                            <Tooltip content="收起批注操作" relationship="description">
                              <Button aria-label="收起批注操作" appearance="subtle" size="small" icon={<ChevronUpRegular />} onClick={cancelAnnotationEditing} />
                            </Tooltip>
                          </div> : null}
                          {activeAnnotationId === annotation.id ? renderAnnotationReview(annotation) : null}
                          {activeAnnotationId === annotation.id && annotation.kind !== "text" && annotation.note && (
                            <div className="annotation-divider" />
                          )}
                          {activeAnnotationId === annotation.id && annotation.kind !== "text" ? (
                            <div className="pdf-annotation-editor">
                              {annotation.quickAsk ? <>
                                <strong>{annotation.quickAsk.question}</strong>
                                <PdfAnnotationMarkdown value={annotation.quickAsk.answer} /><QuickAskProvenance context={annotation.quickAsk.receipt?.context} answer={annotation.quickAsk.answer} />
                              </> : <>

                              <PdfAnnotationEditor value={annotationNoteDraft} onChange={setAnnotationNoteDraft}
                                onSave={saveAnnotationNote} onCancel={cancelAnnotationEditing} />
                              {annotation.kind === "highlight" && (
                                <div className="color-selector">
                                  {pdfHighlightColors.map((color) => <Tooltip key={color} content={`选择${pdfAnnotationColorLabels[color]}高亮`} relationship="description">
                                    <Button size="small" appearance="subtle" className="color-option"
                                      style={{ backgroundColor: getHighlightColor(color) }}
                                      aria-label={`选择${pdfAnnotationColorLabels[color]}高亮`} aria-pressed={(annotation.color ?? "yellow") === color}
                                      onClick={() => updateHighlightColor(annotation.id, color)}
                                      icon={(annotation.color ?? "yellow") === color ? <CheckmarkRegular /> : undefined} />
                                  </Tooltip>)}
                                </div>
                              )}
                              </>}
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="pdf-empty-note">{annotations.length ? "没有符合筛选条件的批注" : "暂无批注"}</div>
                  )}
                  {loadOrganizationAnnotations ? (
                    <section aria-label="团队批注" className="pdf-team-annotations">
                      <div className="pdf-sidebar-section-title">团队批注</div>
                      {filteredTeamAnnotations.length > 0 ? (
                        <ul className="pdf-annotation-list">
                          {filteredTeamAnnotations.map((annotation) => (
                            <li className="pdf-annotation-item note" key={annotation.annotationId}>
                              <span className="pdf-annotation-kind">
                                {organizationAnnotationActorId === annotation.uploadedBy ? "我" : "团队成员"} · 第 {annotation.body.page} 页
                              </span>
                              <span className="pdf-annotation-excerpt"><SearchHighlight text={annotation.body.excerpt} query={annotationQuery} /></span>
                              {annotation.body.note ? (
                                <div className="annotation-note-preview">{annotation.body.note}</div>
                              ) : null}
                              {editingTeamAnnotationId === annotation.annotationId ? (
                                <div className="annotation-note-editor">
                                  <MarkdownEditor documentKey={annotation.annotationId} label="编辑组织批注备注" value={teamAnnotationNoteDraft} onChange={(text) => setTeamAnnotationNoteDraft(text.slice(0, 10000))} />
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
              readingControls={<>{readingControls}{guideControls}{pdfAppearance && onPdfAppearanceChange ? <PdfAppearanceControl value={pdfAppearance} onChange={onPdfAppearanceChange} /> : null}</>}
              activeSearchIndex={activeSearchIndex}
              currentPage={focusedPage}
              layoutMode={layoutMode}
              matchCase={searchMatchCase}
              marginCommentConnectorsVisible={marginCommentConnectorsVisible}
              marginCommentsVisible={marginCommentsVisible}
              whiteboardOpen={objectWorkbench?.isOpen || (whiteboardOpen && (!objectWorkbench || legacyBoardPreview))}
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
                setInkMode(null);
                setTextBoxToolActive((current) => !current);
                setActiveTextAnnotationId(null);
                setSelection(null);
                setSelectionPreview(null);
              }}
              onToggleWhiteboard={() => { if (legacyBoardPreview && whiteboardOpen) { setWhiteboardOpen(false); setLegacyBoardPreview(false); return; } if (objectWorkbench?.isOpen) { objectWorkbench.close?.(); return; } if (objectWorkbench && activePaper && whiteboardStorageKey) { void objectWorkbench.openLegacyBoard(activePaper,resolvedWhiteboardDocument(),whiteboardStorageKey).catch((e) => { setLegacyBoardPreview(true); setWhiteboardOpen(true); setStatus(`白板迁移失败，正在只读显示原快照：${e.message}`); }); } else setWhiteboardOpen((current) => !current); }}
              onZoomIn={() => { viewportAnchor.capture(); onZoomChange?.(Math.min(180, zoom + 5)); }}
              onZoomOut={() => { viewportAnchor.capture(); onZoomChange?.(Math.max(70, zoom - 5)); }}
              pageCount={pageCount}
              searchOpen={searchOpen}
              searchTags={searchMetadata.tags}
              searchQuery={searchQuery}
              searchResultCount={searchMatches.length}
              inkActive={inkMode !== null}
              onToggleInk={() => {
                setInkMode((current) => current ? null : "draw"); setTextBoxToolActive(false);
                setSelection(null); setSelectionPreview(null); setActiveTextAnnotationId(null);
              }}
              textBoxToolActive={textBoxToolActive}
              wholeWords={searchWholeWords}
              zoom={zoom}
            />
            {inkMode ? <div className="pdf-ink-tools" role="toolbar" aria-label="手绘工具">
              <Button size="small" appearance={inkMode === "draw" ? "primary" : "subtle"} icon={<DrawShapeRegular />} aria-label="画笔" title="画笔" onClick={() => setInkMode("draw")}>画笔</Button>
              <Button size="small" appearance={inkMode === "erase" ? "primary" : "subtle"} icon={<EraserRegular />} aria-label="橡皮擦" title="点击删除一条笔迹" onClick={() => setInkMode("erase")}>橡皮擦</Button>
              <label>颜色 <input type="color" aria-label="笔迹颜色" value={inkColor} onChange={(event) => setInkColor(event.target.value)} /></label>
              <label>粗细 <input type="range" aria-label="画笔粗细" min={.1} max={1.2} step={.1} value={inkWidth} onChange={(event) => setInkWidth(Number(event.target.value))} /></label>
              <Button size="small" appearance="subtle" icon={<ArrowUndoRegular />} aria-label="撤销本页最后笔迹" title="撤销本页最后笔迹"
                disabled={!annotations.some((annotation) => annotation.kind === "ink" && annotation.page === focusedPage)}
                onClick={() => { const last = annotations.filter((annotation) => annotation.kind === "ink" && annotation.page === focusedPage).sort((a, b) => Date.parse(a.inkLastStrokeAt ?? a.createdAt) - Date.parse(b.inkLastStrokeAt ?? b.createdAt)).at(-1); if (last) deleteInkStroke(last, pdfInkStrokes(last).length - 1); }} />
              <Button size="small" appearance="subtle" onClick={() => setInkMode(null)}>完成手绘</Button>
            </div> : null}
            {targetEvidence?.paperId === activePaper?.id ? (
              <div aria-live="polite" className="pdf-evidence-status" role="status">
                {status}
              </div>
            ) : null}
          </div>
          <div
            aria-label="PDF 页面滚动区"
            className={`pdf-stage ${readerView !== "document" ? "is-overview" : ""} ${textBoxToolActive ? "text-box-tool-active" : ""}`}
            onContextMenu={readerView === "document" ? handleSelectionContextMenu : undefined}
            onCopy={readerView === "document" ? handleStageCopy : undefined}
            onMouseUp={readerView === "document" ? handleTextSelection : undefined}
            onPointerCancel={readerView === "document" ? handleSelectionPointerCancel : undefined}
            onPointerDown={readerView === "document" ? handleSelectionPointerDown : undefined}
            onPointerMove={readerView === "document" ? handleSelectionPointerMove : undefined}
            onPointerUp={readerView === "document" ? handleSelectionPointerUp : undefined}
            onKeyDown={readerView === "document" ? handleStageKeyDown : (event) => { if (event.key === "Escape") closeOverview(); }}
            ref={stageRef}
            style={{ overflowAnchor: "none" }}
            tabIndex={0}
          >
            {readerView === "document" && documentHasNoTextLayer ? (
              <p className="pdf-page-text-unavailable" role="note">
                本篇没有可用文本层，无法按字符定位。完成 OCR 后才能选中正文与定位证据。
              </p>
            ) : null}
            {readerView === "pages" ? (
              <PdfPagesOverview document={pdfDocument} count={pageCount} currentPage={focusedPage}
                annotations={annotations} onNavigate={navigateToPage} onClose={closeOverview} />
            ) : readerView === "annotations" ? (
              <PdfAnnotationsOverview searchMetadata={searchMetadata} annotations={annotations} teamAnnotations={teamAnnotations}
                paperIdentity={activePaper ? resolvePaperIdentity(activePaper) : undefined}
                error={annotationLoadError} onNavigate={locateAnnotation} onClose={closeOverview} />
            ) : <div className="pdf-document-frame" ref={documentFrameRef}>
              <div
                aria-label="PDF.js 页面列表"
                className={`pdf-page-list responsive layout-${layoutMode} ${
                  hasVisibleMarginComments ? "with-margin-comments" : ""
                }`}
              >
                {pageNumbers.map((pageNumber) => (
                  <PdfPageView
                    readingBackground={pdfBackground} preserveImages={pdfAppearance?.preserveImages !== false}
                    activeSearchMatch={activeSearchMatch}
                    inkMode={inkMode} inkColor={inkColor} inkWidth={inkWidth} onInkCreate={createInkAnnotation}
                    onInkDeleteStroke={deleteInkStroke}
                    onAnnotationDrag={objectWorkbench ? dragAnnotation : undefined}
                    activeTextAnnotationId={activeTextAnnotationId}
                    activePaper={activePaper}
                    annotations={visibleAnnotations}
                    focused={pageNumber === focusedPage}
                    key={pageNumber}
                    layoutVisible={visiblePageNumbers.has(pageNumber)}
                    marginCommentConnectorsVisible={marginCommentConnectorsVisible}
                    marginCommentsVisible={hasVisibleMarginComments}
                    noTextLayer={scannedPages.has(pageNumber)}
                    onEvidenceHighlightResolved={handleEvidenceHighlightResolved}
                    onAnnotationActivate={openPageAnnotationEditor}
                    onPageCharModelRendered={handlePageCharModelRendered}
                    onPageTextRendered={handlePageTextRendered}
                    onTextAnnotationActivate={setActiveTextAnnotationId}
                    onTextAnnotationCommit={commitTextAnnotation}
                    onTextAnnotationDelete={(annotation) => { if (annotation.kind === "ink") void deleteAnnotation(annotation); else requestAnnotationDeletion(annotation); }}
                    onTextAnnotationMove={moveTextAnnotation}
                    onTextAnnotationOpacityChange={changeTextAnnotationOpacity}
                    pageNumber={pageNumber}
                    renderActive={renderedPages.has(pageNumber) && visiblePageNumbers.has(pageNumber)}
                    renderPriority={pageNumber === focusedPage ? 0 : [...renderedPages].indexOf(pageNumber) + 1}
                    defaultPageSize={defaultPageSize}
                    pixelRatio={pixelRatio}
                    pdfDocument={pdfDocument}
                    linksEnabled={!inkMode && !textBoxToolActive}
                    onInternalNavigate={({ page, topRatio }) => navigateToPage(page, "auto", topRatio)}
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
            </div>}
            {selection ? (
              <PdfSelectionMenu stageRef={stageRef} anchor={{ left: selection.menuLeft, top: selection.menuTop, placement: selection.menuPlacement }}>
                <PaperSelectionTools extensionActions={activePaper ? <ReaderExtensionActions input={{ paper: activePaper, ...selection }} /> : undefined} color={selectedColor} onColorChange={setSelectedColor}
                  lookup={selectionLookup ? () => { setLookupMode("auto"); setLookupOpen(true); setLookupDismissed(false); } : undefined}
                  aiLookup={selectionLookup ? () => { setLookupMode("explain"); setLookupOpen(true); setLookupDismissed(false); } : undefined}
                  highlight={() => addAnnotation("highlight")} underline={() => addAnnotation("underline")}
                  copy={() => void copySelectedText()} board={addSelectionToWhiteboard} dragBoard={handleSelectionWhiteboardDragStart}
                  tray={objectWorkbench ? () => { if (activePaper) void objectWorkbench.capturePdf({ paper: activePaper, ...selection }, "tray").catch((e) => setStatus(e.message)); } : undefined}
                  conversation={addSelectionToConversation} quickAsk={onQuickAsk ? () => {
                    quickAskTask.open(selection); setQuickAskContext(undefined); setSelection(null); setSelectionPreview(null); clearBrowserSelection(); setAnnotationPopup(null);
                  } : undefined} />
                {selectionLookup && !lookupDismissed && (lookupOpen || selectionLookup.autoQuery) ? <SelectionLookupCard
                  key={`${activePaper?.id}:${selection.page}:${selection.excerpt}`}
                  initialMode={lookupMode}
                  lookup={selectionLookup} text={selection.excerpt} paperId={activePaper?.id} paperTitle={activePaper?.title}
                  context={selectionLookupContext(pageTexts[selection.page] ?? "", selection.excerpt, selection.normalizedStart)}
                  onClose={() => { setLookupOpen(false); setLookupDismissed(true); }}
                  onSave={hydratedAnnotationStorageKey === annotationStorageKey && !annotationLoadError ? (note, lookupKind) => createReadingAnnotation({ page: selection.page, excerpt: selection.excerpt, note, lookupKind }) : undefined}
                  onExplain={onQuickAsk ? () => {
                    quickAskTask.open(selection, "请结合所在句子解释这个单词或短语在论文中的具体含义，说明它与常见释义的关系。"); setQuickAskContext(undefined); setSelection(null); setSelectionPreview(null); clearBrowserSelection(); setAnnotationPopup(null);
                  } : undefined} /> : null}
              </PdfSelectionMenu>
            ) : null}
            {reviewPromptId ? <GenerationPromptDialog task="annotation_review" title="AI 评阅批注" onClose={() => setReviewPromptId(undefined)} onConfirm={(systemPrompt) => {
              const id = reviewPromptId; setReviewPromptId(undefined); void annotationReview.generate(id, systemPrompt);
            }} /> : null}
            {annotationPopup && popupAnnotation && (guide.visible || !popupAnnotation.aiGuide) ? (
              <aside
                aria-label={`${popupAnnotation.aiGuide ? "AI 讲解" : popupAnnotation.quickAsk ? "速问回答" : `${getAnnotationLabel(popupAnnotation.kind)}注释编辑器`}：${popupAnnotation.excerpt}`}
                className={`pdf-annotation-popover pdf-annotation-fluent is-${annotationPopup.placement}`}
                onKeyDown={(event) => {
                  if (event.key === "Escape") cancelAnnotationEditing();
                }}
                style={{ left: `clamp(min(172px, 50%), ${annotationPopup.left}px, calc(100% - min(172px, 50%)))`, top: annotationPopup.top }}
              >
                <header>
                  <strong>{popupAnnotation.aiGuide ? guideCategories[popupAnnotation.aiGuide.category] : popupAnnotation.quickAsk ? "速问" : getAnnotationLabel(popupAnnotation.kind)} · 第 {popupAnnotation.page} 页</strong>
                  <Tooltip content="关闭注释编辑器" relationship="description"><Button aria-label="关闭注释编辑器" appearance="subtle" size="small" icon={<DismissRegular />} onClick={cancelAnnotationEditing} /></Tooltip>
                </header>
                <p className="pdf-annotation-popover-excerpt">{popupAnnotation.excerpt}</p>
                {!popupAnnotation.aiGuide && renderAnnotationReviewButton(popupAnnotation)}
                {renderAnnotationReview(popupAnnotation)}
                {popupAnnotation.aiGuide ? <>
                  <strong>{popupAnnotation.text}</strong>
                  <PdfAnnotationMarkdown value={popupAnnotation.note ?? ""} />
                  <small>AI 讲解 · 请结合原文判断</small>
                  <DisclosureSection title="编辑讲解"><PdfAnnotationEditor inline value={annotationNoteDraft} onChange={setAnnotationNoteDraft}
                    onSave={saveAnnotationNote} onCancel={cancelAnnotationEditing} /></DisclosureSection>
                </> : popupAnnotation.quickAsk ? <>
                  <strong>{popupAnnotation.quickAsk.question}</strong>
                  <PdfAnnotationMarkdown value={popupAnnotation.quickAsk.answer} /><QuickAskProvenance context={popupAnnotation.quickAsk.receipt?.context} answer={popupAnnotation.quickAsk.answer} />
                </> : <>
                <PdfAnnotationEditor inline value={annotationNoteDraft} onChange={setAnnotationNoteDraft}
                  onSave={saveAnnotationNote} onCancel={cancelAnnotationEditing} />
                </>}
              </aside>
            ) : null}
          </div>
        </section>
        {whiteboardOpen && activePaper && (!objectWorkbench || legacyBoardPreview) ? (
          <div className="pdf-whiteboard-pane">
          <PdfPaneResizeHandle width={whiteboardWidth} onChange={setWhiteboardWidth} />
          <PdfWhiteboard
            document={whiteboardState.storageKey === whiteboardStorageKey
              ? whiteboardState.document
              : createEmptyPdfWhiteboard(activePaper.id)}
            key={whiteboardStorageKey ?? activePaper.id}
            onChange={objectWorkbench ? () => setStatus("原快照仅供阅读，请重试迁移后编辑。") : updateWhiteboardDocument}
            onClose={() => setWhiteboardOpen(false)}
            paperTitle={activePaper.title}
          />
          </div>
        ) : null}
      </div>
    </section>
  );
}
