import { Button } from "@fluentui/react-components";
import { AddRegular, SubtractRegular } from "@fluentui/react-icons";
import { useMemo, useState } from "react";
import liteasyLogoUrl from "../../assets/liteasyclaw-logo.jpg";
import { ArtifactTabs } from "../features/artifacts/ArtifactTabs";
import type { ArtifactTask, ArtifactTab, ArtifactType } from "../features/artifacts/artifact.types";
import type { UIDslActionRef } from "../features/generative-ui/generativeUi.types";
import { PdfReader, type PdfEvidenceTarget } from "../features/pdf/PdfReader";
import type { ReaderConversationContext } from "../features/assistant/assistantContext.types";
import type { Paper } from "../features/workspace/workspace.types";
import type { ThinReadingBranchSource, ThinReadingDocument } from "../features/thin-reading/thinReading.types";
import { DockLayoutControls } from "./DockLayoutControls";
import type { PaneCollapseState } from "./paneLayout.types";

type ReaderPaneProps = {
  analysisHint: string;
  artifactTabs: ArtifactTab[];
  artifactTasks: ArtifactTask[];
  layoutCollapsed?: PaneCollapseState;
  onArtifactDynamicAction?: (action: UIDslActionRef) => void;
  onOpenEvidence?: (request: Omit<PdfEvidenceTarget, "requestId">) => void;
  onGenerateThinReadingBranch?: (input: {
    artifactId: string;
    document: ThinReadingDocument;
    source: ThinReadingBranchSource;
  }) => Promise<void>;
  onSyncThinReadingAnnotations?: (input: { artifactId: string; document: ThinReadingDocument }) => Promise<void>;
  onAddReaderContextToConversation?: (context: ReaderConversationContext) => void;
  intuechoEndpoint?: string;
  onSaveMarkdownTab?: (artifactId: string) => void;
  onStartAnalysis: (artifactType: ArtifactType, selectedPapers?: Paper[]) => void;
  onToggleBottomPane?: () => void;
  onToggleLeftPane?: () => void;
  onToggleRightPane?: () => void;
  onUpdateMarkdownTab?: (artifactId: string, markdown: string) => void;
  onUpdateThinReadingDocument?: (artifactId: string, nextDocument: ThinReadingDocument) => void;
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
  onGenerateThinReadingBranch,
  onSyncThinReadingAnnotations,
  onAddReaderContextToConversation,
  intuechoEndpoint,
  onSaveMarkdownTab,
  onStartAnalysis,
  onToggleBottomPane,
  onToggleLeftPane,
  onToggleRightPane,
  onUpdateMarkdownTab,
  onUpdateThinReadingDocument,
  selectedPapers = [],
  selectedPaperIds,
  selectionLocked,
  showArtifactRegion = true,
  targetEvidence
}: ReaderPaneProps) {
  const [zoom, setZoom] = useState(100);
  const activePaper = selectedPapers[0] ?? null;
  const analysisPapers = useMemo(() => {
    const selectedPaperIdSet = new Set(selectedPaperIds);
    return selectedPapers.filter((paper) => selectedPaperIdSet.has(paper.id));
  }, [selectedPaperIds, selectedPapers]);
  const artifactRegionVisible = showArtifactRegion && !layoutCollapsed.bottom;

  return (
    <main className="pane center">
      <div aria-label="PDF 标题栏" className="pane-header reader-pane-header">
        {activePaper ? (
          <div aria-label="PDF 阅读批注工具栏" className="reader-pdf-toolbar" role="toolbar">
            <span className="reader-file-title" title={activePaper.sourcePath ?? "当前使用 PDF.js 阅读面板"}>
              {activePaper.title}
            </span>
            <Button
              aria-label="缩小 PDF 页面"
              appearance="subtle"
              icon={<SubtractRegular />}
              onClick={() => setZoom((current) => Math.max(70, current - 10))}
              size="small"
              title="缩小 PDF 页面"
              type="button"
            />
            <span className="reader-display-scale">显示比例 {zoom}%</span>
            <Button
              aria-label="放大 PDF 页面"
              appearance="subtle"
              icon={<AddRegular />}
              onClick={() => setZoom((current) => Math.min(180, current + 10))}
              size="small"
              title="放大 PDF 页面"
              type="button"
            />
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
            intuechoEndpoint={intuechoEndpoint}
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
                onGenerateThinReadingBranch={onGenerateThinReadingBranch}
                onSyncThinReadingAnnotations={onSyncThinReadingAnnotations}
                onOpenEvidence={onOpenEvidence}
                onSaveMarkdownTab={onSaveMarkdownTab}
                onStartAnalysis={(artifactType) => onStartAnalysis(artifactType, analysisPapers)}
                onUpdateMarkdownTab={onUpdateMarkdownTab}
                onUpdateThinReadingDocument={onUpdateThinReadingDocument}
                selectedCount={selectedPaperIds.length}
                selectionLocked={selectionLocked}
                tabs={artifactTabs}
                tasks={artifactTasks}
              />
            </section>
          ) : null}
        </div>
      ) : (
        <div aria-label="PDF 空状态" className="pane-body reader-empty-brand">
          <img alt="LiteasyClaw" src={liteasyLogoUrl} />
        </div>
      )}
    </main>
  );
}
