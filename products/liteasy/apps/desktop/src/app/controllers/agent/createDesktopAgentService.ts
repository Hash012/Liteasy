import type {
  AgentPublicApi,
  AgentSession,
  SubmitAgentTurnRequest
} from "../../features/agent-api/agentApi.types";
import { runAgentRuntime } from "../../features/agent-runtime/runtimeOrchestrator";
import { executeConfirmedSemanticPlan } from "../../features/agent-runtime/planExecutor";
import type { AgentRuntimeExecutionContext } from "../../features/agent-runtime/agentRuntime.types";
import { generateAssistantAnswer } from "../../features/assistant/generateAssistantAnswer";
import { createAgentsRunner, type LiteasyAgentsRunner } from "../../features/agent-runtime/openai-agents/agentsRunner";
import { createLiteasyModelProvider } from "../../features/agent-runtime/openai-agents/modelProvider";
import { createModelGatewayFromSettings } from "../../features/models/modelRuntime";
import { getDefaultModelForProvider } from "../../features/models/modelPolicy";
import {
  createAgentApplicationService,
  type AgentBackend,
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
  agentBackend?: AgentBackend;
  createOpenAIAgentsRunner?: (environment: DesktopAgentEnvironment) => LiteasyAgentsRunner;
  getEnvironment: (input?: {
    request?: SubmitAgentTurnRequest;
    session?: AgentSession;
  }) => DesktopAgentEnvironment;
  onCommandResult?: (input: {
    result: Awaited<ReturnType<typeof runAgentRuntime>>;
    message: string;
  }) => void;
  onConfirmationResult?: (result: Awaited<ReturnType<typeof executeConfirmedSemanticPlan>>) => void;
};

export function createDesktopAgentService(
  options: DesktopAgentServiceOptions
): AgentPublicApi {
  const getAgentsRunner = (environment: DesktopAgentEnvironment) => {
    if (options.createOpenAIAgentsRunner) {
      return options.createOpenAIAgentsRunner(environment);
    }
    const settings = environment.knowledge.settings;
    const provider = settings["models.default_provider"];
    const model = getDefaultModelForProvider(provider);
    return createAgentsRunner({
      model,
      modelProvider: createLiteasyModelProvider({
        gateway: createModelGatewayFromSettings(settings, {
          cloudTransport: environment.knowledge.modelTransport
        }),
        model,
        provider
      })
    });
  };

  return createAgentApplicationService({
    agentBackend: options.agentBackend,
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
    async executeOpenAIAgentsCommand({ context, coreTurn, request, runId, signal }) {
      const environment = context.value as DesktopAgentEnvironment;
      return getAgentsRunner(environment).run({
        actionContext: environment.runtime,
        coreInstructions: coreTurn.runtimeContext.promptText,
        message: request.input.message,
        runId,
        signal
      });
    },
    async executeConfirmation({ confirmation, request, runId, signal }) {
      // 确认可能在原计划生成很久后发生，执行前重新读取最新 UI/权限上下文。
      // plan 与 action 参数仍来自服务端保存的 confirmation，调用方无法修改。
      const environment = options.getEnvironment();
      const result = confirmation.openaiAgents
        ? await getAgentsRunner(environment).resume({
            actionContext: environment.runtime,
            confirmation,
            decision: request.decision,
            runId,
            signal
          })
        : await executeConfirmedSemanticPlan(confirmation, environment.runtime);
      options.onConfirmationResult?.(result);
      return result;
    },
    async executeKnowledge({
      context,
      coreTurn,
      reportDelta,
      reportProgress,
      reportSubtaskDelta,
      request,
      signal
    }) {
      const environment = context.value as DesktopAgentEnvironment;
      if (request.input.mode === "command") {
        throw new Error("Command turns cannot use the knowledge executor");
      }
      const answer = await generateAssistantAnswer({
        ...environment.knowledge,
        agentCoreContext: coreTurn.runtimeContext.prompt,
        artifactType: request.input.artifactType,
        enableVisualizationDecisionPlanner: true,
        mode: request.input.mode,
        onDelta: request.input.artifactType
          ? (delta) => reportDelta(delta)
          : undefined,
        onProgress: reportProgress,
        onSubtaskDelta: request.input.artifactType
          ? reportSubtaskDelta
          : undefined,
        question: request.input.message,
        signal
      });
      return {
        citations: answer.citations,
        confidence: answer.confidence,
        message: answer.content,
        metadata: JSON.parse(JSON.stringify({
          analysis: answer.analysis,
          artifactWorkflow: answer.artifactWorkflow,
          audit: answer.audit,
          executionTrace: answer.executionTrace,
          thinReading: answer.thinReading
        })),
        ui: JSON.parse(JSON.stringify(answer.uiDsl))
      };
    },
    listCapabilities: options.listCapabilities,
    now: options.now,
    onPersistenceError: options.onPersistenceError,
    resolveContext({ request, session }) {
      const environment = options.getEnvironment({ request, session });
      return {
        runtimeContext: environment.runtime.contextView,
        value: environment
      };
    },
    stateStore: options.stateStore
  });
}
