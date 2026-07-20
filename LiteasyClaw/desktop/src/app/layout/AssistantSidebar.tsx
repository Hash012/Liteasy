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

type SettingsStoreLike = ReturnType<typeof createSettingsStore>;

type AssistantSidebarProps = {
  agentClient: FrontendAgentClient;
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
  onGenerateArtifact: (artifactType: ArtifactType) => string;
  onImportSelectedSet?: ActionContext["importSelectedSet"];
  onMoveDockItem?: ActionContext["moveDockItem"];
  onOpenAcademicArchive?: ActionContext["openAcademicArchive"];
  onOpenArtifact?: (artifactId: string) => void;
  onOpenOrganizationSharedLibrary?: () => string | Promise<string>;
  onActiveSessionChange?: (session: AssistantSessionHistoryItem) => void;
  onSettingsChanged?: (settings: SettingsState) => void;
  profileUnlocked?: boolean;
  readerConversationContext?: ReaderConversationContext | null;
  regionId?: Exclude<DockRegionId, "main">;
  runtimeOrganizationName?: string;
  runtimeWorkspace?: Partial<WorkspaceSource>;
  selectedPaperCount: number;
  selectedPapers: Paper[];
  selectionLocked: boolean;
  settingsStore: SettingsStoreLike;
};

export function AssistantSidebar({
  agentClient,
  artifactTasks = [],
  executionJournal,
  importedSelectedCount,
  modelTransport,
  onApplyGeneratedTheme,
  onApplyLayoutPreset,
  onApplyPanelAction,
  onApplyThemePreset,
  onCancelArtifactTask,
  onGenerateArtifact,
  onImportSelectedSet,
  onMoveDockItem,
  onOpenAcademicArchive,
  onOpenArtifact,
  onOpenOrganizationSharedLibrary,
  onActiveSessionChange,
  onSettingsChanged,
  profileUnlocked = false,
  readerConversationContext = null,
  regionId = "right",
  runtimeOrganizationName,
  runtimeWorkspace,
  selectedPaperCount,
  selectedPapers,
  selectionLocked,
  settingsStore
}: AssistantSidebarProps) {
  const regionLabel =
    regionId === "bottom" ? "下栏AI助手" : regionId === "left" ? "左栏AI助手" : "右栏AI助手";

  return (
    <section aria-label={regionLabel} className={`pane ${regionId} assistant-only-pane`}>
      <div className="pane-header">Liteasy Chat</div>
      <div className="pane-body">
        <AssistantPane
          agentClient={agentClient}
          artifactTasks={artifactTasks}
          executionJournal={executionJournal}
          modelTransport={modelTransport}
          onApplyGeneratedTheme={onApplyGeneratedTheme}
          onApplyLayoutPreset={onApplyLayoutPreset}
          onApplyPanelAction={onApplyPanelAction}
          onApplyThemePreset={onApplyThemePreset}
          onCancelArtifactTask={onCancelArtifactTask}
          onGenerateArtifact={onGenerateArtifact}
          onImportSelectedSet={onImportSelectedSet}
          onMoveDockItem={onMoveDockItem}
          onOpenAcademicArchive={onOpenAcademicArchive}
          onOpenArtifact={onOpenArtifact}
          onOpenOrganizationSharedLibrary={onOpenOrganizationSharedLibrary}
          onActiveSessionChange={onActiveSessionChange}
          onSettingsChanged={onSettingsChanged}
          profileUnlocked={profileUnlocked}
          readerConversationContext={readerConversationContext}
          runtimeOrganizationName={runtimeOrganizationName}
          runtimeWorkspace={runtimeWorkspace}
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
