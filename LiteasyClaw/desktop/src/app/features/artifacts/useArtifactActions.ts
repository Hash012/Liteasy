import { invoke } from "@tauri-apps/api/core";
import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { AgentCoreCatalogEntry } from "../agent-core/agentCoreConfig";
import type { Paper, SelectedDocumentSet } from "../workspace/workspace.types";
import type { ImportQueueStatus } from "../workspace/useWorkspaceActions";
import { buildArtifactPreview } from "./artifactPreview";
import type {
  ArtifactRegenerationRequest,
  ArtifactTab,
  ArtifactTask,
  ArtifactTaskStage,
  ArtifactType
} from "./artifact.types";
import type { createArtifactStore } from "./artifact.store";
import { generateCenterArtifactUIDslDocument } from "../generative-ui/uiDslGenerator";
import type { AgentCitation, AgentRun } from "../agent-api/agentApi.types";
import type {
  MindmapArtifact,
  MindmapArtifactWorkflowMetadata,
  MindmapVerificationReport
} from "../artifact-workflow/mindmapArtifact.types";
import type { CompletedMultiPaperAnalysis } from "../paper-analysis/analysis.types";
import type { ArtifactResultClient } from "./artifactResultClient";
import {
  buildArtifactOutline,
  outlineToMarkdown,
  parseStreamingOutlineMarkdown
} from "./artifactOutline";
import { createEvidenceBackedBaseGraph } from "../intuition-graph/createBaseGraph";
import {
  advanceThinReadingDocument,
  applyThinReadingAnnotationSyncResults,
  createThinReadingDocument,
  findThinReadingChildBySource,
  truncateThinReadingTitle
} from "../thin-reading/thinReadingProjection";
import {
  createHttpIntuechoSyncAdapter,
  listThinReadingPendingPublicAnnotations
} from "../thin-reading/thinReadingIntuechoSyncQueue";
import { resolveThinReadingTargetLanguage } from "../thin-reading/thinReadingAgent";
import type {
  ThinReadingBranchSource,
  ThinReadingDocument,
  ThinReadingGenerationContext,
  ThinReadingNodeSeed
} from "../thin-reading/thinReading.types";

type ArtifactStore = ReturnType<typeof createArtifactStore>;

type AgentArtifactMetadata = {
  analysis?: CompletedMultiPaperAnalysis;
  artifactWorkflow?: MindmapArtifactWorkflowMetadata;
  thinReading?: {
    context?: ThinReadingGenerationContext;
    rootSeed?: ThinReadingNodeSeed;
  };
};

type VerifiedMindmapMetadata = {
  mindmapArtifact: MindmapArtifact;
  verification: MindmapVerificationReport;
};

export type AgentArtifactGenerationOptions = {
  regeneratedFromArtifactId?: string;
  sourcePaperIds?: string[];
  supplementalContext?: string;
  thinReadingContext?: ThinReadingGenerationContext;
};

export type GenerateThinReadingBranchInput = {
  artifactId: string;
  document: ThinReadingDocument;
  source: ThinReadingBranchSource;
};

export type DuplicateArtifactGenerationConfirmation = {
  artifactType: Exclude<ArtifactType, "skill_doc">;
  existingArtifacts: ArtifactTab[];
  papers: Paper[];
};

type UseArtifactActionsInput = {
  artifactStore: ArtifactStore;
  artifactResultClient: ArtifactResultClient;
  confirmDuplicateGeneration?: (
    input: DuplicateArtifactGenerationConfirmation
  ) => boolean;
  cancelAgentRun?: (runId: string, reason?: string) => Promise<void>;
  getImportedChunksByPaperId: () => Record<string, RetrievalChunk[]>;
  getIntuechoEndpoint?: () => string;
  getAssistantLanguage?: () => string;
  getActiveReaderPaper?: () => Paper | null;
  getModelDiagnosticContext?: () => {
    endpoint?: string;
    model?: string;
    provider?: string;
  };
  getSelectedDocumentSet: () => SelectedDocumentSet;
  getSelectedPapers: () => Paper[];
  onAnalysisHint: (message: string) => void;
  onArtifactCatalogChanged: (catalog: ArtifactTab[]) => void;
  onArtifactTabsChanged: (tabs: ArtifactTab[]) => void;
  onArtifactTasksChanged: (tasks: ArtifactTask[]) => void;
  queueImportForPapers: (papers: Paper[], onComplete?: () => void) => ImportQueueStatus;
  runAgentAnalysis: (
    artifactType: ArtifactType,
    onProgress: (input: {
      agentRunId?: string;
      message: string;
      partialAnswer?: string;
      partialOutlineNodes?: ArtifactTask["partialOutlineNodes"];
      progress: number;
      stage: ArtifactTaskStage;
    }) => void,
    options?: AgentArtifactGenerationOptions
  ) => Promise<AgentRun>;
};

function getArtifactTitle(type: ArtifactType) {
  if (type === "thin_reading") {
    return "薄读";
  }

  if (type === "tree") {
    return "Literature Tree Analysis";
  }

  if (type === "ppt") {
    return "Literature PPT Outline";
  }

  if (type === "comparison_table") {
    return "Literature Comparison Table";
  }

  if (type === "layered_graph") {
    return "Layered Literature Graph";
  }

  return "Literature Mind Map";
}

function createArtifactId(taskId: string) {
  return taskId.replace("artifact-task-", "artifact-");
}

function buildFailureRecovery(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("401") || normalized.includes("unauthorized") || normalized.includes("api key")) {
    return [
      "确认 project-docs/test-api.md 中的 API key 已同步到 dev-cloud/.env.local。",
      "修改密钥后重启 dev-cloud，旧进程不会自动重新读取环境文件。"
    ];
  }
  if (
    normalized.includes("404") ||
    normalized.includes("not found") ||
    normalized.includes("unsupported route")
  ) {
    return [
      "确认上游地址支持 OpenAI Responses API 的 /responses 路由。",
      "确认 OPENAI_BASE_URL 只包含 API 根路径，例如以 /v1 结尾。"
    ];
  }
  if (normalized.includes("429") || normalized.includes("rate limit")) {
    return ["检查上游账号额度与限流状态，稍后重试。"];
  }
  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("econnrefused") ||
    normalized.includes("连接失败")
  ) {
    return [
      "确认 Liteasy dev-cloud 已启动，且桌面端配置的本地端口与实际端口一致。",
      "检查 dev-cloud 到上游模型地址的网络与代理配置。"
    ];
  }
  return [
    "检查下方 endpoint、provider 与 model 是否和当前 dev-cloud 配置一致。",
    "查看 dev-cloud 终端日志中的同一时间请求；修正配置后重启服务再重试。"
  ];
}

function formatVerificationFailure(
  verification: MindmapVerificationReport | undefined,
  fallback: string
) {
  const messages = verification?.errors.map((issue) => issue.message).filter(Boolean) ?? [];
  return messages.length > 0 ? messages.join("；") : fallback;
}

function requireVerifiedMindmapMetadata(
  artifactWorkflow: MindmapArtifactWorkflowMetadata | undefined
): VerifiedMindmapMetadata {
  if (!artifactWorkflow) {
    throw new Error("思维导图审计未通过：缺少 Artifact Workflow 审计结果。");
  }

  const verification = artifactWorkflow.verification ?? artifactWorkflow.mindmap.verification;
  if (
    artifactWorkflow.status !== "verified" ||
    artifactWorkflow.mindmap.verification.status !== "pass" ||
    verification.status !== "pass"
  ) {
    throw new Error(
      `思维导图审计未通过：${formatVerificationFailure(verification, "workflow 未返回可保存的通过态产物。")}`
    );
  }

  return {
    mindmapArtifact: artifactWorkflow.mindmap,
    verification
  };
}

function requireThinReadingSeed(
  metadata: AgentArtifactMetadata,
  fallbackContext: ThinReadingGenerationContext
) {
  const rootSeed = metadata.thinReading?.rootSeed;
  if (!rootSeed) {
    throw new Error("薄读 Agent run 缺少可持久化的 rootSeed。");
  }
  return {
    context: metadata.thinReading?.context ?? fallbackContext,
    rootSeed
  };
}

function createRootThinReadingContext(input: {
  artifactId: string;
  papers: Paper[];
  targetLanguage: string;
}): ThinReadingGenerationContext {
  const primaryPaper = input.papers[0];
  return {
    artifactId: input.artifactId,
    depth: 0,
    paperIds: input.papers.map((paper) => paper.id),
    primaryPaperId: primaryPaper?.id,
    primaryPaperTitle: primaryPaper?.title,
    source: { kind: "root_overview" },
    targetLanguage: input.targetLanguage
  };
}

function thinReadingTitleForSource(source: ThinReadingBranchSource, targetLanguage: string) {
  if (source.kind === "omitted_section") {
    return source.label;
  }
  return truncateThinReadingTitle(
    source.excerpt,
    targetLanguage.startsWith("en") ? "Selected passage" : "正文选区"
  );
}

const artifactTypeLabels: Record<Exclude<ArtifactType, "skill_doc">, string> = {
  comparison_table: "对比表",
  layered_graph: "分层关系图",
  mindmap: "思维导图",
  ppt: "PPT",
  thin_reading: "薄读",
  tree: "树形展开"
};

function normalizePaperIds(papers: Array<{ id: string }>) {
  return [...new Set(papers.map((paper) => paper.id))].sort();
}

function papersForArtifactScope(
  artifactType: ArtifactType,
  papers: Paper[],
  activeReaderPaper?: Paper | null
) {
  // Thin reading starts from one paper; cross-paper artifacts retain the full selection.
  if (artifactType !== "thin_reading") {
    return papers;
  }
  const readerPaper = activeReaderPaper && papers.find((paper) => paper.id === activeReaderPaper.id);
  return readerPaper ? [readerPaper] : papers.slice(0, 1);
}

function createThinReadingResultDocument(input: {
  agentRun?: AgentRun;
  analysis?: CompletedMultiPaperAnalysis;
  answer?: string;
  citations?: AgentCitation[];
  createdAt: string;
  document: ThinReadingDocument;
  existing?: ArtifactTab;
  papers: Array<{ id: string; title: string }>;
  uiDsl?: ArtifactTab["uiDsl"];
}) {
  const activeNode = input.document.nodes[input.document.activeNodeId] ??
    input.document.nodes[input.document.rootNodeId];
  return {
    agent: {
      apiVersion: input.agentRun?.apiVersion ?? "liteasy.agent/v1",
      runId: input.agentRun?.runId ?? input.existing?.agentRunId ?? `local-update-${input.document.artifactId}`,
      sessionId: input.agentRun?.sessionId ?? "thin-reading-local",
      status: "completed" as const
    },
    analysis: input.analysis ?? input.existing?.analysis,
    answer: input.answer ?? input.existing?.answer ?? activeNode.summary,
    artifactId: input.document.artifactId,
    artifactType: "thin_reading" as const,
    citations: input.citations ?? input.existing?.citations ?? [],
    createdAt: input.createdAt,
    papers: input.papers,
    thinReadingDocument: input.document,
    title: "薄读",
    uiDsl: input.uiDsl,
    version: "liteasy.agent-artifact/v1" as const
  };
}

export function findDuplicateArtifacts(
  catalog: ArtifactTab[],
  artifactType: Exclude<ArtifactType, "skill_doc">,
  papers: Array<{ id: string }>
) {
  const sourcePaperIds = normalizePaperIds(papers);
  return catalog.filter((artifact) => {
    if (artifact.type !== artifactType || !artifact.papers) {
      return false;
    }
    const artifactPaperIds = normalizePaperIds(artifact.papers);
    return artifactPaperIds.length === sourcePaperIds.length &&
      artifactPaperIds.every((paperId, index) => paperId === sourcePaperIds[index]);
  });
}

function confirmDuplicateGenerationInBrowser({
  artifactType,
  existingArtifacts,
  papers
}: DuplicateArtifactGenerationConfirmation) {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return false;
  }
  const paperList = papers.map((paper) => `- ${paper.title}`).join("\n");
  return window.confirm(
    `当前文献集合已经存在 ${existingArtifacts.length} 个“${artifactTypeLabels[artifactType]}”产物：\n\n` +
    `${paperList}\n\n仍要生成新的产物吗？新结果会另存，不会覆盖已有产物。`
  );
}

export function useArtifactActions({
  artifactStore,
  artifactResultClient,
  confirmDuplicateGeneration = confirmDuplicateGenerationInBrowser,
  cancelAgentRun,
  getImportedChunksByPaperId,
  getIntuechoEndpoint,
  getAssistantLanguage,
  getActiveReaderPaper,
  getModelDiagnosticContext,
  getSelectedDocumentSet,
  getSelectedPapers,
  onAnalysisHint,
  onArtifactCatalogChanged,
  onArtifactTabsChanged,
  onArtifactTasksChanged,
  queueImportForPapers,
  runAgentAnalysis
}: UseArtifactActionsInput) {
  function syncArtifacts(_taskId?: string) {
    onArtifactTasksChanged(artifactStore.getTasks().map((task) => ({ ...task })));
    onArtifactCatalogChanged(artifactStore.getCatalog());
    onArtifactTabsChanged([...artifactStore.getOpenTabs()]);
  }

  async function startArtifactTask(
    artifactType: ArtifactType,
    selectedPapers: Paper[],
    importedChunksByPaperId: Record<string, RetrievalChunk[]>,
    queuedTaskId?: string,
    generationOptions?: AgentArtifactGenerationOptions
  ) {
    const scopedPapers = papersForArtifactScope(artifactType, selectedPapers, getActiveReaderPaper?.());
    const taskId = queuedTaskId ?? artifactStore.createTask(artifactType);
    if (!queuedTaskId) {
      syncArtifacts(taskId);
    }
    if (artifactStore.getTask(taskId)?.status === "cancelled") {
      return;
    }
    artifactStore.startTask(taskId);
    syncArtifacts(taskId);

    try {
      if (artifactType === "skill_doc") {
        throw new Error("Skill 文档不是论文分析模态");
      }
      const onProgress = (progress: {
        agentRunId?: string;
        message: string;
        partialAnswer?: string;
        partialOutlineNodes?: ArtifactTask["partialOutlineNodes"];
        progress: number;
        stage: ArtifactTaskStage;
      }) => {
        if (artifactStore.getTask(taskId)?.status === "cancelled") {
          if (progress.agentRunId && cancelAgentRun) {
            void cancelAgentRun(
              progress.agentRunId,
              "用户在 Agent 启动前终止了多模态产物生成"
            ).catch((error) => {
              onAnalysisHint(
                `终止请求未能送达 Agent：${error instanceof Error ? error.message : String(error)}`
              );
            });
          }
          return;
        }
        artifactStore.updateTask(taskId, progress);
        syncArtifacts(taskId);
      };
      const thinReadingArtifactId = artifactType === "thin_reading"
        ? createArtifactId(taskId)
        : undefined;
      const thinReadingTargetLanguage = resolveThinReadingTargetLanguage(getAssistantLanguage?.());
      const thinReadingContext = artifactType === "thin_reading"
        ? generationOptions?.thinReadingContext ?? createRootThinReadingContext({
            artifactId: thinReadingArtifactId!,
            papers: scopedPapers,
            targetLanguage: thinReadingTargetLanguage
          })
        : undefined;
      const rootThinReadingPaperId = thinReadingContext?.source.kind === "root_overview"
        ? thinReadingContext.primaryPaperId
        : undefined;
      const effectiveGenerationOptions: AgentArtifactGenerationOptions | undefined =
        artifactType === "thin_reading"
          ? {
              ...generationOptions,
              sourcePaperIds:
                rootThinReadingPaperId !== undefined
                  ? rootThinReadingPaperId
                    ? [rootThinReadingPaperId]
                    : scopedPapers.map((paper) => paper.id)
                  : generationOptions?.sourcePaperIds ?? scopedPapers.map((paper) => paper.id),
              thinReadingContext
            }
          : generationOptions;
      const agentRun = effectiveGenerationOptions
        ? await runAgentAnalysis(artifactType, onProgress, effectiveGenerationOptions)
        : await runAgentAnalysis(artifactType, onProgress);
      if (artifactStore.getTask(taskId)?.status === "cancelled" || agentRun.status === "cancelled") {
        artifactStore.cancelTask(taskId);
        syncArtifacts(taskId);
        return;
      }
      if (agentRun.status !== "completed") {
        throw new Error(`Agent run 未完成：${agentRun.status}`);
      }
      const answerEvent = [...agentRun.events]
        .reverse()
        .find((event) => event.type === "assistant.message");
      if (!answerEvent || answerEvent.type !== "assistant.message") {
        throw new Error("Agent run 没有返回分析结果");
      }
      const metadata =
        answerEvent.metadata &&
        typeof answerEvent.metadata === "object" &&
        !Array.isArray(answerEvent.metadata)
          ? answerEvent.metadata as AgentArtifactMetadata
          : {};
      if (!metadata.analysis) {
        throw new Error("Agent run 缺少可持久化的 AnalysisRun/Evidence/Claim");
      }
      const verifiedMindmap = artifactType === "mindmap"
        ? requireVerifiedMindmapMetadata(metadata.artifactWorkflow)
        : undefined;
      const rawArtifactId = artifactType === "thin_reading"
        ? thinReadingArtifactId!
        : `${createArtifactId(taskId)}-${agentRun.runId}`;
      const artifactId = rawArtifactId
        .replace(/[^A-Za-z0-9._-]/g, "-")
        .slice(0, 120);
      const title = getArtifactTitle(artifactType);
      const createdAt = new Date().toISOString();
      if (artifactType === "thin_reading") {
        const thinReading = requireThinReadingSeed(metadata, thinReadingContext!);
        const thinReadingDocument = createThinReadingDocument({
          artifactId,
          papers: scopedPapers.map((paper) => ({ ...paper })),
          rootSeed: thinReading.rootSeed,
          targetLanguage: thinReading.context.targetLanguage
        });
        artifactStore.updateTask(taskId, {
          message: "正在原子保存薄读结果",
          progress: 95,
          stage: "thin_reading_saving"
        });
        syncArtifacts(taskId);
        const document = createThinReadingResultDocument({
          agentRun,
          analysis: metadata.analysis,
          answer: answerEvent.message,
          citations: answerEvent.citations,
          createdAt,
          document: thinReadingDocument,
          papers: scopedPapers.map((paper) => ({ id: paper.id, title: paper.title }))
        });
        const resultPath = await artifactResultClient.save(document);
        artifactStore.completeTask(taskId, {
          agentRunId: agentRun.runId,
          analysis: metadata.analysis,
          answer: answerEvent.message,
          artifactId,
          citations: answerEvent.citations,
          createdAt,
          papers: document.papers,
          resultPath,
          thinReadingDocument,
          title: "薄读",
          type: "thin_reading"
        });
        syncArtifacts(taskId);
        onAnalysisHint(`薄读 Agent 生成完成并已保存：${resultPath}`);
        return;
      }
      const evidenceOutlineNodes = buildArtifactOutline({
        analysis: metadata.analysis,
        papers: selectedPapers,
        title
      });
      const generatedOutlineNodes = artifactType === "tree" || artifactType === "mindmap" || artifactType === "layered_graph"
        ? parseStreamingOutlineMarkdown(answerEvent.message)
        : [];
      const outlineNodes = generatedOutlineNodes.length >= 4
        ? generatedOutlineNodes
        : evidenceOutlineNodes;
      const outlineMarkdown = outlineToMarkdown(outlineNodes);
      const uiDsl = generateCenterArtifactUIDslDocument({
        artifactId,
        artifactType,
        importedChunksByPaperId,
        outlineNodes,
        selectedPapers,
        title
      });
      const intuitionGraph = artifactType === "mindmap" || artifactType === "layered_graph"
        ? createEvidenceBackedBaseGraph({
            analysis: metadata.analysis,
            artifactId,
            workId: selectedPapers.length === 1 ? `local:${selectedPapers[0].id}` : `selection:${metadata.analysis.run.id}`
          })
        : undefined;
      const document = {
        agent: {
          apiVersion: agentRun.apiVersion,
          runId: agentRun.runId,
          sessionId: agentRun.sessionId,
          status: "completed" as const
        },
        analysis: metadata.analysis,
        answer: answerEvent.message,
        artifactId,
        artifactType,
        citations: answerEvent.citations ?? [],
        createdAt,
        intuitionGraph,
        ...(verifiedMindmap
          ? {
              mindmapArtifact: verifiedMindmap.mindmapArtifact,
              verification: verifiedMindmap.verification
            }
          : {}),
        outlineMarkdown,
        outlineNodes,
        papers: selectedPapers.map((paper) => ({ id: paper.id, title: paper.title })),
        regeneratedFromArtifactId: generationOptions?.regeneratedFromArtifactId,
        supplementalContext: generationOptions?.supplementalContext,
        title,
        uiDsl,
        version: "liteasy.agent-artifact/v1" as const
      };
      artifactStore.updateTask(taskId, {
        message: "正在原子保存结果并发布产物",
        progress: 95,
        stage: "saving_result"
      });
      syncArtifacts(taskId);
      const resultPath = await artifactResultClient.save(document);
      artifactStore.completeTask(taskId, {
        agentRunId: agentRun.runId,
        analysis: metadata.analysis,
        answer: answerEvent.message,
        artifactId,
        citations: answerEvent.citations,
        createdAt,
        intuitionGraph,
        ...(verifiedMindmap
          ? {
              mindmapArtifact: verifiedMindmap.mindmapArtifact,
              verification: verifiedMindmap.verification
            }
          : {}),
        outlineMarkdown,
        outlineNodes,
        papers: document.papers,
        preview: buildArtifactPreview(selectedPapers, importedChunksByPaperId),
        regeneratedFromArtifactId: document.regeneratedFromArtifactId,
        resultPath,
        title,
        type: artifactType,
        supplementalContext: document.supplementalContext,
        uiDsl
      });
      syncArtifacts(taskId);
      onAnalysisHint(`Agent 分析完成并已保存：${resultPath}`);
    } catch (error) {
      if (artifactStore.getTask(taskId)?.status === "cancelled") {
        syncArtifacts(taskId);
        return;
      }
      const currentTask = artifactStore.getTask(taskId);
      const message = error instanceof Error ? error.message : String(error);
      const modelContext = getModelDiagnosticContext?.() ?? {};
      artifactStore.failTask(taskId, {
        ...modelContext,
        failedStage: currentTask?.stage ?? "generating_answer",
        message,
        occurredAt: new Date().toISOString(),
        recovery: buildFailureRecovery(message)
      });
      syncArtifacts(taskId);
      onAnalysisHint(`Agent 分析失败：${message}`);
    }
  }

  async function cancelArtifactTask(taskId: string) {
    const task = artifactStore.getTask(taskId);
    if (!task || task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
      return "该生成任务已经结束。";
    }

    artifactStore.cancelTask(taskId);
    syncArtifacts(taskId);
    if (task.agentRunId && cancelAgentRun) {
      try {
        await cancelAgentRun(task.agentRunId, "用户终止了多模态产物生成");
      } catch (error) {
        onAnalysisHint(
          `终止请求未能送达 Agent：${error instanceof Error ? error.message : String(error)}`
        );
        return "任务已在界面中终止，但 Agent 终止请求发送失败。";
      }
    }
    const message = task.agentRunId
      ? "已终止多模态产物生成；未完成结果不会保存。"
      : "已取消等待中的多模态产物任务；不会启动生成或保存结果。";
    onAnalysisHint(message);
    return message;
  }

  function startAnalysisForPapers(artifactType: ArtifactType, selectedPapers: Paper[]) {
    const scopedPapers = papersForArtifactScope(artifactType, selectedPapers, getActiveReaderPaper?.());
    if (scopedPapers.length === 0) {
      const message = "请通过 @ 指定论文，或在左栏勾选并锁定文献后再生成产物。";
      onAnalysisHint(message);
      return message;
    }
    if (artifactType !== "skill_doc") {
      const existingArtifacts = findDuplicateArtifacts(
        artifactStore.getCatalog(),
        artifactType,
        scopedPapers
      );
      if (
        existingArtifacts.length > 0 &&
        !confirmDuplicateGeneration({
          artifactType,
          existingArtifacts,
          papers: scopedPapers
        })
      ) {
        const message = `已取消重复生成“${artifactTypeLabels[artifactType]}”产物。`;
        onAnalysisHint(message);
        return message;
      }
    }
    const importedChunksByPaperId = getImportedChunksByPaperId();
    let queuedTaskId: string | undefined;
    const importStatus = queueImportForPapers(scopedPapers, () => {
      const taskId = queuedTaskId ?? artifactStore.createTask(artifactType);
      void startArtifactTask(
        artifactType,
        scopedPapers,
        getImportedChunksByPaperId(),
        taskId
      );
      onAnalysisHint("导入完成，已按指定 AI 分析启动主工作流。");
    });

    if (importStatus === "already_imported") {
      queuedTaskId = artifactStore.createTask(artifactType);
      syncArtifacts(queuedTaskId);
      void startArtifactTask(artifactType, scopedPapers, importedChunksByPaperId, queuedTaskId);
      const message = "当前选中文献集已导入，正在按指定 AI 分析启动。";
      onAnalysisHint(message);
      return message;
    }

    if (importStatus === "importing") {
      const message = "当前选中文献集正在导入，请稍后再开始分析。";
      onAnalysisHint(message);
      return message;
    }

    if (importStatus === "started") {
      queuedTaskId = artifactStore.createTask(artifactType);
      syncArtifacts(queuedTaskId);
    }
    const message = "当前选中文献集尚未全部导入，系统会先导入，再自动启动该 AI 分析。";
    onAnalysisHint(message);
    return message;
  }

  function startAnalysis(artifactType: ArtifactType) {
    const selectedSet = getSelectedDocumentSet();
    if (selectedSet.documentIds.length === 0) {
      const message = "请先在工作区勾选文件，形成选中文献集。";
      onAnalysisHint(message);
      return message;
    }

    if (!selectedSet.locked) {
      const message = "请先锁定选中文献集，再启动 AI 分析。";
      onAnalysisHint(message);
      return message;
    }

    return startAnalysisForPapers(artifactType, getSelectedPapers());
  }

  function handleAssistantArtifact(artifactType: ArtifactType) {
    const selectedSet = getSelectedDocumentSet();
    if (selectedSet.documentIds.length === 0) {
      const message = "当前没有可用的选中文献集。请先在左栏勾选并锁定文献。";
      onAnalysisHint(message);
      return message;
    }

    return startAnalysis(artifactType);
  }

  function regenerateArtifact(request: ArtifactRegenerationRequest) {
    const existing = artifactStore
      .getCatalog()
      .find((tab) => tab.artifactId === request.artifactId);
    if (!existing || existing.type === "skill_doc") {
      const message = "找不到可重新生成的论文分析产物。";
      onAnalysisHint(message);
      return message;
    }
    if (request.papers.length === 0) {
      const message = "该历史产物没有记录来源论文，无法按原文献集重新生成。";
      onAnalysisHint(message);
      return message;
    }
    const generationOptions: AgentArtifactGenerationOptions = {
      regeneratedFromArtifactId: request.artifactId,
      sourcePaperIds: request.papers.map((paper) => paper.id),
      supplementalContext: request.supplementalContext
    };
    const selectedPapers: Paper[] = request.papers.map((paper) => ({ ...paper }));
    const importedChunksByPaperId = getImportedChunksByPaperId();
    let queuedTaskId: string | undefined;
    const beginRegeneration = () => {
      const taskId = queuedTaskId ?? artifactStore.createTask(request.artifactType);
      void startArtifactTask(
        request.artifactType,
        selectedPapers,
        getImportedChunksByPaperId(),
        taskId,
        generationOptions
      );
      onAnalysisHint("导入完成，正在基于原产物的论文集合重新生成并另存。");
    };
    const importStatus = queueImportForPapers(selectedPapers, beginRegeneration);
    if (importStatus === "already_imported") {
      queuedTaskId = artifactStore.createTask(request.artifactType);
      syncArtifacts(queuedTaskId);
      void startArtifactTask(
        request.artifactType,
        selectedPapers,
        importedChunksByPaperId,
        queuedTaskId,
        generationOptions
      );
    } else if (importStatus === "started") {
      queuedTaskId = artifactStore.createTask(request.artifactType);
      syncArtifacts(queuedTaskId);
    } else if (importStatus === "importing") {
      const message = "原产物的来源论文仍在导入，请稍后再次重新生成。";
      onAnalysisHint(message);
      return message;
    }
    const message = importStatus === "already_imported"
      ? "正在基于原产物的论文集合和补充资料重新生成。"
      : "正在导入原产物的来源论文，完成后会自动重新生成。";
    onAnalysisHint(message);
    return message;
  }

  function closeArtifactTab(artifactId: string) {
    artifactStore.closeTab(artifactId);
    syncArtifacts();
  }

  async function deleteArtifact(artifactId: string) {
    const existing = artifactStore
      .getCatalog()
      .find((tab) => tab.artifactId === artifactId);
    if (!existing || existing.type === "skill_doc") {
      const message = "找不到可删除的已保存多模态产物。";
      onAnalysisHint(message);
      return message;
    }
    try {
      await artifactResultClient.delete(artifactId);
      artifactStore.removeCatalogEntry(artifactId);
      syncArtifacts();
      const message = `已删除多模态产物：${existing.title}`;
      onAnalysisHint(message);
      return message;
    } catch (error) {
      const message = `删除多模态产物失败：${error instanceof Error ? error.message : String(error)}`;
      onAnalysisHint(message);
      return message;
    }
  }

  function openArtifact(artifactId: string) {
    const opened = artifactStore.openCatalogEntry(artifactId);
    if (!opened) {
      const message = "找不到已保存的多模态产物。";
      onAnalysisHint(message);
      return message;
    }
    syncArtifacts();
    return "已打开保存的多模态产物。";
  }

  function restoreArtifactResult(result: Awaited<ReturnType<ArtifactResultClient["list"]>>[number]) {
    const outlineNodes = result.outlineNodes ?? (result.analysis
      ? buildArtifactOutline({
          analysis: result.analysis,
          papers: result.papers,
          title: result.title
        })
      : undefined);
    const uiDsl = outlineNodes && (result.artifactType === "tree" || result.artifactType === "mindmap" || result.artifactType === "layered_graph")
      ? generateCenterArtifactUIDslDocument({
          artifactId: result.artifactId,
          artifactType: result.artifactType,
          importedChunksByPaperId: {},
          outlineNodes,
          selectedPapers: result.papers,
          title: result.title
        })
      : result.uiDsl;
    artifactStore.upsertCatalogEntry({
      agentRunId: result.agent.runId,
      analysis: result.analysis,
      answer: result.answer,
      artifactId: result.artifactId,
      citations: result.citations,
      createdAt: result.createdAt,
      intuitionGraph: result.intuitionGraph,
      mindmapArtifact: result.mindmapArtifact,
      outlineMarkdown: result.outlineMarkdown ?? (outlineNodes ? outlineToMarkdown(outlineNodes) : undefined),
      outlineNodes,
      papers: result.papers,
      regeneratedFromArtifactId: result.regeneratedFromArtifactId,
      resultPath: `project-docs/agent-results/${result.artifactId}.json`,
      thinReadingDocument: result.thinReadingDocument,
      title: result.title,
      type: result.artifactType,
      supplementalContext: result.supplementalContext,
      uiDsl,
      verification: result.verification
    });
    syncArtifacts();
  }

  function openSkillDocument(entry: AgentCoreCatalogEntry) {
    const artifactId = `skill-doc-${entry.id}`;
    artifactStore.upsertTab({
      artifactId,
      markdown: entry.docMarkdown ?? `# ${entry.id}\n\n${entry.description}`,
      sourcePath: entry.docPath,
      title: `${entry.id}.md`,
      type: "skill_doc"
    });
    syncArtifacts();
  }

  function updateSkillDocument(artifactId: string, markdown: string) {
    const existing = artifactStore.getOpenTabs().find((tab) => tab.artifactId === artifactId);
    if (!existing || existing.type !== "skill_doc") {
      return;
    }

    artifactStore.upsertTab({
      ...existing,
      markdown
    });
    syncArtifacts();
  }

  async function generateThinReadingBranch({
    artifactId,
    document,
    source
  }: GenerateThinReadingBranchInput) {
    const existing = artifactStore.getOpenTabs().find((tab) => tab.artifactId === artifactId) ??
      artifactStore.getCatalog().find((tab) => tab.artifactId === artifactId);
    if (!existing || existing.type !== "thin_reading") {
      throw new Error("找不到可继续深入的薄读产物。");
    }
    const primaryPaperId = document.paperIds[0];
    if (!primaryPaperId) {
      throw new Error("该薄读产物缺少主论文，无法继续生成下一层。");
    }
    const scopedDocument: ThinReadingDocument = {
      ...document,
      paperIds: [primaryPaperId],
      paperIdentities: document.paperIdentities?.[primaryPaperId]
        ? { [primaryPaperId]: document.paperIdentities[primaryPaperId] }
        : undefined
    };
    const activeNode = scopedDocument.nodes[scopedDocument.activeNodeId] ?? scopedDocument.nodes[scopedDocument.rootNodeId];
    const existingChild = findThinReadingChildBySource(scopedDocument, activeNode.id, source);
    if (existingChild) {
      updateThinReadingDocument(artifactId, {
        ...scopedDocument,
        activeNodeId: existingChild.id
      });
      return;
    }
    const primaryPaper = (existing.papers ?? []).find((paper) => paper.id === primaryPaperId);
    if (!primaryPaper) {
      throw new Error("该薄读产物缺少来源论文，无法继续生成下一层。");
    }
    const papers = [{ id: primaryPaper.id, title: primaryPaper.title }] as Paper[];
    const taskId = artifactStore.createTask("thin_reading");
    artifactStore.startTask(taskId);
    syncArtifacts(taskId);
    const context: ThinReadingGenerationContext = {
      artifactId,
      depth: activeNode.depth + 1,
      paperIds: [primaryPaperId],
      primaryPaperId,
      primaryPaperIdentity: scopedDocument.paperIdentities?.[primaryPaperId]
        ? scopedDocument.paperIdentities[primaryPaperId].primary
        : undefined,
      primaryPaperTitle: primaryPaper.title,
      parentClaims: activeNode.evidence.claims ? [...activeNode.evidence.claims] : undefined,
      parentEvidenceSpans: activeNode.evidence.paperEvidenceSpans
        ? [...activeNode.evidence.paperEvidenceSpans]
        : undefined,
      parentNodeId: activeNode.id,
      parentWithinPaperClosure: activeNode.withinPaperClosure,
      parentSummary: activeNode.summary,
      parentTitle: activeNode.title,
      prompt: source.kind === "selected_text" ? source.prompt : undefined,
      source,
      targetLanguage: document.targetLanguage
    };
    const onProgress = (progress: {
      agentRunId?: string;
      message: string;
      partialAnswer?: string;
      partialOutlineNodes?: ArtifactTask["partialOutlineNodes"];
      progress: number;
      stage: ArtifactTaskStage;
    }) => {
      artifactStore.updateTask(taskId, progress);
      syncArtifacts(taskId);
    };
    try {
      const agentRun = await runAgentAnalysis("thin_reading", onProgress, {
        sourcePaperIds: [primaryPaperId],
        thinReadingContext: context
      });
      if (agentRun.status !== "completed") {
        throw new Error(`薄读 Agent run 未完成：${agentRun.status}`);
      }
      const answerEvent = [...agentRun.events]
        .reverse()
        .find((event) => event.type === "assistant.message");
      if (!answerEvent || answerEvent.type !== "assistant.message") {
        throw new Error("薄读 Agent run 没有返回下一层结果。");
      }
      const metadata =
        answerEvent.metadata &&
        typeof answerEvent.metadata === "object" &&
        !Array.isArray(answerEvent.metadata)
          ? answerEvent.metadata as AgentArtifactMetadata
          : {};
      if (!metadata.analysis) {
        throw new Error("薄读 Agent run 缺少可持久化的 AnalysisRun/Evidence/Claim");
      }
      const thinReading = requireThinReadingSeed(metadata, context);
      const nextDocument = advanceThinReadingDocument(scopedDocument, {
        parentNodeId: activeNode.id,
        seed: thinReading.rootSeed,
        source,
        title: thinReadingTitleForSource(source, document.targetLanguage)
      });
      artifactStore.updateTask(taskId, {
        message: "正在保存薄读下一层",
        progress: 95,
        stage: "thin_reading_saving"
      });
      syncArtifacts(taskId);
      const createdAt = existing.createdAt ?? new Date().toISOString();
      const resultPath = await artifactResultClient.save(createThinReadingResultDocument({
        agentRun,
        analysis: metadata.analysis,
        answer: answerEvent.message,
        citations: answerEvent.citations,
        createdAt,
        document: nextDocument,
        existing,
        papers,
        uiDsl: existing.uiDsl
      }));
      artifactStore.completeTask(taskId, {
        ...existing,
        agentRunId: agentRun.runId,
        analysis: metadata.analysis,
        answer: answerEvent.message,
        citations: answerEvent.citations,
        papers,
        resultPath,
        thinReadingDocument: nextDocument
      });
      syncArtifacts(taskId);
      onAnalysisHint(`薄读下一层已由 Agent 生成并保存：${resultPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const modelContext = getModelDiagnosticContext?.() ?? {};
      artifactStore.failTask(taskId, {
        ...modelContext,
        failedStage: artifactStore.getTask(taskId)?.stage ?? "generating_answer",
        message,
        occurredAt: new Date().toISOString(),
        recovery: buildFailureRecovery(message)
      });
      syncArtifacts(taskId);
      onAnalysisHint(`薄读下一层生成失败：${message}`);
      throw error;
    }
  }

  function updateThinReadingDocument(artifactId: string, nextDocument: NonNullable<ArtifactTab["thinReadingDocument"]>) {
    const existing = artifactStore.getOpenTabs().find((tab) => tab.artifactId === artifactId) ??
      artifactStore.getCatalog().find((tab) => tab.artifactId === artifactId);
    if (!existing || existing.type !== "thin_reading") {
      return;
    }
    const primaryPaperId = nextDocument.paperIds[0];
    const papers = primaryPaperId
      ? (existing.papers ?? []).filter((paper) => paper.id === primaryPaperId)
      : [];

    artifactStore.upsertTab({
      ...existing,
      papers,
      thinReadingDocument: nextDocument
    });
    syncArtifacts();
    void artifactResultClient.save(createThinReadingResultDocument({
      createdAt: existing.createdAt ?? new Date().toISOString(),
      document: nextDocument,
      existing,
      papers,
      uiDsl: existing.uiDsl
    })).catch((error) => {
      onAnalysisHint(`薄读本地状态保存失败：${error instanceof Error ? error.message : String(error)}`);
    });
  }

  async function syncThinReadingAnnotations(input: {
    artifactId: string;
    document: ThinReadingDocument;
  }) {
    const endpoint = getIntuechoEndpoint?.().trim() ?? "";
    if (!endpoint) {
      throw new Error("尚未配置 Intuecho HTTPS 同步端点；批注仍保留在本地等待同步队列。");
    }
    const pending = listThinReadingPendingPublicAnnotations(input.document);
    if (pending.length === 0) {
      return;
    }
    const results = await createHttpIntuechoSyncAdapter({ endpoint }).syncPendingAnnotations(pending);
    const nextDocument = applyThinReadingAnnotationSyncResults(input.document, results);
    updateThinReadingDocument(input.artifactId, nextDocument);
    const synced = results.filter((result) => result.status === "synced").length;
    const failed = results.filter((result) => result.status === "failed").length;
    onAnalysisHint(
      failed > 0
        ? `Intuecho 同步完成：${synced} 条已确认，${failed} 条仍在本地队列等待重试。`
        : `Intuecho 已确认同步 ${synced} 条共享批注。`
    );
  }

  async function saveSkillDocument(artifactId: string) {
    const existing = artifactStore.getOpenTabs().find((tab) => tab.artifactId === artifactId);
    if (!existing || existing.type !== "skill_doc") {
      return;
    }

    if (!existing.sourcePath) {
      onAnalysisHint("当前 skill 文档缺少源路径，无法写回文件。");
      return;
    }

    try {
      // 写文件动作收敛到 Tauri 端做路径白名单校验，前端只传逻辑源路径和正文。
      await invoke("save_skill_document", {
        markdown: existing.markdown ?? "",
        sourcePath: existing.sourcePath
      });
      onAnalysisHint(`已保存 skill 文档：${existing.title}`);
    } catch (error) {
      onAnalysisHint(`保存 skill 文档失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    cancelArtifactTask,
    closeArtifactTab,
    deleteArtifact,
    handleAssistantArtifact,
    openArtifact,
    openSkillDocument,
    regenerateArtifact,
    generateThinReadingBranch,
    restoreArtifactResult,
    saveSkillDocument,
    startAnalysis,
    startAnalysisForPapers,
    startArtifactTask,
    syncThinReadingAnnotations,
    syncArtifacts,
    updateSkillDocument,
    updateThinReadingDocument
  };
}
