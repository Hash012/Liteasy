import { useEffect, useMemo, useRef } from "react";
import { getAccountSessionGeneration, loadStoredAccountSession } from "../features/account/accountSessionStorage";
import { createObjectStorage, subscribeObjectStorage } from "../features/objects/objectStorage";
import { localWorkspaceScope } from "../features/local-recovery/runtimeProfile";
import type { createSettingsStore } from "../features/settings/settings.store";

export function usePdfProcessingController(settings: ReturnType<typeof createSettingsStore>, workspace: ReturnType<typeof import("../features/workspace/workspace.store").createWorkspaceStore>, onChanged: (state: ReturnType<typeof workspace.getState>) => void) {
  const scope = localWorkspaceScope(loadStoredAccountSession()?.userId), generation = getAccountSessionGeneration();
  const current = useRef({ scope, generation }); current.current = { scope, generation };
  const storage = useMemo(() => createObjectStorage(scope, () => current.current.scope), [scope]);
  const ready = useRef<Promise<void>>(Promise.resolve());
  const paperIds = workspace.getState().papers.map(paper => paper.id).join("|");
  useEffect(() => {
    let alive = true;
    const hydrate = async () => {
      const rows = await storage.list("imports/policy/", "", 10000);
      if (!alive) return;
      const policies = new Map(rows.map(row => [row.key.slice("imports/policy/".length), row.value as { policy?: "on-open" | "on-import" | "manual" }]));
      const changes = workspace.getState().papers.flatMap(paper => { const policy = policies.get(encodeURIComponent(paper.id))?.policy; return paper.processingPolicy !== policy ? [{ ...paper, processingPolicy: policy }] : []; });
      if (changes.length) { workspace.updatePapers(changes); onChanged(workspace.getState()); }
    };
    ready.current = hydrate();
    void ready.current.catch(() => {});
    const unsubscribe = subscribeObjectStorage(scope, keys => { if (keys?.some(key => key.startsWith("imports/policy/"))) void hydrate().catch(() => {}); });
    return () => { alive = false; unsubscribe(); };
  }, [scope, paperIds]);
  return {
    processingScope: scope, processingStorage: storage,
    processingActive: () => scope === current.current.scope && generation === getAccountSessionGeneration(),
    processingReady: () => ready.current,
    processingPolicy: () => settings.getState()["import.processing_policy"] ?? "on-open",
    processingRecipe: () => { const state = settings.getState(); return JSON.stringify(["local-pdfjs", state["import.ocr_language"], "pdf/v2"]); },
  };
}
