import { Button } from "@fluentui/react-components";
import { AddRegular, SubtractRegular } from "@fluentui/react-icons";
import { useMemo, useState } from "react";
import liteasyLogoUrl from "../../assets/liteasyclaw-logo.jpg";
import { ArtifactTabs } from "../features/artifacts/ArtifactTabs";
import type { ArtifactTask, ArtifactTab, ArtifactType } from "../features/artifacts/artifact.types";
import type { UIDslActionRef } from "../features/generative-ui/generativeUi.types";
import {
  PdfReader,
  type PdfAnnotationPublicationChange,
  type PdfEvidenceTarget
} from "../features/pdf/PdfReader";
import type { PdfAnnotation, PdfAnnotationPublication } from "../features/pdf/pdfAnnotationStorage";
import type { ReaderConversationContext } from "../features/assistant/assistantContext.types";
import type { Paper } from "../features/workspace/workspace.types";
import type { ForumFeedQuery, ForumPost } from "../features/forum/forum.types";
import type {
  LiteratureRecord,
  LiteratureRelation,
  LiteratureRelationsResult
} from "../features/paper-identity/literature.types";
import type { MineruFigure } from "../features/import/import.types";
import type { TeamAnnotation } from "../features/organization/teamAnnotationClient";
import type { VisualizationTabData } from "../features/visualization/visualization.types";
import type { VisualizationArtifactV1 } from "../features/visualization/visualizationArtifact.types";
import type { MultimodalVisualizationCapability } from "../features/account/accountCapabilitiesClient";
import type {
  ThinReadingBranchSource,
  ThinReadingDocument,
  ThinReadingExternalSource
} from "../features/thin-reading/thinReading.types";
import type { ThinReadingPaperRelationsTransport } from "../features/thin-reading/thinReadingPaperRelationsClient";
import { DockLayoutControls } from "./DockLayoutControls";
import type { PaneCollapseState } from "./paneLayout.types";
import type { ThinReadingVisualizationStatus } from "../features/artifacts/artifact.types";

type ReaderPaneProps = {
  allowServerPdfParsing?: boolean;
  analysisHint: string;
  artifactTabs: ArtifactTab[];
  artifactTasks: ArtifactTask[];
  developerDiagnostics?: boolean;
  externalKnowledgeEndpoint?: string;
  layoutCollapsed?: PaneCollapseState;
  loadPdfSource?: (sourcePath: string) => Promise<Uint8Array>;
  loadOrganizationAnnotations?: (paper: Paper) => Promise<TeamAnnotation[]>;
  loadLiteratureRelations?: (literatureId: string) => Promise<LiteratureRelationsResult>;
  organizationAnnotationActorId?: string;
  canModerateOrganizationAnnotations?: boolean;
  onAddExternalPdfToLibrary?: (input: { bytes: Uint8Array; fileName: string; title: string }) => Promise<void>;
  onOpenExternalFullText?: (source: ThinReadingExternalSource) => Promise<void>;
  onOpenLiteratureVersion?: (literature: LiteratureRecord, relation: LiteratureRelation) => void | Promise<void>;
  onPaperAnnotated?: (paperId: string) => Promise<void>;
  onPromoteExternalPaperToLibrary?: (source: ThinReadingExternalSource) => Promise<void>;
  onArtifactDynamicAction?: (action: UIDslActionRef) => void;
  onOpenEvidence?: (request: Omit<PdfEvidenceTarget, "requestId">) => void;
  onOpenVisualization?: (data: VisualizationTabData) => void;
  onLoadForumFeed?: (query: ForumFeedQuery) => Promise<ForumPost[]>;
  onChangeAnnotationPublication?: (input: PdfAnnotationPublicationChange) => Promise<PdfAnnotationPublication>;
  onDeleteOrganizationAnnotation?: (input: { annotation: TeamAnnotation; paper: Paper }) => Promise<void>;
  onShareAnnotationToOrganization?: (input: {
    annotation: PdfAnnotation;
    paper: Paper;
  }) => Promise<TeamAnnotation>;
  onUpdateOrganizationAnnotation?: (input: {
    annotation: TeamAnnotation;
    note: string;
    paper: Paper;
  }) => Promise<TeamAnnotation>;
  onGenerateThinReadingBranch?: (input: {
    artifactId: string;
    document: ThinReadingDocument;
    source: ThinReadingBranchSource;
  }) => Promise<void>;
  onSyncThinReadingAnnotations?: (input: { artifactId: string; document: ThinReadingDocument }) => Promise<void>;
  onAddReaderContextToConversation?: (context: ReaderConversationContext) => void;
  intuechoEndpoint?: string;
  intuechoSessionId?: string;
  mineruFiguresByPaperId?: Record<string, MineruFigure[]>;
  pdfBackground?: string;
  onStartAnalysis: (artifactType: ArtifactType, selectedPapers?: Paper[]) => void;
  onToggleBottomPane?: () => void;
  onToggleLeftPane?: () => void;
  onToggleRightPane?: () => void;
  onUpdateThinReadingDocument?: (artifactId: string, nextDocument: ThinReadingDocument) => void;
  onToggleThinReadingVisualization?: (enabled: boolean) => void;
  thinReadingVisualizationCapability?: MultimodalVisualizationCapability;
  thinReadingVisualizationReadyArtifacts?: readonly VisualizationArtifactV1[];
  thinReadingVisualizationStatuses?: Record<string, ThinReadingVisualizationStatus>;
  paperRelationsTransport?: ThinReadingPaperRelationsTransport;
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
  allowServerPdfParsing = false,
  analysisHint,
  artifactTabs,
  artifactTasks,
  developerDiagnostics = false,
  externalKnowledgeEndpoint,
  layoutCollapsed = defaultLayoutCollapsed,
  loadPdfSource,
  loadOrganizationAnnotations,
  loadLiteratureRelations,
  organizationAnnotationActorId,
  canModerateOrganizationAnnotations,
  onAddExternalPdfToLibrary,
  onOpenExternalFullText,
  onOpenLiteratureVersion,
  onPaperAnnotated,
  onPromoteExternalPaperToLibrary,
  onArtifactDynamicAction,
  onOpenEvidence,
  onOpenVisualization,
  onLoadForumFeed,
  onChangeAnnotationPublication,
  onDeleteOrganizationAnnotation,
  onShareAnnotationToOrganization,
  onUpdateOrganizationAnnotation,
  onGenerateThinReadingBranch,
  onSyncThinReadingAnnotations,
  onAddReaderContextToConversation,
  intuechoEndpoint,
  intuechoSessionId,
  mineruFiguresByPaperId,
  pdfBackground,
  onStartAnalysis,
  onToggleBottomPane,
  onToggleLeftPane,
  onToggleRightPane,
  onUpdateThinReadingDocument,
  onToggleThinReadingVisualization,
  thinReadingVisualizationCapability,
  thinReadingVisualizationReadyArtifacts = [],
  thinReadingVisualizationStatuses = {},
  paperRelationsTransport,
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
            allowServerPdfParsing={allowServerPdfParsing}
            externalKnowledgeEndpoint={externalKnowledgeEndpoint}
            loadPdfSource={loadPdfSource}
            loadLiteratureRelations={loadLiteratureRelations}
            loadOrganizationAnnotations={loadOrganizationAnnotations}
            onOpenLiteratureVersion={onOpenLiteratureVersion}
            organizationAnnotationActorId={organizationAnnotationActorId}
            canModerateOrganizationAnnotations={canModerateOrganizationAnnotations}
            pdfBackground={pdfBackground}
            onPaperAnnotated={onPaperAnnotated}
            onAddSelectionToConversation={onAddReaderContextToConversation}
            onChangeAnnotationPublication={onChangeAnnotationPublication}
            onDeleteOrganizationAnnotation={onDeleteOrganizationAnnotation}
            onShareAnnotationToOrganization={onShareAnnotationToOrganization}
            onUpdateOrganizationAnnotation={onUpdateOrganizationAnnotation}
            selectedPapers={selectedPapers}
            targetEvidence={targetEvidence}
            zoom={zoom}
          />
          {artifactRegionVisible ? (
            <section aria-label="多模态产物区域" className="reader-artifact-region">
              <ArtifactTabs
                analysisHint={analysisHint}
                canStartAnalysis={selectedPaperIds.length > 0 && selectionLocked}
                developerDiagnostics={developerDiagnostics}
                externalKnowledgeEndpoint={externalKnowledgeEndpoint}
                paperRelationsTransport={paperRelationsTransport}
                intuechoEndpoint={intuechoEndpoint}
                intuechoSessionId={intuechoSessionId}
                mineruFiguresByPaperId={mineruFiguresByPaperId}
                onDynamicAction={onArtifactDynamicAction}
                onGenerateThinReadingBranch={onGenerateThinReadingBranch}
                onOpenExternalFullText={onOpenExternalFullText}
                onSyncThinReadingAnnotations={onSyncThinReadingAnnotations}
                onOpenEvidence={onOpenEvidence}
                onOpenVisualization={onOpenVisualization}
                onLoadForumFeed={onLoadForumFeed}
                onPromoteExternalPaperToLibrary={onPromoteExternalPaperToLibrary}
                onStartAnalysis={(artifactType) => onStartAnalysis(artifactType, analysisPapers)}
                onUpdateThinReadingDocument={onUpdateThinReadingDocument}
                onToggleThinReadingVisualization={onToggleThinReadingVisualization}
                thinReadingVisualizationCapability={thinReadingVisualizationCapability}
                thinReadingVisualizationReadyArtifacts={thinReadingVisualizationReadyArtifacts}
                thinReadingVisualizationStatuses={thinReadingVisualizationStatuses}
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
