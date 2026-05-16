import type { ResourceClass } from "./resourceScope.types";

export type ActionRiskLevel = "low" | "medium" | "high";

export type ActionPolicy = {
  actionId: string;
  requiresConfirmation: boolean;
  resourceClass: ResourceClass;
  riskLevel: ActionRiskLevel;
};

const policies: Record<string, ActionPolicy> = {
  "local_library.delete_file": {
    actionId: "local_library.delete_file",
    requiresConfirmation: true,
    resourceClass: "local_private",
    riskLevel: "high"
  },
  "cloud_cache.invalidate_workspace_results": {
    actionId: "cloud_cache.invalidate_workspace_results",
    requiresConfirmation: false,
    resourceClass: "cloud_cache",
    riskLevel: "medium"
  }
};

export function getActionPolicy(actionId: string): ActionPolicy {
  const policy = policies[actionId];
  if (!policy) {
    throw new Error(`Unknown action policy: ${actionId}`);
  }

  return policy;
}

export function requiresConfirmation(policy: ActionPolicy) {
  return policy.requiresConfirmation;
}
