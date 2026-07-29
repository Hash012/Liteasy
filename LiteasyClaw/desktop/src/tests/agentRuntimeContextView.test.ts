import {
  buildAgentRuntimeContextView,
  formatAgentRuntimeContextSummary
} from "../app/features/agent-runtime/contextView";

test("builds a ready runtime context summary", () => {
  const context = buildAgentRuntimeContextView({
    importedCount: 2,
    organizationName: "Liteasy AI Reading Lab",
    profileEnabled: true,
    profilePersonalizationSummary: "研究阶段：博士研究生",
    profileUnlocked: true,
    selectedCount: 2,
    selectionLocked: true,
    workspace: {
      rootPath: "/tmp/LiteasyLibrary",
      type: "local_library"
    }
  });

  expect(context).toEqual({
    cloud: {
      connected: true,
      organizationName: "Liteasy AI Reading Lab"
    },
    profile: {
      enabled: true,
      personalizationSummary: "研究阶段：博士研究生",
      requiresConfirmation: true
    },
    selection: {
      importedCount: 2,
      issues: [],
      locked: true,
      ready: true,
      selectedCount: 2
    },
    workspace: {
      rootPath: "/tmp/LiteasyLibrary",
      type: "local_library"
    }
  });
  expect(formatAgentRuntimeContextSummary(context)).toBe(
    "上下文 · 选中 2 篇 · 已锁定 · 已导入 2/2 · 云账号已连接 · 画像开启（学术档案与个性化已应用）"
  );
});

test("marks empty, unlocked, and partially imported selections as not ready", () => {
  const context = buildAgentRuntimeContextView({
    importedCount: 1,
    profileEnabled: false,
    profileUnlocked: false,
    selectedCount: 3,
    selectionLocked: false
  });

  expect(context.selection).toEqual({
    importedCount: 1,
    issues: ["selection_unlocked", "documents_not_imported"],
    locked: false,
    ready: false,
    selectedCount: 3
  });
  expect(context.workspace).toEqual({
    type: "unknown"
  });
  expect(context.cloud).toEqual({
    connected: false
  });
  expect(formatAgentRuntimeContextSummary(context)).toBe(
    "上下文 · 选中 3 篇 · 未锁定 · 已导入 1/3 · 云账号未连接 · 画像关闭"
  );
});

test("includes academic profile details when profile sampling is enabled", () => {
  const context = buildAgentRuntimeContextView({
    academicProfile: {
      age: "27",
      disciplines: [],
      gender: "女",
      preferredLanguages: "中文、English",
      researchDatasets: "BEIR",
      researchMethods: "混合检索",
      researchTopics: "神经信息检索",
      stage: "博士"
    },
    importedCount: 1,
    profileEnabled: true,
    profileUnlocked: true,
    selectedCount: 1,
    selectionLocked: true
  });

  expect(context.profile).toEqual({
    academic: {
      age: "27",
      disciplines: [],
      gender: "女",
      preferredLanguages: "中文、English",
      researchDatasets: "BEIR",
      researchMethods: "混合检索",
      researchTopics: "神经信息检索",
      stage: "博士"
    },
    enabled: true,
    requiresConfirmation: true
  });
  expect(formatAgentRuntimeContextSummary(context)).toBe(
    "上下文 · 选中 1 篇 · 已锁定 · 已导入 1/1 · 云账号已连接 · 画像开启（女/27/博士/主题:神经信息检索）"
  );
});

test("marks no selected papers and unknown workspace as issues", () => {
  const context = buildAgentRuntimeContextView({
    importedCount: 0,
    profileEnabled: false,
    profileUnlocked: false,
    selectedCount: 0,
    selectionLocked: false
  });

  expect(context.selection.issues).toEqual(["selection_empty", "selection_unlocked"]);
  expect(context.selection.ready).toBe(false);
  expect(context.workspace).toEqual({
    type: "unknown"
  });
});
