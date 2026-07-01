import { getActionPolicy } from "../resources/resourceActionPolicy";
import type { RegisteredActionPolicy } from "./action.types";

export function getRegisteredActionPolicy(actionId: string): RegisteredActionPolicy {
  const policy = getActionPolicy(actionId);

  return {
    actionId: policy.actionId,
    requiresConfirmation: policy.requiresConfirmation,
    resourceClass: policy.resourceClass,
    riskLevel: policy.riskLevel
  };
}
