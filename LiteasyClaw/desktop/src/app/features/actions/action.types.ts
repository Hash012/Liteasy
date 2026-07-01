import type { ActionRiskLevel } from "../resources/resourceActionPolicy";
import type { ResourceClass } from "../resources/resourceScope.types";

export type RegisteredActionPolicy = {
  actionId: string;
  requiresConfirmation: boolean;
  resourceClass: ResourceClass;
  riskLevel: ActionRiskLevel;
};

export type RegisteredActionRequest = {
  actionId: string;
  payload: Record<string, unknown>;
};

export type RegisteredActionResult =
  | {
      message: string;
      ok: true;
    }
  | {
      message: string;
      ok: false;
      recovery?: string;
    };
