import type { ModelTransport } from "../models/modelHttpClient";
import { getDefaultModelForProvider } from "../models/modelPolicy";
import { createModelGatewayFromSettings } from "../models/modelRuntime";
import type { SettingsState } from "../settings/settings.types";
import type {
  AgentRuntimeInput,
  RuntimeActionInvocation,
  RuntimePlanConfidence,
  RuntimeRiskLevel,
  SemanticActionPlan,
  SemanticCommandPlanner,
  SemanticPlannerContext
} from "./agentRuntime.types";
import { planSemanticCommand } from "./semanticPlanner";

type CreateModelSemanticPlannerInput = {
  modelTransport?: ModelTransport;
  settings: SettingsState;
};

type ModelPlanPayload = {
  actions?: unknown;
  clarification?: unknown;
  confidence?: unknown;
  fallback?: unknown;
  intentId?: unknown;
  planId?: unknown;
  requiredContext?: unknown;
  requiresConfirmation?: unknown;
  riskLevel?: unknown;
  summary?: unknown;
  unsupportedReason?: unknown;
};

function createPlannerPrompt(input: AgentRuntimeInput, context: SemanticPlannerContext) {
  return [
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
  ].join("\n");
}

function parsePlan(answer: string): ModelPlanPayload {
  const trimmed = answer.trim();
  const jsonText = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;

  const parsed = JSON.parse(jsonText) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("模型 planner 返回的 JSON 不是对象。");
  }

  return parsed as ModelPlanPayload;
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
      ...input,
      preset: "playful",
      tone: "cartoon"
    };
  }

  if (actionId === "layout.split_two" && typeof input.orientation === "string" && !input.preset) {
    return {
      ...input,
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

function normalizePlan(
  payload: ModelPlanPayload,
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
    try {
      const gateway = createModelGatewayFromSettings(settings, {
        cloudTransport: modelTransport
      });
      const provider = settings["models.default_provider"];
      const generation = await gateway.generateAnswer({
        model: getDefaultModelForProvider(provider),
        prompt: createPlannerPrompt(input, context),
        provider
      });

      return normalizePlan(parsePlan(generation.answer), input, context);
    } catch {
      return planSemanticCommand(input, context);
    }
  };
}
