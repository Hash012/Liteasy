import { expect, test } from "vitest";
import { getRegisteredActionPolicy } from "../app/features/actions/actionPolicy";

test("adapts local library delete policy into the actions module", () => {
  expect(getRegisteredActionPolicy("local_library.delete_file")).toEqual({
    actionId: "local_library.delete_file",
    requiresConfirmation: true,
    resourceClass: "local_private",
    riskLevel: "high"
  });
});

test("adapts cloud cache invalidation policy into the actions module", () => {
  expect(getRegisteredActionPolicy("cloud_cache.invalidate_workspace_results")).toEqual({
    actionId: "cloud_cache.invalidate_workspace_results",
    requiresConfirmation: false,
    resourceClass: "cloud_cache",
    riskLevel: "medium"
  });
});
