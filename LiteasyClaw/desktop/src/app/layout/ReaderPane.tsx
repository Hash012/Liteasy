import { useState } from "react";
import liteasyLogoUrl from "../../assets/liteasyclaw-logo.jpg";
import { ArtifactTabs } from "../features/artifacts/ArtifactTabs";
import type { ArtifactTask, ArtifactTab, ArtifactType } from "../features/artifacts/artifact.types";
import type { UIDslActionRef } from "../features/generative-ui/generativeUi.types";
import { PdfReader, type PdfEvidenceTarget } from "../features/pdf/PdfReader";
import type { ReaderConversationContext } from "../features/assistant/assistantContext.types";
import type { Paper } from "../features/workspace/workspace.types";
import { DockLayoutControls } from "./DockLayoutControls";
import type { PaneCollapseState } from "./paneLayout.types";

type ReaderPaneProps = {
  analysisHint: string;
  artifactTabs: ArtifactTab[];
  artifactTasks: ArtifactTask[];
  layoutCollapsed?: PaneCollapseState;
  onArtifactDynamicAction?: (action: UIDslActionRef) => void;
  onOpenEvidence?: (request: Omit<PdfEvidenceTarget, "requestId">) => void;
  onAddReaderContextToConversation?: (context: ReaderConversationContext) => void;
  onSaveMarkdownTab?: (artifactId: string) => void;
  onStartAnalysis: (artifactType: ArtifactType) => void;
  onToggleBottomPane?: () => void;
  onToggleLeftPane?: () => void;
  onToggleRightPane?: () => void;
  onUpdateMarkdownTab?: (artifactId: string, markdown: string) => void;
  showArtifactRegion?: boolean;
  selectedPapers?: Paper[];
  selectedPaperIds: string[];
  selectionLocked: boolean;
  targetEvidence?: PdfEvidenceTarget | null;
};

const defaultLayoutCollapsed: PaneCollapseState = {
  bottom: false,
  left: false,
  right: false
};

export function ReaderPane({
  analysisHint,
  artifactTabs,
  artifactTasks,
  layoutCollapsed = defaultLayoutCollapsed,
  onArtifactDynamicAction,
  onOpenEvidence,
  onAddReaderContextToConversation,
  onSaveMarkdownTab,
  onStartAnalysis,
  onToggleBottomPane,
  onToggleLeftPane,
  onToggleRightPane,
  onUpdateMarkdownTab,
  selectedPapers = [],
  selectedPaperIds,
  selectionLocked,
  showArtifactRegion = true,
  targetEvidence
}: ReaderPaneProps) {
  const [zoom, setZoom] = useState(100);
  const activePaper = selectedPapers[0] ?? null;
  const artifactRegionVisible = showArtifactRegion && !layoutCollapsed.bottom;

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
        {activePaper ? (
          <div aria-label="PDF 阅读批注工具栏" className="reader-pdf-toolbar" role="toolbar">
            <span className="reader-file-title" title={activePaper.sourcePath ?? "当前使用 PDF.js 阅读面板"}>
              {activePaper.title}
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
        ) : null}
        <DockLayoutControls
          collapsed={layoutCollapsed}
          onToggleBottom={onToggleBottomPane}
          onToggleLeft={onToggleLeftPane}
          onToggleRight={onToggleRightPane}
        />
      </div>
      {activePaper ? (
        <div
          className={`pane-body reader-content-grid ${
            showArtifactRegion
              ? artifactRegionVisible
                ? ""
                : "artifacts-collapsed"
              : "artifacts-detached"
          }`}
        >
          <PdfReader
            onAddSelectionToConversation={onAddReaderContextToConversation}
            selectedPapers={selectedPapers}
            targetEvidence={targetEvidence}
            zoom={zoom}
          />
          {artifactRegionVisible ? (
          <section aria-label="多模态产物区域" className="reader-artifact-region">
            <ArtifactTabs
              analysisHint={analysisHint}
              canStartAnalysis={selectedPaperIds.length > 0 && selectionLocked}
              onDynamicAction={onArtifactDynamicAction}
              onOpenEvidence={onOpenEvidence}
              onSaveMarkdownTab={onSaveMarkdownTab}
              onStartAnalysis={onStartAnalysis}
              onUpdateMarkdownTab={onUpdateMarkdownTab}
              selectedCount={selectedPaperIds.length}
              selectionLocked={selectionLocked}
              tabs={artifactTabs}
              tasks={artifactTasks}
            />
          </section>
          ) : null}
        </div>
      ) : (
        <div aria-label="Reader 空状态" className="pane-body reader-empty-brand">
          <img alt="LiteasyClaw" src={liteasyLogoUrl} />
        </div>
      )}
    </main>
  );
}
