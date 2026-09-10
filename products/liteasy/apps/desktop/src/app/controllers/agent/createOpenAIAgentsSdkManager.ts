import {
  Agent,
  Runner,
  Usage,
  tool,
  type AgentOutputItem,
  type Model,
  type ModelRequest,
  type ModelResponse,
  type RunContext,
  type RunResult
} from "@openai/agents-core";
import { z } from "zod";
import type {
  AgentArtifactType,
  AgentJsonValue
} from "../../features/agent-api/agentApi.types";
import type {
  AgentKnowledgeExecutionResult,
  AgentManagerExecutionResult
} from "./agentApplicationService";
import type {
  DesktopManagerAgent,
  DesktopManagerAgentInput
} from "./createDesktopAgentService";

const artifactLabels: Record<AgentArtifactType, string> = {
  comparison_table: "对比表",
  layered_graph: "分层关系图",
  mindmap: "思维导图",
  ppt: "演示文稿",
  thin_reading: "薄读",
  tree: "树形结构"
};

function completedMessage(text: string): AgentOutputItem {
  return {
    content: [{ text, type: "output_text" }],
    role: "assistant",
    status: "completed",
    type: "message"
  };
}

function functionCall(name: string, argumentsValue: Record<string, unknown>): AgentOutputItem {
  return {
    arguments: JSON.stringify(argumentsValue),
    callId: `call-${name}`,
    name,
    status: "completed",
    type: "function_call"
  };
}

function hasFunctionResult(request: ModelRequest) {
  return Array.isArray(request.input) && request.input.some(
    (item) => item.type === "function_call_result"
  );
}

/**
 * The content model remains behind Liteasy's authenticated model proxy. This
 * routing model makes an explicit product route executable by the Agents SDK
 * Runner, so tool and nested-agent boundaries are real SDK calls rather than
 * decorative metadata.
 */
class ExplicitRouteModel implements Model {
  constructor(
    private readonly route: {
      arguments: Record<string, unknown>;
      completedText: string;
      toolName: string;
    }
  ) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    return {
      output: [
        hasFunctionResult(request)
          ? completedMessage(this.route.completedText)
          : functionCall(this.route.toolName, this.route.arguments)
      ],
      usage: new Usage({ requests: 1 })
    };
  }

  async *getStreamedResponse(): AsyncIterable<never> {
    throw new Error("desktop_sdk_bridge_streaming_not_supported");
  }
}

type SdkTrace = {
  mainAgent: string;
  mainItems: string[];
  mainTool: string;
  resultDestination: "artifact_surface" | "assistant_message" | "runtime_action";
  specialistAgent?: string;
  specialistItems?: string[];
};

type SdkManagerContext = {
  input: DesktopManagerAgentInput;
  result?: AgentManagerExecutionResult;
  trace: SdkTrace;
};

function collectItemTypes(result: RunResult<SdkManagerContext, Agent<SdkManagerContext, any>>) {
  return result.newItems.map((item) => item.rawItem?.type ?? item.type);
}

function getSdkContext(runContext?: RunContext<SdkManagerContext>) {
  if (!runContext) {
    throw new Error("openai_agents_sdk_context_missing");
  }
  return runContext.context;
}

function addSdkMetadata(
  result: AgentKnowledgeExecutionResult,
  trace: SdkTrace
): AgentKnowledgeExecutionResult {
  const existingMetadata = result.metadata &&
    typeof result.metadata === "object" &&
    !Array.isArray(result.metadata)
    ? result.metadata
    : {};
  return {
    ...result,
    metadata: JSON.parse(JSON.stringify({
      ...existingMetadata,
      agentSdk: trace
    })) as AgentJsonValue
  };
}

function getSpecialistId(artifactType: AgentArtifactType) {
  return artifactType === "thin_reading" ? "thin_reading" : "multimodal";
}

function getSpecialistAgentName(artifactType: AgentArtifactType) {
  return artifactType === "thin_reading"
    ? "Liteasy Thin Reading Agent"
    : "Liteasy Multimodal Agent";
}

function createSpecialistAgent(input: {
  artifactType: AgentArtifactType;
  sdkContext: SdkManagerContext;
}) {
  const specialistId = getSpecialistId(input.artifactType);
  const specialistDefinition = input.sdkContext.input.specialistTools.find(
    (candidate) => candidate.agent.id === specialistId
  );
  if (
    !specialistDefinition ||
    !specialistDefinition.supportedArtifactTypes.includes(input.artifactType)
  ) {
    throw new Error(`specialist_unavailable:${input.artifactType}`);
  }

  const workflowToolName = specialistId === "thin_reading"
    ? "execute_thin_reading_workflow"
    : "execute_multimodal_workflow";
  const artifactLabel = artifactLabels[input.artifactType];
  const workflowParameters = z.object({ instruction: z.string().min(1) });
  const workflowTool = tool<typeof workflowParameters, SdkManagerContext>({
    description: `执行已注册的${artifactLabel}工作流，并将结构化结果传回主 Agent。`,
    execute: async ({ instruction }, runContext) => {
      const context = getSdkContext(runContext);
      const activityId = `${context.input.runId}:specialist-${specialistId}`;
      context.input.reportManagerActivity({
        activityId,
        detail: `主 Agent 已启动${specialistDefinition.agent.name}；结果会返回产物校验与展示链路。`,
        kind: "handoff",
        label: `启动${artifactLabel}子任务`,
        status: "running"
      });
      try {
        const specialistResult = await context.input.invokeSpecialist({
          arguments: specialistId === "thin_reading"
            ? { instruction }
            : { artifactType: input.artifactType, instruction },
          specialistId,
          toolCallId: `${context.input.runId}:tool-${specialistId}`
        });
        context.result = {
          kind: "knowledge",
          result: specialistResult
        };
        context.input.reportManagerActivity({
          activityId,
          detail: `${specialistDefinition.agent.name}已返回受控工作流结果，主 Agent 正在传给产物保存与展示链路。`,
          kind: "handoff",
          label: `${artifactLabel}子任务已返回`,
          status: "completed"
        });
        context.input.reportManagerActivity({
          activityId: `${context.input.runId}:result-${specialistId}`,
          detail: "结果将由产物工作流校验并保存；完成后可在中心产物页查看。",
          kind: "tool_result",
          label: `${artifactLabel}结果已传回`,
          status: "completed"
        });
        return `已生成${artifactLabel}结果，并传回主 Agent。`;
      } catch (error) {
        const envelope = context.input.toErrorEnvelope(
          error,
          `请检查当前文献范围和${artifactLabel}任务要求后重试。`
        );
        context.input.reportManagerActivity({
          activityId,
          detail: envelope.error.userImpact,
          kind: "handoff",
          label: `${artifactLabel}子任务失败`,
          status: "failed"
        });
        throw error;
      }
    },
    name: workflowToolName,
    parameters: workflowParameters
  });
  return new Agent<SdkManagerContext>({
    instructions: `你是${specialistDefinition.agent.name}。只执行注册的工作流，并把结果返回主 Agent。`,
    model: new ExplicitRouteModel({
      arguments: { instruction: input.sdkContext.input.request.input.message },
      completedText: `${artifactLabel}工作流已完成。`,
      toolName: workflowToolName
    }),
    name: getSpecialistAgentName(input.artifactType),
    toolUseBehavior: "run_llm_again",
    tools: [workflowTool]
  });
}

function createMainAgent(sdkContext: SdkManagerContext) {
  const { input } = sdkContext;
  const artifactType = input.request.input.artifactType;
  const tools = [];
  let mainToolName: string;

  if (artifactType) {
    const specialistAgent = createSpecialistAgent({ artifactType, sdkContext });
    mainToolName = artifactType === "thin_reading"
      ? "liteasy_thin_reading_agent"
      : "liteasy_multimodal_agent";
    sdkContext.trace.specialistAgent = specialistAgent.name;
    tools.push(specialistAgent.asTool({
      customOutputExtractor(output) {
        sdkContext.trace.specialistItems = output.newItems.map(
          (item) => item.rawItem?.type ?? item.type
        );
        return output.finalOutput ?? "子任务已完成。";
      },
      toolDescription: `调用${specialistAgent.name}生成并校验指定产物。`,
      toolName: mainToolName
    }));
  } else if (input.request.input.mode === "command") {
    mainToolName = "liteasy_command_workflow";
    const commandParameters = z.object({ input: z.string() });
    tools.push(tool<typeof commandParameters, SdkManagerContext>({
      description: "执行 Liteasy 受控命令工作流。",
      execute: async (_arguments, runContext) => {
        const context = getSdkContext(runContext);
        context.result = {
          kind: "runtime",
          result: await context.input.runFastPathCommand()
        };
        return "命令工作流已完成。";
      },
      name: mainToolName,
      parameters: commandParameters
    }));
  } else {
    mainToolName = "liteasy_knowledge_workflow";
    const knowledgeParameters = z.object({ input: z.string() });
    tools.push(tool<typeof knowledgeParameters, SdkManagerContext>({
      description: "执行 Liteasy 文献检索和知识回答工作流。",
      execute: async (_arguments, runContext) => {
        const context = getSdkContext(runContext);
        context.result = {
          kind: "knowledge",
          result: await context.input.answerNormally()
        };
        return "知识工作流已完成。";
      },
      name: mainToolName,
      parameters: knowledgeParameters
    }));
  }

  sdkContext.trace.mainTool = mainToolName;
  return new Agent<SdkManagerContext>({
    instructions: "你是 Liteasy 主 Agent。根据已经确定的产品路由调用唯一匹配的受控工具，并接收其结果。",
    model: new ExplicitRouteModel({
      arguments: { input: input.request.input.message },
      completedText: "受控工作流结果已接收。",
      toolName: mainToolName
    }),
    name: "Liteasy Manager Agent",
    toolUseBehavior: "run_llm_again",
    tools
  });
}

/**
 * Runs every desktop turn through the OpenAI Agents SDK Runner. Artifact turns
 * use Agent.asTool() so Thin Reading and Multimodal are genuine nested-agent
 * calls; the nested agent then invokes the registered Liteasy workflow skill.
 */
export function createOpenAIAgentsSdkManager(): DesktopManagerAgent {
  const runner = new Runner({
    traceIncludeSensitiveData: false,
    tracingDisabled: true
  });
  return {
    runtime: "openai_agents_sdk",
    async run(input) {
      const artifactType = input.request.input.artifactType;
      const sdkContext: SdkManagerContext = {
        input,
        trace: {
          mainAgent: "Liteasy Manager Agent",
          mainItems: [],
          mainTool: "",
          resultDestination: artifactType
            ? "artifact_surface"
            : input.request.input.mode === "command"
              ? "runtime_action"
              : "assistant_message"
        }
      };
      const managerAgent = createMainAgent(sdkContext);
      const sdkResult = await runner.run(managerAgent, input.request.input.message, {
        context: sdkContext,
        maxTurns: 4,
        signal: input.signal
      });
      sdkContext.trace.mainItems = collectItemTypes(sdkResult);
      if (!sdkContext.result) {
        throw new Error("openai_agents_sdk_result_missing");
      }
      if (sdkContext.result.kind === "knowledge") {
        return {
          kind: "knowledge",
          result: addSdkMetadata(sdkContext.result.result, sdkContext.trace)
        };
      }
      return sdkContext.result;
    }
  };
}
