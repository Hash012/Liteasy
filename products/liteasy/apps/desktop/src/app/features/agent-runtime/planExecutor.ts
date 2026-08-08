import type {
  AgentRuntimeExecutionContext,
  AgentRuntimeEvent,
  HumanConfirmationRequest,
  RuntimeActionInvocation,
  RuntimeExecutionResult,
  SemanticActionPlan
} from "./agentRuntime.types";
import { buildIntentRuntimeContexts } from "./contextBuilder";
import { evaluateSemanticPlanPolicy } from "./policyEngine";
import type { SemanticPolicyDecision } from "./policyEngine";
import { validateSemanticActionPlan } from "./planValidator";
import {
  createRecoverableActionFailure,
  evaluateSmoothExecutionPolicy,
  shouldCreateAssistantFeedbackUi
} from "./smoothPolicy";
import { executeAction, getRegisteredActionMetadata } from "../skills/actionRegistry";
import { createFallbackUIDslDocument } from "../generative-ui/fallbackUi";
import { generateUIDslFromSemanticPlan } from "../generative-ui/uiDslGenerator";

function getTraceId(plan: SemanticActionPlan) {
  return `trace-${plan.planId}`;
}

function recordFallbackUIDsl(
  plan: SemanticActionPlan,
  context: AgentRuntimeExecutionContext,
  documentId: string
) {
  context.journal?.record({
    traceId: getTraceId(plan),
    type: "ui_dsl",
    uiDslId: documentId
  });
}

function createRuntimeErrorFallbackEvent(
  plan: SemanticActionPlan,
  context: AgentRuntimeExecutionContext,
  input: {
    message: string;
    recovery?: string;
  }
): AgentRuntimeEvent {
  const document = createFallbackUIDslDocument({
    message: input.message,
    planId: plan.planId,
    reason: "runtime_error",
    recovery: input.recovery,
    traceId: getTraceId(plan)
  });
  recordFallbackUIDsl(plan, context, document.id);

  return {
    document,
    type: "ui_dsl_ready"
  };
}

type SemanticPlanExecutionOptions = {
  confirmedActionIds?: string[];
  includePlanPreview?: boolean;
  recordPlan?: boolean;
};

function createHumanConfirmationRequest(
  plan: SemanticActionPlan,
  action: RuntimeActionInvocation,
  summary: string
): HumanConfirmationRequest {
  return {
    action: {
      actionId: action.actionId,
      payload: action.input as Record<string, unknown>
    },
    confirmationId: `confirm-${plan.planId}-${action.actionId}`,
    plan,
    summary,
    traceId: getTraceId(plan),
    type: "confirmation_request"
  };
}

function createActionEvent(action: RuntimeActionInvocation): AgentRuntimeEvent {
  return {
    action: {
      actionId: action.actionId,
      payload: action.input as Record<string, unknown>
    },
    type: "action_request"
  };
}

function createActionFailedEvent(
  action: RuntimeActionInvocation,
  message: string,
  recovery?: string
): AgentRuntimeEvent {
  return {
    action: {
      actionId: action.actionId,
      payload: action.input as Record<string, unknown>
    },
    message,
    recovery,
    type: "action_failed"
  };
}

function createProgressStartedEvent(plan: SemanticActionPlan): AgentRuntimeEvent {
  return {
    planId: plan.planId,
    summary: plan.summary,
    traceId: getTraceId(plan),
    type: "progress_started"
  };
}

function createTaskCreatedEvent(
  smoothPolicy: Extract<ReturnType<typeof evaluateSmoothExecutionPolicy>, { kind: "background" }>
): AgentRuntimeEvent {
  return {
    task: {
      payload: smoothPolicy.action.input as Record<string, unknown>,
      taskId: smoothPolicy.taskId,
      taskType: smoothPolicy.taskType
    },
    type: "task_created"
  };
}

function createMissingHandlerError(
  plan: SemanticActionPlan,
  action: RuntimeActionInvocation
): AgentRuntimeEvent {
  const failure = createRecoverableActionFailure(
    plan,
    action,
    "UI 动作执行能力尚未注册。"
  );
  return createActionFailedEvent(action, failure.message, failure.recovery);
}

function isUiAction(action: RuntimeActionInvocation) {
  return (
    action.actionId.startsWith("layout.") ||
    action.actionId.startsWith("theme.") ||
    action.actionId.startsWith("panel.")
  );
}

async function executeRegisteredAction(
  action: RuntimeActionInvocation,
  context: AgentRuntimeExecutionContext
) {
  return (await executeAction(action, context)).message;
}

function getInverseAction(action: RuntimeActionInvocation): RuntimeActionInvocation | null {
  const metadata = getRegisteredActionMetadata().find(
    (registeredAction) => registeredAction.actionId === action.actionId
  );
  if (!metadata?.inverseActionId) {
    return null;
  }

  return {
    actionId: metadata.inverseActionId,
    input: {}
  } as RuntimeActionInvocation;
}

async function rollbackExecutedActions(
  executedActions: RuntimeActionInvocation[],
  context: AgentRuntimeExecutionContext,
  traceId: string
): Promise<{
  events: AgentRuntimeEvent[];
  rolledBackCount: number;
}> {
  const events: AgentRuntimeEvent[] = [];
  let rolledBackCount = 0;

  for (const executedAction of [...executedActions].reverse()) {
    const inverseAction = getInverseAction(executedAction);
    if (!inverseAction) {
      continue;
    }

    try {
      context.journal?.record({
        actionId: inverseAction.actionId,
        result: "allow",
        traceId,
        type: "policy"
      });
      const message = await executeRegisteredAction(inverseAction, context);
      rolledBackCount += 1;
      context.journal?.record({
        actionId: inverseAction.actionId,
        message,
        traceId,
        type: "action_result"
      });
      events.push({
        message: `已回滚 ${executedAction.actionId}：${message}`,
        type: "assistant_reply"
      });
    } catch (error) {
      events.push(
        createActionFailedEvent(
          inverseAction,
          error instanceof Error ? error.message : String(error),
          `请手动恢复 ${executedAction.actionId} 的执行结果。`
        )
      );
    }
  }

  return {
    events,
    rolledBackCount
  };
}

function withRollbackRecovery(
  event: AgentRuntimeEvent,
  rolledBackCount: number
): AgentRuntimeEvent {
  if (event.type !== "action_failed" || rolledBackCount === 0) {
    return event;
  }

  return {
    ...event,
    recovery: "已回滚此前成功执行的可逆动作。"
  };
}

function getArtifactAction(plan: SemanticActionPlan) {
  return plan.actions.find((action) => action.actionId === "artifact.generate");
}

async function generateFeedbackUIDsl(
  plan: SemanticActionPlan,
  context: AgentRuntimeExecutionContext,
  statusText: string
) {
  try {
    return await (
      context.generateUIDsl?.({
        plan,
        statusText
      }) ?? generateUIDslFromSemanticPlan(plan, { statusText })
    );
  } catch {
    return generateUIDslFromSemanticPlan(plan, { statusText });
  }
}

async function refineClarificationDecision(
  plan: SemanticActionPlan,
  context: AgentRuntimeExecutionContext,
  policyDecision: Extract<SemanticPolicyDecision, { kind: "clarify" }>,
  runtimeContexts: ReturnType<typeof buildIntentRuntimeContexts>
) {
  if (!context.clarifySemanticPlan || policyDecision.clarificationKind) {
    return policyDecision;
  }

  const clarificationPlan: SemanticActionPlan = {
    ...plan,
    actions: [],
    clarification: {
      candidates: policyDecision.candidates,
      kind: "missing_context",
      missing: policyDecision.missing,
      question: policyDecision.question
    },
    confidence: "low",
    intentId: "unknown",
    requiresConfirmation: false,
    riskLevel: "low",
    summary: "需要补充上下文"
  };

  try {
    const refinedPlan = await context.clarifySemanticPlan({
      context: runtimeContexts.plannerContext,
      input: context.runtimeInput ?? {
        message: plan.summary,
        mode: "command"
      },
      plan: clarificationPlan
    });
    if (!refinedPlan.clarification) {
      return policyDecision;
    }

    const validation = validateSemanticActionPlan(refinedPlan, {
      mode: context.runtimeInput?.mode ?? "command",
      registeredActions: runtimeContexts.policyContext.registeredActions
    });
    if (!validation.valid) {
      return policyDecision;
    }

    return {
      candidates: refinedPlan.clarification.candidates,
      clarificationKind: refinedPlan.clarification.kind,
      kind: "clarify" as const,
      missing: refinedPlan.clarification.missing,
      question: refinedPlan.clarification.question
    };
  } catch {
    return policyDecision;
  }
}

export async function executeSemanticPlan(
  plan: SemanticActionPlan,
  context: AgentRuntimeExecutionContext
): Promise<RuntimeExecutionResult> {
  return executeSemanticPlanWithOptions(plan, context);
}

async function executeSemanticPlanWithOptions(
  plan: SemanticActionPlan,
  context: AgentRuntimeExecutionContext,
  options: SemanticPlanExecutionOptions = {}
): Promise<RuntimeExecutionResult> {
  if (options.recordPlan !== false) {
    context.journal?.record({
      planId: plan.planId,
      plannerSource: plan.plannerSource,
      traceId: getTraceId(plan),
      type: "plan"
    });
  }

  const runtimeContexts = buildIntentRuntimeContexts(context);
  const validation = validateSemanticActionPlan(plan, {
    mode: context.runtimeInput?.mode ?? "command",
    registeredActions: runtimeContexts.policyContext.registeredActions
  });
  if (!validation.valid) {
    const recovery = validation.errors.join("；");

    return {
      events: [
        {
          message: "语义计划未通过动作契约校验。",
          recovery,
          type: "runtime_error"
        },
        createRuntimeErrorFallbackEvent(plan, context, {
          message: "语义计划未通过动作契约校验。",
          recovery
        })
      ],
      settingsChanged: false
    };
  }

  const policyDecision = evaluateSemanticPlanPolicy(
    plan,
    {
      ...runtimeContexts.policyContext,
      confirmedActionIds: options.confirmedActionIds
    }
  );
  const smoothPolicy = evaluateSmoothExecutionPolicy(
    plan,
    runtimeContexts.policyContext
  );

  if (policyDecision.kind === "clarify") {
    const clarificationDecision = await refineClarificationDecision(
      plan,
      context,
      policyDecision,
      runtimeContexts
    );
    const document = createFallbackUIDslDocument({
      message: clarificationDecision.question,
      planId: plan.planId,
      reason: "clarify",
      traceId: getTraceId(plan)
    });
    recordFallbackUIDsl(plan, context, document.id);

    return {
      events: [
        {
          ...(clarificationDecision.candidates
            ? {
                candidates: clarificationDecision.candidates
              }
            : {}),
          ...(clarificationDecision.clarificationKind
            ? {
                kind: clarificationDecision.clarificationKind
              }
            : {}),
          missing: clarificationDecision.missing,
          question: clarificationDecision.question,
          type: "clarification_request"
        },
        {
          document,
          type: "ui_dsl_ready"
        }
      ],
      settingsChanged: false
    };
  }

  if (policyDecision.kind === "deny") {
    const document = createFallbackUIDslDocument({
      message: policyDecision.reason,
      planId: plan.planId,
      reason: "deny",
      recovery: policyDecision.recovery,
      traceId: getTraceId(plan)
    });
    recordFallbackUIDsl(plan, context, document.id);

    return {
      events: [
        {
          message: policyDecision.reason,
          recovery: policyDecision.recovery,
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

  if (policyDecision.kind === "confirm") {
    context.journal?.record({
      actionId: policyDecision.action.actionId,
      result: "confirm",
      traceId: getTraceId(plan),
      type: "policy"
    });

    return {
      events: [
        {
          plan,
          type: "plan_preview"
        },
        {
          ...createHumanConfirmationRequest(
            plan,
            policyDecision.action,
            policyDecision.summary
          )
        }
      ],
      settingsChanged: false
    };
  }

  const artifactAction = getArtifactAction(plan);
  if (artifactAction) {
    if (!context.startArtifactAnalysis) {
      const failure = createRecoverableActionFailure(
        plan,
        artifactAction,
        "产物执行能力尚未注册。"
      );
      return {
        events: [
          {
            message: failure.message,
            recovery: failure.recovery,
            type: "runtime_error"
          },
          createRuntimeErrorFallbackEvent(plan, context, {
            message: failure.message,
            recovery: failure.recovery
          })
        ],
        settingsChanged: false
      };
    }

    let message: string;
    try {
      context.journal?.record({
        actionId: artifactAction.actionId,
        result: "allow",
        traceId: getTraceId(plan),
        type: "policy"
      });
      message = await executeRegisteredAction(artifactAction, context);
      context.journal?.record({
        actionId: artifactAction.actionId,
        message,
        traceId: getTraceId(plan),
        type: "action_result"
      });
    } catch (error) {
      const failure = createRecoverableActionFailure(
        plan,
        artifactAction,
        "产物执行能力尚未注册。"
      );
      return {
        events: [
          {
            message: failure.message,
            recovery: failure.recovery,
            type: "runtime_error"
          },
          createRuntimeErrorFallbackEvent(plan, context, {
            message: failure.message,
            recovery: failure.recovery
          })
        ],
        settingsChanged: false
      };
    }

    const document = await generateFeedbackUIDsl(plan, context, message);
    context.journal?.record({
      traceId: getTraceId(plan),
      type: "ui_dsl",
      uiDslId: document.id
    });

    return {
      events: [
        ...(options.includePlanPreview === false
          ? []
          : [
              {
                plan,
                type: "plan_preview" as const
              }
            ]),
        ...(smoothPolicy.kind === "background" &&
        smoothPolicy.progressEvents.includes("progress_started")
          ? [createProgressStartedEvent(plan)]
          : []),
        {
          artifact: {
            artifactType: artifactAction.input.artifactType,
            payload: {
              source: artifactAction.input.source
            }
          },
          type: "artifact_request"
        },
        ...(smoothPolicy.kind === "background" &&
        smoothPolicy.progressEvents.includes("task_created")
          ? [createTaskCreatedEvent(smoothPolicy)]
          : []),
        {
          message,
          type: "assistant_reply"
        },
        ...(shouldCreateAssistantFeedbackUi(plan)
          ? [
              {
                document,
                type: "ui_dsl_ready" as const
              }
            ]
          : [])
      ],
      settingsChanged: false
    };
  }

  const events: AgentRuntimeEvent[] = [
    ...(options.includePlanPreview === false
      ? []
      : [
          {
            plan,
            type: "plan_preview" as const
          }
        ])
  ];
  if (
    smoothPolicy.kind === "background" &&
    smoothPolicy.progressEvents.includes("progress_started")
  ) {
    events.push(createProgressStartedEvent(plan));
  }

  let lastActionMessage = "";
  const executedActions: RuntimeActionInvocation[] = [];
  const traceId = getTraceId(plan);
  for (const action of plan.actions) {
    let message: string | null | undefined;
    try {
      context.journal?.record({
        actionId: action.actionId,
        result: "allow",
        traceId,
        type: "policy"
      });
      message = await executeRegisteredAction(action, context);
      executedActions.push(action);
    } catch (error) {
      const fallbackFailure = isUiAction(action)
        ? createMissingHandlerError(plan, action)
        : createActionFailedEvent(
            action,
            error instanceof Error ? error.message : String(error),
            `请检查 ${plan.summary} 的 ${action.actionId} action 是否已连接。`
          );
      const rollbackResult = await rollbackExecutedActions(executedActions, context, traceId);
      events.push(withRollbackRecovery(fallbackFailure, rollbackResult.rolledBackCount));
      events.push(...rollbackResult.events);
      break;
    }

    if (message === null) {
      events.push(createActionEvent(action));
      if (
        smoothPolicy.kind === "background" &&
        smoothPolicy.action.actionId === action.actionId &&
        smoothPolicy.progressEvents.includes("task_created")
      ) {
        events.push(createTaskCreatedEvent(smoothPolicy));
      }
      continue;
    }

    if (!message) {
      const rollbackResult = await rollbackExecutedActions(executedActions, context, traceId);
      const failure = createMissingHandlerError(plan, action);
      events.push(withRollbackRecovery(failure, rollbackResult.rolledBackCount));
      events.push(...rollbackResult.events);
      break;
    }

    events.push(createActionEvent(action));
    if (
      smoothPolicy.kind === "background" &&
      smoothPolicy.action.actionId === action.actionId &&
      smoothPolicy.progressEvents.includes("task_created")
    ) {
      events.push(createTaskCreatedEvent(smoothPolicy));
    }
    events.push({
      message,
      type: "assistant_reply"
    });
    context.journal?.record({
      actionId: action.actionId,
      message,
      traceId,
      type: "action_result"
    });
    lastActionMessage = message;
  }

  if (lastActionMessage && shouldCreateAssistantFeedbackUi(plan)) {
    const document = await generateFeedbackUIDsl(plan, context, lastActionMessage);
    context.journal?.record({
      traceId: getTraceId(plan),
      type: "ui_dsl",
      uiDslId: document.id
    });
    events.push({
      document,
      type: "ui_dsl_ready"
    });
  }

  return {
    events,
    settingsChanged: executedActions.some((action) => action.actionId === "settings.update")
  };
}

export async function executeConfirmedSemanticPlan(
  confirmation: HumanConfirmationRequest,
  context: AgentRuntimeExecutionContext
): Promise<RuntimeExecutionResult> {
  context.journal?.record({
    actionId: confirmation.action.actionId,
    confirmationId: confirmation.confirmationId,
    decision: "accepted",
    traceId: confirmation.traceId,
    type: "confirmation"
  });

  return executeSemanticPlanWithOptions(confirmation.plan, context, {
    confirmedActionIds: [confirmation.action.actionId],
    includePlanPreview: false,
    recordPlan: false
  });
}

export function rejectHumanConfirmation(
  confirmation: HumanConfirmationRequest,
  context: Pick<AgentRuntimeExecutionContext, "journal"> = {}
): RuntimeExecutionResult {
  context.journal?.record({
    actionId: confirmation.action.actionId,
    confirmationId: confirmation.confirmationId,
    decision: "rejected",
    traceId: confirmation.traceId,
    type: "confirmation"
  });

  return {
    events: [
      {
        message: `已取消：${confirmation.plan.summary}`,
        type: "assistant_reply"
      }
    ],
    settingsChanged: false
  };
}
