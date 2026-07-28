import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRegular,
  ArrowRightRegular,
  ChevronRightRegular,
  LightbulbRegular
} from "@fluentui/react-icons";
import {
  addThinReadingAnnotation,
  deleteThinReadingAnnotation,
  findThinReadingChildBySource,
  listThinReadingBranchOptions,
  setThinReadingAnnotationPublic,
  setThinReadingAutoPublic,
  updateThinReadingAnnotation
} from "./thinReadingProjection";
import {
  THIN_READING_INTUECHO_PENDING_LABEL,
  listThinReadingPendingPublicAnnotations
} from "./thinReadingIntuechoSyncQueue";
import { getThinReadingPaperTypeLabel } from "./thinReadingPromptRegistry";
import type {
  ThinReadingAnnotationTarget,
  ThinReadingBranchSource,
  ThinReadingDocument,
  ThinReadingEvidenceSpan
} from "./thinReading.types";
import "./thinReading.css";

export type ThinReadingEvidenceOpenRequest = {
  evidenceId: string;
  page: number;
  paperId: string;
  quote: string;
};

export type ThinReadingTabProps = {
  artifactId: string;
  document: ThinReadingDocument;
  onGenerateBranch?: (input: {
    artifactId: string;
    document: ThinReadingDocument;
    source: ThinReadingBranchSource;
  }) => Promise<void>;
  onOpenEvidence?: (request: ThinReadingEvidenceOpenRequest) => void;
  onUpdateDocument: (artifactId: string, nextDocument: ThinReadingDocument) => void;
  papers: Array<{ id: string; title: string }>;
};

function sourceLabel(source: ThinReadingDocument["nodes"][string]["source"]): string {
  if (source.kind === "omitted_section") {
    return source.label;
  }
  if (source.kind === "selected_text") {
    return "正文选区";
  }
  return "总述";
}

export function ThinReadingTab({
  artifactId,
  document,
  onGenerateBranch,
  onOpenEvidence,
  onUpdateDocument,
  papers
}: ThinReadingTabProps) {
  const activeNode = document.nodes[document.activeNodeId] ?? document.nodes[document.rootNodeId];
  const contentRef = useRef<HTMLElement>(null);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [selection, setSelection] = useState<{ excerpt: string; top: number; left: number } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [annotationBody, setAnnotationBody] = useState("");
  const [annotationPublic, setAnnotationPublic] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [editingAnnotationBody, setEditingAnnotationBody] = useState("");
  const [intuechoCollapsed, setIntuechoCollapsed] = useState(false);
  const paperTitle = useMemo(
    () => papers.find((paper) => document.paperIds.includes(paper.id))?.title ?? "未命名论文",
    [document.paperIds, papers]
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
    const rect = range.getBoundingClientRect();
    setSelection({ excerpt, left: Math.max(16, rect.left), top: Math.max(16, rect.bottom + 10) });
  }

  async function generateBranch(source: ThinReadingBranchSource) {
    setGenerationError("");
    const existingChild = findThinReadingChildBySource(document, activeNode.id, source);
    if (existingChild) {
      goToNode(existingChild.id);
      return;
    }
    if (!onGenerateBranch) {
      setGenerationError("薄读 Agent 入口未就绪。");
      return;
    }
    setGenerating(true);
    try {
      await onGenerateBranch({ artifactId, document, source });
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(false);
    }
  }

  function saveSelectionAnnotation() {
    if (!selection || !annotationBody.trim()) return;
    update(addThinReadingAnnotation(document, {
      body: annotationBody,
      excerpt: selection.excerpt,
      nodeId: activeNode.id,
      visibility: annotationPublic ? "pending_public" : "private"
    }));
    setAnnotationBody("");
    setSelection(null);
  }

  async function deepenSelection() {
    if (!selection) return;
    const source: ThinReadingBranchSource = {
      kind: "selected_text",
      excerpt: selection.excerpt,
      ...(prompt ? { prompt } : {})
    };
    await generateBranch(source);
    setSelection(null);
    setPrompt("");
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
      paperId: span.paperId,
      quote: span.quote
    });
  }

  function advanceOmittedSection(sectionKey: string, label: string) {
    const source: ThinReadingBranchSource = { kind: "omitted_section", label, sectionKey };
    void generateBranch(source);
  }

  function handleNextClick() {
    if (branches.length === 1) {
      goToNode(branches[0].nodeId);
      return;
    }
    setBranchMenuOpen((open) => !open);
  }

  const nextLabel = "查看已生成的下一层页面";
  const previousLabel = `回到上一层：${parent?.title ?? "总述"}`;
  const nodeAnnotations = document.annotations.filter((annotation) => annotation.nodeId === activeNode.id);
  const paperEvidenceSpans = activeNode.evidence.paperEvidenceSpans ?? [];
  const claims = activeNode.evidence.claims ?? [];

  return (
    <main
      className={`thin-reading ${activeNode.withinPaperClosure ? "" : "is-external"} ${intuechoCollapsed ? "is-intuecho-collapsed" : ""}`}
      aria-label="薄读页面"
    >
      <header className="thin-reading__topbar">
        <div className="thin-reading__heading">
          <span className="thin-reading__eyebrow">THIN READING</span>
          <h1>{document.title}</h1>
          <span className="thin-reading__source">
            源文：{paperTitle}
            {primaryIdentity ? ` · ${primaryIdentity.kind}:${primaryIdentity.value}` : ""}
          </span>
        </div>
        <div className="thin-reading__controls">
          <span className="thin-reading__language">{document.targetLanguage}</span>
          <div className="thin-reading__depth-nav">
            <button aria-label={previousLabel} disabled={!canGoBack} onClick={() => parent && goToNode(parent.id)} type="button">
              <ArrowLeftRegular aria-hidden="true" />
            </button>
            <span>第 {activeNode.depth} 层</span>
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
                <div className="thin-reading__branch-menu" role="menu" aria-label="已生成的下一层页面">
                  {branches.map((branch) => (
                    <button className="thin-reading__branch-item" key={branch.nodeId} onClick={() => goToNode(branch.nodeId)} role="menuitem" type="button">
                      <span>{branch.title}</span>
                      <small>{branch.sourceLabel} · 第 {branch.depth} 层</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="thin-reading__breadcrumbs" aria-label="薄读层级">
        <button className={activeNode.id === document.rootNodeId ? "is-active" : ""} onClick={() => goToNode(document.rootNodeId)} type="button">
          总述
        </button>
        <span>/</span>
        <span className="is-active">第 {activeNode.depth} 层</span>
      </div>

      <div className="thin-reading__body">
        <article className="thin-reading__article">
          <div className="thin-reading__article-meta">
            {sourceLabel(activeNode.source)}
            {paperTypeLabel ? ` · ${paperTypeLabel}` : ""}
            {" · "}
            {activeNode.withinPaperClosure ? "论文内证据" : "外部知识"}
          </div>
          <h2>{activeNode.title}</h2>
          <section ref={contentRef} onKeyUp={inspectSelection} onMouseUp={inspectSelection}>
            <p
              className="thin-reading__summary"
              data-testid="thin-reading-summary"
            >
              {activeNode.summary}
            </p>
            {claims.length > 0 ? (
              <section className="thin-reading__claim-block" aria-label="关键判断">
                <h3>关键判断</h3>
                {claims.map((claim) => (
                  <button
                    className={`thin-reading__claim thin-reading__claim--${claim.status}`}
                    key={claim.id}
                    onClick={() => annotateBlock({
                      excerpt: claim.text,
                      target: { claimId: claim.id, kind: "claim", nodeId: activeNode.id }
                    })}
                    type="button"
                  >
                    <span>{claim.text}</span>
                    {claim.status !== "grounded" ? (
                      <span className="thin-reading__claim-review">
                        {claim.status === "weak" ? "证据较弱，待复核" : "未支撑，待复核"}
                      </span>
                    ) : null}
                    <small>
                      {claim.status === "grounded" ? "已由论文证据支撑" : claim.status === "weak" ? "弱支撑/需上下文" : "未支撑"}
                      {claim.evidenceIds.length > 0 ? ` · ${claim.evidenceIds.join(", ")}` : ""}
                    </small>
                  </button>
                ))}
              </section>
            ) : null}
            <div className="thin-reading__evidence-grid">
              <section className="thin-reading__evidence-block">
                <h3>论文内证据</h3>
                {paperEvidenceSpans.length > 0 ? paperEvidenceSpans.map((span) => (
                  <div className="thin-reading__evidence-item" key={span.id}>
                    <button
                      aria-label={`打开论文内证据 ${span.id}${span.page ? ` 第 ${span.page} 页` : " 页码未知"}`}
                      className="thin-reading__evidence-open"
                      disabled={!onOpenEvidence || typeof span.page !== "number"}
                      onClick={() => openEvidenceSpan(span)}
                      type="button"
                    >
                      <strong>{span.id}{span.page ? ` · p.${span.page}` : ""}</strong>
                      <span>{span.quote}</span>
                      <small>confidence {span.confidence.toFixed(2)}</small>
                    </button>
                    <button
                      aria-label={`批注论文内证据 ${span.id}`}
                      className="thin-reading__evidence-annotate"
                      onClick={() => annotateBlock({
                        excerpt: span.quote,
                        target: { evidence: span.id, kind: "paper_evidence", nodeId: activeNode.id }
                      })}
                      type="button"
                    >
                      批注
                    </button>
                  </div>
                )) : activeNode.evidence.paperEvidence.length > 0 ? activeNode.evidence.paperEvidence.map((evidence) => (
                  <button key={evidence} onClick={() => annotateBlock({
                    excerpt: evidence,
                    target: { evidence, kind: "paper_evidence", nodeId: activeNode.id }
                  })} type="button">
                    {evidence}
                  </button>
                )) : <span>证据不足</span>}
              </section>
              <section className="thin-reading__evidence-block external">
                <h3>外部知识</h3>
                {activeNode.evidence.externalKnowledge.length > 0 ? activeNode.evidence.externalKnowledge.map((source) => (
                  <button key={source} onClick={() => annotateBlock({
                    excerpt: source,
                    target: { kind: "external_knowledge", nodeId: activeNode.id, source }
                  })} type="button">
                    {source}
                  </button>
                )) : <span>未越出论文闭包</span>}
              </section>
            </div>
          </section>
          {activeNode.omittedSections.length > 0 ? (
            <div className="thin-reading__omitted" aria-label="待展开板块">
              {activeNode.omittedSections.map((section) => (
                <button disabled={generating} key={section.id} onClick={() => advanceOmittedSection(section.sectionKey, section.label)} type="button">
                  {section.label}
                </button>
              ))}
            </div>
          ) : null}
          {generating ? <div className="thin-reading__status">Agent 正在生成下一层</div> : null}
          {generationError ? <div className="thin-reading__error">{generationError}</div> : null}
          <section className="thin-reading__annotations" aria-label="薄读批注">
            <div className="thin-reading__annotation-toolbar">
              <h3>批注</h3>
              <label>
                <input
                  checked={document.annotationSettings.autoPublic}
                  onChange={(event) => update(setThinReadingAutoPublic(document, event.currentTarget.checked))}
                  type="checkbox"
                />
                自动公开
              </label>
            </div>
            {nodeAnnotations.length > 0 ? nodeAnnotations.map((annotation) => (
              <article className="thin-reading__annotation" key={annotation.id}>
                <small>{annotation.excerpt}</small>
                {editingAnnotationId === annotation.id ? (
                  <>
                    <textarea
                      aria-label="编辑批注"
                      onChange={(event) => setEditingAnnotationBody(event.target.value)}
                      value={editingAnnotationBody}
                    />
                    <div className="thin-reading__annotation-actions">
                      <button onClick={() => {
                        update(updateThinReadingAnnotation(document, annotation.id, editingAnnotationBody));
                        setEditingAnnotationId(null);
                      }} type="button">保存</button>
                      <button onClick={() => setEditingAnnotationId(null)} type="button">取消</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p>{annotation.body}</p>
                    {annotation.visibility === "pending_public" ? <span className="thin-reading__pending">{THIN_READING_INTUECHO_PENDING_LABEL}</span> : null}
                    <div className="thin-reading__annotation-actions">
                      <label>
                        <input
                          checked={annotation.visibility === "pending_public"}
                          onChange={(event) => update(setThinReadingAnnotationPublic(document, annotation.id, event.currentTarget.checked))}
                          type="checkbox"
                        />
                        公开
                      </label>
                      <button onClick={() => {
                        setEditingAnnotationId(annotation.id);
                        setEditingAnnotationBody(annotation.body);
                      }} type="button">编辑</button>
                      <button onClick={() => update(deleteThinReadingAnnotation(document, annotation.id))} type="button">删除</button>
                    </div>
                  </>
                )}
              </article>
            )) : <p className="thin-reading__annotation-empty">暂无批注</p>}
          </section>
        </article>

        <aside className={`thin-reading__intuecho ${intuechoCollapsed ? "is-collapsed" : ""}`} aria-label="Intuecho 推荐">
          {intuechoCollapsed ? (
            <button
              aria-expanded="false"
              aria-label="展开 Intuecho 推荐栏"
              className="thin-reading__intuecho-rail"
              onClick={() => setIntuechoCollapsed(false)}
              title="展开 Intuecho 推荐栏"
              type="button"
            >
              <LightbulbRegular aria-hidden="true" />
              <span>Intuecho</span>
              {pendingPublicQueue.length > 0 ? (
                <small>{pendingPublicQueue.length}</small>
              ) : null}
            </button>
          ) : (
            <>
              <button
                aria-expanded="true"
                aria-label="收起 Intuecho 推荐栏"
                className="thin-reading__intuecho-toggle"
                onClick={() => setIntuechoCollapsed(true)}
                title="收起 Intuecho 推荐栏"
                type="button"
              >
                <ChevronRightRegular aria-hidden="true" />
              </button>
              <div className="thin-reading__intuecho-mark">∿</div>
              <h2>Intuecho</h2>
              <p className="thin-reading__intuecho-caption">从当前页面继续联想</p>
              <div className="thin-reading__recommendations">
                {activeNode.recommendations.map((recommendation) => (
                  <div className="thin-reading__recommendation" key={recommendation.id}>
                    <strong>{recommendation.relationship}</strong>
                    <span>{recommendation.note}</span>
                    <button onClick={() => annotateBlock({
                      excerpt: recommendation.note,
                      target: { kind: "recommendation", nodeId: activeNode.id, recommendationId: recommendation.id }
                    })} type="button">批注</button>
                  </div>
                ))}
              </div>
              {pendingPublicQueue.length > 0 ? (
                <div className="thin-reading__pending-summary">{THIN_READING_INTUECHO_PENDING_LABEL} · {pendingPublicQueue.length}</div>
              ) : null}
            </>
          )}
        </aside>
      </div>

      {selection ? (
        <div className="thin-reading__selection-popover" style={{ left: selection.left, top: selection.top }}>
          <label htmlFor="thin-reading-prompt">深入提示（可选）</label>
          <input id="thin-reading-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          <button disabled={generating} onClick={() => void deepenSelection()} type="button">深入</button>
          <label htmlFor="thin-reading-annotation">批注</label>
          <input id="thin-reading-annotation" value={annotationBody} onChange={(event) => setAnnotationBody(event.target.value)} />
          <label>
            <input checked={annotationPublic} onChange={(event) => setAnnotationPublic(event.currentTarget.checked)} type="checkbox" />
            公开
          </label>
          <button onClick={saveSelectionAnnotation} type="button">保存批注</button>
        </div>
      ) : null}
    </main>
  );
}
