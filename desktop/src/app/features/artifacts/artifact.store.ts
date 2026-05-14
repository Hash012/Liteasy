import type { ArtifactTask, ArtifactTab, ArtifactType } from "./artifact.types";

export function createArtifactStore() {
  const tasks = new Map<string, ArtifactTask>();
  const tabs: ArtifactTab[] = [
    { id: "reader-default", title: "Reader" },
  ];
  let sequence = 0;

  return {
    createTask(type: ArtifactType): string {
      sequence += 1;
      const id = `artifact-task-${sequence}`;
      tasks.set(id, { id, type, status: "queued" });
      return id;
    },

    markRunning(id: string) {
      const task = tasks.get(id);
      if (task) task.status = "running";
    },

    completeTask(id: string, payload: { artifactId: string; title: string; content: string }) {
      const task = tasks.get(id);
      if (!task) return;
      task.status = "completed";
      task.title = payload.title;
      tabs.push({
        id: payload.artifactId,
        title: payload.title,
        artifactId: payload.artifactId,
        artifactType: task.type,
        content: payload.content,
      });
    },

    markFailed(id: string) {
      const task = tasks.get(id);
      if (task) task.status = "failed";
    },

    setReaderContent(paperId: string, title: string, content: string) {
      const existing = tabs.find((t) => t.paperId === paperId);
      if (existing) {
        existing.content = content;
        existing.title = title;
      } else {
        const readerTab = tabs.find((t) => t.id === "reader-default");
        if (readerTab) {
          readerTab.content = content;
          readerTab.title = title;
          readerTab.paperId = paperId;
          readerTab.artifactType = "reader";
        }
      }
    },

    getTask(id: string): ArtifactTask | undefined {
      return tasks.get(id);
    },

    getOpenTabs(): ArtifactTab[] {
      return tabs;
    },

    getActiveTabId(): string {
      return tabs[tabs.length - 1]?.id ?? "reader-default";
    },
  };
}

export function mockMindmapContent(title: string): string {
  return `思维导图：${title}

├── 研究背景
│   ├── 问题动机
│   ├── 相关工作
│   └── 研究空白
├── 核心方法
│   ├── 模型架构
│   ├── 训练策略
│   └── 创新点
├── 实验设计
│   ├── 数据集
│   ├── 对比基线
│   └── 评估指标
└── 结论与展望
    ├── 主要发现
    ├── 局限性
    └── 未来方向`;
}
