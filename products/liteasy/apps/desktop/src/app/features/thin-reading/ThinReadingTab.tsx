import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Button, Switch, Tooltip } from "@fluentui/react-components";
import {
  ArrowLeftRegular,
  ArrowRightRegular,
  BranchForkRegular,
  ChevronRightRegular,
  LightbulbRegular,
  LinkRegular,
  TextBulletListTreeRegular
} from "@fluentui/react-icons";
import {
  addThinReadingAnnotation,
  deleteThinReadingAnnotation,
  findThinReadingChildBySource,
  listThinReadingBranchOptions,
  resolveThinReadingClosureState,
  setThinReadingAnnotationPublic,
  setThinReadingAutoPublic,
  updateThinReadingAnnotation
} from "./thinReadingProjection";
import {
  AssociationGraphLayer,
  AssociationReadingOverlay,
  type PageGraphAnchorView
} from "../associations/AssociationGraphLayer";
import { useAnchorRects } from "../associations/useAnchorRects";
import { listThinReadingPendingPublicAnnotations } from "./thinReadingIntuechoSyncQueue";
import { getThinReadingPaperTypeLabel } from "./thinReadingPromptRegistry";
import { getThinReadingUiCopy } from "./thinReadingI18n";
import { MermaidPreview } from "../mermaid/MermaidPreview";
import { HtmlDemoPreview } from "../visualization/HtmlDemoPreview";
import {
  useThinReadingCommunityRecommendations,
  type ThinReadingCommunityRecommendationState
} from "./useThinReadingCommunityRecommendations";
import { useThinReadingPaperRelations } from "./useThinReadingPaperRelations";
import type { ThinReadingPaperRelationsTransport } from "./thinReadingPaperRelationsClient";
import type { ForumFeedQuery, ForumPaperIdentity, ForumPost } from "../forum/forum.types";
import { resolvePaperIdentity } from "../paper-identity/paperIdentity";
import type {
  ThinReadingAnnotationTarget,
  ThinReadingAnchor,
  ThinReadingBranchSource,
  ThinReadingDocument,
  ThinReadingNodeV2,
  ThinReadingEvidenceSpan,
  ThinReadingExternalSource,
  ThinReadingQuickCommand,
  ThinReadingRequestedOutput,
  ThinReadingSummarySentence
} from "./thinReading.types";
import type { MineruFigure } from "../import/import.types";
import type { VisualizationTabData } from "../visualization/visualization.types";
import type { VisualizationArtifactV1 } from "../visualization/visualizationArtifact.types";
import type { MultimodalVisualizationCapability } from "../account/accountCapabilitiesClient";
import type { ThinReadingVisualizationStatus } from "../artifacts/artifact.types";
import { ThinReadingVisualizationRegion } from "./ThinReadingVisualizationRegion";
import { ThinReadingSourceFigures, type ThinReadingSourceFigure } from "./ThinReadingSourceFigures";
import { ThinReadingGraphView } from "./ThinReadingGraphView";
import type { ThinReadingGraphMode } from "./ThinReadingGraphView";
import { AgentLiveWorkPanel } from "../agent-work/AgentLiveWorkPanel";
import "./thinReading.css";

export type ThinReadingEvidenceOpenRequest = {
  evidenceId: string;
  page: number;
  pageTextEnd?: number;
  pageTextStart?: number;
  textExtraction?: "embedded" | "mineru" | "ocr";
  paperId: string;
  quote: string;
};

export type ThinReadingTabProps = {
  artifactId: string;
  developerDiagnostics?: boolean;
  document: ThinReadingDocument;
  generationProgress?: {
    message: string;
    partialAnswer?: string;
    progress: number;
    runKey?: string;
    stageLabel?: string;
  };
  communityRecommendationState?: ThinReadingCommunityRecommendationState;
  intuechoEndpoint?: string;
  intuechoSessionId?: string;
  paperRelationsEndpoint?: string;
  paperRelationsTransport?: ThinReadingPaperRelationsTransport;
  figures?: readonly MineruFigure[];
  headerAction?: ReactNode;
  onLoadForumFeed?: (query: ForumFeedQuery) => Promise<ForumPost[]>;
  taskFailureMessage?: string;
  onGenerateBranch?: (input: {
    artifactId: string;
    document: ThinReadingDocument;
    source: ThinReadingBranchSource;
  }) => Promise<void>;
  onOpenExternalFullText?: (source: ThinReadingExternalSource) => Promise<void>;
  onOpenEvidence?: (request: ThinReadingEvidenceOpenRequest) => void;
  onOpenVisualization?: (data: VisualizationTabData) => void;
  onPromoteExternalPaperToLibrary?: (source: ThinReadingExternalSource) => Promise<void>;
  onRetryInterruptedBranch?: () => Promise<void>;
  onSyncIntuecho?: (input: { artifactId: string; document: ThinReadingDocument }) => Promise<void>;
  onToggleVisualization?: (enabled: boolean) => void;
  onUpdateDocument: (artifactId: string, nextDocument: ThinReadingDocument) => void;
  papers: Array<{
    arxivId?: string;
    authors?: readonly string[] | string;
    doi?: string;
    id: string;
    semanticScholarId?: string;
    title: string;
    year?: number | string;
  }>;
  visualizationArtifacts?: readonly VisualizationArtifactV1[];
  visualizationCapability?: MultimodalVisualizationCapability;
  visualizationStatus?: ThinReadingVisualizationStatus;
};

type ThinReadingSelection = {
  bottom?: number;
  evidenceIds: readonly string[];
  externalSourceIds: readonly string[];
  excerpt: string;
  left: number;
  target: ThinReadingAnnotationTarget;
  top?: number;
};

type SelectionRect = Pick<DOMRect, "bottom" | "left" | "top">;

type RecommendationStage = "article" | "marks" | "graph";

const selectionQuickCommands = [
  {
    description: "用单文件 HTML 动画把步骤按顺序演给读者看。",
    label: "将这个算法做成 HTML 动画",
    prompt: "请把这段内容做成一个真正易懂的 HTML 动画：用单文件内联 HTML/CSS/SVG，逐步展示算法关键步骤，只呈现证据支持的状态变化，并配 2-3 句简短说明。",
    quickCommand: "html_algorithm_animation",
    requestedOutput: "html_demo"
  },
  {
    description: "用 HTML/SVG 画清关键部件、连接关系和信息流。",
    label: "将这个结构用 HTML/SVG 描绘出来",
    prompt: "请用单文件内联 HTML/SVG 把这段结构画清楚：突出部件、连接关系和信息流，标签尽量少但易懂，并配 2-3 句说明。",
    quickCommand: "html_svg_structure",
    requestedOutput: "html_demo"
  },
  {
    description: "把因果链压缩成 Mermaid 图和几句白话解释。",
    label: "用 mermaid 图呈现这段话的因果关系",
    prompt: "请用 Mermaid 图呈现这段话的因果链：节点命名口语化、边上写因果动作，正文压缩成 3-5 句浅显解释。",
    quickCommand: "mermaid_causal",
    requestedOutput: "mermaid"
  }
] as const satisfies ReadonlyArray<{
  description: string;
  label: string;
  prompt: string;
  quickCommand: ThinReadingQuickCommand;
  requestedOutput: ThinReadingRequestedOutput;
}>;

const selectionPopoverGutter = 12;
const selectionPopoverPreferredWidth = 480;
const selectionPopoverMinimumVerticalSpace = 80;

export function resolveThinReadingSelectionPopoverPosition(
  rect: SelectionRect,
  viewport: { height: number; width: number }
) {
  const width = Math.max(0, viewport.width);
  const height = Math.max(0, viewport.height);
  const preferredWidth = Math.min(
    selectionPopoverPreferredWidth,
    Math.max(0, width - selectionPopoverGutter * 2)
  );
  const left = Math.min(
    Math.max(selectionPopoverGutter, rect.left),
    Math.max(selectionPopoverGutter, width - selectionPopoverGutter - preferredWidth)
  );
  const top = Math.max(selectionPopoverGutter, rect.bottom + 10);
  const canPlaceBelow = height - top >= selectionPopoverMinimumVerticalSpace;

  if (!canPlaceBelow && rect.top > selectionPopoverMinimumVerticalSpace) {
    return {
      bottom: Math.max(selectionPopoverGutter, height - rect.top + 10),
      left
    };
  }

  return {
    left,
    top: Math.min(top, Math.max(selectionPopoverGutter, height - selectionPopoverGutter))
  };
}

function sourceLabel(
  source: ThinReadingDocument["nodes"][string]["source"],
  labels: { overview: string; selectedText: string }
): string {
  if (source.kind === "omitted_section") {
    return source.label;
  }
  if (source.kind === "selected_text") {
    return labels.selectedText;
  }
  return labels.overview;
}

function branchSourceLabel(
  source: ThinReadingDocument["nodes"][string]["source"],
  labels: ReturnType<typeof getThinReadingUiCopy>
) {
  if (source.kind === "omitted_section") {
    return labels.omittedSection;
  }
  return sourceLabel(source, labels);
}

function splitSummarySentences(summary: string) {
  const matches = summary.replace(/\s+/g, " ").trim().match(/[^。！？!?]+[。！？!?]?/g) ?? [];
  return matches.map((sentence) => sentence.trim()).filter(Boolean);
}

function getSummarySentences(
  node: ThinReadingDocument["nodes"][string]
): readonly ThinReadingSummarySentence[] {
  if (node.evidence.summarySentences && node.evidence.summarySentences.length > 0) {
    return node.evidence.summarySentences;
  }
  const sentences = splitSummarySentences(node.summary);
  return (sentences.length > 0 ? sentences : [node.summary]).map((sentence, index) => ({
    // Legacy artifacts lack a sentence-level source mapping; never infer one from a node-level claim.
    evidenceIds: [],
    externalKnowledge: [],
    id: `${node.id}-summary-sentence-${index}`,
    status: "unsupported",
    text: sentence
  }));
}

type SummaryTextSegment = {
  anchor?: ThinReadingAnchor;
  text: string;
};

export function splitThinReadingSummaryTextByAnchors(input: {
  anchors: readonly ThinReadingAnchor[];
  sentence: ThinReadingSummarySentence;
}): SummaryTextSegment[] {
  const applicableAnchors = input.anchors
    .filter((anchor) => (
      anchor.summarySentenceId === input.sentence.id &&
      anchor.start >= 0 &&
      anchor.end > anchor.start &&
      anchor.end <= input.sentence.text.length &&
      input.sentence.text.slice(anchor.start, anchor.end) === anchor.text
    ))
    .sort((left, right) => left.start - right.start || right.end - left.end);
  const segments: SummaryTextSegment[] = [];
  let cursor = 0;
  for (const anchor of applicableAnchors) {
    if (anchor.start < cursor) {
      continue;
    }
    if (anchor.start > cursor) {
      segments.push({ text: input.sentence.text.slice(cursor, anchor.start) });
    }
    segments.push({ anchor, text: anchor.text });
    cursor = anchor.end;
  }
  if (cursor < input.sentence.text.length || segments.length === 0) {
    segments.push({ text: input.sentence.text.slice(cursor) });
  }
  return segments;
}

export function ThinReadingTab({
  artifactId,
  developerDiagnostics = false,
  communityRecommendationState,
  document,
  generationProgress,
  figures = [],
  headerAction,
  intuechoEndpoint,
  intuechoSessionId,
  onLoadForumFeed,
  taskFailureMessage,
  onGenerateBranch,
  onOpenExternalFullText,
  onOpenEvidence,
  onOpenVisualization,
  onPromoteExternalPaperToLibrary,
  onRetryInterruptedBranch,
  onSyncIntuecho,
  onToggleVisualization,
  onUpdateDocument,
  paperRelationsEndpoint = "",
  paperRelationsTransport,
  papers,
  visualizationArtifacts = [],
  visualizationCapability,
  visualizationStatus
}: ThinReadingTabProps) {
  const [legacyActiveNodeId, setLegacyActiveNodeId] = useState(document.activeNodeId);
  const displayedActiveNodeId = document.version === "liteasy.thin-reading/v1"
    ? legacyActiveNodeId
    : document.activeNodeId;
  const activeNode = document.nodes[displayedActiveNodeId] ?? document.nodes[document.rootNodeId];
  const activeLegacyEvidence = document.version === "liteasy.thin-reading/v1"
    ? (document.nodes[displayedActiveNodeId] ?? document.nodes[document.rootNodeId]).evidence
    : undefined;
  const fetchedCommunityRecommendationState = useThinReadingCommunityRecommendations({
    endpoint: intuechoEndpoint,
    sessionId: intuechoSessionId,
    scope: activeNode.recommendationScope
  });
  const resolvedCommunityRecommendationState = communityRecommendationState ?? fetchedCommunityRecommendationState;
  const contentRef = useRef<HTMLDivElement>(null);
  const recommendationButtonRef = useRef<HTMLButtonElement>(null);
  const associationReturnFocusRef = useRef<HTMLElement | null>(null);
  const generationLockRef = useRef(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [selection, setSelection] = useState<ThinReadingSelection | null>(null);
  const [prompt, setPrompt] = useState("");
  const [annotationBody, setAnnotationBody] = useState("");
  const [annotationPublic, setAnnotationPublic] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [retryingInterruptedBranch, setRetryingInterruptedBranch] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [generationNotice, setGenerationNotice] = useState("");
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const [recommendationStage, setRecommendationStage] = useState<RecommendationStage>("article");
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [externalPaperActionId, setExternalPaperActionId] = useState<string | null>(null);
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [editingAnnotationBody, setEditingAnnotationBody] = useState("");
  const [intuechoCollapsed, setIntuechoCollapsed] = useState(false);
  const [graphMode, setGraphMode] = useState<ThinReadingGraphMode | null>(null);
  const [syncingIntuecho, setSyncingIntuecho] = useState(false);
  const [forumPosts, setForumPosts] = useState<ForumPost[]>([]);
  const [forumState, setForumState] = useState<"idle" | "loading" | "ready" | "error" | "unmapped">("idle");
  const [forumRefresh, setForumRefresh] = useState(0);
  const [expandedRecommendationId, setExpandedRecommendationId] = useState<string | null>(null);
  useEffect(() => {
    if (document.version === "liteasy.thin-reading/v1") {
      setLegacyActiveNodeId(document.activeNodeId);
    }
  }, [artifactId, document.activeNodeId, document.version]);
  const paperRelations = useThinReadingPaperRelations({
    artifactId,
    enabled: recommendationStage === "graph",
    endpoint: paperRelationsEndpoint,
    node: activeNode,
    onPersist: (recommendationPaperEdges) => {
      if (document.version === "liteasy.thin-reading/v1") return;
      const node = document.nodes[activeNode.id];
      if (!node) return;
      onUpdateDocument(artifactId, {
        ...document,
        nodes: {
          ...document.nodes,
          [node.id]: {
            ...node,
            evidence: { ...node.evidence, recommendationPaperEdges }
          }
        }
      });
    },
    transport: paperRelationsTransport
  });
  const labels = getThinReadingUiCopy(document.targetLanguage);
  const generationInProgress = generating || Boolean(generationProgress);
  const paperTitle = useMemo(
    () => papers.find((paper) => document.paperIds.includes(paper.id))?.title ?? labels.untitledPaper,
    [document.paperIds, labels.untitledPaper, papers]
  );
  const linkedPaper = papers.find((paper) => document.paperIds.includes(paper.id));
  const forumPaperIdentity = linkedPaper ? resolvePaperIdentity(linkedPaper).primary : null;
  const stableForumPaperIdentity = forumPaperIdentity?.kind === "local_paper_id" ? null : forumPaperIdentity;

  useEffect(() => {
    let active = true;
    if (!onLoadForumFeed) return undefined;
    if (!stableForumPaperIdentity) {
      setForumPosts([]);
      setForumState("unmapped");
      return undefined;
    }
    setForumState("loading");
    void onLoadForumFeed({
      paperIdentity: {
        id: stableForumPaperIdentity.id,
        kind: stableForumPaperIdentity.kind as ForumPaperIdentity["kind"],
        source: stableForumPaperIdentity.source === "metadata" ? "metadata" : "inferred",
        value: stableForumPaperIdentity.value
      }
    }).then((posts) => {
      if (active) {
        setForumPosts(posts);
        setForumState("ready");
      }
    }).catch(() => active && setForumState("error"));
    return () => {
      active = false;
    };
  }, [activeNode.id, forumRefresh, onLoadForumFeed, stableForumPaperIdentity?.id]);

  useEffect(() => {
    function refreshForumFeed() {
      setForumRefresh((current) => current + 1);
    }
    window.addEventListener("focus", refreshForumFeed);
    return () => window.removeEventListener("focus", refreshForumFeed);
  }, []);
  const primaryIdentity = document.paperIdentities?.[document.paperIds[0] ?? ""]?.primary;
  const parent = activeNode.parentId ? document.nodes[activeNode.parentId] : undefined;
  const branches = listThinReadingBranchOptions(document, activeNode.id);
  const pendingPublicQueue = useMemo(
    () => listThinReadingPendingPublicAnnotations(document),
    [document]
  );
  const canGoBack = Boolean(parent);
  const paperTypeLabel = activeNode.paperType
    ? getThinReadingPaperTypeLabel(activeNode.paperType, document.targetLanguage)
    : "";
  const closureState = resolveThinReadingClosureState(activeNode);
  const externalSourceById = useMemo(
    () => new Map((activeNode.evidence.externalSources ?? []).map((source) => [source.id, source])),
    [activeNode.evidence.externalSources]
  );
  const figureById = useMemo(
    () => new Map(figures.map((figure) => [figure.id, figure])),
    [figures]
  );
  const inlineFigures = useMemo(() => {
    const recommendedFigures = activeNode.evidence.recommendedFigures ?? [];
    if (recommendedFigures.length > 0) {
      return recommendedFigures.flatMap((recommendation) => {
        const figure = figureById.get(recommendation.figureId);
        if (!figure) {
          return [];
        }
        return [{
          evidenceIds: recommendation.evidenceIds,
          figure,
          reason: recommendation.reason,
          recommendedBy: "agent" as const
        }];
      });
    }
    const evidencePages = new Set(
      (activeNode.evidence.paperEvidenceSpans ?? [])
        .map((span) => span.page)
        .filter((page): page is number => typeof page === "number" && Number.isFinite(page))
    );
    const contextTerms = `${activeNode.title} ${activeNode.summary}`
      .toLocaleLowerCase()
      .match(/[a-z][a-z0-9-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? [];
    const hasSharedTerm = (figure: MineruFigure) => {
      const description = `${figure.analysis?.title ?? ""} ${figure.analysis?.description ?? ""}`.toLocaleLowerCase();
      return contextTerms.some((term) => description.includes(term));
    };
    const ranked = [...figures].sort((left, right) => {
      const rank = (importance: NonNullable<MineruFigure["analysis"]>["importance"] | undefined) => (
        importance === "primary" ? 0 : importance === "supporting" ? 1 : 2
      );
      return rank(left.analysis?.importance) - rank(right.analysis?.importance);
    });
    const relevant = ranked.filter((figure) => (
      evidencePages.has(figure.page) || hasSharedTerm(figure) ||
      (activeNode.id === document.rootNodeId && figure.analysis?.importance === "primary")
    )).filter((figure) => figure.analysis?.importance !== "reference");
    // A page without a specific source match should stay text-first: showing a merely
    // attractive chart is worse than leaving a reader with an honest gap.
    return relevant.slice(0, 2).map((figure) => ({
      evidenceIds: [] as string[],
      figure,
      reason: figure.analysis?.selectionReason ?? "与当前论点的原文证据页相连，可回到 PDF 核对。",
      recommendedBy: "fallback" as const
    }));
  }, [activeNode, document.rootNodeId, figureById, figures]);

  useEffect(() => {
    setBranchMenuOpen(false);
    setSelection(null);
    setPrompt("");
    setActiveAnchorId(null);
    setActiveSourceId(null);
    associationReturnFocusRef.current = null;
    setRecommendationStage("article");
  }, [activeNode.id]);

  // Escape removes exactly one layer: paper card, graph, then concept marks.
  useEffect(() => {
    if (recommendationStage === "article") return undefined;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (activeSourceId) {
        setActiveSourceId(null);
        const returnTarget = associationReturnFocusRef.current;
        if (returnTarget?.isConnected) {
          returnTarget.focus();
        } else {
          recommendationButtonRef.current?.focus();
        }
        return;
      }
      if (recommendationStage === "graph") {
        setActiveAnchorId(null);
        setRecommendationStage("marks");
        recommendationButtonRef.current?.focus();
        return;
      }
      setActiveAnchorId(null);
      setRecommendationStage("article");
      recommendationButtonRef.current?.focus();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeSourceId, recommendationStage]);

  function update(nextDocument: ThinReadingDocument) {
    if (document.version === "liteasy.thin-reading/v1") return;
    onUpdateDocument(artifactId, nextDocument);
  }

  function updateAndSyncPublic(nextDocument: ThinReadingDocument) {
    update(nextDocument);
    if (!onSyncIntuecho || listThinReadingPendingPublicAnnotations(nextDocument).length === 0) return;
    setSyncingIntuecho(true);
    void onSyncIntuecho({ artifactId, document: nextDocument })
      .catch((error) => setGenerationError(error instanceof Error ? error.message : String(error)))
      .finally(() => setSyncingIntuecho(false));
  }

  function goToNode(nodeId: string) {
    if (document.version === "liteasy.thin-reading/v1") {
      setLegacyActiveNodeId(nodeId);
      setBranchMenuOpen(false);
      return;
    }
    update({ ...document, activeNodeId: nodeId });
    setBranchMenuOpen(false);
  }

  function inspectSelection() {
    const currentSelection = window.getSelection();
    const excerpt = currentSelection?.toString().trim() ?? "";
    const range = currentSelection && currentSelection.rangeCount > 0 ? currentSelection.getRangeAt(0) : null;
    const content = contentRef.current;
    if (!content || !excerpt || !range || !content.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }
    if (!selectionIsInLayerBody(range)) {
      setSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const target = annotationTargetForSelection(range);
    const externalSourceIds = summaryExternalSourceIdsForSelection(range);
    setSelection({
      evidenceIds: summaryEvidenceIdsForSelection(range),
      externalSourceIds: [...new Set(externalSourceIds)],
      excerpt,
      ...resolveThinReadingSelectionPopoverPosition(rect, {
        height: window.innerHeight,
        width: window.innerWidth
      }),
      target,
    });
  }

  function summaryEvidenceIdsForSelection(range: Range) {
    return summarySourceIdsForSelection(range, "data-thin-reading-summary-evidence-ids");
  }

  function selectionIsInLayerBody(range: Range) {
    const element = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer as HTMLElement
      : range.commonAncestorContainer.parentElement;
    return Boolean(
      !element?.closest("[data-thin-reading-ignore-selection]") &&
      element?.closest("[data-thin-reading-layer-body]")
    );
  }

  function summaryExternalSourceIdsForSelection(range: Range) {
    return summarySourceIdsForSelection(range, "data-thin-reading-summary-external-source-ids");
  }

  function summarySourceIdsForSelection(range: Range, attribute: string) {
    const content = contentRef.current;
    if (!content) {
      return [];
    }
    const commonElement = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer as HTMLElement
      : range.commonAncestorContainer.parentElement;
    const sentenceElements = [...content.querySelectorAll<HTMLElement>(`[${attribute}]`)];
    const intersecting = sentenceElements.filter((element) => {
      if (typeof range.intersectsNode === "function") {
        return range.intersectsNode(element);
      }
      return element.contains(range.commonAncestorContainer) || commonElement?.contains(element);
    });
    return [...new Set(intersecting.flatMap((element) => (
      (element.getAttribute(attribute) ?? "").split(",").filter(Boolean)
    )))];
  }

  function annotationTargetForSelection(range: Range): ThinReadingAnnotationTarget {
    const element = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer as HTMLElement
      : range.commonAncestorContainer.parentElement;
    const targetElement = element?.closest<HTMLElement>("[data-thin-reading-annotation-target]");
    if (targetElement?.dataset.thinReadingAnnotationTarget === "external_knowledge") {
      const source = targetElement.dataset.thinReadingExternalSource;
      if (source) {
        return { kind: "external_knowledge", nodeId: activeNode.id, source };
      }
    }
    if (targetElement?.dataset.thinReadingAnnotationTarget === "recommendation") {
      const recommendationId = targetElement.dataset.thinReadingRecommendationId;
      if (recommendationId) {
        return { kind: "recommendation", nodeId: activeNode.id, recommendationId };
      }
    }
    return { kind: "node_summary", nodeId: activeNode.id };
  }

  async function generateBranch(source: ThinReadingBranchSource) {
    if (generationLockRef.current || generationInProgress) {
      setGenerationNotice("已有一项薄读生成正在运行，请等待它完成，避免产生重复内容。");
      return;
    }
    generationLockRef.current = true;
    setGenerationError("");
    setGenerationNotice("请求已提交。薄读 Agent 正在工作，请勿重复点击；可以继续阅读当前页面。");
    try {
      const existingChild = findThinReadingChildBySource(document, activeNode.id, source);
      if (existingChild) {
        goToNode(existingChild.id);
        return;
      }
      if (!onGenerateBranch) {
        setGenerationError(labels.unavailableAgent);
        return;
      }
      setGenerating(true);
      const branchDocument = document.version === "liteasy.thin-reading/v1"
        ? { ...document, activeNodeId: activeNode.id }
        : document;
      await onGenerateBranch({ artifactId, document: branchDocument, source });
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(false);
      generationLockRef.current = false;
      setGenerationNotice("");
    }
  }

  async function retryInterruptedBranch() {
    if (!onRetryInterruptedBranch || generationInProgress) return;
    setGenerationError("");
    setRetryingInterruptedBranch(true);
    try {
      await onRetryInterruptedBranch();
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : String(error));
    } finally {
      setRetryingInterruptedBranch(false);
    }
  }

  function saveSelectionAnnotation() {
    if (!selection || !annotationBody.trim()) return;
    const nextDocument = addThinReadingAnnotation(document, {
      body: annotationBody,
      excerpt: selection.excerpt,
      nodeId: activeNode.id,
      target: selection.target,
      ...(annotationPublic ? { visibility: "pending_public" as const } : {})
    });
    updateAndSyncPublic(nextDocument);
    setAnnotationBody("");
    setSelection(null);
  }

  function buildSelectionBranchSource(input: {
    promptText?: string;
    quickCommand?: ThinReadingQuickCommand;
    requestedOutput?: ThinReadingRequestedOutput;
  } = {}): ThinReadingBranchSource | null {
    if (!selection || selection.target.kind !== "node_summary") {
      return null;
    }
    const trimmedPrompt = input.promptText?.trim() ?? "";
    return {
      kind: "selected_text",
      excerpt: selection.excerpt,
      ...(selection.evidenceIds.length > 0 ? { evidenceIds: selection.evidenceIds } : {}),
      ...(selection.externalSourceIds.length > 0 ? { externalSourceIds: selection.externalSourceIds } : {}),
      ...(trimmedPrompt ? { prompt: trimmedPrompt } : {}),
      ...(input.quickCommand ? { quickCommand: input.quickCommand } : {}),
      ...(input.requestedOutput ? { requestedOutput: input.requestedOutput } : {})
    };
  }

  async function deepenSelection() {
    const source = buildSelectionBranchSource({ promptText: prompt });
    if (!source) return;
    setSelection(null);
    setPrompt("");
    await generateBranch(source);
  }

  async function runSelectionQuickCommand(command: typeof selectionQuickCommands[number]) {
    const supplement = prompt.trim();
    const source = buildSelectionBranchSource({
      promptText: (supplement
        ? `${command.prompt}\n\n用户补充：${supplement}`
        : command.prompt).slice(0, 600),
      quickCommand: command.quickCommand,
      requestedOutput: command.requestedOutput
    });
    if (!source) {
      return;
    }
    setSelection(null);
    setPrompt("");
    await generateBranch(source);
  }

  function annotateBlock(input: {
    excerpt: string;
    target: ThinReadingAnnotationTarget;
  }) {
    update(addThinReadingAnnotation(document, {
      body: input.excerpt,
      excerpt: input.excerpt,
      nodeId: activeNode.id,
      target: input.target
    }));
  }

  function openEvidenceSpan(span: ThinReadingEvidenceSpan) {
    if (!onOpenEvidence || typeof span.page !== "number" || !Number.isFinite(span.page)) {
      return;
    }
    onOpenEvidence({
      evidenceId: span.id,
      page: Math.max(1, Math.trunc(span.page)),
      ...(typeof span.pageTextEnd === "number" ? { pageTextEnd: span.pageTextEnd } : {}),
      ...(typeof span.pageTextStart === "number" ? { pageTextStart: span.pageTextStart } : {}),
      ...(span.textExtraction ? { textExtraction: span.textExtraction } : {}),
      paperId: span.paperId,
      quote: span.quote
    });
  }

  function openSummaryMarkerEvidence(
    event: ReactMouseEvent<HTMLButtonElement>,
    span: ThinReadingEvidenceSpan
  ) {
    event.preventDefault();
    event.stopPropagation();
    openEvidenceSpan(span);
  }

  function preserveTextSelection(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (window.getSelection()?.toString().trim()) {
      event.preventDefault();
    }
  }

  // Clicking a concept in the prose opens the graph on it. The mark keeps its place in the
  // sentence; the layer draws around it rather than replacing the text with a list.
  function toggleActiveAnchor(anchorId: string) {
    if (window.getSelection()?.toString().trim()) {
      return;
    }
    setActiveSourceId(null);
    setActiveAnchorId(recommendationStage === "graph" && activeAnchorId === anchorId ? null : anchorId);
    setRecommendationStage("graph");
  }

  function advanceRecommendationStage() {
    if (recommendationStage === "graph") {
      setActiveAnchorId(null);
      setActiveSourceId(null);
      setRecommendationStage("article");
      return;
    }
    setRecommendationStage(recommendationStage === "article" ? "marks" : "graph");
  }

  function restoreAssociationFocus() {
    const returnTarget = associationReturnFocusRef.current;
    if (returnTarget?.isConnected) {
      returnTarget.focus();
      return;
    }
    recommendationButtonRef.current?.focus();
  }

  function selectAssociationSource(sourceId: string) {
    if (sourceId) {
      associationReturnFocusRef.current = globalThis.document.activeElement instanceof HTMLElement
        ? globalThis.document.activeElement
        : null;
      setActiveSourceId(sourceId);
      return;
    }
    setActiveSourceId(null);
    restoreAssociationFocus();
  }

  function popAssociationStage() {
    if (activeSourceId) {
      setActiveSourceId(null);
      restoreAssociationFocus();
      return;
    }
    setRecommendationStage("marks");
    setActiveAnchorId(null);
    recommendationButtonRef.current?.focus();
  }

  async function runAnchorPaperAction(
    source: ThinReadingExternalSource,
    action: (source: ThinReadingExternalSource) => Promise<void>
  ) {
    if (externalPaperActionId) {
      return;
    }
    setGenerationError("");
    setExternalPaperActionId(source.id);
    try {
      await action(source);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : String(error));
    } finally {
      setExternalPaperActionId(null);
    }
  }

  function advanceOmittedSection(sectionKey: string, label: string) {
    void generateBranch({ kind: "omitted_section", label, sectionKey });
  }

  async function syncIntuecho() {
    if (!onSyncIntuecho || syncingIntuecho) {
      return;
    }
    setSyncingIntuecho(true);
    try {
      await onSyncIntuecho({ artifactId, document });
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncingIntuecho(false);
    }
  }

  function handleNextClick() {
    if (branches.length === 1) {
      goToNode(branches[0].nodeId);
      return;
    }
    setBranchMenuOpen((open) => !open);
  }

  const nextLabel = labels.next;
  const previousLabel = labels.previous(parent?.title ?? labels.overview);
  const nodeAnnotations = document.annotations.filter((annotation) => annotation.nodeId === activeNode.id);
  const paperEvidenceSpans = activeNode.evidence.paperEvidenceSpans ?? [];
  const summarySentences = getSummarySentences(activeNode);
  const sourceFigures = inlineFigures as readonly ThinReadingSourceFigure[];
  const activeVisualizations = [
    ...(document.version === "liteasy.thin-reading/v2" ? (activeNode as ThinReadingNodeV2).visualizations : []),
    ...visualizationArtifacts.filter((artifact) => artifact.nodeId === activeNode.id)
  ].filter((artifact, index, all) => all.findIndex((candidate) => candidate.artifactId === artifact.artifactId) === index);
  const anchors = activeNode.evidence.anchors ?? [];
  const activeAnchor = anchors.find((anchor) => anchor.id === activeAnchorId) ?? null;
  const marksVisible = recommendationStage !== "article";
  const associationGraphOpen = recommendationStage === "graph";

  /*
   * The association graph over the generated article.
   *
   * The anchors are already in the prose as marks, and the sources they point at are already on
   * the artifact — so all the graph needs is where those marks landed after the text was laid out.
   * That is measured, never computed: the same sentence wraps differently at another width.
   */
  const anchorSourcesByAnchorId = useMemo(() => Object.fromEntries(
    anchors
      .map((anchor) => [
        anchor.id,
        anchor.externalSourceIds.flatMap((sourceId) => {
          const source = externalSourceById.get(sourceId);
          return source ? [source] : [];
        })
      ] as const)
      .filter(([, sources]) => sources.length > 0)
  ), [anchors, externalSourceById]);
  const anchorMeasurement = useAnchorRects({
    containerRef: contentRef,
    enabled: associationGraphOpen,
    signature: `${activeNode.id}|${anchors.length}|${intuechoCollapsed}`
  });
  const graphAnchorViews = useMemo<PageGraphAnchorView[]>(() => anchors.flatMap((anchor) => {
    const rects = anchorMeasurement.rectsByAnchorId[anchor.id];
    return rects && rects.length > 0
      ? [{ anchorId: anchor.id, kind: anchor.kind, label: anchor.label, quality: anchor.quality, rects }]
      : [];
  }), [anchorMeasurement, anchors]);
  const graphSourceCount = useMemo(
    () => Object.values(anchorSourcesByAnchorId).reduce((total, sources) => total + sources.length, 0),
    [anchorSourcesByAnchorId]
  );
  const activeSource = activeSourceId
    ? externalSourceById.get(activeSourceId) ?? null
    : null;
  const associationStateLabel = activeSource
    ? "阅读位"
    : associationGraphOpen
      ? activeAnchor ? "聚焦概念" : "页级关联图"
      : marksVisible ? "概念标记" : "正文";
  const associationStateCopy = activeSource
    ? `正在阅读「${activeSource.title}」`
      : associationGraphOpen
      ? activeAnchor
        ? `正在聚焦「${activeAnchor.label}」及其关联文献`
        : "页级文献关联已展开"
      : anchors.length === 0
        // A disabled control has to say why, or it reads as broken rather than as empty.
        ? "本节无相关推荐"
        : marksVisible
          ? "概念标记已显示"
          : "相关推荐未展开";
  const recommendationTooltip = recommendationStage === "article"
    ? "显示概念标记"
    : recommendationStage === "marks"
      ? "打开页级关联图"
      : "返回正文";
  const visibleGenerationProgress = generationProgress ?? (generating
    ? { message: generationNotice || labels.generating, partialAnswer: undefined, progress: null, runKey: "local-thin-reading", stageLabel: "薄读 Agent 已启动" }
    : null);
  const visibleGenerationError = generationError || taskFailureMessage;
  const ancestorPath = [] as Array<ThinReadingDocument["nodes"][string]>;
  const visitedNodeIds = new Set<string>();
  let pathNode: ThinReadingDocument["nodes"][string] | undefined = activeNode;
  while (pathNode && !visitedNodeIds.has(pathNode.id)) {
    ancestorPath.unshift(pathNode);
    visitedNodeIds.add(pathNode.id);
    pathNode = pathNode.parentId ? document.nodes[pathNode.parentId] : undefined;
  }

  return (
    <main
      className={`thin-reading ${closureState === "outside_paper" ? "is-external" : ""} ${closureState === "near_boundary" ? "is-near-boundary" : ""} ${intuechoCollapsed ? "is-intuecho-collapsed" : ""}`}
      aria-label={labels.page}
    >
      <header className="thin-reading__topbar">
        <div className="thin-reading__heading">
          <span className="thin-reading__eyebrow">THIN READING</span>
          <h1>{document.title}</h1>
          <span className="thin-reading__source">
            {labels.source(paperTitle)}
            {primaryIdentity ? ` · ${primaryIdentity.kind}:${primaryIdentity.value}` : ""}
            {primaryIdentity?.kind === "local_paper_id" ? ` (${labels.identityLocalOnly})` : ""}
          </span>
        </div>
        <div className="thin-reading__controls">
          {headerAction}
          <span className="thin-reading__language">{labels.languageName}</span>
          <Tooltip content="控制生成可视化" positioning="below" relationship="description">
            <span className="thin-reading__visualization-toggle">
              <Switch
                checked={Boolean(visualizationCapability?.allowed && visualizationCapability.enabled)}
                disabled={!visualizationCapability?.allowed}
                label="多模态"
                onChange={(_, data) => onToggleVisualization?.(data.checked)}
              />
              {!visualizationCapability?.allowed ? <small>暂不可用</small> : null}
              {visualizationCapability?.allowed && visualizationStatus?.status === "generating" ? <small>生成中</small> : null}
              {visualizationCapability?.allowed && visualizationStatus?.status === "omitted" ? <small>已简化</small> : null}
              {visualizationCapability?.allowed && visualizationStatus?.status === "idle" ? <small>未生成</small> : null}
            </span>
          </Tooltip>
          <div className="thin-reading__depth-nav">
            <button aria-label={previousLabel} disabled={!canGoBack} onClick={() => parent && goToNode(parent.id)} type="button">
              <ArrowLeftRegular aria-hidden="true" />
            </button>
            <span>{labels.depth(activeNode.depth)}</span>
            <div className="thin-reading__next-wrap" onMouseEnter={() => branches.length > 1 && setBranchMenuOpen(true)}>
              <button
                aria-expanded={branches.length > 1 ? branchMenuOpen : undefined}
                aria-haspopup={branches.length > 1 ? "menu" : undefined}
                aria-label={nextLabel}
                disabled={branches.length === 0}
                onClick={handleNextClick}
                onFocus={() => branches.length > 1 && setBranchMenuOpen(true)}
                type="button"
              >
                <ArrowRightRegular aria-hidden="true" />
              </button>
              {branchMenuOpen && branches.length > 1 ? (
                <div className="thin-reading__branch-menu" role="menu" aria-label={labels.generatedBranches}>
                  {branches.map((branch) => (
                    <button className="thin-reading__branch-item" key={branch.nodeId} onClick={() => goToNode(branch.nodeId)} role="menuitem" type="button">
                      <span>{branch.title}</span>
                      <small>{branchSourceLabel(document.nodes[branch.nodeId]?.source ?? activeNode.source, labels)} · {labels.depth(branch.depth)}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="thin-reading__breadcrumbs" aria-label={labels.thinReadingDepth}>
        {ancestorPath.map((node, index) => (
          <span className="thin-reading__breadcrumb-item" key={node.id}>
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            {node.id === activeNode.id ? (
              <span aria-current="page" className="is-active">{node.id === document.rootNodeId ? labels.overview : node.title}</span>
            ) : (
              <button onClick={() => goToNode(node.id)} type="button">
                {node.id === document.rootNodeId ? labels.overview : node.title}
              </button>
            )}
          </span>
        ))}
      </div>

      {visibleGenerationProgress ? (
        developerDiagnostics ? (
          <AgentLiveWorkPanel
            floating
            markdown={visibleGenerationProgress.partialAnswer}
            message={generationNotice || visibleGenerationProgress.message}
            progress={visibleGenerationProgress.progress}
            progressLabel={labels.generationProgress}
            runKey={visibleGenerationProgress.runKey}
            stageLabel={visibleGenerationProgress.stageLabel}
          />
        ) : (
          <div aria-live="polite" className="thin-reading__generation-status" role="status">
            {labels.generatingPrivately}
          </div>
        )
      ) : null}

      {graphMode === null ? (
        <div className="thin-reading__graph-entry" aria-label="选择薄读结构图形式" role="group">
          <span>结构图</span>
          <button onClick={() => setGraphMode("network")} type="button">
            <BranchForkRegular aria-hidden="true" />
            关系网络
          </button>
          <button onClick={() => setGraphMode("mindmap")} type="button">
            <TextBulletListTreeRegular aria-hidden="true" />
            思维导图
          </button>
        </div>
      ) : (
        <ThinReadingGraphView
          activeNodeId={activeNode.id}
          document={document}
          onClose={() => setGraphMode(null)}
          onOpenInTab={onOpenVisualization
            ? () => onOpenVisualization({
                document,
                id: `thin-reading-graph:${artifactId}`,
                kind: "thin_reading_graph",
                title: `${document.title} · ${graphMode === "mindmap" ? "薄读层次思维导图" : "薄读页面网络"}`,
                viewMode: graphMode
              })
            : undefined}
          onSelectNode={goToNode}
          onViewModeChange={setGraphMode}
          viewMode={graphMode}
        />
      )}

      {/* Kept above the body so the graph never covers its own control. */}
      <div aria-label="相关推荐工具" className="thin-reading__modebar">
        <Tooltip content={recommendationTooltip} positioning="below" relationship="description">
          <Button
            appearance="subtle"
            aria-label="相关推荐"
            aria-pressed={recommendationStage !== "article"}
            className={`thin-reading__mode ${recommendationStage !== "article" ? "is-active" : ""}`}
            disabled={anchors.length === 0}
            icon={<LinkRegular />}
            onClick={advanceRecommendationStage}
            ref={recommendationButtonRef}
            size="small"
            title={recommendationTooltip}
          >
            相关推荐
          </Button>
        </Tooltip>
        <span className="thin-reading__mode-state">
          <span className="thin-reading__mode-pill">{associationStateLabel}</span>
          <span className="thin-reading__mode-copy">{associationStateCopy}</span>
        </span>
      </div>

      <div
        className={`thin-reading__body${associationGraphOpen ? " is-graph-dimmed" : ""}${
          marksVisible ? "" : " is-marks-hidden"
        }`}
        onKeyUp={inspectSelection}
        onMouseUp={inspectSelection}
        ref={contentRef}
      >
        <article className="thin-reading__article" data-testid="thin-reading-node">
          {paperTypeLabel ? <div className="thin-reading__article-meta">{paperTypeLabel}</div> : null}
          {closureState === "near_boundary" ? (
            <section className="thin-reading__near-boundary" aria-label={labels.nearBoundary}>
              <strong>{labels.nearBoundary}</strong>
              <span>{labels.nearBoundaryReason}</span>
            </section>
          ) : null}
          <h2>{activeNode.title}</h2>
          <ThinReadingVisualizationRegion artifacts={activeVisualizations} status={visualizationStatus} />
          <section data-testid="thin-reading-prose">
            <div
              className="thin-reading__summary"
              data-thin-reading-annotation-target="node_summary"
              data-thin-reading-layer-body
              data-testid="thin-reading-summary"
            >
              {summarySentences.map((sentence, index) => {
                return (
                  <div className="thin-reading__summary-unit" key={sentence.id}>
                    <p
                      className="thin-reading__summary-paragraph"
                      data-thin-reading-annotation-target="node_summary"
                      data-thin-reading-layer-body
                    >
                      <span
                        className="thin-reading__summary-sentence"
                        data-thin-reading-summary-evidence-ids={sentence.evidenceIds.join(",")}
                        data-thin-reading-summary-external-source-ids={sentence.externalKnowledge.join(",")}
                      >
                        {splitThinReadingSummaryTextByAnchors({ anchors, sentence }).map((segment, segmentIndex) => (
                          segment.anchor ? (
                            <mark
                              aria-label={marksVisible ? `查看“${segment.anchor.label}”关联论文` : undefined}
                              aria-pressed={marksVisible ? activeAnchor?.id === segment.anchor.id : undefined}
                              className={`thin-reading__anchor${marksVisible ? "" : " is-hidden"}${activeAnchor?.id === segment.anchor.id ? " is-active" : ""}`}
                              data-anchor-id={segment.anchor.id}
                              data-thin-reading-anchor-id={segment.anchor.id}
                              data-thin-reading-summary-external-source-ids={segment.anchor.externalSourceIds.join(",")}
                              key={segment.anchor.id}
                              onClick={marksVisible ? () => toggleActiveAnchor(segment.anchor!.id) : undefined}
                              onKeyDown={marksVisible ? (event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  toggleActiveAnchor(segment.anchor!.id);
                                }
                              } : undefined}
                              role={marksVisible ? "button" : undefined}
                              tabIndex={marksVisible ? 0 : -1}
                              title={marksVisible
                                ? `${segment.anchor.label} · ${Math.round(segment.anchor.importance * 100)}%`
                                : undefined}
                            >
                              {segment.text}
                            </mark>
                          ) : <span key={`${sentence.id}-text-${segmentIndex}`}>{segment.text}</span>
                        ))}
                    {sentence.evidenceIds.map((evidenceId, evidenceIndex) => {
                      const span = paperEvidenceSpans.find((candidate) => candidate.id === evidenceId);
                      const canOpenEvidence = Boolean(
                        span &&
                        onOpenEvidence &&
                        typeof span.page === "number" &&
                        Number.isFinite(span.page)
                      );
                      return (
                        <sup key={`${sentence.id}-${evidenceId}`}>
                          {canOpenEvidence ? (
                            <button
                              aria-label={labels.evidenceOpen(sentence.text, evidenceIndex + 1)}
                              className="thin-reading__summary-marker"
                              onClick={(event) => openSummaryMarkerEvidence(event, span!)}
                              title={labels.evidenceOpenTitle(evidenceId)}
                              type="button"
                            >
                              {labels.evidencePaper(evidenceIndex + 1)}
                            </button>
                          ) : (
                            <span
                              className="thin-reading__summary-marker is-static"
                              title={labels.evidenceUnavailableTitle(evidenceId)}
                            >
                              {labels.evidencePaper(evidenceIndex + 1)}
                            </span>
                          )}
                        </sup>
                      );
                    })}
                    {sentence.externalKnowledge.map((sourceId, sourceIndex) => {
                      const source = externalSourceById.get(sourceId);
                      return (
                        <sup key={`${sentence.id}-${sourceId}`}>
                          {source ? (
                            <a
                              aria-label={labels.evidenceExternalOpen(source.title)}
                              className="thin-reading__summary-marker"
                              data-thin-reading-annotation-target="external_knowledge"
                              data-thin-reading-external-source={source.id}
                              href={source.url}
                              onClick={preserveTextSelection}
                              rel="noreferrer"
                              target="_blank"
                              title={`${labels.evidenceExternalRelation(source.relation)} · ${labels.evidenceExternalTitle([source.title])}`}
                            >
                              {labels.evidenceExternal(sourceIndex + 1)}
                            </a>
                          ) : (
                            <span
                              className="thin-reading__summary-marker is-static"
                              title={labels.evidenceExternalTitle([sourceId])}
                            >
                              {labels.evidenceExternal(sourceIndex + 1)}
                            </span>
                          )}
                        </sup>
                      );
                    })}
                      </span>
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
          {activeLegacyEvidence ? (
            <section aria-label="旧版薄读来源" className="thin-reading__legacy-source">
              <h3>旧版薄读来源（只读）</h3>
              {activeLegacyEvidence.mermaid ? (
                <MermaidPreview code={activeLegacyEvidence.mermaid} onOpenInTab={() => onOpenVisualization?.({ code: activeLegacyEvidence.mermaid!, id: `mermaid:${artifactId}:${activeNode.id}`, kind: "mermaid", title: `${activeNode.title} · 关系与流程` })} title="关系与流程" />
              ) : null}
              {activeLegacyEvidence.interactiveDemo ? (
                <HtmlDemoPreview
                  description={activeLegacyEvidence.interactiveDemo.description}
                  html={activeLegacyEvidence.interactiveDemo.html}
                  onOpenInTab={onOpenVisualization
                    ? () => onOpenVisualization({
                        description: activeLegacyEvidence.interactiveDemo!.description,
                        html: activeLegacyEvidence.interactiveDemo!.html,
                        id: `html-demo:${artifactId}:${activeNode.id}`,
                        kind: "html_demo",
                        title: activeLegacyEvidence.interactiveDemo!.title
                      })
                    : undefined}
                  title={activeLegacyEvidence.interactiveDemo.title}
                />
              ) : null}
            </section>
          ) : null}
          <ThinReadingSourceFigures figures={sourceFigures.slice(0, 2)} />
          {activeNode.omittedSections.length > 0 ? (
            <section className="thin-reading__omitted" aria-label={labels.omittedRegion}>
              <div className="thin-reading__omitted-actions">
                {activeNode.omittedSections.map((section) => (
                  <button
                    aria-label={labels.deepenOmittedSection(section.label)}
                    disabled={generationInProgress}
                    key={section.id}
                    onClick={() => advanceOmittedSection(section.sectionKey, section.label)}
                    type="button"
                  >
                    <span className="thin-reading__omitted-copy">
                      <span className="thin-reading__omitted-cue">{labels.deepenOmittedAction}</span>
                      <span className="thin-reading__omitted-topic">{section.label}</span>
                    </span>
                    <span className="thin-reading__omitted-icon">
                      <ArrowRightRegular aria-hidden="true" />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {visibleGenerationError ? <div className="thin-reading__error">{visibleGenerationError}</div> : null}
          {onRetryInterruptedBranch ? (
            <div className="thin-reading__recovery">
              <button disabled={generationInProgress || retryingInterruptedBranch} onClick={() => void retryInterruptedBranch()} type="button">
                {retryingInterruptedBranch ? labels.retryingInterrupted : labels.retryInterrupted}
              </button>
              <small>{labels.retryInterruptedDescription}</small>
            </div>
          ) : null}
          <section className="thin-reading__annotations" aria-label={labels.annotationRegion}>
            <div className="thin-reading__annotation-toolbar">
              <h3>{labels.annotate}</h3>
              <label>
                <input
                  checked={document.annotationSettings.autoPublic}
                  onChange={(event) => update(setThinReadingAutoPublic(document, event.currentTarget.checked))}
                  type="checkbox"
                />
                {labels.autoPublic}
              </label>
            </div>
            {nodeAnnotations.length > 0 ? nodeAnnotations.map((annotation) => (
              <article className="thin-reading__annotation" key={annotation.id}>
                <small>{annotation.excerpt}</small>
                {editingAnnotationId === annotation.id ? (
                  <>
                    <textarea
                      aria-label={labels.editAnnotation}
                      disabled={syncingIntuecho}
                      onChange={(event) => setEditingAnnotationBody(event.target.value)}
                      value={editingAnnotationBody}
                    />
                    <div className="thin-reading__annotation-actions">
                      <button disabled={syncingIntuecho} onClick={() => {
                        updateAndSyncPublic(updateThinReadingAnnotation(document, annotation.id, editingAnnotationBody));
                        setEditingAnnotationId(null);
                      }} type="button">{labels.save}</button>
                      <button disabled={syncingIntuecho} onClick={() => setEditingAnnotationId(null)} type="button">{labels.cancel}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p>{annotation.body}</p>
                    {annotation.visibility === "pending_public" ? <span className="thin-reading__pending">{labels.pendingSync}</span> : null}
                    {annotation.syncState?.status === "synced" ? <span className="thin-reading__pending">{labels.synced}</span> : null}
                    {annotation.syncState?.status === "failed" ? <span className="thin-reading__pending">{labels.syncFailed}</span> : null}
                    <div className="thin-reading__annotation-actions">
                      <label>
                        <input
                          checked={annotation.visibility === "pending_public"}
                          disabled={syncingIntuecho}
                          onChange={(event) => updateAndSyncPublic(setThinReadingAnnotationPublic(document, annotation.id, event.currentTarget.checked))}
                          type="checkbox"
                        />
                        {labels.public}
                      </label>
                      <button disabled={syncingIntuecho} onClick={() => {
                        setEditingAnnotationId(annotation.id);
                        setEditingAnnotationBody(annotation.body);
                      }} type="button">{labels.edit}</button>
                      <button disabled={syncingIntuecho} onClick={() => update(deleteThinReadingAnnotation(document, annotation.id))} type="button">{labels.delete}</button>
                    </div>
                  </>
                )}
              </article>
            )) : <p className="thin-reading__annotation-empty">{labels.annotationEmpty}</p>}
            {pendingPublicQueue.length > 0 ? (
              <div className="thin-reading__pending-summary">
                <span>{labels.pendingSync} · {pendingPublicQueue.length}</span>
                <button disabled={!onSyncIntuecho || syncingIntuecho} onClick={() => void syncIntuecho()} type="button">{labels.syncNow}</button>
              </div>
            ) : null}
          </section>
        </article>

        {intuechoCollapsed ? (
          <button
            aria-expanded="false"
            aria-label={labels.expandIntuecho}
            className="thin-reading__intuecho-floating"
            onClick={() => setIntuechoCollapsed(false)}
            title={labels.expandIntuecho}
            type="button"
          >
            <LightbulbRegular aria-hidden="true" />
          </button>
        ) : (
          <aside className="thin-reading__intuecho" aria-label={labels.recommendationRegion}>
                <button
                  aria-expanded="true"
                  aria-label={labels.collapseIntuecho}
                  className="thin-reading__intuecho-toggle"
                  onClick={() => setIntuechoCollapsed(true)}
                  title={labels.collapseIntuecho}
                  type="button"
                >
                  <ChevronRightRegular aria-hidden="true" />
                </button>
            <div className="thin-reading__intuecho-mark">∿</div>
            <h2>论坛</h2>
            <p className="thin-reading__intuecho-caption">{labels.communityRecommendationCaption}</p>
            {onLoadForumFeed ? (
              <div className="thin-reading__forum-feed">
                {forumState === "loading" ? <span>正在读取共享批注…</span> : null}
                {forumState === "error" ? <span>论坛暂时无法连接。</span> : null}
                {forumState === "unmapped" ? <span>补全文献身份后可读取共享批注。</span> : null}
                {forumState === "ready" && forumPosts.length === 0 ? <span>暂无相关批注。</span> : null}
                {forumPosts.map((post) => (
                  <a
                    className="thin-reading__forum-post"
                    href={`${import.meta.env.VITE_FORUM_WEB_URL ?? "http://127.0.0.1:5174"}/?literatureIdentityKind=${encodeURIComponent(stableForumPaperIdentity?.kind ?? "")}&literatureIdentityValue=${encodeURIComponent(stableForumPaperIdentity?.value ?? "")}`}
                    key={post.id}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <strong>{post.title ?? "共享批注"}</strong>
                    <span>{post.body}</span>
                    <small>{post.author_name} · 有帮助 {post.helpful}</small>
                  </a>
                ))}
              </div>
            ) : null}
                {resolvedCommunityRecommendationState.status === "unconfigured" ? (
                  <p className="thin-reading__recommendation-empty">{labels.communityRecommendationUnconfigured}</p>
                ) : null}
                {resolvedCommunityRecommendationState.status === "unavailable" ? (
                  <p className="thin-reading__recommendation-empty">{labels.communityRecommendationUnavailable}</p>
                ) : null}
                {resolvedCommunityRecommendationState.status === "loading" ? (
                  <p className="thin-reading__recommendation-empty" role="status">{labels.communityRecommendationLoading}</p>
                ) : null}
                {resolvedCommunityRecommendationState.status === "error" ? (
                  <p className="thin-reading__error" role="alert">
                    {labels.communityRecommendationFailed(resolvedCommunityRecommendationState.message)}
                  </p>
                ) : null}
                {resolvedCommunityRecommendationState.status === "ready" ? (
                  resolvedCommunityRecommendationState.recommendations.length === 0 ? (
                    <p className="thin-reading__recommendation-empty">{labels.communityRecommendationEmpty}</p>
                  ) : (
                    <div className="thin-reading__recommendations">
                      {resolvedCommunityRecommendationState.recommendations.map((recommendation) => (
                        <div
                          className={`thin-reading__recommendation${expandedRecommendationId === recommendation.id ? " is-expanded" : ""}`}
                          data-thin-reading-annotation-target="recommendation"
                          data-thin-reading-recommendation-id={recommendation.id}
                          key={recommendation.id}
                          onClick={() => setExpandedRecommendationId((current) => current === recommendation.id ? null : recommendation.id)}
                        >
                          <strong>{recommendation.relationship}</strong>
                          <small className="thin-reading__recommendation-source">{labels.communityRecommendation}</small>
                          <span>{recommendation.note}</span>
                          <div className="thin-reading__recommendation-actions">
                            <button onClick={(event) => { event.stopPropagation(); annotateBlock({
                              excerpt: recommendation.note,
                              target: { kind: "recommendation", nodeId: activeNode.id, recommendationId: recommendation.id }
                            }); }} type="button">{labels.annotate}</button>
                            <a href={`${import.meta.env.VITE_FORUM_WEB_URL ?? "http://127.0.0.1:5174"}/annotations/${encodeURIComponent(recommendation.id)}`} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank">Web</a>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : null}
          </aside>
        )}

        {/* Inside the body, in the body's own coordinates: the layer scrolls with the article and
            never re-lays-out while the reader moves through it. */}
        {associationGraphOpen ? (
          <AssociationGraphLayer
            activeSourceId={activeSourceId}
            anchors={graphAnchorViews}
            documentHeight={anchorMeasurement.height}
            focusedAnchorId={activeAnchorId}
            frameWidth={anchorMeasurement.width}
            onClose={popAssociationStage}
            onFocusAnchor={setActiveAnchorId}
            onSelectSource={selectAssociationSource}
            paperEdges={paperRelations.edges}
            sourcesByAnchor={anchorSourcesByAnchorId}
          />
        ) : null}
      </div>

      {associationGraphOpen ? (
        <AssociationReadingOverlay
          activeSource={activeSource}
          anchorCount={graphAnchorViews.length}
          anchored="viewport"
          emptyAnchorsMessage="这一节的正文没有可展开的概念。"
          emptySourcesMessage="这些概念还没有检索到可验证的关联文献。"
          onAddToLibrary={onPromoteExternalPaperToLibrary
            ? (source) => void runAnchorPaperAction(source, onPromoteExternalPaperToLibrary)
            : undefined}
          onClose={popAssociationStage}
          onOpenFullText={onOpenExternalFullText
            ? (source) => void runAnchorPaperAction(source, onOpenExternalFullText)
            : undefined}
          onSelectSource={selectAssociationSource}
          sourceCount={graphSourceCount}
        />
      ) : null}

      {selection ? (
        <div
          className="thin-reading__selection-popover"
          style={{
            bottom: selection.bottom,
            left: selection.left,
            maxWidth: `calc(100vw - ${selection.left + selectionPopoverGutter}px)`,
            top: selection.top
          }}
        >
          {selection.target.kind === "node_summary" ? (
            <>
              <label htmlFor="thin-reading-prompt">{labels.deepenPrompt}</label>
              <input id="thin-reading-prompt" maxLength={600} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
              <div className="thin-reading__selection-quick-commands" aria-label="快捷命令列表">
                <span className="thin-reading__selection-quick-title">快捷命令</span>
                <div className="thin-reading__selection-quick-list">
                  {selectionQuickCommands.map((command) => (
                    <button
                      aria-label={command.label}
                      className="thin-reading__selection-command"
                      disabled={generationInProgress}
                      key={command.quickCommand}
                      onClick={() => void runSelectionQuickCommand(command)}
                      type="button"
                    >
                      <span className="thin-reading__selection-command-icon" aria-hidden="true">
                        {command.requestedOutput === "mermaid" ? <BranchForkRegular /> : command.quickCommand === "html_svg_structure" ? <LightbulbRegular /> : <ArrowRightRegular />}
                      </span>
                      <span className="thin-reading__selection-command-copy">
                        <strong>{command.label}</strong>
                        <small>{command.description}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <button disabled={generationInProgress} onClick={() => void deepenSelection()} type="button">{labels.deepen}</button>
            </>
          ) : null}
          <label htmlFor="thin-reading-annotation">{labels.annotate}</label>
          <input id="thin-reading-annotation" value={annotationBody} onChange={(event) => setAnnotationBody(event.target.value)} />
          <label>
            <input checked={annotationPublic} onChange={(event) => setAnnotationPublic(event.currentTarget.checked)} type="checkbox" />
            {labels.public}
          </label>
          <button onClick={saveSelectionAnnotation} type="button">{labels.saveAnnotation}</button>
        </div>
      ) : null}
    </main>
  );
}
