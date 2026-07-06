import { AssistantPane } from "../features/assistant/AssistantPane";
import type { ArtifactType } from "../features/artifacts/artifact.types";
import type { ModelTransport } from "../features/models/modelHttpClient";
import type { RetrievalChunk } from "../features/retrieval/retrieval.types";
import type { SettingsState } from "../features/settings/settings.types";
import type { createSettingsStore } from "../features/settings/settings.store";
import type { ActionContext } from "../features/skills/actionRegistry";
import type { DockRegionId } from "../features/dock/dock.types";
import type { Paper, WorkspaceSource } from "../features/workspace/workspace.types";

type SettingsStoreLike = ReturnType<typeof createSettingsStore>;

type AssistantSidebarProps = {
  importedChunksByPaperId: Record<string, RetrievalChunk[]>;
  importedSelectedCount: number;
  modelTransport?: ModelTransport;
  onApplyGeneratedTheme?: ActionContext["applyGeneratedTheme"];
  onApplyLayoutPreset?: ActionContext["applyLayoutPreset"];
  onApplyPanelAction?: ActionContext["applyPanelAction"];
  onApplyThemePreset?: ActionContext["applyThemePreset"];
  onGenerateArtifact: (artifactType: ArtifactType) => string;
  onImportSelectedSet?: ActionContext["importSelectedSet"];
  onMoveDockItem?: ActionContext["moveDockItem"];
  onOpenAcademicArchive?: ActionContext["openAcademicArchive"];
  onOpenOrganizationSharedLibrary?: () => string | Promise<string>;
  onSettingsChanged?: (settings: SettingsState) => void;
  profileUnlocked?: boolean;
  regionId?: Exclude<DockRegionId, "main">;
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
  modelTransport,
  onApplyGeneratedTheme,
  onApplyLayoutPreset,
  onApplyPanelAction,
  onApplyThemePreset,
  onGenerateArtifact,
  onImportSelectedSet,
  onMoveDockItem,
  onOpenAcademicArchive,
  onOpenOrganizationSharedLibrary,
  onSettingsChanged,
  profileUnlocked = false,
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
          importedChunksByPaperId={importedChunksByPaperId}
          modelTransport={modelTransport}
          onApplyGeneratedTheme={onApplyGeneratedTheme}
          onApplyLayoutPreset={onApplyLayoutPreset}
          onApplyPanelAction={onApplyPanelAction}
          onApplyThemePreset={onApplyThemePreset}
          onGenerateArtifact={onGenerateArtifact}
          onImportSelectedSet={onImportSelectedSet}
          onMoveDockItem={onMoveDockItem}
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
