import { expect, test } from "vitest";
import {
  getActionPolicy,
  requiresConfirmation
} from "../app/features/resources/resourceActionPolicy";

test("requires confirmation for destructive local-library actions", () => {
  const policy = getActionPolicy("local_library.delete_file");

  expect(policy.resourceClass).toBe("local_private");
  expect(policy.riskLevel).toBe("high");
  expect(requiresConfirmation(policy)).toBe(true);
});

test("does not treat cloud cache invalidation as long-term user data deletion", () => {
  const policy = getActionPolicy("cloud_cache.invalidate_workspace_results");

  expect(policy.resourceClass).toBe("cloud_cache");
  expect(policy.riskLevel).toBe("medium");
  expect(requiresConfirmation(policy)).toBe(false);
});
