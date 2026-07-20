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

type UseArtifactActionsInput = {
  artifactStore: ArtifactStore;
  artifactResultClient: ArtifactResultClient;
  getImportedChunksByPaperId: () => Record<string, RetrievalChunk[]>;
  getSelectedDocumentSet: () => SelectedDocumentSet;
  getSelectedPapers: () => Paper[];
  onAnalysisHint: (message: string) => void;
  onArtifactTabsChanged: (tabs: ArtifactTab[]) => void;
  onArtifactTasksChanged: (tasks: ArtifactTask[]) => void;
  queueImportForPapers: (papers: Paper[], onComplete?: () => void) => ImportQueueStatus;
  runAgentAnalysis: (
    artifactType: ArtifactType,
    onProgress: (input: {
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

export function useArtifactActions({
  artifactStore,
  artifactResultClient,
  getImportedChunksByPaperId,
  getSelectedDocumentSet,
  getSelectedPapers,
  onAnalysisHint,
  onArtifactTabsChanged,
  onArtifactTasksChanged,
  queueImportForPapers,
  runAgentAnalysis
}: UseArtifactActionsInput) {
  function syncArtifacts(taskId?: string) {
    const task = taskId ? artifactStore.getTask(taskId) : undefined;
    const nextTasks = task ? [{ ...task }] : [];
    onArtifactTasksChanged(nextTasks);
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
    artifactStore.startTask(taskId);
    syncArtifacts(taskId);

    try {
      if (artifactType === "skill_doc") {
        throw new Error("Skill 文档不是论文分析模态");
      }
      const onProgress = (progress: {
        message: string;
        partialAnswer?: string;
        partialOutlineNodes?: ArtifactTask["partialOutlineNodes"];
        progress: number;
        stage: ArtifactTaskStage;
      }) => {
        artifactStore.updateTask(taskId, progress);
        syncArtifacts(taskId);
      };
      const agentRun = generationOptions
        ? await runAgentAnalysis(artifactType, onProgress, generationOptions)
        : await runAgentAnalysis(artifactType, onProgress);
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
      artifactStore.failTask(taskId);
      syncArtifacts(taskId);
      onAnalysisHint(
        `Agent 分析失败：${error instanceof Error ? error.message : String(error)}`
      );
    }
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

    startAnalysis(artifactType);
    return "已根据当前选中文献集触发分支 skill；如尚未导入，系统会先导入再开始生成产物。";
  }

  function regenerateArtifact(request: ArtifactRegenerationRequest) {
    const existing = artifactStore
      .getOpenTabs()
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
    artifactStore.upsertTab({
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
    closeArtifactTab,
    handleAssistantArtifact,
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
