export type ModelAccessMode = "cloud_proxy" | "local_direct";
import type { ModelExecutionTrace } from "./modelExecution";

export type ModelPolicy = {
  allowedModels: string[];
  allowedProviders: string[];
  localDirectEnabled: boolean;
  modelAccessMode: ModelAccessMode;
};

export type GenerateAnswerInput = {
  model: string;
  prompt: string;
  provider: string;
};

export type ModelGenerationResult = {
  answer: string;
  trace: ModelExecutionTrace;
};

type ModelGatewayDeps = {
  cloudProxy: (input: GenerateAnswerInput) => Promise<ModelGenerationResult>;
  localDirect: (input: GenerateAnswerInput) => Promise<ModelGenerationResult>;
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

      if (deps.policy.modelAccessMode === "cloud_proxy") {
        return deps.cloudProxy(input);
      }

      if (!deps.policy.localDirectEnabled) {
        throw new Error("当前云端策略未开放本地直连模型能力");
      }

      return deps.localDirect(input);
    }
  };
}
