import "fake-indexeddb/auto";
import { renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { createAgentAssetService } from "../app/features/resource-filesystem/agentAssetService";
import { useObjectWorkbenchController } from "../app/controllers/useObjectWorkbenchController";
import { createSettingsStore } from "../app/features/settings/settings.store";

test("production composition exposes exactly which native annotation route is registered", () => {
  const scopeId = crypto.randomUUID();
  const hook = renderHook(() => useObjectWorkbenchController({ scopeId, getApi: () => { throw new Error("No model request"); },
    getPapers: () => [], getSettings: () => createSettingsStore().getState(), openEvidence() {} }));
  const diagnosis = hook.result.current.agentAssets.diagnose(`liteasy://paper-annotations/p/a?scope=${scopeId}`);
  // Baseline characterization; PR-1 must change this to the production native handler.
  expect(diagnosis).toEqual({ matches: [], state: "unsupported_type" });
  expect(JSON.stringify(diagnosis)).not.toContain(scopeId);
  hook.unmount();
});

test("overlapping handlers fail closed and diagnostics do not invoke or leak resource bodies", async () => {
  const service = createAgentAssetService({ scopeId: "test", active: () => true });
  for (const id of ["first", "second"]) service.registerAdapter({ id, accepts: () => true, search: async () => [],
    stat: async () => { throw new Error("must not pick first"); }, read: async () => { throw new Error("must not read"); } });
  expect(service.diagnose("liteasy://private/title")).toEqual({ matches: ["first", "second"], state: "ambiguous_provider" });
  await expect(service.stat("liteasy://private/title")).rejects.toMatchObject({ code: "ambiguous_provider" });
});
