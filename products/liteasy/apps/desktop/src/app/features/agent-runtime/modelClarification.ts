import type { ModelTransport } from "../models/modelHttpClient";
import { getDefaultModelForProvider } from "../models/modelPolicy";
import { createModelGatewayFromSettings } from "../models/modelRuntime";
import type { SettingsState } from "../settings/settings.types";
import type {
  AgentRuntimeInput,
  SemanticActionPlan,
  SemanticClarificationCandidate,
  SemanticPlannerContext
} from "./agentRuntime.types";
import { validateSemanticActionPlan } from "./planValidator";
import {
  parseStructuredPlannerPayload,
  type StructuredPlannerPayload
} from "./structuredOutputAdapter";

type CreateModelClarificationInput = {
  modelTransport?: ModelTransport;
  settings: SettingsState;
};

type ModelClarificationInput = {
  context: SemanticPlannerContext;
  input: AgentRuntimeInput;
  plan: SemanticActionPlan;
};

function createClarificationPrompt(
  input: ModelClarificationInput,
  retryReason?: string
) {
  const prompt = [
    "你是 LiteasyClaw Command Mode V2 的 Clarification / Recovery 模块。",
    "只输出 JSON，不要输出 Markdown。",
    "目标：在已有 SemanticActionPlan 需要澄清时，生成更清楚的澄清问题和恢复路径。",
    "禁止生成、选择或执行动作；actions 必须省略或为空数组。",
    "不得新增不在原始 clarification.candidates 中的候选动作。",
    "输出格式必须是 JSON 对象，字段为：summary, confidence, clarification。",
    "clarification 字段必须包含 question；kind、missing 会以原始计划为准。",
    `用户输入：${input.input.message}`,
    `模式：${input.input.mode}`,
    `运行时上下文：${JSON.stringify(input.context.contextView ?? null)}`,
    `原始语义计划：${JSON.stringify(input.plan)}`,
    `已注册动作：${JSON.stringify(input.context.registeredActions)}`
  ];

  if (retryReason) {
    prompt.push(
      `上一次 clarification 输出未通过校验：${retryReason}`,
      "请只返回可解析 JSON，且 candidates 只能来自原始 clarification.candidates。"
    );
  }

  return prompt.join("\n");
}

function sameCandidate(
  left: SemanticClarificationCandidate,
  right: SemanticClarificationCandidate
) {
  return (
    left.actionId === right.actionId &&
    JSON.stringify(left.input) === JSON.stringify(right.input)
  );
}

function normalizeModelCandidates(
  value: unknown,
  baseCandidates: SemanticClarificationCandidate[] | undefined
) {
  if (!Array.isArray(value)) {
    return baseCandidates;
  }

  if (!baseCandidates || baseCandidates.length === 0) {
    throw new Error("模型 clarification 不得为该恢复路径新增候选动作。");
  }

  const normalized: SemanticClarificationCandidate[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      throw new Error("模型 clarification candidate 格式无效。");
    }

    const candidate = item as {
      actionId?: unknown;
      input?: unknown;
      label?: unknown;
    };
    if (
      typeof candidate.actionId !== "string" ||
      typeof candidate.input !== "object" ||
      candidate.input === null ||
      typeof candidate.label !== "string"
    ) {
      throw new Error("模型 clarification candidate 字段无效。");
    }

    const normalizedCandidate: SemanticClarificationCandidate = {
      actionId: candidate.actionId as SemanticClarificationCandidate["actionId"],
      input: candidate.input as Record<string, unknown>,
      label: candidate.label
    };
    if (!baseCandidates.some((baseCandidate) => sameCandidate(baseCandidate, normalizedCandidate))) {
      throw new Error("模型 clarification candidate 不在原始候选集中。");
    }

    if (!normalized.some((existing) => sameCandidate(existing, normalizedCandidate))) {
      normalized.push(normalizedCandidate);
    }
  }

  return normalized.length > 0 ? normalized : baseCandidates;
}

function normalizeModelClarification(
  payload: StructuredPlannerPayload,
  basePlan: SemanticActionPlan
): SemanticActionPlan {
  if (!basePlan.clarification) {
    return basePlan;
  }

  if (typeof payload.clarification !== "object" || payload.clarification === null) {
    throw new Error("模型 clarification 缺少 clarification 对象。");
  }

  const clarification = payload.clarification as {
    candidates?: unknown;
    question?: unknown;
  };
  if (typeof clarification.question !== "string" || clarification.question.trim().length === 0) {
    throw new Error("模型 clarification 缺少 question。");
  }

  return {
    ...basePlan,
    actions: [],
    clarification: {
      ...basePlan.clarification,
      candidates: normalizeModelCandidates(
        clarification.candidates,
        basePlan.clarification.candidates
      ),
      question: clarification.question.trim()
    },
    confidence:
      payload.confidence === "medium" || payload.confidence === "high" || payload.confidence === "low"
        ? payload.confidence
        : basePlan.confidence,
    intentId: "unknown",
    summary:
      typeof payload.summary === "string" && payload.summary.trim().length > 0
        ? payload.summary.trim()
        : basePlan.summary
  };
}

export function createModelAssistedClarification({
  modelTransport,
  settings
}: CreateModelClarificationInput) {
  return async (input: ModelClarificationInput): Promise<SemanticActionPlan> => {
    if (!input.plan.clarification) {
      return input.plan;
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
          prompt: createClarificationPrompt(input, retryReason),
          provider
        });
        const clarifiedPlan = normalizeModelClarification(
          parseStructuredPlannerPayload(generation.answer),
          input.plan
        );
        const validation = validateSemanticActionPlan(clarifiedPlan, {
          mode: input.input.mode,
          registeredActions: input.context.registeredActions
        });

        if (!validation.valid) {
          retryReason = validation.errors.join("；");
          continue;
        }

        return clarifiedPlan;
      } catch (error) {
        retryReason = error instanceof Error ? error.message : "模型 clarification 输出无效。";
      }
    }

    return input.plan;
  };
}
