import { buildIntentRuntimeContexts } from "./contextBuilder";
import { executeSemanticPlan } from "./planExecutor";
import { validateSemanticActionPlan } from "./planValidator";
import { planSemanticCommand } from "./semanticPlanner";
import { createFallbackUIDslDocument } from "../generative-ui/fallbackUi";
import type {
  AgentRuntimeExecutionContext,
  AgentRuntimeInput,
  RuntimeExecutionResult
} from "./agentRuntime.types";

export async function runAgentRuntime(
  input: AgentRuntimeInput,
  context: AgentRuntimeExecutionContext
): Promise<RuntimeExecutionResult> {
  const semanticPlanner = context.semanticPlanner ?? planSemanticCommand;
  const runtimeContexts = buildIntentRuntimeContexts(context);
  const semanticPlan = await semanticPlanner(input, runtimeContexts.plannerContext);

  context.journal?.record({
    input: input.message,
    mode: input.mode,
    traceId: `trace-${semanticPlan.planId}`,
    type: "input"
  });

  const validation = validateSemanticActionPlan(semanticPlan, {
    mode: input.mode,
    registeredActions: runtimeContexts.policyContext.registeredActions
  });
  if (!validation.valid) {
    const traceId = `trace-${semanticPlan.planId}`;
    const document = createFallbackUIDslDocument({
      message: "语义计划未通过动作契约校验。",
      planId: semanticPlan.planId,
      reason: "runtime_error",
      recovery: validation.errors.join("；"),
      traceId
    });
    context.journal?.record({
      traceId,
      type: "ui_dsl",
      uiDslId: document.id
    });

    return {
      events: [
        {
          message: "语义计划未通过动作契约校验。",
          recovery: validation.errors.join("；"),
          type: "runtime_error"
        },
        {
          document,
          type: "ui_dsl_ready"
        }
      ],
      settingsChanged: false
    };
  }

  return executeSemanticPlan(semanticPlan, {
    ...context,
    runtimeInput: input
  });
}
