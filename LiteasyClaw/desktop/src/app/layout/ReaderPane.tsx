import { useState } from "react";
import { ArtifactTabs } from "../features/artifacts/ArtifactTabs";
import type { ArtifactTask, ArtifactTab, ArtifactType } from "../features/artifacts/artifact.types";
import { PdfReader } from "../features/pdf/PdfReader";
import type { Paper } from "../features/workspace/workspace.types";
import type { PaneCollapseState } from "./paneLayout.types";

type ReaderPaneProps = {
  analysisHint: string;
  artifactTabs: ArtifactTab[];
  artifactTasks: ArtifactTask[];
  layoutCollapsed?: PaneCollapseState;
  onStartAnalysis: (artifactType: ArtifactType) => void;
  onToggleBottomPane?: () => void;
  onToggleLeftPane?: () => void;
  onToggleRightPane?: () => void;
  selectedPapers?: Paper[];
  selectedPaperIds: string[];
  selectionLocked: boolean;
};

const defaultLayoutCollapsed: PaneCollapseState = {
  bottom: false,
  left: false,
  right: false
};

function getToggleLabel(target: "bottom" | "left" | "right", collapsed: boolean) {
  const action = collapsed ? "展开" : "折叠";

  if (target === "bottom") {
    return `${action}下栏`;
  }

  if (target === "left") {
    return `${action}左侧栏`;
  }

  return `${action}右侧栏`;
}

function LayoutToggleButton({
  collapsed,
  icon,
  onToggle,
  target
}: {
  collapsed: boolean;
  icon: "bottom" | "left" | "right";
  onToggle?: () => void;
  target: "bottom" | "left" | "right";
}) {
  const label = getToggleLabel(target, collapsed);

  return (
    <button
      aria-label={label}
      aria-pressed={collapsed}
      className={collapsed ? "reader-layout-button collapsed" : "reader-layout-button"}
      onClick={onToggle}
      title={label}
      type="button"
    >
      <span aria-hidden="true" className={`reader-layout-icon ${icon}`} />
    </button>
  );
}

export function ReaderPane({
  analysisHint,
  artifactTabs,
  artifactTasks,
  layoutCollapsed = defaultLayoutCollapsed,
  onStartAnalysis,
  onToggleBottomPane,
  onToggleLeftPane,
  onToggleRightPane,
  selectedPapers = [],
  selectedPaperIds,
  selectionLocked
}: ReaderPaneProps) {
  const [zoom, setZoom] = useState(100);
  const activePaper = selectedPapers[0] ?? null;
  const documentTitle = activePaper?.title ?? "选择文献后开始阅读";
  const artifactRegionVisible = !layoutCollapsed.bottom;

  return (
    <main className="pane center">
      <div aria-label="Reader 标题栏" className="pane-header reader-pane-header">
        <div className="reader-header-primary">
          <span className="reader-pane-title">Reader</span>
          <span className="reader-brand-lockup" title="LiteasyClaw · AI-driven paper-assisted reading platform · 云端模型能力">
            <span className="reader-brand-name">LiteasyClaw</span>
            <span className="reader-brand-tagline">AI-driven paper-assisted reading platform</span>
            <span className="reader-model-indicator">云端模型能力</span>
          </span>
        </div>
        <div aria-label="PDF 阅读批注工具栏" className="reader-pdf-toolbar" role="toolbar">
          <span className="reader-file-title" title={activePaper?.sourcePath ?? "当前使用 PDF.js 阅读面板"}>
            {documentTitle}
          </span>
          <button
            aria-label="缩小 PDF 页面"
            onClick={() => setZoom((current) => Math.max(70, current - 10))}
            title="缩小 PDF 页面"
            type="button"
          >
            -
          </button>
          <span className="reader-display-scale">显示比例 {zoom}%</span>
          <button
            aria-label="放大 PDF 页面"
            onClick={() => setZoom((current) => Math.min(180, current + 10))}
            title="放大 PDF 页面"
            type="button"
          >
            +
          </button>
        </div>
        <div aria-label="阅读区布局控制" className="reader-layout-controls" role="toolbar">
          <LayoutToggleButton
            collapsed={layoutCollapsed.left}
            icon="left"
            onToggle={onToggleLeftPane}
            target="left"
          />
          <LayoutToggleButton
            collapsed={layoutCollapsed.bottom}
            icon="bottom"
            onToggle={onToggleBottomPane}
            target="bottom"
          />
          <LayoutToggleButton
            collapsed={layoutCollapsed.right}
            icon="right"
            onToggle={onToggleRightPane}
            target="right"
          />
        </div>
      </div>
      <div className={`pane-body reader-content-grid ${artifactRegionVisible ? "" : "artifacts-collapsed"}`}>
        <PdfReader selectedPapers={selectedPapers} zoom={zoom} />
        {artifactRegionVisible ? (
          <section aria-label="多模态产物区域" className="reader-artifact-region">
            <ArtifactTabs
              analysisHint={analysisHint}
              canStartAnalysis={selectedPaperIds.length > 0 && selectionLocked}
              onStartAnalysis={onStartAnalysis}
              selectedCount={selectedPaperIds.length}
              selectionLocked={selectionLocked}
              tabs={artifactTabs}
              tasks={artifactTasks}
            />
          </section>
        ) : null}
      </div>
    </main>
  );
}
