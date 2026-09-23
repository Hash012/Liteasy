import { thinkingDepthInstruction } from "../../features/assistant/thinkingDepth";
import type {
  AgentPublicApi,
  AgentExecutionRuntime,
  AgentSession,
  SubmitAgentTurnRequest
} from "../../features/agent-api/agentApi.types";
import type { ArtifactTask } from "../../features/artifacts/artifact.types";
import {
  createManagerCapabilityToolCatalog,
  executeManagerCapabilityTool,
  type ManagerCapabilityToolDefinition,
  type ManagerCapabilityToolInvocation
} from "../../features/agent-runtime/capabilityToolAdapter";
import { runAgentRuntime } from "../../features/agent-runtime/runtimeOrchestrator";
import { executeConfirmedSemanticPlan } from "../../features/agent-runtime/planExecutor";
import type {
  AgentRuntimeExecutionContext,
  RuntimeExecutionResult
} from "../../features/agent-runtime/agentRuntime.types";
import {
  createAgentActivityToolCatalog,
  createAgentErrorEnvelope,
  executeAgentActivityTool,
  type AgentActivityToolDefinition,
  type AgentActivityToolInvocation,
  type AgentActivityToolResult,
  type AgentErrorEnvelope
} from "../../features/agent-runtime/runtimeObservability";
import {
  createSpecialistAgentExecutionRequest,
  createSpecialistAgentToolCatalog,
  type SpecialistAgentToolDefinition,
  type SpecialistAgentToolInvocation
} from "../../features/agent-runtime/specialistAgentAdapter";
import { generateAssistantAnswer } from "../../features/assistant/generateAssistantAnswer";
import { collectPaperAnchors } from "../../features/paper-anchors/paperAnchorEntity";
import { executeWorkflowSkill } from "../../features/skills/workflowSkillRegistry";
import {
  createPluginBuilderToolCatalog,
  type PluginBuilderRuntime,
  type PluginBuilderToolDefinition,
  type PluginBuilderToolInvocation,
  type PluginBuilderToolResult
} from "../../features/extensions/pluginBuilder";
import {
  createWorkflowDesignerToolCatalog,
  type WorkflowDesignerRuntime,
  type WorkflowDesignerToolDefinition,
  type WorkflowDesignerToolInvocation,
  type WorkflowDesignerToolResult
} from "../../features/skills/workflowDesigner";
import {
  createAgentApplicationService,
  type AgentApplicationPorts,
  type AgentCommandExecutionInput,
  type AgentKnowledgeExecutionResult,
  type AgentManagerExecutionResult
} from "./agentApplicationService";

import { runArtifactAuthoring } from "../../features/artifact-workflow/runArtifactAuthoring";
import { contextSnapshotPrompt, type ContextSnapshot } from "../../features/context/objectContext";
import { createModelGatewayFromSettings } from "../../features/models/modelRuntime";
import { getActiveModelProvider, getModelForSettings } from "../../features/models/modelPolicy";

type KnowledgeEnvironment = Omit<
  Parameters<typeof generateAssistantAnswer>[0],
  "agentCoreContext" | "mode" | "question"
>;

export type DesktopAgentEnvironment = {
  activity?: {
    artifactTasks: readonly ArtifactTask[];
  };
  knowledge: KnowledgeEnvironment;
  pluginBuilder?: PluginBuilderRuntime;
  runtime: AgentRuntimeExecutionContext;
  workflowDesigner?: WorkflowDesignerRuntime;
};

export type DesktopManagerAgentInput = AgentCommandExecutionInput & {
  activityTools: AgentActivityToolDefinition[];
  answerNormally: () => Promise<AgentKnowledgeExecutionResult>;
  capabilityTools: ManagerCapabilityToolDefinition[];
  invokeCapability: (
    invocation: ManagerCapabilityToolInvocation
  ) => Promise<RuntimeExecutionResult>;
  invokeActivityTool: (
    invocation: AgentActivityToolInvocation
  ) => AgentActivityToolResult | Promise<AgentActivityToolResult>;
  invokePluginBuilder: (
    invocation: PluginBuilderToolInvocation
  ) => Promise<PluginBuilderToolResult>;
  invokeSpecialist: (
    invocation: SpecialistAgentToolInvocation
  ) => Promise<AgentKnowledgeExecutionResult>;
  runFastPathCommand: () => Promise<RuntimeExecutionResult>;
  pluginBuilderTools: PluginBuilderToolDefinition[];
  specialistTools: SpecialistAgentToolDefinition[];
  toErrorEnvelope: (error: unknown, recovery?: string) => AgentErrorEnvelope;
  workflowDesignerTools: WorkflowDesignerToolDefinition[];
  invokeWorkflowDesigner: (
    invocation: WorkflowDesignerToolInvocation
  ) => Promise<WorkflowDesignerToolResult>;
};

export type DesktopManagerAgent = {
  runtime?: Extract<AgentExecutionRuntime, "custom_manager" | "openai_agents_sdk">;
  run: (
    input: DesktopManagerAgentInput
  ) => AgentManagerExecutionResult | Promise<AgentManagerExecutionResult>;
};

export type DesktopAgentServiceOptions = Pick<
  AgentApplicationPorts,
  | "getPrincipalId"
  | "createCoreSession"
  | "createId"
  | "listCapabilities"
  | "now"
  | "onPersistenceError"
  | "stateStore"
> & {
  resolveObjectContext?: (request: SubmitAgentTurnRequest) => Promise<ContextSnapshot>;
  getEnvironment: (input?: {
    request?: SubmitAgentTurnRequest;
    session?: AgentSession;
  }) => DesktopAgentEnvironment;
  managerAgent?: DesktopManagerAgent;
  onCommandResult?: (input: {
    result: Awaited<ReturnType<typeof runAgentRuntime>>;
    message: string;
  }) => void;
  onConfirmationResult?: (result: Awaited<ReturnType<typeof executeConfirmedSemanticPlan>>) => void;
};

async function executeKnowledgeTurn(
  input: AgentCommandExecutionInput,
  environment: DesktopAgentEnvironment,
  override?: {
    artifactType: SubmitAgentTurnRequest["input"]["artifactType"];
    question: string;
  }
): Promise<AgentKnowledgeExecutionResult> {
  const {
    conversationHistory,
    coreTurn,
    reportDelta,
    reportProgress,
    reportSubtaskDelta,
    request,
    signal
  } = input;
  if (request.input.mode === "command") {
    throw new Error("Command turns cannot use the knowledge executor");
  }
  const artifactType = override?.artifactType ?? request.input.artifactType;
  const question = [request.input.thinkingDepth ? thinkingDepthInstruction(request.input.thinkingDepth) : "", override?.question ?? request.input.message].filter(Boolean).join("\n\n");
  const author = async (source: string, evidenceIds: string[]) => {
    if (artifactType !== "ppt" && artifactType !== "tree") throw new Error("当前资源尚不支持这种产物格式。");
    const settings = environment.knowledge.settings;
    const gateway = createModelGatewayFromSettings(settings, { cloudTransport: environment.knowledge.modelTransport });
    const activityId = `${input.runId}:artifact-authoring`;
    input.reportManagerActivity({ activityId, kind: "handoff", label: "创作结构化内容", status: "running", detail: "正在依据来源编写并校验可保存的内容。" });
    try {
      const result = await runArtifactAuthoring({ artifactType, instruction: question, source, evidenceIds, signal,
        generate: (authorRequest) => gateway.generateAnswer({ ...authorRequest, model: getModelForSettings(settings), provider: getActiveModelProvider(settings) })
      });
      input.reportManagerActivity({ activityId, kind: "handoff", label: "内容校验通过", status: "completed", detail: "内容已交回生成任务，等待资源保存。" });
      return result;
    } catch (error) {
      input.reportManagerActivity({ activityId, kind: "handoff", label: "内容生成未完成", status: "failed", detail: "内容尚未保存，可减少来源或重试。" });
      throw error;
    }
  };
  if (input.context.objectSnapshot) {
    const snapshot = input.context.objectSnapshot;
    const paperAnchors = collectPaperAnchors(...snapshot.entries.map((entry) => entry.paperAnchors ?? []));
    const resourceSnapshot = { snapshotId: snapshot.snapshotId, scopeId: snapshot.scopeId,
      entries: snapshot.entries.map(({ text: _text, ...entry }) => entry) };
    if (artifactType) {
      const ids = snapshot.entries.map((entry, index) => "objectId" in entry.ref
        ? `${entry.ref.objectId}@${entry.ref.revision}` : `context-${index + 1}`);
      const source = snapshot.entries.map((entry, index) => `[${ids[index]}] ${entry.title} (${entry.trustLabel})\n${entry.text}`).join("\n\n");
      const anchorSource = paperAnchors.map((anchor) => `[${anchor.evidenceIds.join(",")}] ${anchor.presentation.title} · ${anchor.presentation.location}\n${anchor.snapshot.quote}`).join("\n\n");
      const result = await author([source, anchorSource].filter(Boolean).join("\n\n"), [...new Set([...ids, ...paperAnchors.flatMap((anchor) => anchor.evidenceIds)])]);
      return { message: result.message, metadata: JSON.parse(JSON.stringify({ authoredArtifact: result.authoredArtifact, paperAnchors,
        resourceSnapshot
      })) };
    }
    const settings = environment.knowledge.settings;
    const gateway = createModelGatewayFromSettings(settings, { cloudTransport: environment.knowledge.modelTransport });
    const result = await gateway.generateAnswer({
      model: getModelForSettings(settings),
      provider: getActiveModelProvider(settings),
      prompt: contextSnapshotPrompt(input.context.objectSnapshot, question),
      requireLive: true,
      signal
    });
    if (!result.answer.trim()) throw new Error("未收到回答，请重试。");
    return { message: result.answer,
      citations: paperAnchors.flatMap((anchor) => anchor.locator.page ? [{
        paperAnchor: anchor, paperId: anchor.source.paperId, page: anchor.locator.page, snippet: anchor.snapshot.quote,
      }] : []),
      metadata: JSON.parse(JSON.stringify({ paperAnchors, resourceSnapshot })),
    };
  }
  const answer = await generateAssistantAnswer({
    ...environment.knowledge,
    agentCoreContext: coreTurn.runtimeContext.prompt,
    artifactType,
    conversationHistory,
    enableVisualizationDecisionPlanner: true,
    mode: request.input.mode,
    onDelta: artifactType
      ? (delta) => reportDelta(delta)
      : undefined,
    onReasoningDelta: (_delta, accumulated) => input.reportManagerActivity({
      activityId: `${input.runId}:model-reasoning`, kind: "reasoning_summary", label: "模型公开推理",
      detail: accumulated, status: "running"
    }),
    onProgress: reportProgress,
    onSubtaskDelta: artifactType
      ? reportSubtaskDelta
      : undefined,
    question,
    signal
  });
  const authored = artifactType === "ppt" || artifactType === "tree"
    ? await author([
      answer.content,
      ...(answer.analysis?.evidence ?? []).map((evidence) => `[${evidence.id}] ${evidence.paperTitle} · 第 ${evidence.page} 页\n${evidence.quote}`)
    ].join("\n\n"), answer.analysis?.evidence.map((evidence) => evidence.id) ?? [])
    : undefined;
  return {
    citations: answer.citations,
    confidence: answer.confidence,
    message: authored?.message ?? answer.content,
    metadata: JSON.parse(JSON.stringify({
      authoredArtifact: authored?.authoredArtifact,
      analysis: answer.analysis,
      artifactWorkflow: answer.artifactWorkflow,
      audit: answer.audit,
      executionTrace: answer.executionTrace,
      thinReading: answer.thinReading
    })),
    ui: JSON.parse(JSON.stringify(answer.uiDsl))
  };
}

function createDesktopRuntimeContext(
  environment: DesktopAgentEnvironment,
  overrides: Partial<AgentRuntimeExecutionContext> = {}
): AgentRuntimeExecutionContext {
  return {
    ...environment.runtime,
    ...(environment.pluginBuilder
      ? {
          describePluginBuildForApproval: (buildId: string) =>
            environment.pluginBuilder!.describeInstallApproval(buildId),
          installPluginBuild: ({ buildId }: { buildId: string }) =>
            environment.pluginBuilder!.install(buildId)
        }
      : {}),
    ...(environment.workflowDesigner
      ? {
          installWorkflowDraft: ({ draftId }: { draftId: string }) =>
            environment.workflowDesigner!.installDraft(draftId)
        }
      : {}),
    ...overrides
  };
}

export function createDesktopAgentService(
  options: DesktopAgentServiceOptions
): AgentPublicApi & { dispose(): void } {
  return createAgentApplicationService({
    supportsObjectContext: !!options.resolveObjectContext,
    getPrincipalId: options.getPrincipalId,
    createCoreSession: options.createCoreSession,
    createId: options.createId,
    async executeCommand({ context, coreTurn, request }) {
      const environment = context.value as DesktopAgentEnvironment;
      const result = await runAgentRuntime(
        {
          message: request.input.message,
          mode: request.input.mode
        },
        createDesktopRuntimeContext(environment, {
          agentCore: coreTurn.runtimeContext
        })
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
      const result = await executeConfirmedSemanticPlan(
        confirmation,
        createDesktopRuntimeContext(environment)
      );
      options.onConfirmationResult?.(result);
      return result;
    },
    async executeKnowledge(input) {
      const { context } = input;
      const environment = context.value as DesktopAgentEnvironment;
      return executeKnowledgeTurn(input, environment);
    },
    executeManagerTurn: options.managerAgent
      ? async (input) => {
          const environment = input.context.value as DesktopAgentEnvironment;
          if (input.context.objectSnapshot && !input.request.input.artifactType) return { kind: "knowledge", result: await executeKnowledgeTurn(input, environment) };
          const runtimeContext = createDesktopRuntimeContext(environment, {
            agentCore: input.coreTurn.runtimeContext,
            runtimeInput: {
              message: input.request.input.message,
              mode: input.request.input.mode
            }
          });
          return options.managerAgent!.run({
            ...input,
            activityTools: createAgentActivityToolCatalog(),
            answerNormally: () => executeKnowledgeTurn(input, environment),
            capabilityTools: createManagerCapabilityToolCatalog(),
            invokeCapability: (invocation) =>
              executeManagerCapabilityTool(invocation, runtimeContext),
            invokeActivityTool: (invocation) =>
              executeAgentActivityTool(
                invocation,
                environment.activity?.artifactTasks ?? [],
                { generatedAt: options.now?.().toISOString() }
              ),
            invokePluginBuilder: (invocation) => {
              if (!environment.pluginBuilder) {
                return Promise.reject(new Error("plugin_builder_unavailable"));
              }
              return environment.pluginBuilder.invokeTool(invocation, {
                signal: input.signal
              });
            },
            invokeSpecialist: async (invocation) => {
              const specialistRequest = createSpecialistAgentExecutionRequest(invocation);
              const workflowResult = await executeWorkflowSkill<AgentKnowledgeExecutionResult>({
                input: specialistRequest.workflow.input,
                skillId: specialistRequest.workflow.skillId,
                version: specialistRequest.workflow.version
              }, {
                now: options.now,
                runArtifactAnalysis: async ({
                  artifactType,
                  instruction,
                  workflowInstructions
                }) => {
                  const result = await executeKnowledgeTurn(input, environment, {
                    artifactType,
                    question: `${workflowInstructions}\n\n当前请求：${instruction}`
                  });
                  return { ...result } as Record<string, unknown>;
                }
              });
              const result = workflowResult.output;
              environment.workflowDesigner?.recordSuccessfulRun({
                completedAt: options.now?.().toISOString() ?? new Date().toISOString(),
                input: specialistRequest.workflow.input,
                resultSummary: result.message.slice(0, 500),
                runId: input.runId,
                skillId: specialistRequest.workflow.skillId,
                skillVersion: specialistRequest.workflow.version,
                trace: workflowResult.trace
              });
              const existingMetadata = result.metadata &&
                typeof result.metadata === "object" &&
                !Array.isArray(result.metadata)
                ? result.metadata
                : {};
              return {
                ...result,
                metadata: JSON.parse(JSON.stringify({
                  ...existingMetadata,
                  specialist: {
                    artifactType: specialistRequest.artifactType,
                    instruction: specialistRequest.instruction,
                    specialistId: specialistRequest.specialistId,
                    toolCallId: specialistRequest.toolCallId
                  },
                  workflow: workflowResult.trace
                }))
              };
            },
            runFastPathCommand: () =>
              runAgentRuntime(
                {
                  message: input.request.input.message,
                  mode: input.request.input.mode
                },
                runtimeContext
              ),
            pluginBuilderTools: environment.pluginBuilder
              ? createPluginBuilderToolCatalog()
              : [],
            specialistTools: createSpecialistAgentToolCatalog(),
            toErrorEnvelope: (error, recovery) => createAgentErrorEnvelope({
              message: error instanceof Error ? error.message : String(error),
              recovery
            }),
            workflowDesignerTools: environment.workflowDesigner
              ? createWorkflowDesignerToolCatalog()
              : [],
            invokeWorkflowDesigner: (invocation) => {
              if (!environment.workflowDesigner) {
                return Promise.reject(new Error("workflow_designer_unavailable"));
              }
              return environment.workflowDesigner.invokeTool(invocation);
            }
          });
        }
      : undefined,
    managerRuntime: options.managerAgent?.runtime,
    listCapabilities: options.listCapabilities,
    now: options.now,
    onPersistenceError: options.onPersistenceError,
    async resolveContext({ request, session }) {
      const environment = options.getEnvironment({ request, session });
      return {
        objectSnapshot: request.contextRefs?.length ? await options.resolveObjectContext?.(request) : undefined,
        runtimeContext: request.contextRefs?.length ? undefined : environment.runtime.contextView,
        value: environment
      };
    },
    stateStore: options.stateStore
  });
}
