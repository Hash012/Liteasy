import type { ArtifactType } from "../artifacts/artifact.types";
import { executeAction } from "../skills/actionRegistry";

type UseRegisteredWorkspaceActionsInput = {
  importSelectedSet: () => string;
  onAnalysisHint: (message: string) => void;
  startArtifactAnalysis: (artifactType: ArtifactType) => string;
};

export function useRegisteredWorkspaceActions({
  importSelectedSet,
  onAnalysisHint,
  startArtifactAnalysis
}: UseRegisteredWorkspaceActionsInput) {
  async function handleImportSelectedSet() {
    const result = await executeAction(
      {
        actionId: "selected_set.import",
        input: {
          source: "selected_document_set"
        }
      },
      {
        importSelectedSet
      }
    );
    onAnalysisHint(result.message);
    return result.message;
  }

  async function handleDirectAnalysis(artifactType: ArtifactType) {
    const result = await executeAction(
      {
        actionId: "artifact.start_analysis",
        input: {
          artifactType,
          source: "selected_document_set"
        }
      },
      {
        startArtifactAnalysis
      }
    );
    onAnalysisHint(result.message);
    return result.message;
  }

  return {
    handleDirectAnalysis,
    handleImportSelectedSet
  };
}
