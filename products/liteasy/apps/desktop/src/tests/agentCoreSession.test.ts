import { createAgentCoreSession } from "../app/features/agent-core/agentCoreSession";
import { defaultAgentCoreConfig, getAgentCoreSkills } from "../app/features/agent-core/agentCoreConfig";
import { registerBuiltinSkill } from "../app/features/skills/builtinSkillRegistry";
import { registerVisualizationRenderer } from "../app/features/visualization/visualizationRendererRegistry";

test("prepares a turn with agent.md, memory, capabilities, and budget context", () => {
  const session = createAgentCoreSession();
  const prepared = session.prepareTurn({
    message: "帮我实现 Agent 核心",
    mode: "command"
  });

  expect(prepared.ok).toBe(true);
  if (!prepared.ok) {
    throw new Error("expected prepared turn");
  }

  expect(prepared.turn.runtimeContext.prompt.agentMd).toContain("Liteasy 学术工作台 Agent");
  expect(prepared.turn.runtimeContext.prompt.memorySummary).toContain("当前项目需要补齐 Agent 核心");
  expect(prepared.turn.runtimeContext.prompt.capabilitySummary).toContain("artifact.generate");
  expect(prepared.turn.runtimeContext.prompt.budgetSummary).toContain("最大迭代：64");
});

test("replaces caller-provided visualization catalog entries with the verified local chain", () => {
  const skills = getAgentCoreSkills({
    ...defaultAgentCoreConfig,
    skills: [
      ...defaultAgentCoreConfig.skills,
      {
        description: "stale",
        id: "thin-reading-visualize",
        label: "stale",
        risk: "low",
        status: "active"
      }
    ]
  });
  expect(skills.filter((skill) => skill.id === "thin-reading-visualize")).toEqual([expect.objectContaining({
    description: expect.stringContaining("证据"),
    label: "文献可视化",
    status: "active"
  })]);
  expect(skills.some((skill) => skill.label === "stale")).toBe(false);
});

test("summarizes evidence-bound thin-reading visualization only when a complete chain is available", () => {
  registerBuiltinSkill({
    costClass: "low",
    evidenceRequirements: ["source_figure"],
    fallbackModalities: [],
    id: "test-thin-reading-visualize",
    integrityRules: [],
    modality: "semantic_graph",
    outputSchemaId: "test",
    remote: false,
    rendererId: "test-thin-reading-renderer",
    runtimeVersion: "liteasy.visualization-runtime/v1",
    styleLock: [],
    validatorIds: ["artifact-schema"],
    version: "1"
  }, async () => ({
    instructions: "test",
    manifest: {
      costClass: "low",
      evidenceRequirements: ["source_figure"],
      fallbackModalities: [],
      id: "test-thin-reading-visualize",
      integrityRules: [],
      modality: "semantic_graph",
      outputSchemaId: "test",
      remote: false,
      rendererId: "test-thin-reading-renderer",
      runtimeVersion: "liteasy.visualization-runtime/v1",
      styleLock: [],
      validatorIds: ["artifact-schema"],
      version: "1"
    }
  }));
  registerVisualizationRenderer({
    id: "test-thin-reading-renderer",
    load: async () => ({ id: "test-thin-reading-renderer", modality: "semantic_graph", version: "1" }),
    modality: "semantic_graph",
    version: "1"
  });

  const prepared = createAgentCoreSession().prepareTurn({ message: "画图", mode: "qa" });
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) throw new Error("expected prepared turn");
  expect(prepared.turn.runtimeContext.prompt.capabilitySummary).toContain("thin-reading-visualize");
  expect(prepared.turn.runtimeContext.prompt.capabilitySummary).toContain("证据");
  expect(prepared.turn.runtimeContext.prompt.capabilitySummary).not.toContain("renderer");
});

test("injects enabled academic profile details into the core prompt context", () => {
  const session = createAgentCoreSession();
  const prepared = session.prepareTurn({
    message: "解释这篇论文时适配我的背景",
    mode: "qa",
    runtimeContext: {
      cloud: { connected: true },
      profile: {
        academic: {
          age: "27",
          gender: "女",
          stage: "博士"
        },
        enabled: true,
        requiresConfirmation: true
      },
      selection: {
        importedCount: 1,
        issues: [],
        locked: true,
        ready: true,
        selectedCount: 1
      },
      workspace: { type: "local_library" }
    }
  });

  expect(prepared.ok).toBe(true);
  if (!prepared.ok) {
    throw new Error("expected prepared turn");
  }
  expect(prepared.turn.runtimeContext.prompt.runtimeSummary).toContain(
    "画像：开启（性别 女，年龄 27，学段 博士）"
  );
});

test("reads edited memories and recent user state for each new turn", () => {
  let memories = [{
    id: "user-focus",
    importance: "高" as const,
    namespace: "local-user",
    summary: "优先用清晰的中文解释生物信息学论文。",
    type: "偏好" as const
  }];
  let recentState = "用户正在比较两篇基因组学论文，并已锁定文献集。";
  const session = createAgentCoreSession(undefined, {
    getMemories: () => memories,
    getUserStateSummary: () => recentState
  });

  const first = session.prepareTurn({ message: "帮我解释生物信息学论文", mode: "qa" });
  expect(first.ok).toBe(true);
  if (!first.ok) throw new Error("expected prepared turn");
  expect(first.turn.runtimeContext.prompt.memorySummary).toContain("生物信息学论文");
  expect(first.turn.runtimeContext.promptText).toContain("用户正在比较两篇基因组学论文");

  memories = [{
    id: "user-focus",
    importance: "高",
    namespace: "local-user",
    summary: "优先用英文给出可复现实验步骤。",
    type: "偏好"
  }];
  recentState = "用户已切换到实验复现任务。";
  const second = session.prepareTurn({ message: "给我实验步骤", mode: "qa" });
  expect(second.ok).toBe(true);
  if (!second.ok) throw new Error("expected prepared turn");
  expect(second.turn.runtimeContext.prompt.memorySummary).toContain("可复现实验步骤");
  expect(second.turn.runtimeContext.promptText).toContain("用户已切换到实验复现任务");
});

test("blocks the same failed request after two failed observations", () => {
  const session = createAgentCoreSession();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prepared = session.prepareTurn({
      message: "执行一个不存在的动作",
      mode: "command"
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      throw new Error("expected prepared turn");
    }

    session.observeRuntimeTurn({
      events: [
        {
          message: "动作不存在。",
          recovery: "请换一种方式。",
          type: "runtime_error"
        }
      ],
      turn: prepared.turn
    });
  }

  const blocked = session.prepareTurn({
    message: "执行一个不存在的动作",
    mode: "command"
  });

  expect(blocked).toEqual({
    events: [
      {
        message: "这个请求已经连续失败两次，Agent 不会继续用同一种方式重试。",
        recovery: "请换一种表述、补充上下文，或先手动完成缺失的前置条件。",
        type: "runtime_error"
      }
    ],
    ok: false
  });
});
