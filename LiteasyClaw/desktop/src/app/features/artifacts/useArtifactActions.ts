import { invoke } from "@tauri-apps/api/core";
import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { AgentCoreCatalogEntry } from "../agent-core/agentCoreConfig";
import type { Paper, SelectedDocumentSet } from "../workspace/workspace.types";
import type { ImportQueueStatus } from "../workspace/useWorkspaceActions";
import { buildArtifactPreview } from "./artifactPreview";
import type { ArtifactTab, ArtifactTask, ArtifactType } from "./artifact.types";
import type { createArtifactStore } from "./artifact.store";
import { generateCenterArtifactUIDslDocument } from "../generative-ui/uiDslGenerator";

type ArtifactStore = ReturnType<typeof createArtifactStore>;

type UseArtifactActionsInput = {
  artifactStore: ArtifactStore;
  getImportedChunksByPaperId: () => Record<string, RetrievalChunk[]>;
  getSelectedDocumentSet: () => SelectedDocumentSet;
  getSelectedPapers: () => Paper[];
  onAnalysisHint: (message: string) => void;
  onArtifactTabsChanged: (tabs: ArtifactTab[]) => void;
  onArtifactTasksChanged: (tasks: ArtifactTask[]) => void;
  queueImportForPapers: (papers: Paper[], onComplete?: () => void) => ImportQueueStatus;
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
  getImportedChunksByPaperId,
  getSelectedDocumentSet,
  getSelectedPapers,
  onAnalysisHint,
  onArtifactTabsChanged,
  onArtifactTasksChanged,
  queueImportForPapers
}: UseArtifactActionsInput) {
  function syncArtifacts(taskId?: string) {
    const nextTasks = taskId ? [artifactStore.getTask(taskId)!].filter(Boolean) : [];
    onArtifactTasksChanged(nextTasks);
    onArtifactTabsChanged([...artifactStore.getOpenTabs()]);
  }

  function startArtifactTask(
    artifactType: ArtifactType,
    selectedPapers: Paper[],
    importedChunksByPaperId: Record<string, RetrievalChunk[]>
  ) {
    const taskId = artifactStore.createTask(artifactType);
    syncArtifacts(taskId);

    window.setTimeout(() => {
      artifactStore.startTask(taskId);
      syncArtifacts(taskId);
    }, 300);

    window.setTimeout(() => {
      const artifactId = createArtifactId(taskId);
      artifactStore.completeTask(taskId, {
        artifactId,
        preview: buildArtifactPreview(selectedPapers, importedChunksByPaperId),
        title: getArtifactTitle(artifactType),
        type: artifactType,
        uiDsl: generateCenterArtifactUIDslDocument({
          artifactId,
          artifactType,
          importedChunksByPaperId,
          selectedPapers,
          title: getArtifactTitle(artifactType)
        })
      });
      syncArtifacts(taskId);
    }, 1200);
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
    const importStatus = queueImportForPapers(selectedPapers, () => {
      startArtifactTask(artifactType, selectedPapers, getImportedChunksByPaperId());
      onAnalysisHint("导入完成，已按指定模态启动主工作流。");
    });

    if (importStatus === "already_imported") {
      startArtifactTask(artifactType, selectedPapers, importedChunksByPaperId);
      const message = "当前选中文献集已导入，正在按指定模态启动分析。";
      onAnalysisHint(message);
      return message;
    }

    if (importStatus === "importing") {
      const message = "当前选中文献集正在导入，请稍后再开始分析。";
      onAnalysisHint(message);
      return message;
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

  function closeArtifactTab(artifactId: string) {
    artifactStore.closeTab(artifactId);
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
    saveSkillDocument,
    startAnalysis,
    startArtifactTask,
    syncArtifacts,
    updateSkillDocument
  };
}
