import { AssistantPane } from "../features/assistant/AssistantPane";
import type { ArtifactTask, ArtifactType } from "../features/artifacts/artifact.types";
import type { AssistantSessionHistoryItem } from "../features/assistant/assistantSessionHistory";
import type { ModelTransport } from "../features/models/modelHttpClient";
import type { RetrievalChunk } from "../features/retrieval/retrieval.types";
import type { SettingsState } from "../features/settings/settings.types";
import type { createSettingsStore } from "../features/settings/settings.store";
import type { ActionContext } from "../features/skills/actionRegistry";
import type { DockRegionId } from "../features/dock/dock.types";
import type { Paper, WorkspaceSource } from "../features/workspace/workspace.types";
import type { ReaderConversationContext } from "../features/assistant/assistantContext.types";
import type { FrontendAgentClient } from "../features/agent-api/frontendAgentClient";
import type { ExecutionJournal } from "../features/generative-ui/executionJournal";
import type { AcademicProfile } from "../features/profile/profile.types";

type SettingsStoreLike = ReturnType<typeof createSettingsStore>;

type AssistantSidebarProps = {
  agentClient: FrontendAgentClient;
  academicProfile?: AcademicProfile;
  artifactTasks?: ArtifactTask[];
  executionJournal?: ExecutionJournal;
  /** @deprecated Agent context is supplied by the AppShell controller. */
  importedChunksByPaperId?: Record<string, RetrievalChunk[]>;
  importedSelectedCount: number;
  modelTransport?: ModelTransport;
  onApplyGeneratedTheme?: ActionContext["applyGeneratedTheme"];
  onApplyLayoutPreset?: ActionContext["applyLayoutPreset"];
  onApplyPanelAction?: ActionContext["applyPanelAction"];
  onApplyThemePreset?: ActionContext["applyThemePreset"];
  onCancelArtifactTask?: (taskId: string) => string | Promise<string>;
  onGenerateArtifact: (artifactType: ArtifactType, paperIds?: string[]) => string;
  onImportSelectedSet?: ActionContext["importSelectedSet"];
  onLockPapersForTask?: (paperIds: string[]) => void;
  onMoveDockItem?: ActionContext["moveDockItem"];
  onOpenAcademicArchive?: ActionContext["openAcademicArchive"];
  onOpenArtifact?: (artifactId: string) => void;
  onOpenOrganizationSharedLibrary?: () => string | Promise<string>;
  onActiveSessionChange?: (session: AssistantSessionHistoryItem) => void;
  onSettingsChanged?: (settings: SettingsState) => void;
  profilePersonalizationSummary?: string;
  profileUnlocked?: boolean;
  registrationWelcomeMessage?: { content: string; id: number };
  readerConversationContext?: ReaderConversationContext | null;
  regionId?: Exclude<DockRegionId, "main">;
  runtimeOrganizationName?: string;
  runtimeWorkspace?: Partial<WorkspaceSource>;
  selectedPaperCount: number;
  availablePapers?: Paper[];
  selectedPapers: Paper[];
  selectionLocked: boolean;
  settingsStore: SettingsStoreLike;
};

export function AssistantSidebar({
  agentClient,
  academicProfile,
  artifactTasks = [],
  executionJournal,
  importedChunksByPaperId,
  importedSelectedCount,
  modelTransport,
  onApplyGeneratedTheme,
  onApplyLayoutPreset,
  onApplyPanelAction,
  onApplyThemePreset,
  onCancelArtifactTask,
  onGenerateArtifact,
  onImportSelectedSet,
  onLockPapersForTask,
  onMoveDockItem,
  onOpenAcademicArchive,
  onOpenArtifact,
  onOpenOrganizationSharedLibrary,
  onActiveSessionChange,
  onSettingsChanged,
  profilePersonalizationSummary,
  profileUnlocked = false,
  registrationWelcomeMessage,
  readerConversationContext = null,
  regionId = "right",
  runtimeOrganizationName,
  runtimeWorkspace,
  selectedPaperCount,
  availablePapers,
  selectedPapers,
  selectionLocked,
  settingsStore
}: AssistantSidebarProps) {
  const regionLabel =
    regionId === "bottom" ? "下栏AI助手" : regionId === "left" ? "左栏AI助手" : "右栏AI助手";

  return (
    <section aria-label={regionLabel} className={`pane ${regionId} assistant-only-pane`}>
      <div className="pane-header">AI 对话</div>
      <div className="pane-body">
        <AssistantPane
          agentClient={agentClient}
          academicProfile={academicProfile}
          artifactTasks={artifactTasks}
          executionJournal={executionJournal}
          importedChunksByPaperId={importedChunksByPaperId}
          modelTransport={modelTransport}
          onApplyGeneratedTheme={onApplyGeneratedTheme}
          onApplyLayoutPreset={onApplyLayoutPreset}
          onApplyPanelAction={onApplyPanelAction}
          onApplyThemePreset={onApplyThemePreset}
          onCancelArtifactTask={onCancelArtifactTask}
          onGenerateArtifact={onGenerateArtifact}
          onImportSelectedSet={onImportSelectedSet}
          onLockPapersForTask={onLockPapersForTask}
          onMoveDockItem={onMoveDockItem}
          onOpenAcademicArchive={onOpenAcademicArchive}
          onOpenArtifact={onOpenArtifact}
          onOpenOrganizationSharedLibrary={onOpenOrganizationSharedLibrary}
          onActiveSessionChange={onActiveSessionChange}
          onSettingsChanged={onSettingsChanged}
          profilePersonalizationSummary={profilePersonalizationSummary}
          profileUnlocked={profileUnlocked}
          registrationWelcomeMessage={registrationWelcomeMessage}
          readerConversationContext={readerConversationContext}
          runtimeOrganizationName={runtimeOrganizationName}
          runtimeWorkspace={runtimeWorkspace}
          availablePapers={availablePapers}
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
