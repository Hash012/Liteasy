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
import { defaultGraphViewState } from "../layered-reading/layeredReading.types";

type ArtifactTabsProps = {
  activeArtifactId?: string | null;
  analysisHint: string;
  canStartAnalysis: boolean;
  onActivateArtifact?: (artifactId: string) => void;
  onDynamicAction?: (action: UIDslActionRef) => void;
  onDeleteArtifact?: (artifactId: string) => string | void | Promise<string | void>;
  onOpenEvidence?: (request: ArtifactEvidenceOpenRequest) => void;
  onRegenerateArtifact?: (
    request: ArtifactRegenerationRequest
  ) => string | void | Promise<string | void>;
  onSaveMarkdownTab?: (artifactId: string) => void;
  onUpdateMarkdownTab?: (artifactId: string, markdown: string) => void;
  onStartAnalysis: (artifactType: ArtifactType) => void;
  selectedCount: number;
  selectionLocked: boolean;
  tasks: ArtifactTask[];
  tabs: ArtifactTab[];
};

export type ArtifactEvidenceOpenRequest = {
  evidenceId: string;
  page: number;
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
  waiting_for_import: "等待 PDF 解析"
};

function cleanAgentAnswer(answer: string) {
  return answer
    .replace(/^\s*```(?:text|markdown|md)?\s*$/gim, "")
    .replace(/^\s*```\s*$/gim, "")
    .replace(/\[?\bevidence-[a-z0-9][a-z0-9-]*\b\]?/gi, "〔证据〕")
    .replace(/(?:〔证据〕[\s,，、;；]*){2,}/g, "〔证据〕 ")
    .trim();
}

export function ArtifactTabs({
  activeArtifactId,
  analysisHint,
  canStartAnalysis,
  onActivateArtifact,
  onDynamicAction,
  onDeleteArtifact,
  onOpenEvidence,
  onRegenerateArtifact,
  onSaveMarkdownTab,
  onUpdateMarkdownTab,
  onStartAnalysis,
  selectedCount,
  selectionLocked,
  tasks,
  tabs
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

  useEffect(() => {
    setRegenerationOpen(false);
    setSupplementalContext("");
    setGraphMode(false);
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

  return (
    <div className="artifact-layout">
      <div className="artifact-toolbar">
        <span className="artifact-title">多模态产物</span>
        {activeTask && (
          <span className={`artifact-status-badge ${activeTask.status}`}>
            {taskStatusLabels[activeTask.status]}
          </span>
        )}
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

      {activeTask && activeTask.status !== "completed" ? (
        <section className={`artifact-progress-panel ${activeTask.status}`} aria-live="polite">
          <div className="artifact-progress-copy">
            <strong>{activeTask.message}</strong>
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
          {activeTask.partialOutlineNodes && activeTask.partialOutlineNodes.length > 0 ? (
            <div className="artifact-stream-tree" aria-label="正在生成的树形预览">
              <OutlineTree
                nodes={activeTask.partialOutlineNodes.map((node) => ({ ...node }))}
                variant={activeTask.type === "mindmap" ? "mindmap" : "tree"}
              />
            </div>
          ) : activeTask.partialAnswer ? (
            <div className="artifact-stream-preview">{cleanAgentAnswer(activeTask.partialAnswer)}</div>
          ) : null}
          {activeTask.failure ? (
            <details className="artifact-failure-diagnostic" open>
              <summary>查看失败详情与恢复建议</summary>
              <dl>
                <div><dt>原因</dt><dd>{activeTask.failure.message}</dd></div>
                <div><dt>失败阶段</dt><dd>{taskStageLabels[activeTask.failure.failedStage]}</dd></div>
                {activeTask.failure.endpoint ? (
                  <div><dt>Agent 服务端点</dt><dd>{activeTask.failure.endpoint}</dd></div>
                ) : null}
                {activeTask.failure.provider ? (
                  <div><dt>Provider</dt><dd>{activeTask.failure.provider}</dd></div>
                ) : null}
                {activeTask.failure.model ? (
                  <div><dt>Model</dt><dd>{activeTask.failure.model}</dd></div>
                ) : null}
                <div><dt>时间</dt><dd>{activeTask.failure.occurredAt}</dd></div>
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
              ? "使用中间栏悬浮模态按钮生成新的多模态产物。"
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
            <button
              className="skill-doc-save-button"
              onClick={() => onSaveMarkdownTab?.(activeTab.artifactId)}
              type="button"
            >
              保存文档
            </button>
          </div>
          <textarea
            aria-label={`编辑 Skill 文档：${activeTab.title}`}
            className="skill-doc-editor"
            onChange={(event) => onUpdateMarkdownTab?.(activeTab.artifactId, event.target.value)}
            value={activeTab.markdown ?? ""}
          />
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
              已由 Agent 生成并保存 · {activeTab.resultPath}
            </div>
          ) : null}
          {activeTab.regeneratedFromArtifactId ? (
            <div className="artifact-result-meta">
              从产物 {activeTab.regeneratedFromArtifactId} 补充资料后重新生成
            </div>
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
            {graphMode && activeTab.intuitionGraph ? (
              <ObsidianLikeGraphCanvas
                graph={activeTab.intuitionGraph}
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
