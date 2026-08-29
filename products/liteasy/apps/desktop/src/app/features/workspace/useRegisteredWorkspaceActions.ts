import type { ArtifactType } from "../artifacts/artifact.types";
import { invokeAction } from "../agent-runtime/invokeAction";

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
    const result = await invokeAction(
      "selected_set.import",
      { source: "selected_document_set" },
      { importSelectedSet }
    );
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    onAnalysisHint(result.output.message);
    return result.output.message;
  }

  async function handleDirectAnalysis(artifactType: ArtifactType) {
    const result = await invokeAction(
      "artifact.start_analysis",
      { artifactType, source: "selected_document_set" },
      { startArtifactAnalysis }
    );
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    onAnalysisHint(result.output.message);
    return result.output.message;
  }

  return {
    handleDirectAnalysis,
    handleImportSelectedSet
  };
}
