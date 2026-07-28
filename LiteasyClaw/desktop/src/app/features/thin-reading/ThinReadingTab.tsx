import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
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
import { listThinReadingPendingPublicAnnotations } from "./thinReadingIntuechoSyncQueue";
import { getThinReadingPaperTypeLabel } from "./thinReadingPromptRegistry";
import { getThinReadingUiCopy } from "./thinReadingI18n";
import type {
  ThinReadingAnnotationTarget,
  ThinReadingBranchSource,
  ThinReadingDocument,
  ThinReadingEvidenceSpan,
  ThinReadingSummarySentence
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
  const fallbackEvidenceIds = node.evidence.claims?.find((claim) => claim.evidenceIds.length > 0)?.evidenceIds ??
    node.evidence.paperEvidence.slice(0, 2);
  const sentences = splitSummarySentences(node.summary);
  return (sentences.length > 0 ? sentences : [node.summary]).map((sentence, index) => ({
    evidenceIds: fallbackEvidenceIds,
    externalKnowledge: fallbackEvidenceIds.length > 0
      ? []
      : node.evidence.externalKnowledge.slice(0, 2),
    id: `${node.id}-summary-sentence-${index}`,
    status: fallbackEvidenceIds.length > 0
      ? "grounded"
      : node.evidence.externalKnowledge.length > 0
        ? "weak"
        : "unsupported",
    text: sentence
  }));
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
  const contentRef = useRef<HTMLDivElement>(null);
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
  const labels = getThinReadingUiCopy(document.targetLanguage);
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
  const externalSourceById = useMemo(
    () => new Map((activeNode.evidence.externalSources ?? []).map((source) => [source.id, source])),
    [activeNode.evidence.externalSources]
  );

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
      setGenerationError(labels.unavailableAgent);
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

  function openSummaryMarkerEvidence(
    event: ReactMouseEvent<HTMLButtonElement>,
    span: ThinReadingEvidenceSpan
  ) {
    event.preventDefault();
    event.stopPropagation();
    openEvidenceSpan(span);
  }

  function advanceOmittedSection(sectionKey: string, label: string) {
    const source: ThinReadingBranchSource = { kind: "omitted_section", label, sectionKey };
    void generateBranch(source);
  }

  function deepenRecommendation(input: {
    note: string;
    relationship: string;
  }) {
    void generateBranch({
      kind: "selected_text",
      excerpt: input.note,
      prompt: labels.deepenIntuechoPrompt(input.relationship)
    });
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

  return (
    <main
      className={`thin-reading ${activeNode.withinPaperClosure ? "" : "is-external"} ${intuechoCollapsed ? "is-intuecho-collapsed" : ""}`}
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
        <button className={activeNode.id === document.rootNodeId ? "is-active" : ""} onClick={() => goToNode(document.rootNodeId)} type="button">
          {labels.overview}
        </button>
        <span>/</span>
        <span className="is-active">{labels.depth(activeNode.depth)}</span>
      </div>

      <div
        className="thin-reading__body"
        onKeyUp={inspectSelection}
        onMouseUp={inspectSelection}
        ref={contentRef}
      >
        <article className="thin-reading__article">
          <div className="thin-reading__article-meta">
            {sourceLabel(activeNode.source, labels)}
            {paperTypeLabel ? ` · ${paperTypeLabel}` : ""}
            {" · "}
            {activeNode.withinPaperClosure ? labels.paperEvidence : labels.externalKnowledge}
          </div>
          <h2>{activeNode.title}</h2>
          <section>
            <p
              className="thin-reading__summary"
              data-testid="thin-reading-summary"
            >
              {summarySentences.map((sentence, index) => {
                return (
                  <span
                    className="thin-reading__summary-sentence"
                    key={sentence.id}
                  >
                    {sentence.text}
                    {sentence.evidenceIds.length > 0 ? sentence.evidenceIds.map((evidenceId, evidenceIndex) => {
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
                    }) : sentence.externalKnowledge.length > 0 ? sentence.externalKnowledge.map((sourceId, sourceIndex) => {
                      const source = externalSourceById.get(sourceId);
                      return (
                        <sup key={`${sentence.id}-${sourceId}`}>
                          {source ? (
                            <a
                              aria-label={labels.evidenceExternalOpen(source.title)}
                              className="thin-reading__summary-marker"
                              href={source.url}
                              rel="noreferrer"
                              target="_blank"
                              title={labels.evidenceExternalTitle([source.title])}
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
                    }) : (
                      <sup>
                        <span
                          className="thin-reading__summary-marker is-static"
                          title={labels.evidenceReviewTitle}
                        >
                          {labels.evidenceReview}
                        </span>
                      </sup>
                    )}
                    {index < summarySentences.length - 1 ? " " : ""}
                  </span>
                );
              })}
            </p>
          </section>
          {activeNode.omittedSections.length > 0 ? (
            <div className="thin-reading__omitted" aria-label={labels.omittedRegion}>
              {activeNode.omittedSections.map((section) => (
                <button disabled={generating} key={section.id} onClick={() => advanceOmittedSection(section.sectionKey, section.label)} type="button">
                  {section.label}
                </button>
              ))}
            </div>
          ) : null}
          {generating ? <div className="thin-reading__status">{labels.generating}</div> : null}
          {generationError ? <div className="thin-reading__error">{generationError}</div> : null}
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
                      onChange={(event) => setEditingAnnotationBody(event.target.value)}
                      value={editingAnnotationBody}
                    />
                    <div className="thin-reading__annotation-actions">
                      <button onClick={() => {
                        update(updateThinReadingAnnotation(document, annotation.id, editingAnnotationBody));
                        setEditingAnnotationId(null);
                      }} type="button">{labels.save}</button>
                      <button onClick={() => setEditingAnnotationId(null)} type="button">{labels.cancel}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p>{annotation.body}</p>
                    {annotation.visibility === "pending_public" ? <span className="thin-reading__pending">{labels.pendingSync}</span> : null}
                    <div className="thin-reading__annotation-actions">
                      <label>
                        <input
                          checked={annotation.visibility === "pending_public"}
                          onChange={(event) => update(setThinReadingAnnotationPublic(document, annotation.id, event.currentTarget.checked))}
                          type="checkbox"
                        />
                        {labels.public}
                      </label>
                      <button onClick={() => {
                        setEditingAnnotationId(annotation.id);
                        setEditingAnnotationBody(annotation.body);
                      }} type="button">{labels.edit}</button>
                      <button onClick={() => update(deleteThinReadingAnnotation(document, annotation.id))} type="button">{labels.delete}</button>
                    </div>
                  </>
                )}
              </article>
            )) : <p className="thin-reading__annotation-empty">{labels.annotationEmpty}</p>}
          </section>
        </article>

        <aside className={`thin-reading__intuecho ${intuechoCollapsed ? "is-collapsed" : ""}`} aria-label={labels.recommendationRegion}>
          {intuechoCollapsed ? (
            <button
              aria-expanded="false"
              aria-label={labels.expandIntuecho}
              className="thin-reading__intuecho-rail"
              onClick={() => setIntuechoCollapsed(false)}
              title={labels.expandIntuecho}
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
              <p className="thin-reading__intuecho-caption">{labels.recommendationCaption}</p>
              <div className="thin-reading__recommendations">
                {activeNode.recommendations.map((recommendation) => (
                  <div className="thin-reading__recommendation" key={recommendation.id}>
                    <strong>{recommendation.relationship}</strong>
                    <span>{recommendation.note}</span>
                    <div className="thin-reading__recommendation-actions">
                      <button
                        aria-label={labels.deepenIntuecho(recommendation.relationship)}
                        disabled={generating}
                        onClick={() => deepenRecommendation({
                          note: recommendation.note,
                          relationship: recommendation.relationship
                        })}
                        type="button"
                      >
                        {labels.deepen}
                      </button>
                      <button onClick={() => annotateBlock({
                        excerpt: recommendation.note,
                        target: { kind: "recommendation", nodeId: activeNode.id, recommendationId: recommendation.id }
                      })} type="button">{labels.annotate}</button>
                    </div>
                  </div>
                ))}
              </div>
              {pendingPublicQueue.length > 0 ? (
                <div className="thin-reading__pending-summary">{labels.pendingSync} · {pendingPublicQueue.length}</div>
              ) : null}
            </>
          )}
        </aside>
      </div>

      {selection ? (
        <div className="thin-reading__selection-popover" style={{ left: selection.left, top: selection.top }}>
          <label htmlFor="thin-reading-prompt">{labels.deepenPrompt}</label>
          <input id="thin-reading-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          <button disabled={generating} onClick={() => void deepenSelection()} type="button">{labels.deepen}</button>
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
