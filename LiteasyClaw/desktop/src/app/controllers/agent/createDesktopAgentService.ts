import type { AgentPublicApi } from "../../features/agent-api/agentApi.types";
import { runAgentRuntime } from "../../features/agent-runtime/runtimeOrchestrator";
import { executeConfirmedSemanticPlan } from "../../features/agent-runtime/planExecutor";
import type { AgentRuntimeExecutionContext } from "../../features/agent-runtime/agentRuntime.types";
import { generateAssistantAnswer } from "../../features/assistant/generateAssistantAnswer";
import {
  createAgentApplicationService,
  type AgentApplicationPorts
} from "./agentApplicationService";

type KnowledgeEnvironment = Omit<
  Parameters<typeof generateAssistantAnswer>[0],
  "agentCoreContext" | "mode" | "question"
>;

export type DesktopAgentEnvironment = {
  knowledge: KnowledgeEnvironment;
  runtime: AgentRuntimeExecutionContext;
};

export type DesktopAgentServiceOptions = Pick<
  AgentApplicationPorts,
  | "createCoreSession"
  | "createId"
  | "listCapabilities"
  | "now"
  | "onPersistenceError"
  | "stateStore"
> & {
  getEnvironment: () => DesktopAgentEnvironment;
  onCommandResult?: (input: {
    result: Awaited<ReturnType<typeof runAgentRuntime>>;
    message: string;
  }) => void;
  onConfirmationResult?: (result: Awaited<ReturnType<typeof executeConfirmedSemanticPlan>>) => void;
};

export function createDesktopAgentService(
  options: DesktopAgentServiceOptions
): AgentPublicApi {
  return createAgentApplicationService({
    createCoreSession: options.createCoreSession,
    createId: options.createId,
    async executeCommand({ context, coreTurn, request }) {
      const environment = context.value as DesktopAgentEnvironment;
      const result = await runAgentRuntime(
        {
          message: request.input.message,
          mode: request.input.mode
        },
        {
          ...environment.runtime,
          agentCore: coreTurn.runtimeContext
        }
      );
      options.onCommandResult?.({
        message: request.input.message,
        result
      });
      return result;
    },
    async executeConfirmation({ confirmation }) {
      // 确认可能在原计划生成很久后发生，执行前重新读取最新 UI/权限上下文。
      // plan 与 action 参数仍来自服务端保存的 confirmation，调用方无法修改。
      const environment = options.getEnvironment();
      const result = await executeConfirmedSemanticPlan(confirmation, environment.runtime);
      options.onConfirmationResult?.(result);
      return result;
    },
    async executeKnowledge({ context, coreTurn, reportDelta, reportProgress, request, signal }) {
      const environment = context.value as DesktopAgentEnvironment;
      if (request.input.mode === "command") {
        throw new Error("Command turns cannot use the knowledge executor");
      }
      const answer = await generateAssistantAnswer({
        ...environment.knowledge,
        agentCoreContext: coreTurn.runtimeContext.prompt,
        artifactType: request.input.artifactType,
        mode: request.input.mode,
        onDelta: request.input.artifactType
          ? (delta) => reportDelta(delta)
          : undefined,
        onProgress: reportProgress,
        question: request.input.message,
        signal
      });
      return {
        citations: answer.citations,
        confidence: answer.confidence,
        message: answer.content,
        metadata: JSON.parse(JSON.stringify({
          analysis: answer.analysis,
          audit: answer.audit,
          executionTrace: answer.executionTrace
        })),
        ui: JSON.parse(JSON.stringify(answer.uiDsl))
      };
    },
    listCapabilities: options.listCapabilities,
    now: options.now,
    onPersistenceError: options.onPersistenceError,
    resolveContext() {
      const environment = options.getEnvironment();
      return {
        runtimeContext: environment.runtime.contextView,
        value: environment
      };
    },
    stateStore: options.stateStore
  });
}
