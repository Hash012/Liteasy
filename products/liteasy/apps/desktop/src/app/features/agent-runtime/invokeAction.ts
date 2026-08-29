import { z } from "zod";
import {
  executeRegisteredActionHandler,
  getRegisteredActionMetadata,
  getRuntimeActionPolicy,
  isActionHandlerAvailable,
  type ActionContext,
  type ActionInvocation,
  type RegisteredActionMetadata
} from "../skills/actionRegistry";
import type {
  AgentRuntimeContextView,
  RuntimeActionInvocation,
  SemanticActionPlan
} from "./agentRuntime.types";
import { evaluateSemanticPlanPolicy } from "./policyEngine";

export type ActionInvocationAudit = {
  actionId: string;
  completedAt: string;
  invocationId?: string;
  result: "error" | "success";
};

export type InvokeActionResult =
  | {
      actionId: string;
      audit: ActionInvocationAudit;
      ok: true;
      output: {
        message: string;
      };
    }
  | {
      actionId: string;
      audit: ActionInvocationAudit;
      error: {
        code:
          | "confirmation_required"
          | "handler_unavailable"
          | "invalid_input"
          | "missing_context"
          | "policy_denied"
          | "unknown_action"
          | "execution_failed";
        message: string;
        missing?: string[];
        retryable: boolean;
      };
      ok: false;
    };

export type InvokeActionContext = ActionContext & {
  approvedActionIds?: string[];
  contextView?: AgentRuntimeContextView;
  invocationCache?: Map<string, InvokeActionResult>;
  invocationId?: string;
  now?: () => Date;
  onAudit?: (audit: ActionInvocationAudit) => void;
  plan?: SemanticActionPlan;
};

function createPlan(
  action: RuntimeActionInvocation,
  metadata: RegisteredActionMetadata
): SemanticActionPlan {
  return {
    actions: [action],
    confidence: "high",
    intentId: "unknown",
    planId: `invoke-${action.actionId}`,
    requiredContext: [...metadata.requiredContext],
    requiresConfirmation: metadata.requiresConfirmation,
    riskLevel: metadata.riskLevel,
    summary: metadata.label
  };
}

function getMissingContext(
  requiredContext: string[],
  contextView: AgentRuntimeContextView | undefined
) {
  if (!contextView) {
    return [];
  }

  return requiredContext.filter((required) => {
    if (required === "selected_document_set") {
      return contextView.selection.selectedCount === 0 || !contextView.selection.locked;
    }
    if (required === "ingested_documents") {
      return contextView.selection.importedCount < contextView.selection.selectedCount;
    }
    if (required === "organization") {
      return !contextView.cloud.organizationName;
    }
    if (required === "profile") {
      return !contextView.profile.enabled;
    }
    if (required === "workspace") {
      return contextView.workspace.type === "unknown";
    }
    return true;
  });
}

function getUnavailableHandlerMessage(actionId: string) {
  if (actionId === "pane.focus") {
    return "pane.focus requires a pane focus handler";
  }
  return `${actionId} has no available Liteasy handler`;
}

function failure(
  actionId: string,
  context: InvokeActionContext,
  error: Extract<InvokeActionResult, { ok: false }>["error"]
): InvokeActionResult {
  const audit: ActionInvocationAudit = {
    actionId,
    completedAt: (context.now?.() ?? new Date()).toISOString(),
    invocationId: context.invocationId,
    result: "error"
  };
  context.onAudit?.(audit);
  const result: InvokeActionResult = {
    actionId,
    audit,
    error,
    ok: false
  };
  if (context.invocationId) {
    context.invocationCache?.set(context.invocationId, result);
  }
  return result;
}

export async function invokeAction(
  actionId: string,
  input: unknown,
  context: InvokeActionContext
): Promise<InvokeActionResult> {
  if (context.invocationId) {
    const cached = context.invocationCache?.get(context.invocationId);
    if (cached) {
      return cached;
    }
  }

  const metadata = getRegisteredActionMetadata().find((item) => item.actionId === actionId);
  if (!metadata) {
    return failure(actionId, context, {
      code: "unknown_action",
      message: `Unknown action: ${actionId}`,
      retryable: false
    });
  }

  const schema = z.fromJSONSchema(
    metadata.inputSchema as Parameters<typeof z.fromJSONSchema>[0]
  );
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return failure(actionId, context, {
      code: "invalid_input",
      message: z.prettifyError(parsed.error),
      retryable: true
    });
  }

  const invocation = {
    actionId,
    input: parsed.data
  } as ActionInvocation;
  if (!isActionHandlerAvailable(invocation.actionId, context)) {
    return failure(actionId, context, {
      code: "handler_unavailable",
      message: getUnavailableHandlerMessage(actionId),
      retryable: false
    });
  }

  const runtimeMetadata = getRuntimeActionPolicy(invocation);
  const missing = getMissingContext(runtimeMetadata.requiredContext, context.contextView);
  if (missing.length > 0) {
    return failure(actionId, context, {
      code: "missing_context",
      message: `Missing required context: ${missing.join(", ")}`,
      missing,
      retryable: true
    });
  }

  const plan = context.plan ?? createPlan(invocation as RuntimeActionInvocation, runtimeMetadata);
  const decision = evaluateSemanticPlanPolicy(plan, {
    confirmedActionIds: context.approvedActionIds,
    contextView: context.contextView,
    registeredActions: getRegisteredActionMetadata()
  });
  if (decision.kind === "confirm") {
    return failure(actionId, context, {
      code: "confirmation_required",
      message: decision.summary,
      retryable: true
    });
  }
  if (decision.kind === "clarify" && context.contextView) {
    return failure(actionId, context, {
      code: "missing_context",
      message: decision.question,
      missing: decision.missing,
      retryable: true
    });
  }
  if (decision.kind === "deny") {
    return failure(actionId, context, {
      code: "policy_denied",
      message: decision.recovery
        ? `${decision.reason} ${decision.recovery}`
        : decision.reason,
      retryable: false
    });
  }

  try {
    const output = await executeRegisteredActionHandler(invocation, context);
    const audit: ActionInvocationAudit = {
      actionId,
      completedAt: (context.now?.() ?? new Date()).toISOString(),
      invocationId: context.invocationId,
      result: "success"
    };
    context.onAudit?.(audit);
    const result: InvokeActionResult = {
      actionId,
      audit,
      ok: true,
      output
    };
    if (context.invocationId) {
      context.invocationCache?.set(context.invocationId, result);
    }
    return result;
  } catch (error) {
    return failure(actionId, context, {
      code: "execution_failed",
      message: error instanceof Error ? error.message : String(error),
      retryable: true
    });
  }
}
