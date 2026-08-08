# LiteasyClaw Command Semantic Action Runtime V2 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace command mode's fixed phrase router with a semantic action-plan foundation while preserving current Phase A-C behavior.

**Architecture:** Add plan types and a deterministic semantic planner inside `agent-runtime`, then make `runtimeOrchestrator` execute plan-backed actions through the existing safe boundaries. This slice introduces structured plans, capability-family action ids, plan preview events, better clarification/unsupported responses, and tests for artifact/layout/theme semantics without yet applying arbitrary generated UI styling.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, existing LiteasyClaw desktop runtime/action modules.

---

## Scope

This is the first implementation slice for `docs/superpowers/specs/2026-07-02-liteasyclaw-command-semantic-action-runtime-design.md`.

In scope:

- Semantic action plan types.
- Deterministic planner interface.
- Backward-compatible mapping for existing command behavior.
- Plan preview runtime events.
- Semantic planning for registered artifact types: `mindmap`, `tree`, `ppt`.
- Unsupported-but-understood modality response for unregistered artifacts such as `comparison_table`.
- Semantic layout/theme/panel action plans as registered low-risk capability families.
- Clarification for unknown/ambiguous command input.
- Risk-aware confirmation metadata in plans.
- Focused tests and full desktop verification.

Out of scope for this slice:

- Model-backed planning.
- Persisted theme system.
- Real arbitrary UI restyling.
- New rendered artifact modalities beyond existing `ArtifactType`.
- Destructive workspace/file operations.
- Full confirmation-card accept/cancel UI.

## File Responsibilities

- `products/liteasy/apps/desktop/src/app/features/agent-runtime/agentRuntime.types.ts`: add semantic action plan, runtime action invocation, risk, confidence, and plan preview event types.
- `products/liteasy/apps/desktop/src/app/features/agent-runtime/semanticPlanner.ts`: deterministic planner that maps natural-language command mode input to `SemanticActionPlan`.
- `products/liteasy/apps/desktop/src/app/features/agent-runtime/planExecutor.ts`: converts semantic plans to existing runtime events and executable action calls.
- `products/liteasy/apps/desktop/src/app/features/agent-runtime/runtimeOrchestrator.ts`: call planner and executor instead of directly using phrase router for command mode.
- `products/liteasy/apps/desktop/src/app/features/agent-runtime/intentRouter.ts`: keep as compatibility helper only if still needed by tests, or reduce to wrapper over planner.
- `products/liteasy/apps/desktop/src/app/features/skills/actionRegistry.ts`: leave unchanged in this foundation slice; layout/theme/panel semantics are represented as `action_request` events first, then wired to concrete AppShell actions in the next implementation slice.
- `products/liteasy/apps/desktop/src/app/features/assistant/AssistantPane.tsx`: render plan preview runtime events as concise assistant messages.
- `products/liteasy/apps/desktop/src/tests/agentRuntimeSemanticPlanner.test.ts`: planner behavior tests.
- `products/liteasy/apps/desktop/src/tests/agentRuntimePlanExecutor.test.ts`: plan execution and policy tests.
- `products/liteasy/apps/desktop/src/tests/agentRuntimeOrchestrator.test.ts`: update command-mode integration coverage.
- `products/liteasy/apps/desktop/src/tests/AssistantPane.test.tsx`: verify user-visible command mode feedback remains coherent.

## Task 1: Add Semantic Plan Types

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/agent-runtime/agentRuntime.types.ts`
- Test: `products/liteasy/apps/desktop/src/tests/agentRuntimeSemanticPlanner.test.ts`

- [ ] **Step 1: Write the failing type-driven planner test**

Create `products/liteasy/apps/desktop/src/tests/agentRuntimeSemanticPlanner.test.ts`:

```ts
import { planSemanticCommand } from "../app/features/agent-runtime/semanticPlanner";

test("plans a semantic mind map artifact command", () => {
  const plan = planSemanticCommand({
    message: "用思维导图解释当前选中文献集",
    mode: "command"
  });

  expect(plan).toMatchObject({
    actions: [
      {
        actionId: "artifact.generate",
        input: {
          artifactType: "mindmap",
          source: "selected_document_set"
        }
      }
    ],
    confidence: "high",
    intentId: "artifact.generate",
    requiresConfirmation: false,
    riskLevel: "low",
    summary: "生成思维导图"
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimeSemanticPlanner.test.ts
```

Expected: FAIL because `semanticPlanner` does not exist.

- [ ] **Step 3: Add semantic plan types**

In `products/liteasy/apps/desktop/src/app/features/agent-runtime/agentRuntime.types.ts`, add:

```ts
export type RuntimeRiskLevel = "low" | "medium" | "high";

export type RuntimePlanConfidence = "high" | "medium" | "low";

export type RuntimeActionInvocation =
  | {
      actionId: "artifact.generate";
      input: {
        artifactType: ArtifactType;
        source: "selected_document_set";
      };
    }
  | {
      actionId: "layout.split_two" | "layout.reset";
      input: {
        preset?: "two_column" | "reading" | "focus";
      };
    }
  | {
      actionId: "theme.apply_preset" | "theme.reset";
      input: {
        preset?: "playful" | "default";
        tone?: "cartoon" | "quiet";
      };
    }
  | {
      actionId: "panel.open" | "panel.close" | "panel.toggle";
      input: {
        panel: "left" | "right" | "bottom" | "settings" | "library";
      };
    }
  | {
      actionId: "settings.update";
      input: {
        target: SettingsStateKey;
        value: boolean | string;
      };
    }
  | {
      actionId: "organization.open_shared_library";
      input: {
        source: "organization_space";
      };
    };

export type SemanticActionPlan = {
  actions: RuntimeActionInvocation[];
  clarification?: {
    missing: string[];
    question: string;
  };
  confidence: RuntimePlanConfidence;
  intentId:
    | "artifact.generate"
    | "layout.change"
    | "theme.apply"
    | "panel.change"
    | "settings.update"
    | "organization.open_shared_library"
    | "unknown";
  planId: string;
  requiresConfirmation: boolean;
  requiredContext: string[];
  riskLevel: RuntimeRiskLevel;
  summary: string;
  unsupportedReason?: string;
};
```

If `SettingsStateKey` does not exist, add this alias near settings imports:

```ts
export type SettingsStateKey = keyof SettingsState;
```

- [ ] **Step 4: Add `plan_preview` runtime event**

Extend `AgentRuntimeEvent`:

```ts
  | { plan: SemanticActionPlan; type: "plan_preview" }
```

- [ ] **Step 5: Add minimal planner file**

Create `products/liteasy/apps/desktop/src/app/features/agent-runtime/semanticPlanner.ts`:

```ts
import type { AgentRuntimeInput, SemanticActionPlan } from "./agentRuntime.types";

function createPlanId(input: string) {
  return `plan-${input.length}-${input.charCodeAt(0) || 0}`;
}

export function planSemanticCommand(input: AgentRuntimeInput): SemanticActionPlan {
  const normalized = input.message.trim();

  return {
    actions: [
      {
        actionId: "artifact.generate",
        input: {
          artifactType: "mindmap",
          source: "selected_document_set"
        }
      }
    ],
    confidence: "high",
    intentId: "artifact.generate",
    planId: createPlanId(normalized),
    requiredContext: ["selected_document_set"],
    requiresConfirmation: false,
    riskLevel: "low",
    summary: "生成思维导图"
  };
}
```

- [ ] **Step 6: Run the planner test to verify it passes**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimeSemanticPlanner.test.ts
```

Expected: PASS for 1 test.

- [ ] **Step 7: Commit**

If git commits are allowed in the current execution session:

```bash
git add products/liteasy/apps/desktop/src/app/features/agent-runtime/agentRuntime.types.ts products/liteasy/apps/desktop/src/app/features/agent-runtime/semanticPlanner.ts products/liteasy/apps/desktop/src/tests/agentRuntimeSemanticPlanner.test.ts
git commit -m "feat: add semantic action plan types"
```

If the user has asked not to use git, skip this step and record the skipped commit in the final implementation summary.

## Task 2: Implement Deterministic Semantic Planner Coverage

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/agent-runtime/semanticPlanner.ts`
- Test: `products/liteasy/apps/desktop/src/tests/agentRuntimeSemanticPlanner.test.ts`

- [ ] **Step 1: Extend planner tests for command families**

Append to `agentRuntimeSemanticPlanner.test.ts`:

```ts
test("plans registered artifact modalities from semantic language", () => {
  expect(planSemanticCommand({ message: "生成树状图", mode: "command" }).actions[0]).toEqual({
    actionId: "artifact.generate",
    input: {
      artifactType: "tree",
      source: "selected_document_set"
    }
  });

  expect(planSemanticCommand({ message: "做一份 PPT", mode: "command" }).actions[0]).toEqual({
    actionId: "artifact.generate",
    input: {
      artifactType: "ppt",
      source: "selected_document_set"
    }
  });
});

test("returns unsupported details for understood but unavailable artifact modality", () => {
  const plan = planSemanticCommand({
    message: "把当前论文生成对比表",
    mode: "command"
  });

  expect(plan).toMatchObject({
    actions: [],
    confidence: "high",
    intentId: "artifact.generate",
    unsupportedReason: "comparison_table artifact is not registered",
    summary: "当前还不能生成对比表，可用模态：思维导图、树状图、PPT"
  });
});

test("plans layout and theme actions from semantic UI instructions", () => {
  expect(planSemanticCommand({ message: "把窗口切分成两个", mode: "command" })).toMatchObject({
    actions: [
      {
        actionId: "layout.split_two",
        input: {
          preset: "two_column"
        }
      }
    ],
    intentId: "layout.change",
    riskLevel: "low",
    summary: "切换为双栏布局"
  });

  expect(planSemanticCommand({ message: "让 UI 变成卡通风格", mode: "command" })).toMatchObject({
    actions: [
      {
        actionId: "theme.apply_preset",
        input: {
          preset: "playful",
          tone: "cartoon"
        }
      }
    ],
    intentId: "theme.apply",
    riskLevel: "low",
    summary: "应用卡通风格"
  });
});

test("returns clarification for unknown ambiguous command text", () => {
  const plan = planSemanticCommand({
    message: "ABC",
    mode: "command"
  });

  expect(plan).toMatchObject({
    actions: [],
    clarification: {
      missing: ["intent"],
      question: "我还不能确定你想让我对 ABC 做什么。你可以说要打开、生成、切换、调整或分析什么。"
    },
    confidence: "low",
    intentId: "unknown"
  });
});
```

- [ ] **Step 2: Run planner tests to verify they fail**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimeSemanticPlanner.test.ts
```

Expected: FAIL for tree, ppt, comparison table, layout, theme, and unknown handling.

- [ ] **Step 3: Replace planner implementation**

Replace `semanticPlanner.ts` with:

```ts
import type { AgentRuntimeInput, SemanticActionPlan } from "./agentRuntime.types";

function createPlanId(input: string) {
  return `plan-${input.length}-${input.charCodeAt(0) || 0}`;
}

function includesAny(input: string, phrases: string[]) {
  return phrases.some((phrase) => input.includes(phrase));
}

function createBasePlan(input: string): Omit<SemanticActionPlan, "actions" | "intentId" | "summary"> {
  return {
    confidence: "high",
    planId: createPlanId(input),
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low"
  };
}

export function planSemanticCommand(input: AgentRuntimeInput): SemanticActionPlan {
  const normalized = input.message.trim();
  const base = createBasePlan(normalized);

  if (input.mode !== "command") {
    return {
      ...base,
      actions: [],
      clarification: {
        missing: ["command_mode"],
        question: "当前模式不执行软件动作，请切换到命令模式。"
      },
      confidence: "low",
      intentId: "unknown",
      summary: "当前模式不执行软件动作"
    };
  }

  if (includesAny(normalized, ["对比表", "对比矩阵", "comparison table"])) {
    return {
      ...base,
      actions: [],
      intentId: "artifact.generate",
      summary: "当前还不能生成对比表，可用模态：思维导图、树状图、PPT",
      unsupportedReason: "comparison_table artifact is not registered"
    };
  }

  if (includesAny(normalized, ["树状图", "树图", "tree"])) {
    return {
      ...base,
      actions: [
        {
          actionId: "artifact.generate",
          input: {
            artifactType: "tree",
            source: "selected_document_set"
          }
        }
      ],
      intentId: "artifact.generate",
      requiredContext: ["selected_document_set"],
      summary: "生成树状图"
    };
  }

  if (includesAny(normalized, ["PPT", "ppt", "演示文稿", "幻灯片"])) {
    return {
      ...base,
      actions: [
        {
          actionId: "artifact.generate",
          input: {
            artifactType: "ppt",
            source: "selected_document_set"
          }
        }
      ],
      intentId: "artifact.generate",
      requiredContext: ["selected_document_set"],
      summary: "生成 PPT"
    };
  }

  if (includesAny(normalized, ["思维导图", "mindmap", "脑图"])) {
    return {
      ...base,
      actions: [
        {
          actionId: "artifact.generate",
          input: {
            artifactType: "mindmap",
            source: "selected_document_set"
          }
        }
      ],
      intentId: "artifact.generate",
      requiredContext: ["selected_document_set"],
      summary: "生成思维导图"
    };
  }

  if (includesAny(normalized, ["窗口切分成两个", "切成两个", "双栏", "两栏"])) {
    return {
      ...base,
      actions: [
        {
          actionId: "layout.split_two",
          input: {
            preset: "two_column"
          }
        }
      ],
      intentId: "layout.change",
      summary: "切换为双栏布局"
    };
  }

  if (includesAny(normalized, ["卡通风格", "卡通 UI", "cartoon"])) {
    return {
      ...base,
      actions: [
        {
          actionId: "theme.apply_preset",
          input: {
            preset: "playful",
            tone: "cartoon"
          }
        }
      ],
      intentId: "theme.apply",
      summary: "应用卡通风格"
    };
  }

  return {
    ...base,
    actions: [],
    clarification: {
      missing: ["intent"],
      question: `我还不能确定你想让我对 ${normalized} 做什么。你可以说要打开、生成、切换、调整或分析什么。`
    },
    confidence: "low",
    intentId: "unknown",
    summary: "需要澄清命令意图"
  };
}
```

- [ ] **Step 4: Run planner tests to verify they pass**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimeSemanticPlanner.test.ts
```

Expected: PASS for all planner tests.

- [ ] **Step 5: Commit**

If git commits are allowed:

```bash
git add products/liteasy/apps/desktop/src/app/features/agent-runtime/semanticPlanner.ts products/liteasy/apps/desktop/src/tests/agentRuntimeSemanticPlanner.test.ts
git commit -m "feat: plan semantic command actions"
```

## Task 3: Execute Semantic Plans Through Runtime Events

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/agent-runtime/planExecutor.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/agent-runtime/runtimeOrchestrator.ts`
- Test: `products/liteasy/apps/desktop/src/tests/agentRuntimePlanExecutor.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/agentRuntimeOrchestrator.test.ts`

- [ ] **Step 1: Write failing plan executor tests**

Create `products/liteasy/apps/desktop/src/tests/agentRuntimePlanExecutor.test.ts`:

```ts
import { executeSemanticPlan } from "../app/features/agent-runtime/planExecutor";
import type { SemanticActionPlan } from "../app/features/agent-runtime/agentRuntime.types";

function createPlan(overrides: Partial<SemanticActionPlan> = {}): SemanticActionPlan {
  return {
    actions: [],
    confidence: "high",
    intentId: "unknown",
    planId: "plan-test",
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low",
    summary: "测试计划",
    ...overrides
  };
}

test("emits a plan preview before low-risk layout actions", async () => {
  const result = await executeSemanticPlan(
    createPlan({
      actions: [
        {
          actionId: "layout.split_two",
          input: {
            preset: "two_column"
          }
        }
      ],
      intentId: "layout.change",
      summary: "切换为双栏布局"
    }),
    {}
  );

  expect(result).toEqual({
    events: [
      {
        plan: expect.objectContaining({
          intentId: "layout.change",
          summary: "切换为双栏布局"
        }),
        type: "plan_preview"
      },
      {
        action: {
          actionId: "layout.split_two",
          payload: {
            preset: "two_column"
          }
        },
        type: "action_request"
      },
      {
        message: "已准备执行：切换为双栏布局",
        type: "assistant_reply"
      }
    ],
    settingsChanged: false
  });
});

test("returns clarification events from ambiguous plans", async () => {
  const result = await executeSemanticPlan(
    createPlan({
      clarification: {
        missing: ["intent"],
        question: "我还不能确定你想让我对 ABC 做什么。你可以说要打开、生成、切换、调整或分析什么。"
      },
      confidence: "low",
      summary: "需要澄清命令意图"
    }),
    {}
  );

  expect(result.events).toEqual([
    {
      missing: ["intent"],
      question: "我还不能确定你想让我对 ABC 做什么。你可以说要打开、生成、切换、调整或分析什么。",
      type: "clarification_request"
    }
  ]);
});

test("returns unsupported explanations for understood missing capabilities", async () => {
  const result = await executeSemanticPlan(
    createPlan({
      intentId: "artifact.generate",
      summary: "当前还不能生成对比表，可用模态：思维导图、树状图、PPT",
      unsupportedReason: "comparison_table artifact is not registered"
    }),
    {}
  );

  expect(result.events).toEqual([
    {
      message: "当前还不能生成对比表，可用模态：思维导图、树状图、PPT",
      recovery: "comparison_table artifact is not registered",
      type: "runtime_error"
    }
  ]);
});
```

- [ ] **Step 2: Run plan executor tests to verify they fail**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimePlanExecutor.test.ts
```

Expected: FAIL because `planExecutor` does not exist.

- [ ] **Step 3: Add plan executor implementation**

Create `products/liteasy/apps/desktop/src/app/features/agent-runtime/planExecutor.ts`:

```ts
import type {
  AgentRuntimeExecutionContext,
  AgentRuntimeEvent,
  RuntimeExecutionResult,
  SemanticActionPlan
} from "./agentRuntime.types";

function createActionEvent(action: SemanticActionPlan["actions"][number]): AgentRuntimeEvent {
  return {
    action: {
      actionId: action.actionId,
      payload: action.input
    },
    type: "action_request"
  };
}

export async function executeSemanticPlan(
  plan: SemanticActionPlan,
  _context: AgentRuntimeExecutionContext
): Promise<RuntimeExecutionResult> {
  if (plan.clarification) {
    return {
      events: [
        {
          missing: plan.clarification.missing,
          question: plan.clarification.question,
          type: "clarification_request"
        }
      ],
      settingsChanged: false
    };
  }

  if (plan.unsupportedReason) {
    return {
      events: [
        {
          message: plan.summary,
          recovery: plan.unsupportedReason,
          type: "runtime_error"
        }
      ],
      settingsChanged: false
    };
  }

  const events: AgentRuntimeEvent[] = [
    {
      plan,
      type: "plan_preview"
    },
    ...plan.actions.map(createActionEvent),
    {
      message: `已准备执行：${plan.summary}`,
      type: "assistant_reply"
    }
  ];

  return {
    events,
    settingsChanged: false
  };
}
```

- [ ] **Step 4: Run plan executor tests to verify they pass**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimePlanExecutor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Extend orchestrator tests for semantic plan events**

Append to `products/liteasy/apps/desktop/src/tests/agentRuntimeOrchestrator.test.ts`:

```ts
test("routes semantic layout instructions through command runtime plans", async () => {
  await expect(
    runAgentRuntime(
      {
        message: "把窗口切分成两个",
        mode: "command"
      },
      {}
    )
  ).resolves.toEqual({
    events: [
      {
        plan: expect.objectContaining({
          intentId: "layout.change",
          summary: "切换为双栏布局"
        }),
        type: "plan_preview"
      },
      {
        action: {
          actionId: "layout.split_two",
          payload: {
            preset: "two_column"
          }
        },
        type: "action_request"
      },
      {
        message: "已准备执行：切换为双栏布局",
        type: "assistant_reply"
      }
    ],
    settingsChanged: false
  });
});

test("asks for clarification instead of returning a generic registry error for unknown commands", async () => {
  await expect(
    runAgentRuntime(
      {
        message: "ABC",
        mode: "command"
      },
      {}
    )
  ).resolves.toEqual({
    events: [
      {
        missing: ["intent"],
        question: "我还不能确定你想让我对 ABC 做什么。你可以说要打开、生成、切换、调整或分析什么。",
        type: "clarification_request"
      }
    ],
    settingsChanged: false
  });
});
```

- [ ] **Step 6: Update `runtimeOrchestrator` to use planner for new semantic families**

Modify `runtimeOrchestrator.ts`:

```ts
import { executeSemanticPlan } from "./planExecutor";
import { planSemanticCommand } from "./semanticPlanner";
```

At the start of `runAgentRuntime`, after command-mode check and before legacy routing:

```ts
  if (input.mode === "command") {
    const semanticPlan = planSemanticCommand(input);
    if (
      semanticPlan.intentId === "layout.change" ||
      semanticPlan.intentId === "theme.apply" ||
      semanticPlan.intentId === "panel.change" ||
      semanticPlan.intentId === "unknown" ||
      semanticPlan.unsupportedReason
    ) {
      return executeSemanticPlan(semanticPlan, context);
    }
  }
```

Keep existing artifact/settings/profile/organization paths working until Task 4 migrates them.

- [ ] **Step 7: Run orchestrator tests**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimeOrchestrator.test.ts src/tests/agentRuntimePlanExecutor.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

If git commits are allowed:

```bash
git add products/liteasy/apps/desktop/src/app/features/agent-runtime/planExecutor.ts products/liteasy/apps/desktop/src/app/features/agent-runtime/runtimeOrchestrator.ts products/liteasy/apps/desktop/src/tests/agentRuntimePlanExecutor.test.ts products/liteasy/apps/desktop/src/tests/agentRuntimeOrchestrator.test.ts
git commit -m "feat: execute semantic command plans"
```

## Task 4: Preserve Current Commands Through Planner-Compatible Paths

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/agent-runtime/semanticPlanner.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/agent-runtime/runtimeOrchestrator.ts`
- Modify: `products/liteasy/apps/desktop/src/tests/agentRuntimeSemanticPlanner.test.ts`
- Modify: `products/liteasy/apps/desktop/src/tests/agentRuntimeOrchestrator.test.ts`

- [ ] **Step 1: Add regression tests for existing command behavior**

Append to `agentRuntimeSemanticPlanner.test.ts`:

```ts
test("plans existing settings and organization commands as semantic plans", () => {
  expect(planSemanticCommand({ message: "关闭联网推荐", mode: "command" })).toMatchObject({
    actions: [
      {
        actionId: "settings.update",
        input: {
          target: "network.recommendation.enabled",
          value: false
        }
      }
    ],
    intentId: "settings.update",
    summary: "关闭联网推荐"
  });

  expect(planSemanticCommand({ message: "打开组织共享文献库", mode: "command" })).toMatchObject({
    actions: [
      {
        actionId: "organization.open_shared_library",
        input: {
          source: "organization_space"
        }
      }
    ],
    intentId: "organization.open_shared_library",
    summary: "打开组织共享文献库"
  });
});
```

- [ ] **Step 2: Run planner tests to verify they fail**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimeSemanticPlanner.test.ts
```

Expected: FAIL because settings and organization commands still plan as unknown.

- [ ] **Step 3: Add semantic planner branches for existing commands**

In `semanticPlanner.ts`, add helper predicates equivalent to the legacy router:

```ts
function isRecommendationDisableCommand(input: string) {
  return (
    includesAny(input, [
      "关闭联网推荐",
      "停用联网推荐",
      "禁用联网推荐",
      "关闭联网文献推荐",
      "停用联网文献推荐",
      "禁用联网文献推荐"
    ]) ||
    (includesAny(input, ["联网推荐", "联网文献推荐"]) && includesAny(input, ["关闭", "停用", "禁用", "不要", "别再"]))
  );
}

function isOpenOrganizationSharedLibraryCommand(input: string) {
  return input.includes("打开") && input.includes("组织") && input.includes("共享文献库");
}
```

Before unknown fallback, add:

```ts
  if (isRecommendationDisableCommand(normalized)) {
    return {
      ...base,
      actions: [
        {
          actionId: "settings.update",
          input: {
            target: "network.recommendation.enabled",
            value: false
          }
        }
      ],
      intentId: "settings.update",
      summary: "关闭联网推荐"
    };
  }

  if (isOpenOrganizationSharedLibraryCommand(normalized)) {
    return {
      ...base,
      actions: [
        {
          actionId: "organization.open_shared_library",
          input: {
            source: "organization_space"
          }
        }
      ],
      intentId: "organization.open_shared_library",
      requiredContext: ["organization"],
      summary: "打开组织共享文献库"
    };
  }
```

- [ ] **Step 4: Run planner tests**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimeSemanticPlanner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Keep orchestrator legacy execution behavior intact**

Do not migrate settings/profile/organization execution in this task if doing so would change existing confirmation behavior. Instead, verify:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimeOrchestrator.test.ts src/tests/AssistantPane.test.tsx
```

Expected: existing settings, profile confirmation, organization, artifact, and AssistantPane command tests still pass.

- [ ] **Step 6: Commit**

If git commits are allowed:

```bash
git add products/liteasy/apps/desktop/src/app/features/agent-runtime/semanticPlanner.ts products/liteasy/apps/desktop/src/tests/agentRuntimeSemanticPlanner.test.ts
git commit -m "test: preserve existing command planning"
```

## Task 5: Render Plan Preview Events In AssistantPane

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/assistant/AssistantPane.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/AssistantPane.test.tsx`

- [ ] **Step 1: Add failing AssistantPane plan-preview test**

Append to `AssistantPane.test.tsx`:

```tsx
test("shows semantic command plan previews in command mode", async () => {
  const user = userEvent.setup();

  render(
    <AssistantPane
      onGenerateArtifact={() => "unused"}
      selectedSetStatus={{
        importedCount: 0,
        selectedCount: 0,
        selectionLocked: false
      }}
    />
  );

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "把窗口切分成两个");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText("计划：切换为双栏布局")).toBeInTheDocument();
  expect(screen.getByText("已准备执行：切换为双栏布局")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run AssistantPane test to verify it fails**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/AssistantPane.test.tsx
```

Expected: FAIL because `formatRuntimeEvent` does not handle `plan_preview`.

- [ ] **Step 3: Update runtime event formatting**

In `AssistantPane.tsx`, add this branch at the start of `formatRuntimeEvent`:

```ts
  if (event.type === "plan_preview") {
    return `计划：${event.plan.summary}`;
  }
```

- [ ] **Step 4: Run AssistantPane test**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/AssistantPane.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

If git commits are allowed:

```bash
git add products/liteasy/apps/desktop/src/app/features/assistant/AssistantPane.tsx products/liteasy/apps/desktop/src/tests/AssistantPane.test.tsx
git commit -m "feat: show semantic command plan previews"
```

## Task 6: Final Verification

**Files:**
- No code files unless verification exposes defects.

- [ ] **Step 1: Run focused runtime tests**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimeSemanticPlanner.test.ts src/tests/agentRuntimePlanExecutor.test.ts src/tests/agentRuntimeOrchestrator.test.ts src/tests/AssistantPane.test.tsx
```

Expected: PASS for all listed files.

- [ ] **Step 2: Run Context Panel regression tests**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimeContextView.test.ts src/tests/AssistantContextPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run full desktop test suite**

Run:

```bash
cd products/liteasy/apps/desktop && npm test
```

Expected: PASS. If sandbox blocks localhost binding in `devScript.test.ts` with `listen EPERM: operation not permitted 127.0.0.1`, rerun the same command with elevated permissions and record the elevated run result.

- [ ] **Step 4: Run production build**

Run:

```bash
cd products/liteasy/apps/desktop && npm run build
```

Expected: `tsc && vite build` completes successfully. Existing chunk size warnings are acceptable.

- [ ] **Step 5: Inspect git status**

Run:

```bash
git status --short
```

Expected: only intended command runtime V2 foundation files plus pre-existing unrelated docs changes remain.

## Self-Review

- Spec coverage: This plan implements the first V2 foundation slice: semantic plan types, deterministic planner, plan preview events, layout/theme/panel planning, existing command preservation, better clarification/unsupported responses, and verification. It does not implement model-backed planning, persisted themes, real AppShell layout mutation, or concrete actionRegistry execution for new UI capability families because those are explicitly deferred to follow-up slices.
- Marker scan: This plan contains no unresolved fill-in markers. Deferred features are named as out of scope for this slice.
- Type consistency: `SemanticActionPlan`, `RuntimeActionInvocation`, `planSemanticCommand`, `executeSemanticPlan`, `plan_preview`, and action ids are consistently named across tasks.
