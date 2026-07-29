import {
  buildAgentRuntimeContextView,
  formatAgentRuntimeContextSummary
} from "../app/features/agent-runtime/contextView";

test("builds a ready runtime context summary", () => {
  const context = buildAgentRuntimeContextView({
    importedCount: 2,
    organizationName: "Liteasy AI Reading Lab",
    profilePersonalizationSummary: "研究阶段：博士研究生",
    profileUnlocked: true,
    selectedCount: 2,
    selectionLocked: true,
    workspace: { rootPath: "/tmp/LiteasyLibrary", type: "local_library" }
  });

  expect(context).toEqual({
    cloud: { connected: true, organizationName: "Liteasy AI Reading Lab" },
    profile: { personalizationSummary: "研究阶段：博士研究生" },
    recommendations: { items: [], totalCount: 0 },
    selection: { importedCount: 2, issues: [], locked: true, ready: true, selectedCount: 2 },
    workspace: { rootPath: "/tmp/LiteasyLibrary", type: "local_library" }
  });
  expect(formatAgentRuntimeContextSummary(context)).toBe(
    "上下文 · 选中 2 篇 · 已锁定 · 已导入 2/2 · 云账号已连接 · 学术档案已应用"
  );
});

test("marks empty, unlocked, and partially imported selections as not ready", () => {
  const context = buildAgentRuntimeContextView({
    importedCount: 1,
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
  expect(formatAgentRuntimeContextSummary(context)).toBe(
    "上下文 · 选中 3 篇 · 未锁定 · 已导入 1/3 · 云账号未连接 · 学术档案待补充"
  );
});

test("includes academic archive details and recommendations without a profile toggle", () => {
  const context = buildAgentRuntimeContextView({
    academicProfile: {
      age: "未设置",
      disciplines: [],
      gender: "未设置",
      preferredLanguages: "中文、English",
      researchDatasets: "BEIR",
      researchMethods: "混合检索",
      researchTopics: "神经信息检索",
      stage: "博士"
    },
    importedCount: 1,
    profileUnlocked: true,
    recommendations: [{ reason: "主题匹配", relevanceScore: 0.91, title: "Candidate paper" }],
    selectedCount: 1,
    selectionLocked: true
  });

  expect(context.profile.academic?.researchTopics).toBe("神经信息检索");
  expect(context.profile).not.toHaveProperty("enabled");
  expect(context.recommendations.totalCount).toBe(1);
  expect(formatAgentRuntimeContextSummary(context)).toContain("学术档案已应用");
});

test("marks no selected papers and unknown workspace as issues", () => {
  const context = buildAgentRuntimeContextView({
    importedCount: 0,
    profileUnlocked: false,
    selectedCount: 0,
    selectionLocked: false
  });

  expect(context.selection.issues).toEqual(["selection_empty", "selection_unlocked"]);
  expect(context.selection.ready).toBe(false);
  expect(context.workspace).toEqual({ type: "unknown" });
});
