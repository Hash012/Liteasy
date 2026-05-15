import { AssistantPane } from "../features/assistant/AssistantPane";
import type { ArtifactType } from "../features/artifacts/artifact.types";
import type { ModelExecutionTrace } from "../features/models/modelExecution";
import type { RetrievalChunk } from "../features/retrieval/retrieval.types";
import type { SettingsState } from "../features/settings/settings.types";
import type { createSettingsStore } from "../features/settings/settings.store";
import type { Paper } from "../features/workspace/workspace.types";

type SettingsStoreLike = ReturnType<typeof createSettingsStore>;

type AssistantSidebarProps = {
  importedChunksByPaperId: Record<string, RetrievalChunk[]>;
  importedSelectedCount: number;
  onGenerateArtifact: (artifactType: ArtifactType) => string;
  onModelExecution?: (trace: ModelExecutionTrace) => void;
  onOpenOrganizationSharedLibrary?: () => string | Promise<string>;
  onSettingsChanged?: (settings: SettingsState) => void;
  onSyncCloudPolicy?: () => Promise<string>;
  selectedPaperCount: number;
  selectedPapers: Paper[];
  selectionLocked: boolean;
  settingsStore: SettingsStoreLike;
};

export function AssistantSidebar({
  importedChunksByPaperId,
  importedSelectedCount,
  onGenerateArtifact,
  onModelExecution,
  onOpenOrganizationSharedLibrary,
  onSettingsChanged,
  onSyncCloudPolicy,
  selectedPaperCount,
  selectedPapers,
  selectionLocked,
  settingsStore
}: AssistantSidebarProps) {
  return (
    <section aria-label="右栏AI助手" className="pane right assistant-only-pane">
      <div className="pane-header">AI Assistant</div>
      <div className="pane-body">
        <AssistantPane
          importedChunksByPaperId={importedChunksByPaperId}
          onGenerateArtifact={onGenerateArtifact}
          onModelExecution={onModelExecution}
          onOpenOrganizationSharedLibrary={onOpenOrganizationSharedLibrary}
          onSettingsChanged={onSettingsChanged}
          onSyncCloudPolicy={onSyncCloudPolicy}
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
