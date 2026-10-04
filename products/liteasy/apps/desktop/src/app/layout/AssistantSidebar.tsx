import type { AssistantComposerSuggestion } from "../features/assistant/assistant.types";
import { AssistantPane } from "../features/assistant/AssistantPane";
import type { ArtifactTask, ArtifactType } from "../features/artifacts/artifact.types";
import type { AssistantSessionHistoryItem, ArtifactSessionOpenRequest } from "../features/assistant/assistantSessionHistory";
import type { ModelTransport } from "../features/models/modelHttpClient";
import type { Citation, RetrievalChunk } from "../features/retrieval/retrieval.types";
import type { SettingsState } from "../features/settings/settings.types";
import type { createSettingsStore } from "../features/settings/settings.store";
import type { ActionContext } from "../features/skills/actionRegistry";
import type { DockRegionId } from "../features/dock/dock.types";
import type { Paper, WorkspaceSource } from "../features/workspace/workspace.types";
import type { ReaderConversationContext } from "../features/assistant/assistantContext.types";
import type { FrontendAgentClient } from "../features/agent-api/frontendAgentClient";
import type { ExecutionJournal } from "../features/generative-ui/executionJournal";
import type { AcademicProfile } from "../features/profile/profile.types";
import type { ReadingCatalogEntry } from "../features/library/readingCatalog.types";

import type { AssistantHistoryPersistence } from "../features/assistant/assistantHistoryPersistence";

type SettingsStoreLike = ReturnType<typeof createSettingsStore>;

type AssistantSidebarProps = {
  agentClient: FrontendAgentClient;
  historyPersistence?: AssistantHistoryPersistence;
  memoryNotice?: string;
  academicProfile?: AcademicProfile;
  artifactTasks?: ArtifactTask[];
  artifactSessionOpenRequest?: ArtifactSessionOpenRequest;
  developerDiagnostics?: boolean;
  executionJournal?: ExecutionJournal;
  /** @deprecated Agent context is supplied by the AppShell controller. */
  importedChunksByPaperId?: Record<string, RetrievalChunk[]>;
  importedSelectedCount: number;
  modelTransport?: ModelTransport;
  onApplyGeneratedTheme?: ActionContext["applyGeneratedTheme"];
  onApplyLayoutPreset?: ActionContext["applyLayoutPreset"];
  onApplyPanelAction?: ActionContext["applyPanelAction"];
  onApplyThemePreset?: ActionContext["applyThemePreset"];
  onResumeArtifactTask?: (taskId: string) => Promise<void>;
  onCancelArtifactTask?: (taskId: string) => string | Promise<string>;
  onGenerateArtifact: (artifactType: ArtifactType, paperIds?: string[], context?: string, contextRefs?: import("../features/context/objectContext").ContextRef[], systemPrompt?: string) => string;
  onImportSelectedSet?: ActionContext["importSelectedSet"];
  lazyPaperContext?: boolean;
  onPreparePapersForContext?: (paperIds: string[]) => Promise<void>;
  onExpand?: () => void;
  onMoveDockItem?: ActionContext["moveDockItem"];
  onOpenAcademicArchive?: ActionContext["openAcademicArchive"];
  onOpenCitation?: (citation: Citation) => void;
  onOpenArtifact?: (artifactId: string) => void;
  onOpenAsset?: (path: string) => void | Promise<void>;
  onOpenOrganizationSharedLibrary?: () => string | Promise<string>;
  onActiveSessionChange?: (session: AssistantSessionHistoryItem) => void;
  onSettingsChanged?: (settings: SettingsState) => void;
  profilePersonalizationSummary?: string;
  profileUnlocked?: boolean;
  profileEnabled?: boolean;
  registrationWelcomeMessage?: { content: string; id: number };
  readerConversationContext?: ReaderConversationContext | null;
  regionId?: Exclude<DockRegionId, "main">;
  runtimeOrganizationName?: string;
  runtimeWorkspace?: Partial<WorkspaceSource>;
  selectedPaperCount: number;
  availablePapers?: Paper[];
  searchEntries?: ReadingCatalogEntry[];
  contextSuggestions?: AssistantComposerSuggestion[];
  contextCatalogStatus?: string;
  onRefreshContextCatalog?: () => void;
  selectedPapers: Paper[];
  selectionLocked: boolean;
  settingsStore: SettingsStoreLike;
};

export function AssistantSidebar({
  agentClient,
  historyPersistence,
  memoryNotice,
  academicProfile,
  artifactTasks = [],
  artifactSessionOpenRequest,
  developerDiagnostics = false,
  executionJournal,
  importedChunksByPaperId,
  importedSelectedCount,
  modelTransport,
  onApplyGeneratedTheme,
  onApplyLayoutPreset,
  onApplyPanelAction,
  onApplyThemePreset,
  onResumeArtifactTask,
  onCancelArtifactTask,
  onGenerateArtifact,
  onImportSelectedSet,
  onPreparePapersForContext,
  lazyPaperContext,
  onExpand,
  onMoveDockItem,
  onOpenAcademicArchive,
  onOpenArtifact,
  onOpenAsset,
  onOpenCitation,
  onOpenOrganizationSharedLibrary,
  onActiveSessionChange,
  onSettingsChanged,
  profilePersonalizationSummary,
  profileUnlocked = false,
  profileEnabled,
  registrationWelcomeMessage,
  readerConversationContext = null,
  regionId = "right",
  runtimeOrganizationName,
  runtimeWorkspace,
  selectedPaperCount,
  availablePapers,
  searchEntries,
  contextSuggestions,
  contextCatalogStatus,
  onRefreshContextCatalog,
  selectedPapers,
  selectionLocked,
  settingsStore
}: AssistantSidebarProps) {
  const regionLabel =
    regionId === "bottom" ? "下栏AI助手" : regionId === "left" ? "左栏AI助手" : "右栏AI助手";

  return (
    <section aria-label={regionLabel} className={`pane ${regionId} assistant-only-pane`}>
      {memoryNotice ? <div role="status" className="assistant-memory-notice">{memoryNotice} 可在个人中心查看。</div> : null}
      <div className="pane-body">
        <AssistantPane
          agentClient={agentClient}
          historyPersistence={historyPersistence}
          academicProfile={academicProfile}
          artifactTasks={artifactTasks}
          artifactSessionOpenRequest={artifactSessionOpenRequest}
          developerDiagnostics={developerDiagnostics}
          executionJournal={executionJournal}
          importedChunksByPaperId={importedChunksByPaperId}
          modelTransport={modelTransport}
          onApplyGeneratedTheme={onApplyGeneratedTheme}
          onApplyLayoutPreset={onApplyLayoutPreset}
          onApplyPanelAction={onApplyPanelAction}
          onApplyThemePreset={onApplyThemePreset}
          onResumeArtifactTask={onResumeArtifactTask}
          onCancelArtifactTask={onCancelArtifactTask}
          onGenerateArtifact={onGenerateArtifact}
          onImportSelectedSet={onImportSelectedSet}
          lazyPaperContext={lazyPaperContext}
          onPreparePapersForContext={onPreparePapersForContext}
          onExpand={onExpand}
          onMoveDockItem={onMoveDockItem}
          onOpenAcademicArchive={onOpenAcademicArchive}
          onOpenArtifact={onOpenArtifact}
          onOpenAsset={onOpenAsset}
          onOpenCitation={onOpenCitation}
          onOpenOrganizationSharedLibrary={onOpenOrganizationSharedLibrary}
          onActiveSessionChange={onActiveSessionChange}
          onSettingsChanged={onSettingsChanged}
          profilePersonalizationSummary={profilePersonalizationSummary}
          profileUnlocked={profileUnlocked}
          profileEnabled={profileEnabled}
          registrationWelcomeMessage={registrationWelcomeMessage}
          readerConversationContext={readerConversationContext}
          runtimeOrganizationName={runtimeOrganizationName}
          runtimeWorkspace={runtimeWorkspace}
          availablePapers={availablePapers}
          searchEntries={searchEntries}
          contextSuggestions={contextSuggestions}
          contextCatalogStatus={contextCatalogStatus}
          onRefreshContextCatalog={onRefreshContextCatalog}
          selectedPapers={selectedPapers}
          selectedSetStatus={{
            importedCount: importedSelectedCount,
            selectedCount: selectedPaperCount,
            selectionLocked
          }}
          settingsStore={settingsStore}
        />
      </div>
    </section>
  );
}
