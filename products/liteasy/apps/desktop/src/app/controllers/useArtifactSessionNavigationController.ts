import { useState } from "react";
import type { ArtifactTask } from "../features/artifacts/artifact.types";
import type { ArtifactSessionOpenRequest } from "../features/assistant/assistantSessionHistory";

/** A details click reveals chat and selects the task's conversation after it is restored. */
export function useArtifactSessionNavigationController(input: {
  tasks: ArtifactTask[];
  scopeId: string;
  openAssistant: () => void;
}) {
  const [requested, setRequested] = useState<{ scopeId: string; request: ArtifactSessionOpenRequest }>();
  const canOpenTaskDetails = (taskId: string) => input.tasks.some((task) => task.id === taskId);
  return {
    request: requested?.scopeId === input.scopeId ? requested.request : undefined,
    canOpenTaskDetails,
    openTaskDetails(taskId: string) {
      if (!canOpenTaskDetails(taskId)) return;
      setRequested({ scopeId: input.scopeId, request: { requestId: crypto.randomUUID(), taskId } });
      input.openAssistant();
    },
  };
}
