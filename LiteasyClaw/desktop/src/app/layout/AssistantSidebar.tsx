import { AssistantPane } from "../features/assistant/AssistantPane";
import type { ArtifactType } from "../features/artifacts/artifact.types";
import type { RetrievalChunk } from "../features/retrieval/retrieval.types";
import type { SettingsState } from "../features/settings/settings.types";
import type { createSettingsStore } from "../features/settings/settings.store";
import type { Paper } from "../features/workspace/workspace.types";

type SettingsStoreLike = ReturnType<typeof createSettingsStore>;

type AssistantSidebarProps = {
  importedChunksByPaperId: Record<string, RetrievalChunk[]>;
  importedSelectedCount: number;
  onGenerateArtifact: (artifactType: ArtifactType) => string;
  onOpenOrganizationSharedLibrary?: () => string | Promise<string>;
  onSettingsChanged?: (settings: SettingsState) => void;
  profileUnlocked?: boolean;
  selectedPaperCount: number;
  selectedPapers: Paper[];
  selectionLocked: boolean;
  settingsStore: SettingsStoreLike;
};

export function AssistantSidebar({
  importedChunksByPaperId,
  importedSelectedCount,
  onGenerateArtifact,
  onOpenOrganizationSharedLibrary,
  onSettingsChanged,
  profileUnlocked = false,
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
          onGenerateArtifact={onGenerateArtifact}
          onOpenOrganizationSharedLibrary={onOpenOrganizationSharedLibrary}
          onSettingsChanged={onSettingsChanged}
          profileUnlocked={profileUnlocked}
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
