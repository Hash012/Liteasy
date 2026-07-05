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
        type,
        status: "queued"
      };
      tasks.set(task.id, task);
      return task.id;
    },
    startTask(id: string) {
      const task = tasks.get(id);
      if (!task) return;
      task.status = "running";
    },
    completeTask(id: string, payload: ArtifactTab) {
      const task = tasks.get(id);
      if (!task) return;
      task.status = "completed";
      tabs.unshift(payload);
    },
    closeTab(artifactId: string) {
      const tabIndex = tabs.findIndex((tab) => tab.artifactId === artifactId);
      if (tabIndex === -1) return;
      tabs.splice(tabIndex, 1);
    },
    failTask(id: string) {
      const task = tasks.get(id);
      if (!task) return;
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
