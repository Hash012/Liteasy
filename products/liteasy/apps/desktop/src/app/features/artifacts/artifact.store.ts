import type {
  ArtifactTab,
  ArtifactTask,
  ArtifactTaskFailure,
  ArtifactType
} from "./artifact.types";

export function createArtifactStore() {
  const tasks = new Map<string, ArtifactTask>();
  const tabs: ArtifactTab[] = [];
  const catalog = new Map<string, ArtifactTab>();
  let sequence = 0;

  function upsertOpenTab(payload: ArtifactTab) {
    const existingIndex = tabs.findIndex((tab) => tab.artifactId === payload.artifactId);
    if (existingIndex >= 0) {
      tabs.splice(existingIndex, 1, payload);
    } else {
      tabs.unshift(payload);
    }
  }

  return {
    createTask(type: ArtifactType) {
      sequence += 1;
      const task: ArtifactTask = {
        id: `artifact-task-${sequence}`,
        message: type === "thin_reading" ? "正在解析论文文本与证据位置" : "等待 PDF 解析与索引",
        progress: 5,
        stage: type === "thin_reading" ? "thin_reading_parsing_document" : "waiting_for_import",
        type,
        status: "queued"
      };
      tasks.set(task.id, task);
      return task.id;
    },
    startTask(id: string) {
      const task = tasks.get(id);
      if (!task || task.status === "cancelled") return;
      task.message = task.type === "thin_reading" ? "正在规划薄读路径与证据范围" : "正在准备 Agent 上下文";
      task.progress = Math.max(task.progress, 15);
      task.stage = task.type === "thin_reading" ? "thin_reading_planning" : "preparing_context";
      task.status = "running";
    },
    updateTask(id: string, patch: Partial<Omit<ArtifactTask, "id" | "type">>) {
      const task = tasks.get(id);
      if (!task) return;
      Object.assign(task, patch);
    },
    completeTask(id: string, payload: ArtifactTab) {
      const task = tasks.get(id);
      if (!task || task.status === "cancelled") return;
      task.message = "分析结果已保存";
      task.artifactId = payload.artifactId;
      task.progress = 100;
      task.stage = "completed";
      task.status = "completed";
      catalog.set(payload.artifactId, payload);
      upsertOpenTab(payload);
    },
    upsertTab(payload: ArtifactTab) {
      catalog.set(payload.artifactId, payload);
      upsertOpenTab(payload);
    },
    upsertCatalogEntry(payload: ArtifactTab) {
      catalog.set(payload.artifactId, payload);
    },
    renameCatalogEntry(artifactId: string, title: string) {
      const catalogEntry = catalog.get(artifactId);
      if (!catalogEntry) return false;
      const renamed = { ...catalogEntry, title };
      catalog.set(artifactId, renamed);
      const tabIndex = tabs.findIndex((tab) => tab.artifactId === artifactId);
      if (tabIndex >= 0) {
        tabs.splice(tabIndex, 1, renamed);
      }
      return true;
    },
    openCatalogEntry(artifactId: string) {
      const entry = catalog.get(artifactId);
      if (!entry) return false;
      upsertOpenTab(entry);
      return true;
    },
    closeTab(artifactId: string) {
      const tabIndex = tabs.findIndex((tab) => tab.artifactId === artifactId);
      if (tabIndex === -1) return;
      tabs.splice(tabIndex, 1);
    },
    removeCatalogEntry(artifactId: string) {
      catalog.delete(artifactId);
      const tabIndex = tabs.findIndex((tab) => tab.artifactId === artifactId);
      if (tabIndex >= 0) {
        tabs.splice(tabIndex, 1);
      }
    },
    clearAccountArtifacts() {
      tasks.clear();
      for (const [artifactId, entry] of catalog) {
        if (entry.type !== "skill_doc") {
          catalog.delete(artifactId);
        }
      }
      const retainedTabs = tabs.filter((tab) => tab.type === "skill_doc");
      tabs.splice(0, tabs.length, ...retainedTabs);
    },
    failTask(id: string, failure?: ArtifactTaskFailure) {
      const task = tasks.get(id);
      if (!task || task.status === "cancelled") return;
      task.failure = failure;
      task.message = failure?.message
        ? `Agent 分析失败：${failure.message}`
        : "Agent 分析失败";
      task.stage = "failed";
      task.status = "failed";
    },
    restoreInterruptedTask(task: Pick<ArtifactTask, "agentRunId" | "artifactId" | "id" | "message" | "progress" | "thinReadingBranchRecovery" | "type">) {
      const recovered: ArtifactTask = {
        ...(task.agentRunId ? { agentRunId: task.agentRunId } : {}),
        ...(task.artifactId ? { artifactId: task.artifactId } : {}),
        ...(task.thinReadingBranchRecovery ? { thinReadingBranchRecovery: task.thinReadingBranchRecovery } : {}),
        failure: {
          failedStage: "failed",
          message: "应用在生成期间重启，原模型调用已中断。请重新发起生成。",
          occurredAt: new Date().toISOString(),
          recovery: ["重新发起生成"]
        },
        id: task.id,
        message: "生成已因应用重启而中断，请重新发起。",
        progress: Math.max(0, Math.min(100, task.progress)),
        recoveredAfterRestart: true,
        stage: "failed",
        status: "failed",
        type: task.type
      };
      tasks.set(recovered.id, recovered);
      const suffix = recovered.id.match(/artifact-task-(\d+)$/)?.[1];
      sequence = Math.max(sequence, Number(suffix) || 0);
    },
    cancelTask(id: string) {
      const task = tasks.get(id);
      if (!task || task.status === "completed" || task.status === "failed") return false;
      task.message = "用户已终止生成";
      task.stage = "cancelled";
      task.status = "cancelled";
      return true;
    },
    getTask(id: string) {
      return tasks.get(id);
    },
    getTasks() {
      return [...tasks.values()].reverse();
    },
    getOpenTabs() {
      return [...tabs];
    },
    getCatalog() {
      return [...catalog.values()].sort((left, right) =>
        (right.createdAt ?? "").localeCompare(left.createdAt ?? "")
      );
    }
  };
}
