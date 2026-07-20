import type { ArtifactTab, ArtifactTask, ArtifactType } from "./artifact.types";

export function createArtifactStore() {
  const tasks = new Map<string, ArtifactTask>();
  const tabs: ArtifactTab[] = [];
  let sequence = 0;

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
      if (!task) return;
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
      if (!task) return;
      task.message = "分析结果已保存";
      task.progress = 100;
      task.stage = "completed";
      task.status = "completed";
      tabs.unshift(payload);
    },
    upsertTab(payload: ArtifactTab) {
      const existingIndex = tabs.findIndex((tab) => tab.artifactId === payload.artifactId);
      if (existingIndex >= 0) {
        tabs.splice(existingIndex, 1, payload);
      } else {
        tabs.unshift(payload);
      }
    },
    closeTab(artifactId: string) {
      const tabIndex = tabs.findIndex((tab) => tab.artifactId === artifactId);
      if (tabIndex === -1) return;
      tabs.splice(tabIndex, 1);
    },
    failTask(id: string) {
      const task = tasks.get(id);
      if (!task) return;
      task.message = "Agent 分析失败";
      task.stage = "failed";
      task.status = "failed";
    },
    getTask(id: string) {
      return tasks.get(id);
    },
    getOpenTabs() {
      return [...tabs];
    }
  };
}
