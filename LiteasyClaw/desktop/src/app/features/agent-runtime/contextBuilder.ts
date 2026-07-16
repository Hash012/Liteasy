import { getRegisteredActionMetadata } from "../skills/actionRegistry";
import type { RegisteredActionMetadata } from "../skills/actionRegistry";
import type {
  AgentRuntimeContextView,
  AgentRuntimeExecutionContext,
  SemanticPlannerContext
} from "./agentRuntime.types";

export type RuntimePolicyContext = {
  confirmedActionIds?: string[];
  contextView?: AgentRuntimeContextView;
  registeredActions: RegisteredActionMetadata[];
};

export type IntentRuntimeContextBundle = {
  contextView?: AgentRuntimeContextView;
  plannerContext: SemanticPlannerContext;
  policyContext: RuntimePolicyContext;
};

export function buildIntentRuntimeContexts(
  context: Pick<AgentRuntimeExecutionContext, "agentCore" | "contextView" | "pendingClarification">
): IntentRuntimeContextBundle {
  const registeredActions = getRegisteredActionMetadata();

  return {
    contextView: context.contextView,
    plannerContext: {
      agentCore: context.agentCore,
      contextView: context.contextView,
      pendingClarification: context.pendingClarification,
      registeredActions
    },
    policyContext: {
      contextView: context.contextView,
      registeredActions
    }
  };
}
