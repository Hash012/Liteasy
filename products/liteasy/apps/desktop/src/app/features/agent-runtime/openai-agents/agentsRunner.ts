import {
  RunContext,
  Runner,
  RunState,
  type ModelProvider,
  type RunResult,
  type RunToolApprovalItem
} from "@openai/agents";
import {
  getRegisteredActionMetadata,
  getRuntimeActionPolicy,
  type ActionInvocation
} from "../../skills/actionRegistry";
import type {
  AgentRuntimeEvent,
  HumanConfirmationRequest,
  RuntimeActionInvocation,
  RuntimeExecutionResult,
  SemanticActionPlan
} from "../agentRuntime.types";
import type { InvokeActionContext, InvokeActionResult } from "../invokeAction";
import {
  createActionTools,
  getActionIdForSdkToolName
} from "./createActionTools";
import { createLiteasyCommandAgent } from "./createLiteasyAgent";
import { createLiteasyRunContext, type LiteasyRunContext } from "./liteasyRunContext";

const stateVersion = "liteasy.openai-agents-state/v1" as const;

export type AgentsRunnerInput = {
  actionContext: InvokeActionContext;
  coreInstructions?: string;
  message: string;
  runId: string;
  signal?: AbortSignal;
};

export type AgentsRunnerResumeInput = {
  actionContext: InvokeActionContext;
  confirmation: HumanConfirmationRequest;
  decision: "approve" | "reject";
  runId: string;
  signal?: AbortSignal;
};

export type LiteasyAgentsRunner = {
  resume: (input: AgentsRunnerResumeInput) => Promise<RuntimeExecutionResult>;
  run: (input: AgentsRunnerInput) => Promise<RuntimeExecutionResult>;
};

function parseArguments(item: RunToolApprovalItem) {
  try {
    return item.arguments ? JSON.parse(item.arguments) as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function createPlan(actionId: string, input: Record<string, unknown>, runId: string) {
  const invocation = { actionId, input } as ActionInvocation;
  const metadata = getRuntimeActionPolicy(invocation);
  return {
    actions: [invocation as RuntimeActionInvocation],
    confidence: "high",
    intentId: "unknown",
    planId: `${runId}-${actionId}`,
    plannerSource: "model",
    requiredContext: [...metadata.requiredContext],
    requiresConfirmation: metadata.requiresConfirmation,
    riskLevel: metadata.riskLevel,
    summary: metadata.label
  } satisfies SemanticActionPlan;
}

function createConfirmation(
  interruption: RunToolApprovalItem,
  serializedRunState: string,
  runId: string
): HumanConfirmationRequest {
  const toolName = interruption.name ?? "unknown";
  const actionId = getActionIdForSdkToolName(toolName, getRegisteredActionMetadata()) ?? toolName;
  const input = parseArguments(interruption);
  const plan = createPlan(actionId, input, runId);
  const callId = "callId" in interruption.rawItem
    ? interruption.rawItem.callId
    : `${runId}-${toolName}`;
  return {
    action: {
      actionId,
      payload: input
    },
    confirmationId: `confirm-${runId}-${callId}`,
    openaiAgents: {
      callId,
      serializedRunState,
      toolName,
      version: stateVersion
    },
    plan,
    summary: `请确认后再执行：${plan.summary}`,
    traceId: `trace-${runId}`,
    type: "confirmation_request"
  };
}

function resultEvents(
  results: Array<{ input: Record<string, unknown>; result: InvokeActionResult }>
): AgentRuntimeEvent[] {
  return results.flatMap(({ input, result }): AgentRuntimeEvent[] => {
    const action = {
      actionId: result.actionId,
      payload: input
    };
    if (!result.ok) {
      return [{
        action,
        message: result.error.message,
        recovery: result.error.retryable ? "请修正参数或上下文后重试。" : undefined,
        type: "action_failed"
      }];
    }
    return [{ action, type: "action_request" }];
  });
}

function mapRunResult(
  result: RunResult<LiteasyRunContext, any>,
  runId: string
): RuntimeExecutionResult {
  const events = resultEvents(result.runContext.context.actionResults);
  const interruption = result.interruptions[0];
  if (interruption) {
    const confirmation = createConfirmation(interruption, result.state.toString(), runId);
    events.push({ plan: confirmation.plan, type: "plan_preview" });
    events.push(confirmation);
  } else if (typeof result.finalOutput === "string" && result.finalOutput.trim()) {
    events.push({ message: result.finalOutput.trim(), type: "assistant_reply" });
  }
  return {
    events,
    settingsChanged: result.runContext.context.actionResults.some(
      ({ result: actionResult }) => actionResult.ok && actionResult.actionId === "settings.update"
    )
  };
}

export function createAgentsRunner(input: {
  model: string;
  modelProvider: ModelProvider;
}): LiteasyAgentsRunner {
  const sdkRunner = new Runner({
    modelProvider: input.modelProvider,
    traceIncludeSensitiveData: false,
    tracingDisabled: true
  });

  const createAgent = (coreInstructions?: string) => createLiteasyCommandAgent({
    coreInstructions,
    model: input.model,
    tools: createActionTools(getRegisteredActionMetadata())
  });

  return {
    async run(runInput) {
      const context = createLiteasyRunContext({
        actionContext: runInput.actionContext,
        runId: runInput.runId
      });
      const agent = createAgent(runInput.coreInstructions);
      const result = await sdkRunner.run(agent, runInput.message, {
        context,
        maxTurns: 12,
        signal: runInput.signal
      });
      return mapRunResult(result, runInput.runId);
    },

    async resume(resumeInput) {
      const saved = resumeInput.confirmation.openaiAgents;
      if (!saved || saved.version !== stateVersion) {
        throw new Error("OpenAI Agents confirmation state is missing or unsupported");
      }
      const context = createLiteasyRunContext({
        actionContext: resumeInput.actionContext,
        runId: resumeInput.runId
      });
      const agent = createAgent();
      const state = await RunState.fromStringWithContext(
        agent,
        saved.serializedRunState,
        new RunContext(context),
        { contextStrategy: "replace" }
      );
      const interruption = state.getInterruptions().find((candidate) => {
        const callId = "callId" in candidate.rawItem ? candidate.rawItem.callId : undefined;
        return callId === saved.callId && candidate.name === saved.toolName;
      });
      if (!interruption) {
        throw new Error("OpenAI Agents confirmation call is no longer pending");
      }
      if (resumeInput.decision === "approve") {
        state.approve(interruption);
      } else {
        state.reject(interruption, { message: "用户拒绝了此操作。" });
      }
      const result = await sdkRunner.run(agent, state, {
        signal: resumeInput.signal
      });
      return mapRunResult(result, resumeInput.runId);
    }
  };
}
