import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
  ArrowLeftRegular,
  ArrowRightRegular,
  BranchForkRegular,
  ChevronRightRegular,
  LightbulbRegular,
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
import { listThinReadingPendingPublicAnnotations } from "./thinReadingIntuechoSyncQueue";
import { getThinReadingPaperTypeLabel } from "./thinReadingPromptRegistry";
import { getThinReadingUiCopy } from "./thinReadingI18n";
import { MermaidPreview } from "../mermaid/MermaidPreview";
import { HtmlDemoPreview } from "../visualization/HtmlDemoPreview";
import {
  useThinReadingCommunityRecommendations,
  type ThinReadingCommunityRecommendationState
} from "./useThinReadingCommunityRecommendations";
import type {
  ThinReadingAnnotationTarget,
  ThinReadingBranchSource,
  ThinReadingDocument,
  ThinReadingEvidenceSpan,
  ThinReadingQuickCommand,
  ThinReadingRequestedOutput,
  ThinReadingSummarySentence
} from "./thinReading.types";
import type { MineruFigure } from "../import/import.types";
import type { VisualizationTabData } from "../visualization/visualization.types";
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
  figures?: readonly MineruFigure[];
  headerAction?: ReactNode;
  taskFailureMessage?: string;
  onGenerateBranch?: (input: {
    artifactId: string;
    document: ThinReadingDocument;
    source: ThinReadingBranchSource;
  }) => Promise<void>;
  onOpenEvidence?: (request: ThinReadingEvidenceOpenRequest) => void;
  onOpenVisualization?: (data: VisualizationTabData) => void;
  onRetryInterruptedBranch?: () => Promise<void>;
  onSyncIntuecho?: (input: { artifactId: string; document: ThinReadingDocument }) => Promise<void>;
  onUpdateDocument: (artifactId: string, nextDocument: ThinReadingDocument) => void;
  papers: Array<{ id: string; title: string }>;
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

type InlineFigurePresentation = {
  evidenceIds: readonly string[];
  figure: MineruFigure;
  reason: string;
  recommendedBy: "agent" | "fallback";
};

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

function figurePlacementLabel(placement: NonNullable<MineruFigure["analysis"]>["placement"] | undefined) {
  switch (placement) {
    case "method": return "方法图解";
    case "results": return "结果证据";
    case "evidence": return "关键证据";
    default: return "核心图解";
  }
}

function fallbackFigureSentenceIndex(
  figure: MineruFigure,
  sentenceCount: number
) {
  if (sentenceCount <= 1) return 0;
  switch (figure.analysis?.placement) {
    case "method": return Math.min(sentenceCount - 1, Math.floor(sentenceCount * .34));
    case "results": return Math.min(sentenceCount - 1, Math.floor(sentenceCount * .72));
    case "evidence": return Math.min(sentenceCount - 1, Math.floor(sentenceCount * .55));
    default: return 0;
  }
}

function InlineMineruFigure({ entry }: { entry: InlineFigurePresentation }) {
  const { figure, reason, recommendedBy } = entry;
  return (
    <figure className="thin-reading__figure-embed is-inline" data-thin-reading-ignore-selection>
      <div className="thin-reading__figure-media">
        <img alt={figure.analysis?.title ?? figure.alt} loading="lazy" src={figure.dataUrl} />
      </div>
      <figcaption>
        <div className="thin-reading__figure-kicker">
          <span>{figurePlacementLabel(figure.analysis?.placement)}</span>
          <span>原文第 {figure.page} 页</span>
        </div>
        <h4>{figure.analysis?.title ?? figure.alt}</h4>
        <p>{figure.analysis?.description ?? "这张原文图表直接支撑相邻段落的解释。"}</p>
        <small>{recommendedBy === "agent" ? "模型建议读者先看" : "相关性建议"}：{reason}</small>
      </figcaption>
    </figure>
  );
}

const selectionQuickCommands = [
  {
    description: "用单文件 HTML 动画把步骤按顺序演给读者看。",
    label: "将这个算法做成 HTML 动画",
    prompt:
      "请把这段内容做成一个真正易懂的 HTML 动画：用单文件内联 HTML/CSS/SVG，逐步展示算法关键步骤，只呈现证据支持的状态变化，并配 2-3 句简短说明。",
    quickCommand: "html_algorithm_animation",
    requestedOutput: "html_demo"
  },
  {
    description: "用 HTML/SVG 画清关键部件、连接关系和信息流。",
    label: "将这个结构用 HTML/SVG 描绘出来",
    prompt:
      "请用单文件内联 HTML/SVG 把这段结构画清楚：突出部件、连接关系和信息流，标签尽量少但易懂，并配 2-3 句说明。",
    quickCommand: "html_svg_structure",
    requestedOutput: "html_demo"
  },
  {
    description: "把因果链压缩成 Mermaid 图和几句白话解释。",
    label: "用 mermaid 图呈现这段话的因果关系",
    prompt:
      "请用 Mermaid 图呈现这段话的因果链：节点命名口语化、边上写因果动作，正文压缩成 3-5 句浅显解释。",
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

export function ThinReadingTab({
  artifactId,
  communityRecommendationState,
  document,
  generationProgress,
  figures = [],
  headerAction,
  intuechoEndpoint,
  taskFailureMessage,
  onGenerateBranch,
  onOpenEvidence,
  onOpenVisualization,
  onRetryInterruptedBranch,
  onSyncIntuecho,
  onUpdateDocument,
  papers
}: ThinReadingTabProps) {
  const activeNode = document.nodes[document.activeNodeId] ?? document.nodes[document.rootNodeId];
  const fetchedCommunityRecommendationState = useThinReadingCommunityRecommendations({
    endpoint: intuechoEndpoint,
    scope: activeNode.recommendationScope
  });
  const resolvedCommunityRecommendationState = communityRecommendationState ?? fetchedCommunityRecommendationState;
  const contentRef = useRef<HTMLDivElement>(null);
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
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [editingAnnotationBody, setEditingAnnotationBody] = useState("");
  const [intuechoCollapsed, setIntuechoCollapsed] = useState(true);
  const [graphMode, setGraphMode] = useState<ThinReadingGraphMode | null>(null);
  const [syncingIntuecho, setSyncingIntuecho] = useState(false);
  const labels = getThinReadingUiCopy(document.targetLanguage);
  const generationInProgress = generating || Boolean(generationProgress);
  const paperTitle = useMemo(
    () => papers.find((paper) => document.paperIds.includes(paper.id))?.title ?? labels.untitledPaper,
    [document.paperIds, labels.untitledPaper, papers]
  );
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
  }, [activeNode.id]);

  function update(nextDocument: ThinReadingDocument) {
    onUpdateDocument(artifactId, nextDocument);
  }

  function goToNode(nodeId: string) {
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
      await onGenerateBranch({ artifactId, document, source });
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
    update(addThinReadingAnnotation(document, {
      body: annotationBody,
      excerpt: selection.excerpt,
      nodeId: activeNode.id,
      target: selection.target,
      ...(annotationPublic ? { visibility: "pending_public" as const } : {})
    }));
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
  const inlineFiguresBySentence = useMemo(() => {
    const placements = new Map<number, InlineFigurePresentation[]>();
    inlineFigures.forEach((entry) => {
      const evidenceMatch = entry.evidenceIds.length > 0
        ? summarySentences.findIndex((sentence) => sentence.evidenceIds.some((id) => entry.evidenceIds.includes(id)))
        : -1;
      let sentenceIndex = evidenceMatch >= 0
        ? evidenceMatch
        : fallbackFigureSentenceIndex(entry.figure, summarySentences.length);
      while (placements.has(sentenceIndex) && sentenceIndex < summarySentences.length - 1) {
        sentenceIndex += 1;
      }
      placements.set(sentenceIndex, [...(placements.get(sentenceIndex) ?? []), entry]);
    });
    return placements;
  }, [inlineFigures, summarySentences]);
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
        <AgentLiveWorkPanel
          floating
          markdown={visibleGenerationProgress.partialAnswer}
          message={generationNotice || visibleGenerationProgress.message}
          progress={visibleGenerationProgress.progress}
          progressLabel={labels.generationProgress}
          runKey={visibleGenerationProgress.runKey}
          stageLabel={visibleGenerationProgress.stageLabel}
        />
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

      <div
        className="thin-reading__body"
        onKeyUp={inspectSelection}
        onMouseUp={inspectSelection}
        ref={contentRef}
      >
        <article className="thin-reading__article">
          {paperTypeLabel ? <div className="thin-reading__article-meta">{paperTypeLabel}</div> : null}
          {closureState === "near_boundary" ? (
            <section className="thin-reading__near-boundary" aria-label={labels.nearBoundary}>
              <strong>{labels.nearBoundary}</strong>
              <span>{labels.nearBoundaryReason}</span>
            </section>
          ) : null}
          <h2>{activeNode.title}</h2>
          <section>
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
                        {sentence.text}
                        {sentence.evidenceIds.map((evidenceId, evidenceIndex) => {
                          const span = paperEvidenceSpans.find((candidate) => candidate.id === evidenceId);
                          const canOpenEvidence = Boolean(
                            span && onOpenEvidence && typeof span.page === "number" && Number.isFinite(span.page)
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
                                <span className="thin-reading__summary-marker is-static" title={labels.evidenceUnavailableTitle(evidenceId)}>
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
                                <span className="thin-reading__summary-marker is-static" title={labels.evidenceExternalTitle([sourceId])}>
                                  {labels.evidenceExternal(sourceIndex + 1)}
                                </span>
                              )}
                            </sup>
                          );
                        })}
                      </span>
                    </p>
                    {(inlineFiguresBySentence.get(index) ?? []).map((entry) => (
                      <InlineMineruFigure entry={entry} key={entry.figure.id} />
                    ))}
                  </div>
                );
              })}
            </div>
          </section>
          {activeNode.evidence.mermaid ? (
            <MermaidPreview code={activeNode.evidence.mermaid} onOpenInTab={() => onOpenVisualization?.({ code: activeNode.evidence.mermaid!, id: `mermaid:${artifactId}:${activeNode.id}`, kind: "mermaid", title: `${activeNode.title} · 关系与流程` })} title="关系与流程" />
          ) : null}
          {activeNode.evidence.interactiveDemo ? (
            <HtmlDemoPreview
              description={activeNode.evidence.interactiveDemo.description}
              html={activeNode.evidence.interactiveDemo.html}
              onOpenInTab={onOpenVisualization
                ? () => onOpenVisualization({
                    description: activeNode.evidence.interactiveDemo!.description,
                    html: activeNode.evidence.interactiveDemo!.html,
                    id: `html-demo:${artifactId}:${activeNode.id}`,
                    kind: "html_demo",
                    title: activeNode.evidence.interactiveDemo!.title
                  })
                : undefined}
              title={activeNode.evidence.interactiveDemo.title}
            />
          ) : null}
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
                        update(updateThinReadingAnnotation(document, annotation.id, editingAnnotationBody));
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
                          onChange={(event) => update(setThinReadingAnnotationPublic(document, annotation.id, event.currentTarget.checked))}
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
                <h2>Intuecho</h2>
                <p className="thin-reading__intuecho-caption">{labels.communityRecommendationCaption}</p>
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
                          className="thin-reading__recommendation"
                          data-thin-reading-annotation-target="recommendation"
                          data-thin-reading-recommendation-id={recommendation.id}
                          key={recommendation.id}
                        >
                          <strong>{recommendation.relationship}</strong>
                          <small className="thin-reading__recommendation-source">{labels.communityRecommendation}</small>
                          <span>{recommendation.note}</span>
                          <div className="thin-reading__recommendation-actions">
                            <button onClick={() => annotateBlock({
                              excerpt: recommendation.note,
                              target: { kind: "recommendation", nodeId: activeNode.id, recommendationId: recommendation.id }
                            })} type="button">{labels.annotate}</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : null}
          </aside>
        )}
      </div>

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
