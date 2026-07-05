import { AssistantPane } from "../features/assistant/AssistantPane";
import type { ArtifactType } from "../features/artifacts/artifact.types";
import type { RetrievalChunk } from "../features/retrieval/retrieval.types";
import type { SettingsState } from "../features/settings/settings.types";
import type { createSettingsStore } from "../features/settings/settings.store";
import type { ActionContext } from "../features/skills/actionRegistry";
import type { Paper, WorkspaceSource } from "../features/workspace/workspace.types";

type SettingsStoreLike = ReturnType<typeof createSettingsStore>;

type AssistantSidebarProps = {
  importedChunksByPaperId: Record<string, RetrievalChunk[]>;
  importedSelectedCount: number;
  onApplyLayoutPreset?: ActionContext["applyLayoutPreset"];
  onApplyPanelAction?: ActionContext["applyPanelAction"];
  onApplyThemePreset?: ActionContext["applyThemePreset"];
  onGenerateArtifact: (artifactType: ArtifactType) => string;
  onImportSelectedSet?: ActionContext["importSelectedSet"];
  onOpenAcademicArchive?: ActionContext["openAcademicArchive"];
  onOpenOrganizationSharedLibrary?: () => string | Promise<string>;
  onSettingsChanged?: (settings: SettingsState) => void;
  profileUnlocked?: boolean;
  runtimeOrganizationName?: string;
  runtimeWorkspace?: Partial<WorkspaceSource>;
  selectedPaperCount: number;
  selectedPapers: Paper[];
  selectionLocked: boolean;
  settingsStore: SettingsStoreLike;
};

export function AssistantSidebar({
  importedChunksByPaperId,
  importedSelectedCount,
  onApplyLayoutPreset,
  onApplyPanelAction,
  onApplyThemePreset,
  onGenerateArtifact,
  onImportSelectedSet,
  onOpenAcademicArchive,
  onOpenOrganizationSharedLibrary,
  onSettingsChanged,
  profileUnlocked = false,
  runtimeOrganizationName,
  runtimeWorkspace,
  selectedPaperCount,
  selectedPapers,
  selectionLocked,
  settingsStore
}: AssistantSidebarProps) {
  return (
    <section aria-label="右栏AI助手" className="pane right assistant-only-pane">
      <div className="pane-header">Liteasy Chat</div>
      <div className="pane-body">
        <AssistantPane
          importedChunksByPaperId={importedChunksByPaperId}
          onApplyLayoutPreset={onApplyLayoutPreset}
          onApplyPanelAction={onApplyPanelAction}
          onApplyThemePreset={onApplyThemePreset}
          onGenerateArtifact={onGenerateArtifact}
          onImportSelectedSet={onImportSelectedSet}
          onOpenAcademicArchive={onOpenAcademicArchive}
          onOpenOrganizationSharedLibrary={onOpenOrganizationSharedLibrary}
          onSettingsChanged={onSettingsChanged}
          profileUnlocked={profileUnlocked}
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
