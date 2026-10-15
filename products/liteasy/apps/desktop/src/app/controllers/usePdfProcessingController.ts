import { useMemo, useRef } from "react";
import { getAccountSessionGeneration, loadStoredAccountSession } from "../features/account/accountSessionStorage";
import { createObjectStorage } from "../features/objects/objectStorage";
import { localWorkspaceScope } from "../features/local-recovery/runtimeProfile";
import type { createSettingsStore } from "../features/settings/settings.store";

export function usePdfProcessingController(settings: ReturnType<typeof createSettingsStore>) {
  const scope = localWorkspaceScope(loadStoredAccountSession()?.userId), generation = getAccountSessionGeneration();
  const current = useRef({ scope, generation }); current.current = { scope, generation };
  const storage = useMemo(() => createObjectStorage(scope, () => current.current.scope), [scope]);
  return {
    processingScope: scope, processingStorage: storage,
    processingActive: () => scope === current.current.scope && generation === getAccountSessionGeneration(),
    processingPolicy: () => settings.getState()["import.processing_policy"] ?? "on-open",
    processingRecipe: () => { const state = settings.getState(); return JSON.stringify(["local-pdfjs", state["import.ocr_language"], "pdf/v2"]); },
  };
}
