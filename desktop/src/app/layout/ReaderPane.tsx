import { ArtifactTabs } from "../features/artifacts/ArtifactTabs";
import type { ArtifactTask, ArtifactTab, ArtifactType } from "../features/artifacts/artifact.types";

type ReaderPaneProps = {
  analysisHint: string;
  artifactTabs: ArtifactTab[];
  artifactTasks: ArtifactTask[];
  onStartAnalysis: (artifactType: ArtifactType) => void;
  selectedPaperIds: string[];
  selectionLocked: boolean;
};

export function ReaderPane({
  analysisHint,
  artifactTabs,
  artifactTasks,
  onStartAnalysis,
  selectedPaperIds,
  selectionLocked
}: ReaderPaneProps) {
  return (
    <main className="pane center">
      <div className="pane-header">Reader</div>
      <div className="pane-body">
        <ArtifactTabs
          analysisHint={analysisHint}
          canStartAnalysis={selectedPaperIds.length > 0 && selectionLocked}
          onStartAnalysis={onStartAnalysis}
          selectedCount={selectedPaperIds.length}
          selectionLocked={selectionLocked}
          tabs={artifactTabs}
          tasks={artifactTasks}
        />
      </div>
    </main>
  );
}
