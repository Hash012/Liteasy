import type { HelpContentProvider } from "./help.types";

// The initial shell intentionally supplies categories only. Manuals can be added
// by replacing this provider or contributing another namespaced provider.
export const builtinHelpProviders: readonly HelpContentProvider[] = [
  {
    id: "liteasy",
    title: "用户手册",
    async listTopics() {
      return [
        { id: "getting-started", title: "开始使用", order: 0 },
        { id: "reading", title: "文献与阅读", order: 1 },
        { id: "boards", title: "研究白板", order: 2 },
        { id: "agent", title: "Agent", order: 3 },
        { id: "preferences", title: "设置与快捷键", order: 4 },
      ];
    },
    async search() {
      return [];
    },
    async read() {
      return null;
    },
  },
];
