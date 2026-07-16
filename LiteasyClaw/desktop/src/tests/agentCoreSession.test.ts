import { createAgentCoreSession } from "../app/features/agent-core/agentCoreSession";

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
  expect(prepared.turn.runtimeContext.prompt.budgetSummary).toContain("最大迭代：12");
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

