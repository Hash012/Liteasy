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
import type { AgentRun } from "../agent-api/agentApi.types";
import type { CompletedMultiPaperAnalysis } from "../paper-analysis/analysis.types";
import type { ArtifactResultClient } from "./artifactResultClient";
import {
  buildArtifactOutline,
  outlineToMarkdown,
  parseStreamingOutlineMarkdown
} from "./artifactOutline";

type ArtifactStore = ReturnType<typeof createArtifactStore>;

export type AgentArtifactGenerationOptions = {
  regeneratedFromArtifactId?: string;
  sourcePaperIds?: string[];
  supplementalContext?: string;
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
  if (type === "tree") {
    return "Literature Tree Analysis";
  }

  if (type === "ppt") {
    return "Literature PPT Outline";
  }

  if (type === "comparison_table") {
    return "Literature Comparison Table";
  }

  return "Literature Mind Map";
}

function createArtifactId(taskId: string) {
  return taskId.replace("artifact-task-", "artifact-");
}

const artifactTypeLabels: Record<Exclude<ArtifactType, "skill_doc">, string> = {
  comparison_table: "对比表",
  mindmap: "思维导图",
  ppt: "PPT",
  tree: "树形展开"
};

function normalizePaperIds(papers: Array<{ id: string }>) {
  return [...new Set(papers.map((paper) => paper.id))].sort();
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
      const agentRun = generationOptions
        ? await runAgentAnalysis(artifactType, onProgress, generationOptions)
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
          ? answerEvent.metadata as { analysis?: CompletedMultiPaperAnalysis }
          : {};
      if (!metadata.analysis) {
        throw new Error("Agent run 缺少可持久化的 AnalysisRun/Evidence/Claim");
      }
      const artifactId = `${createArtifactId(taskId)}-${agentRun.runId}`
        .replace(/[^A-Za-z0-9._-]/g, "-")
        .slice(0, 120);
      const title = getArtifactTitle(artifactType);
      const createdAt = new Date().toISOString();
      const evidenceOutlineNodes = buildArtifactOutline({
        analysis: metadata.analysis,
        papers: selectedPapers,
        title
      });
      const generatedOutlineNodes = artifactType === "tree" || artifactType === "mindmap"
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
      artifactStore.failTask(taskId);
      syncArtifacts(taskId);
      onAnalysisHint(
        `Agent 分析失败：${error instanceof Error ? error.message : String(error)}`
      );
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

  function startAnalysis(artifactType: ArtifactType) {
    const selectedSet = getSelectedDocumentSet();
    if (selectedSet.documentIds.length === 0) {
      const message = "请先在工作区勾选文件，形成选中文献集。";
      onAnalysisHint(message);
      return message;
    }

    if (!selectedSet.locked) {
      const message = "请先锁定选中文献集，再启动模态分析。";
      onAnalysisHint(message);
      return message;
    }

    const selectedPapers = getSelectedPapers();
    if (artifactType !== "skill_doc") {
      const existingArtifacts = findDuplicateArtifacts(
        artifactStore.getCatalog(),
        artifactType,
        selectedPapers
      );
      if (
        existingArtifacts.length > 0 &&
        !confirmDuplicateGeneration({
          artifactType,
          existingArtifacts,
          papers: selectedPapers
        })
      ) {
        const message = `已取消重复生成“${artifactTypeLabels[artifactType]}”产物。`;
        onAnalysisHint(message);
        return message;
      }
    }
    const importedChunksByPaperId = getImportedChunksByPaperId();
    let queuedTaskId: string | undefined;
    const importStatus = queueImportForPapers(selectedPapers, () => {
      const taskId = queuedTaskId ?? artifactStore.createTask(artifactType);
      void startArtifactTask(
        artifactType,
        selectedPapers,
        getImportedChunksByPaperId(),
        taskId
      );
      onAnalysisHint("导入完成，已按指定模态启动主工作流。");
    });

    if (importStatus === "already_imported") {
      queuedTaskId = artifactStore.createTask(artifactType);
      syncArtifacts(queuedTaskId);
      void startArtifactTask(artifactType, selectedPapers, importedChunksByPaperId, queuedTaskId);
      const message = "当前选中文献集已导入，正在按指定模态启动分析。";
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
    const message = "当前选中文献集尚未全部导入，系统会先导入，再自动启动该模态分析。";
    onAnalysisHint(message);
    return message;
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
    const uiDsl = outlineNodes && (result.artifactType === "tree" || result.artifactType === "mindmap")
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
      outlineMarkdown: result.outlineMarkdown ?? (outlineNodes ? outlineToMarkdown(outlineNodes) : undefined),
      outlineNodes,
      papers: result.papers,
      regeneratedFromArtifactId: result.regeneratedFromArtifactId,
      resultPath: `project-docs/agent-results/${result.artifactId}.json`,
      title: result.title,
      type: result.artifactType,
      supplementalContext: result.supplementalContext,
      uiDsl
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
    restoreArtifactResult,
    saveSkillDocument,
    startAnalysis,
    startArtifactTask,
    syncArtifacts,
    updateSkillDocument
  };
}
