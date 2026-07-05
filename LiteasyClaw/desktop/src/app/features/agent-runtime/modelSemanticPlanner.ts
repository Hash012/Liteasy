import type { ModelTransport } from "../models/modelHttpClient";
import { getDefaultModelForProvider } from "../models/modelPolicy";
import { createModelGatewayFromSettings } from "../models/modelRuntime";
import type { SettingsState } from "../settings/settings.types";
import type {
  AgentRuntimeInput,
  RuntimeActionInvocation,
  RuntimePlanConfidence,
  RuntimeRiskLevel,
  SemanticClarificationCandidate,
  SemanticActionPlan,
  SemanticCommandPlanner,
  SemanticPlannerContext
} from "./agentRuntime.types";
import { createModelAssistedClarification } from "./modelClarification";
import { validateSemanticActionPlan } from "./planValidator";
import { planSemanticCommand } from "./semanticPlanner";
import {
  parseStructuredPlannerPayload,
  type StructuredPlannerPayload
} from "./structuredOutputAdapter";

type CreateModelSemanticPlannerInput = {
  modelTransport?: ModelTransport;
  settings: SettingsState;
};

function createPlannerPrompt(input: AgentRuntimeInput, context: SemanticPlannerContext, retryReason?: string) {
  const prompt = [
    "你是 LiteasyClaw Command Mode V2 的语义动作规划器。",
    "只输出 JSON，不要输出 Markdown。",
    "目标：把用户自然语言转成结构化 SemanticActionPlan；不得直接改 UI 或执行动作。",
    "输出格式必须是一个 JSON 对象，字段为：planId, intentId, summary, confidence, riskLevel, requiresConfirmation, requiredContext, actions。",
    "confidence 只能是 high、medium、low；riskLevel 只能是 high、medium、low；requiredContext 必须是字符串数组。",
    "actions 必须是数组；每个 action 必须使用 actions[].input 放参数，不要使用 parameters、args 或 payload。",
    "actions[].actionId 只能取已注册动作里的 actionId；无法理解时 actions 返回空数组并给 clarification.question。",
    `用户输入：${input.message}`,
    `模式：${input.mode}`,
    `运行时上下文：${JSON.stringify(context.contextView ?? null)}`,
    `已注册动作：${JSON.stringify(context.registeredActions)}`
  ];

  if (retryReason) {
    prompt.push(
      `上一次输出未通过结构化解析或动作契约校验：${retryReason}`,
      "请修正为严格 JSON 对象，并确保 actions[].actionId 来自已注册动作、actions[].input 是对象。"
    );
  }

  return prompt.join("\n");
}

function normalizeConfidence(value: unknown): RuntimePlanConfidence {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }

  if (typeof value === "number") {
    if (value >= 0.8) {
      return "high";
    }

    if (value >= 0.45) {
      return "medium";
    }
  }

  return "low";
}

function isRiskLevel(value: unknown): value is RuntimeRiskLevel {
  return value === "high" || value === "medium" || value === "low";
}

function normalizeActionInputAliases(actionId: string, input: Record<string, unknown>) {
  if (actionId === "theme.apply_preset" && input.preset === "cartoon") {
    return {
      preset: "playful",
      tone: "cartoon"
    };
  }

  if (actionId === "layout.split_two" && typeof input.orientation === "string" && !input.preset) {
    return {
      preset: "two_column"
    };
  }

  return input;
}

function normalizeAction(action: unknown, registeredActionIds: Set<string>): RuntimeActionInvocation {
  if (typeof action !== "object" || action === null) {
    throw new Error("模型 planner action 格式无效。");
  }

  const candidate = action as { actionId?: unknown; input?: unknown; parameters?: unknown };
  if (typeof candidate.actionId !== "string" || !registeredActionIds.has(candidate.actionId)) {
    throw new Error("模型 planner 返回了未注册 action。");
  }

  const actionInput = candidate.input ?? candidate.parameters;
  if (typeof actionInput !== "object" || actionInput === null) {
    throw new Error("模型 planner action input 格式无效。");
  }

  return {
    actionId: candidate.actionId,
    input: normalizeActionInputAliases(candidate.actionId, actionInput as Record<string, unknown>)
  } as RuntimeActionInvocation;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function normalizeClarificationKind(value: unknown) {
  if (
    value === "ambiguous_action" ||
    value === "not_command" ||
    value === "unsupported_action" ||
    value === "missing_context" ||
    value === "command_mode"
  ) {
    return value;
  }

  return undefined;
}

function normalizeClarificationCandidates(
  value: unknown,
  registeredActionIds: Set<string>
): SemanticClarificationCandidate[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.flatMap((candidate) => {
    if (typeof candidate !== "object" || candidate === null) {
      return [];
    }

    const record = candidate as {
      actionId?: unknown;
      input?: unknown;
      label?: unknown;
    };
    if (
      typeof record.actionId !== "string" ||
      !registeredActionIds.has(record.actionId) ||
      typeof record.input !== "object" ||
      record.input === null ||
      typeof record.label !== "string"
    ) {
      return [];
    }

    return [
      {
        actionId: record.actionId,
        input: record.input as Record<string, unknown>,
        label: record.label
      }
    ] as SemanticClarificationCandidate[];
  });
}

function normalizePlan(
  payload: StructuredPlannerPayload,
  input: AgentRuntimeInput,
  context: SemanticPlannerContext
): SemanticActionPlan {
  const registeredActionIds = new Set(context.registeredActions.map((action) => action.actionId));
  const actions = Array.isArray(payload.actions)
    ? payload.actions.map((action) => normalizeAction(action, registeredActionIds))
    : [];

  if (typeof payload.intentId !== "string") {
    throw new Error("模型 planner 缺少 intentId。");
  }

  if (typeof payload.summary !== "string") {
    throw new Error("模型 planner 缺少 summary。");
  }

  return {
    actions,
    ...(typeof payload.clarification === "object" && payload.clarification !== null
      ? {
          clarification: {
            candidates: normalizeClarificationCandidates(
              (payload.clarification as { candidates?: unknown }).candidates,
              registeredActionIds
            ),
            kind: normalizeClarificationKind((payload.clarification as { kind?: unknown }).kind),
            missing: normalizeStringArray((payload.clarification as { missing?: unknown }).missing),
            question:
              typeof (payload.clarification as { question?: unknown }).question === "string"
                ? (payload.clarification as { question: string }).question
                : `我理解你可能想让软件处理“${input.message}”，但还需要补充动作或对象。`
          }
        }
      : {}),
    confidence: normalizeConfidence(payload.confidence),
    intentId: payload.intentId as SemanticActionPlan["intentId"],
    planId: typeof payload.planId === "string" ? payload.planId : `model-plan-${Date.now()}`,
    requiredContext: normalizeStringArray(payload.requiredContext),
    requiresConfirmation:
      typeof payload.requiresConfirmation === "boolean" ? payload.requiresConfirmation : false,
    riskLevel: isRiskLevel(payload.riskLevel) ? payload.riskLevel : "low",
    summary: payload.summary,
    ...(typeof payload.unsupportedReason === "string"
      ? {
          unsupportedReason: payload.unsupportedReason
        }
      : {})
  };
}

export function createModelSemanticPlanner({
  modelTransport,
  settings
}: CreateModelSemanticPlannerInput): SemanticCommandPlanner {
  return async (input, context) => {
    const deterministicPlan = planSemanticCommand(input, context);
    if (context.pendingClarification && deterministicPlan.actions.length > 0) {
      return deterministicPlan;
    }

    if (deterministicPlan.requiresConfirmation) {
      return deterministicPlan;
    }

    if (deterministicPlan.clarification?.kind === "ambiguous_action") {
      return createModelAssistedClarification({
        modelTransport,
        settings
      })({
        context,
        input,
        plan: deterministicPlan
      });
    }

    const gateway = createModelGatewayFromSettings(settings, {
      cloudTransport: modelTransport
    });
    const provider = settings["models.default_provider"];
    let retryReason: string | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const generation = await gateway.generateAnswer({
          model: getDefaultModelForProvider(provider),
          prompt: createPlannerPrompt(input, context, retryReason),
          provider
        });

        const modelPlan = normalizePlan(parseStructuredPlannerPayload(generation.answer), input, context);
        const validation = validateSemanticActionPlan(modelPlan, {
          mode: input.mode,
          registeredActions: context.registeredActions
        });

        if (!validation.valid) {
          retryReason = validation.errors.join("；");
          continue;
        }

        return modelPlan;
      } catch (error) {
        retryReason = error instanceof Error ? error.message : "模型 planner 输出无效。";
      }
    }

    return deterministicPlan;
  };
}
