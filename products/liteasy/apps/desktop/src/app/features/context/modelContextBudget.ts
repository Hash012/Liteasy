import { contextTokens } from "./contextSelection";
import type { GenerateAnswerInput, ModelGenerationResult } from "../models/modelGateway";

export type ModelContextUsage = { usedTokens: number; maxTokens: number; estimated: boolean };
export function agentContextLimit(value?: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 4096 && parsed <= 262144 ? parsed : 32768;
}

/** Local estimate, not a provider tokenizer or the model's advertised capacity. */
export function modelInputTokens(input: Pick<GenerateAnswerInput, "prompt" | "images" | "outputFormat">) {
  return contextTokens(input.prompt) + (input.outputFormat ? contextTokens(JSON.stringify(input.outputFormat.schema)) : 0)
    + (input.images?.length ?? 0) * 1024;
}

export function withModelContextBudget(
  gateway: { generateAnswer(input: GenerateAnswerInput): Promise<ModelGenerationResult> },
  maxTokens: number,
  report?: (usage: ModelContextUsage) => void
) {
  return { async generateAnswer(input: GenerateAnswerInput) {
    const usedTokens = modelInputTokens(input);
    report?.({ usedTokens, maxTokens, estimated: true });
    // Reserve space for the answer. Provider-side output limits remain provider
    // settings; this guard bounds what Liteasy sends on every model request.
    if (usedTokens > maxTokens - Math.min(4096, Math.floor(maxTokens / 4))) {
      throw new Error("本次资料超过 Agent 上下文预算，请减少选中内容或在 AI 设置中调整上下文上限。");
    }
    const result = await gateway.generateAnswer(input);
    report?.({ usedTokens: usedTokens + contextTokens(result.answer), maxTokens, estimated: true });
    return result;
  } };
}
