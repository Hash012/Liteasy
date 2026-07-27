import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRegular, ArrowRightRegular } from "@fluentui/react-icons";
import {
  advanceThinReadingDocument,
  listThinReadingBranchOptions
} from "./thinReadingProjection";
import type { ThinReadingDocument } from "./thinReading.types";
import "./thinReading.css";

export type ThinReadingTabProps = {
  artifactId: string;
  document: ThinReadingDocument;
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

export function ThinReadingTab({ artifactId, document, onUpdateDocument, papers }: ThinReadingTabProps) {
  const activeNode = document.nodes[document.activeNodeId] ?? document.nodes[document.rootNodeId];
  const paragraphRef = useRef<HTMLParagraphElement>(null);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [selection, setSelection] = useState<{ excerpt: string; top: number; left: number } | null>(null);
  const [prompt, setPrompt] = useState("");
  const paperTitle = useMemo(
    () => papers.find((paper) => document.paperIds.includes(paper.id))?.title ?? "未命名论文",
    [document.paperIds, papers]
  );
  const parent = activeNode.parentId ? document.nodes[activeNode.parentId] : undefined;
  const branches = listThinReadingBranchOptions(document, activeNode.id);
  const canGoBack = Boolean(parent);

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
    const paragraph = paragraphRef.current;
    if (!paragraph || !excerpt || !range || !paragraph.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setSelection({ excerpt, left: Math.max(16, rect.left), top: Math.max(16, rect.bottom + 10) });
  }

  function deepenSelection() {
    if (!selection) return;
    update(
      advanceThinReadingDocument(document, {
        parentNodeId: activeNode.id,
        source: { kind: "selected_text", excerpt: selection.excerpt, ...(prompt ? { prompt } : {}) },
        summary: `围绕“${selection.excerpt}”的深入薄读。`,
        title: `深入：${selection.excerpt.slice(0, 24)}`
      })
    );
    setSelection(null);
    setPrompt("");
  }

  function advanceOmittedSection(sectionKey: string, label: string) {
    update(
      advanceThinReadingDocument(document, {
        parentNodeId: activeNode.id,
        source: { kind: "omitted_section", label, sectionKey },
        summary: `围绕“${label}”的深入薄读。`,
        title: label
      })
    );
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

  return (
    <main className="thin-reading" aria-label="薄读页面">
      <header className="thin-reading__topbar">
        <div className="thin-reading__heading">
          <span className="thin-reading__eyebrow">THIN READING</span>
          <h1>{document.title}</h1>
          <span className="thin-reading__source">源文：{paperTitle}</span>
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
          <div className="thin-reading__article-meta">{sourceLabel(activeNode.source)} · {activeNode.withinPaperClosure ? "论文内延展" : "跨论文总览"}</div>
          <h2>{activeNode.title}</h2>
          <p
            className="thin-reading__summary"
            data-testid="thin-reading-summary"
            onKeyUp={inspectSelection}
            onMouseUp={inspectSelection}
            ref={paragraphRef}
          >
            {activeNode.summary}
          </p>
          {activeNode.omittedSections.length > 0 ? (
            <div className="thin-reading__omitted" aria-label="待展开板块">
              {activeNode.omittedSections.map((section) => (
                <button key={section.id} onClick={() => advanceOmittedSection(section.sectionKey, section.label)} type="button">
                  {section.label}
                </button>
              ))}
            </div>
          ) : null}
        </article>

        <aside className="thin-reading__intuecho" aria-label="Intuecho 推荐">
          <div className="thin-reading__intuecho-mark">∿</div>
          <h2>Intuecho</h2>
          <p className="thin-reading__intuecho-caption">从当前页面继续联想</p>
          <div className="thin-reading__recommendations">
            {activeNode.recommendations.map((recommendation) => (
              <div className="thin-reading__recommendation" key={recommendation.id}>
                <strong>{recommendation.relationship}</strong>
                <span>{recommendation.note}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {selection ? (
        <div className="thin-reading__selection-popover" style={{ left: selection.left, top: selection.top }}>
          <label htmlFor="thin-reading-prompt">深入提示（可选）</label>
          <input id="thin-reading-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          <button onClick={deepenSelection} type="button">深入</button>
        </div>
      ) : null}
    </main>
  );
}
