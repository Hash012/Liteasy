import type { PdfAppearance } from "../features/pdf/PdfAppearanceControl";
import { GenerationPromptDialog } from "../features/ai-prompts/GenerationPromptDialog";
import type { PdfQuickAskRequest } from "../features/pdf/pdfQuickAsk";
import type { SelectionLookupPort } from "../features/selection-lookup/selectionLookup.types";
import { Button } from "@fluentui/react-components";
import {
  CheckmarkCircleRegular,
  DocumentSearchRegular,
  WarningRegular
} from "@fluentui/react-icons";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { WorkbenchWelcome } from "../features/workbench/WorkbenchWelcome";
import { ArtifactTabs } from "../features/artifacts/ArtifactTabs";
import type { ArtifactTask, ArtifactTab, ArtifactType } from "../features/artifacts/artifact.types";
import type { UIDslActionRef } from "../features/generative-ui/generativeUi.types";
import {
  PdfReader,
  type PdfAnnotationPublicationChange,
  type PdfEvidenceTarget,
  type PdfReaderSelectionSnapshot
} from "../features/pdf/PdfReader";
import type { PdfAnnotation, PdfAnnotationPublication } from "../features/pdf/pdfAnnotationStorage";
import type { PdfReadingAnnotations } from "../features/pdf/pdfReadingAnnotations";
import type { ReaderConversationContext } from "../features/assistant/assistantContext.types";
import type { Paper } from "../features/workspace/workspace.types";
import type { ForumFeedQuery, ForumPost } from "../features/forum/forum.types";
import type {
  LiteratureRecord,
  LiteratureRelation,
  LiteratureRelationsResult
} from "../features/paper-identity/literature.types";
import type { LiteratureResolutionState } from "../features/paper-identity/literatureResolutionRepository";
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
  selectionLookup?: SelectionLookupPort;
  onGenerateGuide?: import("../features/paper-reading/literatureGuide").GuideGenerator;
  onDocumentInfo?: (info: import("../features/pdf/pdfDocumentInfo").PdfDocumentInfo) => void;
  onQuickAsk?: (request: PdfQuickAskRequest) => Promise<string>;
  readingContent?: ReactNode | ((annotations: PdfReadingAnnotations) => ReactNode);
  extractingPaper?: boolean;
  onExtractPaper?: () => Promise<void>;
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
  literatureResolution?: LiteratureResolutionState;
  organizationAnnotationActorId?: string;
  canModerateOrganizationAnnotations?: boolean;
  onAddExternalPdfToLibrary?: (input: { bytes: Uint8Array; fileName: string; title: string }) => Promise<void>;
  onAcquireLiteratureVersion?: (
    literature: LiteratureRecord,
    relation: LiteratureRelation
  ) => Promise<{ created: boolean; documentId: string } | void>;
  onOpenExternalFullText?: (source: ThinReadingExternalSource) => Promise<void>;
  onOpenLiteratureVersion?: (literature: LiteratureRecord, relation: LiteratureRelation) => void | Promise<void>;
  onResolveLiteratureIdentity?: () => void;
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
  onReaderSelectionChanged?: (selection: PdfReaderSelectionSnapshot | null) => void;
  intuechoEndpoint?: string;
  intuechoSessionId?: string;
  mineruFiguresByPaperId?: Record<string, MineruFigure[]>;
  pdfBackground?: string;
  pdfAppearance?: PdfAppearance;
  onPdfAppearanceChange?: (value: PdfAppearance) => void;
  onStartAnalysis: (artifactType: ArtifactType, selectedPapers?: Paper[], options?: import("../features/artifacts/useArtifactActions").AgentArtifactGenerationOptions) => void | string;
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
  selectionLookup,
  onDocumentInfo,
  onQuickAsk,
  onGenerateGuide,
  readingContent, extractingPaper, onExtractPaper,
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
  literatureResolution,
  organizationAnnotationActorId,
  canModerateOrganizationAnnotations,
  onAddExternalPdfToLibrary,
  onAcquireLiteratureVersion,
  onOpenExternalFullText,
  onOpenLiteratureVersion,
  onResolveLiteratureIdentity,
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
  onReaderSelectionChanged,
  intuechoEndpoint,
  intuechoSessionId,
  mineruFiguresByPaperId,
  pdfBackground, pdfAppearance, onPdfAppearanceChange,
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
  const [thinReadingPromptOpen, setThinReadingPromptOpen] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [readingMode, setReadingMode] = useState(false);
  const [extractionError, setExtractionError] = useState("");
  const [analysisFeedback, setAnalysisFeedback] = useState("");
  useEffect(() => { setReadingMode(false); setThinReadingPromptOpen(false); }, [selectedPapers[0]?.id, targetEvidence?.requestId]);
  const readingVisible = readingMode && Boolean(readingContent);
  const activePaper = selectedPapers[0] ?? null;
  const thinReadingButton = activePaper ? <>
    <Button appearance="primary" size="small" onClick={() => setThinReadingPromptOpen(true)} title={`为《${activePaper.title}》生成薄读`}>AI 薄读</Button>
    {thinReadingPromptOpen ? <GenerationPromptDialog task="thin_reading" title={`为《${activePaper.title}》生成薄读`} onClose={() => setThinReadingPromptOpen(false)} onConfirm={(systemPrompt) => {
      setThinReadingPromptOpen(false);
      try { setAnalysisFeedback(onStartAnalysis("thin_reading", [activePaper], { systemPrompt }) ?? ""); }
      catch (error) { setAnalysisFeedback(error instanceof Error ? error.message : "薄读启动失败，请重试。"); }
    }} /> : null}
    {analysisFeedback ? <span role="status" className="reader-ai-feedback" title={analysisFeedback}>{analysisFeedback}</span> : null}
  </> : null;
  const readingModeControls = <>{thinReadingButton}
    <Button size="small" onClick={() => setReadingMode(false)}>PDF 模式</Button>
  </>;
  const analysisPapers = useMemo(() => {
    const selectedPaperIdSet = new Set(selectedPaperIds);
    return selectedPapers.filter((paper) => selectedPaperIdSet.has(paper.id));
  }, [selectedPaperIds, selectedPapers]);
  const artifactRegionVisible = showArtifactRegion && !layoutCollapsed.bottom;

  return (
    <main className="pane center">
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
          <div className="reader-pdf-surface">
          <PdfReader
            selectionLookup={selectionLookup}
            onGenerateGuide={onGenerateGuide}
            onEnterReadingMode={readingContent ? () => setReadingMode(true) : undefined}
            onExitReadingMode={() => setReadingMode(false)}
            readingView={readingVisible ? (annotations) => <section aria-label="论文阅读模式" className="reader-reading-surface">
              {typeof readingContent === "function"
                ? readingContent({ ...annotations, readerControls: readingModeControls })
                : <><div className="reader-reading-actions">{readingModeControls}</div>{readingContent}</>}
            </section> : undefined}
            onDocumentInfo={onDocumentInfo}
            onQuickAsk={onQuickAsk}
            readingControls={<>{thinReadingButton}{readingContent
              ? <Button size="small" onClick={() => setReadingMode(true)}>阅读模式</Button>
              : onExtractPaper ? <Button size="small" disabled={extractingPaper} onClick={() => {
                setExtractionError("");
                void onExtractPaper().catch((error) => setExtractionError(error instanceof Error ? error.message : String(error)));
              }}>{extractingPaper ? "正在解析…" : "MinerU 解析"}</Button> : null}</>}
            allowServerPdfParsing={allowServerPdfParsing}
            externalKnowledgeEndpoint={externalKnowledgeEndpoint}
            loadPdfSource={loadPdfSource}
            loadLiteratureRelations={loadLiteratureRelations}
            loadOrganizationAnnotations={loadOrganizationAnnotations}
            onAcquireLiteratureVersion={onAcquireLiteratureVersion}
            onOpenLiteratureVersion={onOpenLiteratureVersion}
            organizationAnnotationActorId={organizationAnnotationActorId}
            canModerateOrganizationAnnotations={canModerateOrganizationAnnotations}
            pdfBackground={pdfBackground}
            pdfAppearance={pdfAppearance} onPdfAppearanceChange={onPdfAppearanceChange}
            onPaperAnnotated={onPaperAnnotated}
            onAddSelectionToConversation={onAddReaderContextToConversation}
            onSelectionChanged={onReaderSelectionChanged}
            onChangeAnnotationPublication={onChangeAnnotationPublication}
            onDeleteOrganizationAnnotation={onDeleteOrganizationAnnotation}
            onShareAnnotationToOrganization={onShareAnnotationToOrganization}
            onUpdateOrganizationAnnotation={onUpdateOrganizationAnnotation}
            onZoomChange={setZoom}
            selectedPapers={selectedPapers}
            targetEvidence={targetEvidence}
            zoom={zoom}
          />
          {extractionError ? <p role="alert" className="reader-service-error">{extractionError}</p> : null}
          </div>
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
          <WorkbenchWelcome />
        </div>
      )}
    </main>
  );
}
