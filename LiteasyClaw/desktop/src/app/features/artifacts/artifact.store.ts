import type { ArtifactTab, ArtifactTask, ArtifactType } from "./artifact.types";

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
        message: "等待 PDF 解析与索引",
        progress: 5,
        stage: "waiting_for_import",
        type,
        status: "queued"
      };
      tasks.set(task.id, task);
      return task.id;
    },
    startTask(id: string) {
      const task = tasks.get(id);
      if (!task || task.status === "cancelled") return;
      task.message = "正在准备 Agent 上下文";
      task.progress = Math.max(task.progress, 15);
      task.stage = "preparing_context";
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
    failTask(id: string) {
      const task = tasks.get(id);
      if (!task || task.status === "cancelled") return;
      task.message = "Agent 分析失败";
      task.stage = "failed";
      task.status = "failed";
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
