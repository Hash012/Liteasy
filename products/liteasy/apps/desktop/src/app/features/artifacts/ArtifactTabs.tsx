import { Button } from "@fluentui/react-components";
import { useEffect, useState } from "react";
import type {
  ArtifactRegenerationRequest,
  ArtifactTab,
  ArtifactTask,
  ArtifactType
} from "./artifact.types";
import { DynamicCanvas, OutlineTree } from "../generative-ui/DynamicCanvas";
import type { UIDslActionRef } from "../generative-ui/generativeUi.types";
import { ObsidianLikeGraphCanvas } from "../layered-reading/ObsidianLikeGraphCanvas";
import { MermaidPreview } from "../mermaid/MermaidPreview";
import { defaultGraphViewState } from "../layered-reading/layeredReading.types";
import { ThinReadingTab } from "../thin-reading/ThinReadingTab";
import type {
  ThinReadingBranchSource,
  ThinReadingDocument,
  ThinReadingExternalSource
} from "../thin-reading/thinReading.types";
import type { ThinReadingPaperRelationsTransport } from "../thin-reading/thinReadingPaperRelationsClient";
import type { ForumFeedQuery, ForumPost } from "../forum/forum.types";
import type { MineruFigure } from "../import/import.types";
import type { VisualizationTabData } from "../visualization/visualization.types";
import type { VisualizationArtifactV1 } from "../visualization/visualizationArtifact.types";
import type { MultimodalVisualizationCapability } from "../account/accountCapabilitiesClient";
import type { ThinReadingVisualizationStatus } from "./artifact.types";
import { AgentLiveWorkPanel } from "../agent-work/AgentLiveWorkPanel";
import { ArtifactExportMenu } from "./ArtifactExportMenu";
import { presentArtifactFailure } from "./artifactFailurePresentation";
import { exportArtifactDocument } from "./artifactDocumentExport";
import type {
  ArtifactDocumentFormat,
  ArtifactExportOutcome
} from "./artifactExport.types";

type ArtifactTabsProps = {
  activeArtifactId?: string | null;
  analysisHint: string;
  canStartAnalysis: boolean;
  developerDiagnostics?: boolean;
  externalKnowledgeEndpoint?: string;
  paperRelationsTransport?: ThinReadingPaperRelationsTransport;
  intuechoEndpoint?: string;
  intuechoSessionId?: string;
  mineruFiguresByPaperId?: Record<string, MineruFigure[]>;
  onLoadForumFeed?: (query: ForumFeedQuery) => Promise<ForumPost[]>;
  onActivateArtifact?: (artifactId: string) => void;
  onDynamicAction?: (action: UIDslActionRef) => void;
  onDeleteArtifact?: (artifactId: string) => string | void | Promise<string | void>;
  onExportArtifact?: (
    tab: ArtifactTab,
    format: ArtifactDocumentFormat
  ) => Promise<ArtifactExportOutcome>;
  onOpenEvidence?: (request: ArtifactEvidenceOpenRequest) => void;
  onOpenVisualization?: (data: VisualizationTabData) => void;
  onOpenExternalFullText?: (source: ThinReadingExternalSource) => Promise<void>;
  onPromoteExternalPaperToLibrary?: (source: ThinReadingExternalSource) => Promise<void>;
  onSyncThinReadingAnnotations?: (input: { artifactId: string; document: ThinReadingDocument }) => Promise<void>;
  onGenerateThinReadingBranch?: (input: {
    artifactId: string;
    document: ThinReadingDocument;
    source: ThinReadingBranchSource;
  }) => Promise<void>;
  onRegenerateArtifact?: (
    request: ArtifactRegenerationRequest
  ) => string | void | Promise<string | void>;
  onRetryInterruptedThinReadingBranch?: (taskId: string) => Promise<void>;
  onUpdateThinReadingDocument?: (artifactId: string, nextDocument: ThinReadingDocument) => void;
  onToggleThinReadingVisualization?: (enabled: boolean) => void;
  onStartAnalysis: (artifactType: ArtifactType) => void;
  selectedCount: number;
  selectionLocked: boolean;
  tasks: ArtifactTask[];
  tabs: ArtifactTab[];
  thinReadingVisualizationCapability?: MultimodalVisualizationCapability;
  thinReadingVisualizationReadyArtifacts?: readonly VisualizationArtifactV1[];
  thinReadingVisualizationStatuses?: Record<string, ThinReadingVisualizationStatus>;
};

export type ArtifactEvidenceOpenRequest = {
  evidenceId: string;
  page: number;
  pageTextEnd?: number;
  pageTextStart?: number;
  textExtraction?: "embedded" | "mineru" | "ocr";
  paperId: string;
  quote: string;
};

function getFallbackPreview(type: ArtifactType) {
  if (type === "mindmap") {
    return {
      nodes: ["核心概念", "系统结构", "应用场景"],
      rootLabel: "Literature Paper"
    };
  }

  if (type === "tree") {
    return {
      nodes: ["方法动机", "模型组成", "实验结论"],
      rootLabel: "总体结构"
    };
  }

  if (type === "comparison_table") {
    return {
      nodes: ["研究对象", "方法差异", "实验指标"],
      rootLabel: "论文对比表"
    };
  }

  return {
    nodes: ["研究背景", "核心方法", "结果与局限"],
    rootLabel: "PPT 大纲"
  };
}

const taskStatusLabels: Record<ArtifactTask["status"], string> = {
  cancelled: "已终止",
  completed: "已完成",
  failed: "失败",
  queued: "准备中",
  running: "分析中"
};

const taskStageLabels: Record<ArtifactTask["stage"], string> = {
  auditing_answer: "核验回答",
  cancelled: "已终止",
  completed: "生成完成",
  failed: "生成失败",
  generating_answer: "流式生成",
  preparing_context: "准备上下文",
  retrieving_evidence: "检索论文证据",
  saving_result: "持久保存",
  structuring_artifact: "构建产物结构",
  thin_reading_generating_branch: "生成薄读下一层",
  thin_reading_generating_root: "生成薄读总述",
  thin_reading_parsing_document: "解析论文文本",
  thin_reading_planning: "规划薄读路径",
  thin_reading_repairing_trace: "修复句级证据映射",
  thin_reading_retrieving_evidence: "检索薄读证据",
  thin_reading_retrieving_external_knowledge: "检索外部文献",
  thin_reading_saving: "保存薄读节点",
  thin_reading_validating: "核验薄读证据",
  waiting_for_import: "等待 PDF 解析"
};

const verificationStatusLabels = {
  fail: "审计未通过",
  pass: "审计通过",
  review: "需复核"
} as const;

function cleanAgentAnswer(answer: string) {
  return answer
    .replace(/^\s*```(?:text|markdown|md)?\s*$/gim, "")
    .replace(/^\s*```\s*$/gim, "")
    .replace(/\[?\bevidence-[a-z0-9][a-z0-9-]*\b\]?/gi, "〔证据〕")
    .replace(/(?:〔证据〕[\s,，、;；]*){2,}/g, "〔证据〕 ")
    .trim();
}

function mermaidBlocks(value: string | undefined) {
  if (!value) return [];
  return [...value.matchAll(/```mermaid\s*([\s\S]*?)```/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

// Persisted artifacts may predate fields added to the reading workflow. Normalize at
// the display boundary so an older result can never crash the entire workbench.
function normalizeThinReadingDocument(document: ThinReadingDocument): ThinReadingDocument {
  return {
    ...document,
    annotationSettings: document.annotationSettings ?? { autoPublic: false },
    annotations: document.annotations ?? [],
    pendingPublicAnnotationIds: document.pendingPublicAnnotationIds ?? []
  };
}

export function ArtifactTabs({
  activeArtifactId,
  analysisHint,
  canStartAnalysis,
  developerDiagnostics = false,
  externalKnowledgeEndpoint,
  paperRelationsTransport,
  intuechoEndpoint,
  intuechoSessionId,
  mineruFiguresByPaperId,
  onLoadForumFeed,
  onActivateArtifact,
  onDynamicAction,
  onDeleteArtifact,
  onExportArtifact = async (tab, format) => {
    await exportArtifactDocument(tab, format);
    return {
      record: {
        artifactId: tab.artifactId,
        exportedAt: new Date().toISOString(),
        fileName: `${tab.title}.${format === "markdown" ? "md" : format}`,
        format,
        id: `browser-export-${Date.now()}`,
        location: "browser",
        status: "browser_managed",
        title: tab.title
      },
      status: "saved"
    };
  },
  onGenerateThinReadingBranch,
  onOpenEvidence,
  onOpenVisualization,
  onOpenExternalFullText,
  onPromoteExternalPaperToLibrary,
  onSyncThinReadingAnnotations,
  onRegenerateArtifact,
  onRetryInterruptedThinReadingBranch,
  onUpdateThinReadingDocument,
  onToggleThinReadingVisualization,
  onStartAnalysis,
  selectedCount,
  selectionLocked,
  tasks,
  tabs,
  thinReadingVisualizationCapability,
  thinReadingVisualizationReadyArtifacts = [],
  thinReadingVisualizationStatuses = {}
}: ArtifactTabsProps) {
  const [regenerationOpen, setRegenerationOpen] = useState(false);
  const [supplementalContext, setSupplementalContext] = useState("");
  const [submittingRegeneration, setSubmittingRegeneration] = useState(false);
  const [deletingArtifact, setDeletingArtifact] = useState(false);
  const [graphMode, setGraphMode] = useState(false);
  const [graphView, setGraphView] = useState(defaultGraphViewState);
  const activeTab = tabs.find((tab) => tab.artifactId === activeArtifactId) ?? tabs[0] ?? null;
  const activePreview = activeTab ? (activeTab.preview ?? getFallbackPreview(activeTab.type)) : null;
  const activeTask = tasks[0] ?? null;
  const activeThinReadingTask = tasks.find((task) => (
    task.type === "thin_reading" && task.artifactId === activeTab?.artifactId &&
    (task.status === "running" || task.status === "failed")
  ));
  const activeVerification = activeTab?.verification ?? activeTab?.mindmapArtifact?.verification;
  const activeMindmapSources = activeTab?.mindmapArtifact?.sources;
  const activeFailure = activeTask?.failure
    ? presentArtifactFailure(activeTask.failure, developerDiagnostics)
    : undefined;

  useEffect(() => {
    setRegenerationOpen(false);
    setSupplementalContext("");
    setGraphMode(activeTab?.type === "layered_graph");
    setGraphView(defaultGraphViewState);
  }, [activeTab?.artifactId]);

  async function submitRegeneration() {
    if (!activeTab || activeTab.type === "skill_doc" || !onRegenerateArtifact) {
      return;
    }
    const trimmedContext = supplementalContext.trim();
    if (!trimmedContext) {
      return;
    }
    setSubmittingRegeneration(true);
    try {
      await onRegenerateArtifact({
        artifactId: activeTab.artifactId,
        artifactType: activeTab.type,
        papers: activeTab.papers ?? [],
        supplementalContext: trimmedContext
      });
      setRegenerationOpen(false);
      setSupplementalContext("");
    } finally {
      setSubmittingRegeneration(false);
    }
  }

  async function deleteActiveArtifact() {
    if (!activeTab || activeTab.type === "skill_doc" || !onDeleteArtifact) {
      return;
    }
    const confirmed = window.confirm(
      `确认删除多模态产物“${activeTab.title}”吗？\n\n持久化 JSON 文件也会被删除，此操作无法撤销。`
    );
    if (!confirmed) {
      return;
    }
    setDeletingArtifact(true);
    try {
      await onDeleteArtifact(activeTab.artifactId);
    } finally {
      setDeletingArtifact(false);
    }
  }

  if (activeTab?.type === "thin_reading") {
    if (!activeTab.thinReadingDocument) {
      return <div className="artifact-empty">薄读内容缺失</div>;
    }

    const document = normalizeThinReadingDocument(activeTab.thinReadingDocument);
    return (
      <ThinReadingTab
        artifactId={activeTab.artifactId}
        developerDiagnostics={developerDiagnostics}
        document={document}
        headerAction={(
          <ArtifactExportMenu
            onExport={onExportArtifact}
            tab={{ ...activeTab, thinReadingDocument: document }}
          />
        )}
        intuechoEndpoint={intuechoEndpoint}
        intuechoSessionId={intuechoSessionId}
        generationProgress={activeThinReadingTask?.status === "running" ? {
          message: activeThinReadingTask.message,
          partialAnswer: activeThinReadingTask.partialAnswer,
          progress: activeThinReadingTask.progress,
          runKey: activeThinReadingTask.id,
          stageLabel: taskStageLabels[activeThinReadingTask.stage]
        } : undefined}
        taskFailureMessage={activeThinReadingTask?.status === "failed"
          ? activeThinReadingTask.failure
            ? presentArtifactFailure(activeThinReadingTask.failure, developerDiagnostics).message
            : "生成任务未完成，请稍后重试。"
          : undefined}
        onRetryInterruptedBranch={activeThinReadingTask?.status === "failed" &&
          activeThinReadingTask.thinReadingBranchRecovery && onRetryInterruptedThinReadingBranch
          ? () => onRetryInterruptedThinReadingBranch(activeThinReadingTask.id)
          : undefined}
        onGenerateBranch={onGenerateThinReadingBranch}
        onOpenExternalFullText={onOpenExternalFullText}
        onOpenEvidence={onOpenEvidence}
        onPromoteExternalPaperToLibrary={onPromoteExternalPaperToLibrary}
        onSyncIntuecho={onSyncThinReadingAnnotations}
        onLoadForumFeed={onLoadForumFeed}
        onUpdateDocument={onUpdateThinReadingDocument ?? (() => undefined)}
        onToggleVisualization={onToggleThinReadingVisualization}
        paperRelationsEndpoint={externalKnowledgeEndpoint}
        paperRelationsTransport={paperRelationsTransport}
        papers={activeTab.papers ?? []}
        visualizationArtifacts={thinReadingVisualizationReadyArtifacts}
        visualizationCapability={thinReadingVisualizationCapability}
        visualizationStatus={activeTab.thinReadingDocument.version === "liteasy.thin-reading/v2"
          ? thinReadingVisualizationStatuses[activeTab.thinReadingDocument.activeNodeId]
          : undefined}
        figures={[
          ...(activeTab.figures ?? []),
          ...(activeTab.papers ?? []).flatMap((paper) => mineruFiguresByPaperId?.[paper.id] ?? [])
        ].filter((figure, index, figures) => figures.findIndex((candidate) => (
          candidate.dataUrl === figure.dataUrl || candidate.id === figure.id
        )) === index)}
      />
    );
  }

  return (
    <div className="artifact-layout">
      <div className="artifact-toolbar">
        <span className="artifact-title">多模态产物</span>
        <div className="artifact-toolbar-actions">
          {activeTask && (
            <span className={`artifact-status-badge ${activeTask.status}`}>
              {taskStatusLabels[activeTask.status]}
            </span>
          )}
          {activeTab ? <ArtifactExportMenu onExport={onExportArtifact} tab={activeTab} /> : null}
        </div>
      </div>

      {tabs.length > 1 ? (
        <nav aria-label="产物历史" className="artifact-history-list">
          {tabs.map((tab) => (
            <button
              aria-current={tab.artifactId === activeTab?.artifactId ? "page" : undefined}
              className={tab.artifactId === activeTab?.artifactId ? "active" : ""}
              key={tab.artifactId}
              onClick={() => onActivateArtifact?.(tab.artifactId)}
              title={tab.title}
              type="button"
            >
              <span>{tab.title}</span>
              {tab.createdAt ? (
                <time dateTime={tab.createdAt}>
                  {new Date(tab.createdAt).toLocaleString("zh-CN", {
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    month: "2-digit"
                  })}
                </time>
              ) : null}
            </button>
          ))}
        </nav>
      ) : null}

      {activeTask && activeTask.status !== "completed" &&
      activeTask.type === "thin_reading" && !developerDiagnostics ? (
        <section aria-live="polite" className={`artifact-progress-panel ${activeTask.status}`}>
          <strong>
            {activeTask.status === "failed"
              ? activeFailure?.message ?? "生成任务未完成，请稍后重试。"
              : activeTask.status === "cancelled"
                ? "薄读生成已取消。"
                : "正在生成薄读正文，完成后将在当前页面显示。"}
          </strong>
        </section>
      ) : activeTask && activeTask.status !== "completed" ? (
        <section className={`artifact-progress-panel ${activeTask.status}`} aria-live="polite">
          <div className="artifact-progress-copy">
            <div>
              <strong>{activeFailure?.message ?? activeTask.message}</strong>
              <small>当前阶段：{taskStageLabels[activeTask.stage]}</small>
            </div>
            <span>{activeTask.progress}%</span>
          </div>
          <div
            aria-label="Agent 分析进度"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={activeTask.progress}
            className="artifact-progress-track"
            role="progressbar"
          >
            <span style={{ width: `${activeTask.progress}%` }} />
          </div>
          <div className="artifact-live-output">
            <AgentLiveWorkPanel
              markdown={activeTask.partialAnswer}
              message=""
              progress={activeTask.progress}
              runKey={activeTask.id}
              stageLabel={taskStageLabels[activeTask.stage]}
            />
            {activeTask.partialOutlineNodes && activeTask.partialOutlineNodes.length > 0 ? (
              <div className="artifact-stream-tree" aria-label="正在生成的树形预览">
                <OutlineTree
                  nodes={activeTask.partialOutlineNodes.map((node) => ({ ...node }))}
                  variant={activeTask.type === "mindmap" || activeTask.type === "layered_graph" ? "mindmap" : "tree"}
                />
              </div>
            ) : null}
          </div>
          {activeTask.failure && activeFailure ? (
            <details className="artifact-failure-diagnostic" open>
              <summary>查看错误信息与恢复建议</summary>
              <dl>
                <div><dt>错误编号</dt><dd>{activeFailure.code}</dd></div>
                <div><dt>原因</dt><dd>{activeFailure.message}</dd></div>
                <div><dt>失败阶段</dt><dd>{taskStageLabels[activeTask.failure.failedStage]}</dd></div>
                <div><dt>时间</dt><dd>{activeTask.failure.occurredAt}</dd></div>
                {activeFailure.traceId ? (
                  <div><dt>追踪编号</dt><dd>{activeFailure.traceId}</dd></div>
                ) : null}
                {activeFailure.diagnostics ? (
                  <>
                    <div><dt>内部异常</dt><dd>{activeFailure.diagnostics.message}</dd></div>
                    {activeFailure.diagnostics.endpoint ? (
                      <div><dt>服务端点</dt><dd>{activeFailure.diagnostics.endpoint}</dd></div>
                    ) : null}
                    {activeFailure.diagnostics.provider ? (
                      <div><dt>Provider</dt><dd>{activeFailure.diagnostics.provider}</dd></div>
                    ) : null}
                    {activeFailure.diagnostics.model ? (
                      <div><dt>Model</dt><dd>{activeFailure.diagnostics.model}</dd></div>
                    ) : null}
                  </>
                ) : null}
              </dl>
              <ul>
                {activeTask.failure.recovery.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      {tabs.length === 0 ? (
        <div
          className="artifact-empty"
          title={
            canStartAnalysis
              ? "使用中间栏悬浮 AI 按钮生成新的多模态产物。"
              : analysisHint
          }
        >
          {selectedCount === 0
            ? "选择文献后开始分析"
            : selectionLocked
              ? "选择分析类型以生成产物"
              : "锁定选中文献后开始分析"}
        </div>
      ) : activeTab?.type === "skill_doc" ? (
        <div className="artifact-card skill-doc-card">
          <div className="skill-doc-header">
            <div>
              <div className="artifact-card-title">{activeTab.title}</div>
              {activeTab.sourcePath ? (
                <div className="skill-doc-path">{activeTab.sourcePath}</div>
              ) : null}
            </div>
          </div>
          <pre
            aria-label={`Skill 文档内容：${activeTab.title}`}
            className="skill-doc-editor"
          >{activeTab.markdown ?? ""}</pre>
        </div>
      ) : (
        <div className="artifact-card">
          <div className="artifact-card-heading">
            <div>
              <div className="artifact-card-title">{activeTab.title}</div>
              {activeTab.papers && activeTab.papers.length > 0 ? (
                <div aria-label="产物来源论文" className="artifact-source-papers">
                  <span>基于 {activeTab.papers.length} 篇论文</span>
                  <ul>
                    {activeTab.papers.map((paper) => (
                      <li key={paper.id} title={paper.title}>{paper.title}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="artifact-source-papers missing">历史产物未记录来源论文</div>
              )}
            </div>
            <div className="artifact-card-actions">
              {activeTab.intuitionGraph ? (
                <button
                  className="artifact-regenerate-button"
                  onClick={() => setGraphMode((current) => !current)}
                  type="button"
                >
                  {graphMode ? "查看原产物" : "星图阅读"}
                </button>
              ) : null}
              {onRegenerateArtifact && activeTab.papers && activeTab.papers.length > 0 ? (
                <button
                  className="artifact-regenerate-button"
                  onClick={() => setRegenerationOpen(true)}
                  type="button"
                >
                  补充资料并重新生成
                </button>
              ) : null}
              {onDeleteArtifact ? (
                <button
                  aria-label={`删除产物：${activeTab.title}`}
                  className="artifact-delete-button"
                  disabled={deletingArtifact}
                  onClick={() => void deleteActiveArtifact()}
                  type="button"
                >
                  {deletingArtifact ? "正在删除…" : "删除产物"}
                </button>
              ) : null}
            </div>
          </div>
          {activeTab.resultPath ? (
            <div className="artifact-result-meta">
              已由 Agent 生成并保存到当前账号
            </div>
          ) : null}
          {activeTab.regeneratedFromArtifactId ? (
            <div className="artifact-result-meta">
              从产物 {activeTab.regeneratedFromArtifactId} 补充资料后重新生成
            </div>
          ) : null}
          {activeVerification ? (
            <div className={`artifact-verification-summary ${activeVerification.status}`}>
              <span>{verificationStatusLabels[activeVerification.status]}</span>
              {activeVerification.errors.length > 0 ? (
                <span>错误：{activeVerification.errors.length}</span>
              ) : null}
              {activeVerification.warnings.length > 0 ? (
                <span>警告：{activeVerification.warnings.length}</span>
              ) : null}
            </div>
          ) : null}
          {activeMindmapSources ? (
            <div className="artifact-source-layer-summary" aria-label="思维导图来源层">
              <span>论文证据：{activeMindmapSources.selectedPapers.length}</span>
              <span>外部补充：{activeMindmapSources.externalReferences.length}</span>
              <span>模型推断：{activeMindmapSources.inferences.length}</span>
            </div>
          ) : null}
          {activeMindmapSources?.externalReferences.length ? (
            <details className="artifact-external-reference-index" open>
              <summary>外部补充来源</summary>
              <ul>
                {activeMindmapSources.externalReferences.map((reference) => (
                  <li key={reference.refId}>
                    <strong>{reference.sourceTitle}</strong>
                    <span>{reference.summary}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {activeTab.answer ? (
            <details className="artifact-agent-answer">
              <summary>查看原始 Agent 分析记录</summary>
              <div className="artifact-agent-answer-body">{cleanAgentAnswer(activeTab.answer)}</div>
            </details>
          ) : null}
          {activeTab.outlineMarkdown ? (
            <details className="artifact-outline-markdown">
              <summary>查看可提交的 Markdown 大纲元数据</summary>
              <pre>{cleanAgentAnswer(activeTab.outlineMarkdown)}</pre>
            </details>
          ) : null}
          {activeTab.analysis?.evidence.length ? (
            <details className="artifact-evidence-index" open>
              <summary>
                论文原文证据（{activeTab.analysis.evidence.length} 条）
                {onOpenEvidence ? " · 点击跳转 PDF" : ""}
              </summary>
              <ol>
                {activeTab.analysis.evidence.map((evidence, index) => (
                  <li key={evidence.id}>
                    <button
                      aria-label={`打开原文证据 ${index + 1}：${evidence.paperTitle} 第 ${evidence.page} 页`}
                      disabled={!onOpenEvidence}
                      onClick={() => onOpenEvidence?.({
                        evidenceId: evidence.id,
                        page: evidence.page,
                        ...(typeof evidence.pageTextEnd === "number" ? { pageTextEnd: evidence.pageTextEnd } : {}),
                        ...(typeof evidence.pageTextStart === "number" ? { pageTextStart: evidence.pageTextStart } : {}),
                        ...(evidence.textExtraction ? { textExtraction: evidence.textExtraction } : {}),
                        paperId: evidence.paperId,
                        quote: evidence.quote
                      })}
                      type="button"
                    >
                      <span className="artifact-evidence-heading">
                        <strong>{evidence.paperTitle}</strong>
                        <span>第 {evidence.page} 页</span>
                      </span>
                      <q>{evidence.quote}</q>
                      {evidence.summary && evidence.summary !== evidence.quote ? (
                        <span className="artifact-evidence-summary">摘要：{evidence.summary}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
          <div className="artifact-card-body">
            {mermaidBlocks(activeTab.answer).map((code, index) => (
              <MermaidPreview code={code} key={`${activeTab.artifactId}-mermaid-${index}`} onOpenInTab={() => onOpenVisualization?.({ code, id: `mermaid:${activeTab.artifactId}:${index}`, kind: "mermaid", title: `${activeTab.title} · 关系与流程` })} title="关系与流程" />
            ))}
            {graphMode && activeTab.intuitionGraph ? (
              <ObsidianLikeGraphCanvas
                graph={activeTab.intuitionGraph}
                onOpenInTab={() => onOpenVisualization?.({ graph: activeTab.intuitionGraph!, id: `intuition-graph:${activeTab.artifactId}`, kind: "intuition_graph", title: `${activeTab.title} · 认知图` })}
                onViewChange={setGraphView}
                view={graphView}
              />
            ) : activeTab.uiDsl ? (
              <DynamicCanvas document={activeTab.uiDsl} onAction={(action) => onDynamicAction?.(action)} />
            ) : activePreview ? (
              <>
                <div className="mindmap-node root">{activePreview.rootLabel}</div>
                <div className="mindmap-children">
                  {activePreview.nodes.map((node) => (
                    <div className="mindmap-node" key={node}>
                      {node}
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {regenerationOpen && activeTab && activeTab.type !== "skill_doc" ? (
        <div
          aria-label="补充资料并重新生成产物"
          aria-modal="true"
          className="artifact-regenerate-backdrop"
          role="dialog"
        >
          <form
            className="artifact-regenerate-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              void submitRegeneration();
            }}
          >
            <div className="artifact-regenerate-heading">
              <div>
                <strong>补充资料并重新生成</strong>
                <p>仍基于原来的 {activeTab.papers?.length ?? 0} 篇论文，新结果会另存为历史产物。</p>
              </div>
              <button
                aria-label="关闭补充资料对话框"
                onClick={() => setRegenerationOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <label htmlFor={`artifact-supplement-${activeTab.artifactId}`}>
              补充文本、引用或分析要求
            </label>
            <textarea
              autoFocus
              id={`artifact-supplement-${activeTab.artifactId}`}
              onChange={(event) => setSupplementalContext(event.target.value)}
              placeholder="粘贴论文正文、引用、页码、读书笔记，或说明希望补强的章节……"
              rows={10}
              value={supplementalContext}
            />
            <div className="artifact-regenerate-actions">
              <button onClick={() => setRegenerationOpen(false)} type="button">取消</button>
              <button
                disabled={!supplementalContext.trim() || submittingRegeneration}
                type="submit"
              >
                {submittingRegeneration ? "正在启动…" : "另存并重新生成"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
