export type StructuredPlannerPayload = {
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

export function parseStructuredPlannerPayload(answer: string): StructuredPlannerPayload {
  const trimmed = answer.trim();
  const jsonText = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;

  const parsed = JSON.parse(jsonText) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("模型 planner 返回的 JSON 不是对象。");
  }

  return parsed as StructuredPlannerPayload;
}
