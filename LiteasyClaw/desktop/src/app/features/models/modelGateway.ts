import type { ModelExecutionTrace } from "./modelExecution";

export type ModelPolicy = {
  allowedModels: string[];
  allowedProviders: string[];
};

export type GenerateAnswerInput = {
  model: string;
  onDelta?: (delta: string, accumulated: string) => void;
  prompt: string;
  provider: string;
  signal?: AbortSignal;
};

export type ModelGenerationResult = {
  answer: string;
  trace: ModelExecutionTrace;
};

type ModelGatewayDeps = {
  cloudModel: (input: GenerateAnswerInput) => Promise<ModelGenerationResult>;
  policy: ModelPolicy;
};

export function createModelGateway(deps: ModelGatewayDeps) {
  return {
    async generateAnswer(input: GenerateAnswerInput): Promise<ModelGenerationResult> {
      if (!deps.policy.allowedProviders.includes(input.provider)) {
        throw new Error(`当前云端策略未开放该 provider：${input.provider}`);
      }

      if (!deps.policy.allowedModels.includes(input.model)) {
        throw new Error(`当前云端策略未开放该模型：${input.model}`);
      }

      return deps.cloudModel(input);
    }
  };
}
