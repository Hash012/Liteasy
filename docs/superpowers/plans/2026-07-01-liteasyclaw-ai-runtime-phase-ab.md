# LiteasyClaw AI Runtime Phase A-B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the existing command-mode assistant path behind a local `agent-runtime` boundary that emits structured runtime events before actions execute.

**Architecture:** Keep current user-visible behavior mostly intact while introducing `intentRouter`, `confirmationPolicy`, `skillExecutor`, and `runtimeOrchestrator` under `agent-runtime`. `AssistantPane` will call the orchestrator for command mode and render returned events as assistant messages; QA and explanation modes stay on the existing `generateAssistantAnswer` path.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, existing LiteasyClaw desktop feature modules.

---

## File Responsibilities

- `products/liteasy/apps/desktop/src/app/features/agent-runtime/agentRuntime.types.ts`: extend runtime contracts with runtime input, intent plan, action outcome metadata, and runtime execution context.
- `products/liteasy/apps/desktop/src/app/features/agent-runtime/intentRouter.ts`: map command-mode natural language to runtime plans for settings, organization, artifact, and unknown intents.
- `products/liteasy/apps/desktop/src/tests/agentRuntimeIntentRouter.test.ts`: verify current command examples map to runtime plans and removed endpoint/model-policy commands remain unavailable.
- `products/liteasy/apps/desktop/src/app/features/agent-runtime/confirmationPolicy.ts`: classify planned actions as direct execution or confirmation-required.
- `products/liteasy/apps/desktop/src/tests/agentRuntimeConfirmationPolicy.test.ts`: verify recommendation settings are direct and profile sampling requires confirmation.
- `products/liteasy/apps/desktop/src/app/features/agent-runtime/skillExecutor.ts`: execute planned skills through `executeSkill`, wrap success/failure into runtime events, and report settings mutation metadata.
- `products/liteasy/apps/desktop/src/tests/agentRuntimeSkillExecutor.test.ts`: verify success, confirmation, and execution error event behavior.
- `products/liteasy/apps/desktop/src/app/features/agent-runtime/runtimeOrchestrator.ts`: coordinate routing, artifact context checks, confirmation, execution, and event emission.
- `products/liteasy/apps/desktop/src/tests/agentRuntimeOrchestrator.test.ts`: verify unknown commands, direct settings execution, profile confirmation, and mind-map missing context behavior.
- `products/liteasy/apps/desktop/src/app/features/assistant/AssistantPane.tsx`: replace direct `routeCommand` / `executeSkill` command-mode execution with `runAgentRuntime`.
- `products/liteasy/apps/desktop/src/tests/AssistantPane.test.tsx`: verify command-mode UI renders runtime results and does not mutate profile sampling before confirmation.

## Task 1: Add Runtime Intent Routing

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/agent-runtime/agentRuntime.types.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/agent-runtime/intentRouter.ts`
- Test: `products/liteasy/apps/desktop/src/tests/agentRuntimeIntentRouter.test.ts`

- [ ] **Step 1: Write the failing intent-router test**

Create `products/liteasy/apps/desktop/src/tests/agentRuntimeIntentRouter.test.ts`:

```ts
import { routeAgentIntent } from "../app/features/agent-runtime/intentRouter";

test("maps closing network recommendation to a runtime settings plan", () => {
  expect(routeAgentIntent({ message: "关闭联网推荐", mode: "command" })).toEqual({
    intentId: "settings.update",
    kind: "skill",
    skill: {
      skillId: "settings.adjust",
      input: {
        target: "network.recommendation.enabled",
        value: false
      }
    }
  });
});

test("maps recommendation sort commands to runtime settings plans", () => {
  expect(routeAgentIntent({ message: "按关联度排序推荐", mode: "command" })).toEqual({
    intentId: "settings.update",
    kind: "skill",
    skill: {
      skillId: "settings.adjust",
      input: {
        target: "network.recommendation.sort_mode",
        value: "relevance"
      }
    }
  });

  expect(routeAgentIntent({ message: "按检索时间排序推荐", mode: "command" })).toEqual({
    intentId: "settings.update",
    kind: "skill",
    skill: {
      skillId: "settings.adjust",
      input: {
        target: "network.recommendation.sort_mode",
        value: "retrieved_at"
      }
    }
  });
});

test("maps profile sampling commands to runtime settings plans", () => {
  expect(routeAgentIntent({ message: "开启用户画像", mode: "command" })).toEqual({
    intentId: "settings.update",
    kind: "skill",
    skill: {
      skillId: "settings.adjust",
      input: {
        target: "profile.enabled",
        value: true
      }
    }
  });
});

test("maps organization shared library commands to runtime organization plans", () => {
  expect(routeAgentIntent({ message: "帮我打开组织的共享文献库", mode: "command" })).toEqual({
    intentId: "organization.open_shared_library",
    kind: "skill",
    skill: {
      skillId: "organization.open_shared_library",
      input: {
        source: "organization_space"
      }
    }
  });
});

test("maps mind map commands to runtime artifact plans", () => {
  expect(routeAgentIntent({ message: "请根据当前选中文献集生成思维导图", mode: "command" })).toEqual({
    artifact: {
      artifactType: "mindmap",
      payload: {
        source: "selected_document_set"
      }
    },
    intentId: "artifact.generate",
    kind: "artifact"
  });
});

test("does not expose removed endpoint or model-policy commands", () => {
  expect(routeAgentIntent({ message: "允许本地直连", mode: "command" })).toEqual({
    intentId: "unknown",
    kind: "unknown",
    message: "当前命令还没有注册到安全能力表中。"
  });
  expect(routeAgentIntent({ message: "设置云代理端点为 http://127.0.0.1:8787", mode: "command" })).toEqual({
    intentId: "unknown",
    kind: "unknown",
    message: "当前命令还没有注册到安全能力表中。"
  });
});

test("treats non-command modes as unknown for command routing", () => {
  expect(routeAgentIntent({ message: "关闭联网推荐", mode: "qa" })).toEqual({
    intentId: "unknown",
    kind: "unknown",
    message: "当前模式不执行受控命令。"
  });
});
```

- [ ] **Step 2: Run the intent-router test to verify it fails**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimeIntentRouter.test.ts
```

Expected: FAIL because `intentRouter` does not exist or exported runtime plan types are missing.

- [ ] **Step 3: Extend runtime types**

Modify `products/liteasy/apps/desktop/src/app/features/agent-runtime/agentRuntime.types.ts` by adding these imports after the existing imports:

```ts
import type { ArtifactType } from "../artifacts/artifact.types";
import type { AssistantMode } from "../assistant/assistant.types";
import type { ActionContext } from "../skills/actionRegistry";
import type { SkillInvocation } from "../skills/skillRegistry";
```

Then add these types after `ArtifactRequest`:

```ts
export type AgentRuntimeInput = {
  message: string;
  mode: AssistantMode;
};

export type AgentIntentId =
  | "settings.update"
  | "organization.open_shared_library"
  | "artifact.generate"
  | "unknown";

export type RuntimeSkillPlan = {
  intentId: Exclude<AgentIntentId, "artifact.generate" | "unknown">;
  kind: "skill";
  skill: SkillInvocation;
};

export type RuntimeArtifactPlan = {
  artifact: {
    artifactType: ArtifactType;
    payload: {
      source: "selected_document_set";
    };
  };
  intentId: "artifact.generate";
  kind: "artifact";
};

export type RuntimeUnknownPlan = {
  intentId: "unknown";
  kind: "unknown";
  message: string;
};

export type AgentRuntimePlan = RuntimeArtifactPlan | RuntimeSkillPlan | RuntimeUnknownPlan;

export type AgentRuntimeExecutionContext = ActionContext & {
  profileUnlocked?: boolean;
};
```

- [ ] **Step 4: Add the intent router**

Create `products/liteasy/apps/desktop/src/app/features/agent-runtime/intentRouter.ts`:

```ts
import type { AgentRuntimeInput, AgentRuntimePlan } from "./agentRuntime.types";

function includesAny(input: string, phrases: string[]) {
  return phrases.some((phrase) => input.includes(phrase));
}

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

function isRecommendationEnableCommand(input: string) {
  return (
    includesAny(input, [
      "开启联网推荐",
      "打开联网推荐",
      "启用联网推荐",
      "开启联网文献推荐",
      "打开联网文献推荐",
      "启用联网文献推荐"
    ]) ||
    (includesAny(input, ["联网推荐", "联网文献推荐"]) && includesAny(input, ["开启", "打开", "启用", "恢复", "重新开启"]))
  );
}

function isOpenOrganizationSharedLibraryCommand(input: string) {
  return input.includes("打开") && input.includes("组织") && input.includes("共享文献库");
}

export function routeAgentIntent(input: AgentRuntimeInput): AgentRuntimePlan {
  const normalized = input.message.trim();

  if (input.mode !== "command") {
    return {
      intentId: "unknown",
      kind: "unknown",
      message: "当前模式不执行受控命令。"
    };
  }

  if (normalized.includes("思维导图")) {
    return {
      artifact: {
        artifactType: "mindmap",
        payload: {
          source: "selected_document_set"
        }
      },
      intentId: "artifact.generate",
      kind: "artifact"
    };
  }

  if (isRecommendationDisableCommand(normalized)) {
    return {
      intentId: "settings.update",
      kind: "skill",
      skill: {
        skillId: "settings.adjust",
        input: {
          target: "network.recommendation.enabled",
          value: false
        }
      }
    };
  }

  if (isRecommendationEnableCommand(normalized)) {
    return {
      intentId: "settings.update",
      kind: "skill",
      skill: {
        skillId: "settings.adjust",
        input: {
          target: "network.recommendation.enabled",
          value: true
        }
      }
    };
  }

  if (normalized === "按关联度排序推荐") {
    return {
      intentId: "settings.update",
      kind: "skill",
      skill: {
        skillId: "settings.adjust",
        input: {
          target: "network.recommendation.sort_mode",
          value: "relevance"
        }
      }
    };
  }

  if (normalized === "按检索时间排序推荐") {
    return {
      intentId: "settings.update",
      kind: "skill",
      skill: {
        skillId: "settings.adjust",
        input: {
          target: "network.recommendation.sort_mode",
          value: "retrieved_at"
        }
      }
    };
  }

  if (normalized === "开启用户画像") {
    return {
      intentId: "settings.update",
      kind: "skill",
      skill: {
        skillId: "settings.adjust",
        input: {
          target: "profile.enabled",
          value: true
        }
      }
    };
  }

  if (normalized === "关闭用户画像") {
    return {
      intentId: "settings.update",
      kind: "skill",
      skill: {
        skillId: "settings.adjust",
        input: {
          target: "profile.enabled",
          value: false
        }
      }
    };
  }

  if (isOpenOrganizationSharedLibraryCommand(normalized)) {
    return {
      intentId: "organization.open_shared_library",
      kind: "skill",
      skill: {
        skillId: "organization.open_shared_library",
        input: {
          source: "organization_space"
        }
      }
    };
  }

  return {
    intentId: "unknown",
    kind: "unknown",
    message: "当前命令还没有注册到安全能力表中。"
  };
}
```

- [ ] **Step 5: Run the intent-router test to verify it passes**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimeIntentRouter.test.ts
```

Expected: PASS for 7 tests.

- [ ] **Step 6: Commit**

Run:

```bash
git add products/liteasy/apps/desktop/src/app/features/agent-runtime/agentRuntime.types.ts products/liteasy/apps/desktop/src/app/features/agent-runtime/intentRouter.ts products/liteasy/apps/desktop/src/tests/agentRuntimeIntentRouter.test.ts
git commit -m "feat: add agent runtime intent router"
```

## Task 2: Add Confirmation Policy

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/agent-runtime/confirmationPolicy.ts`
- Test: `products/liteasy/apps/desktop/src/tests/agentRuntimeConfirmationPolicy.test.ts`

- [ ] **Step 1: Write the failing confirmation-policy test**

Create `products/liteasy/apps/desktop/src/tests/agentRuntimeConfirmationPolicy.test.ts`:

```ts
import { evaluateRuntimeConfirmation } from "../app/features/agent-runtime/confirmationPolicy";
import type { RuntimeSkillPlan } from "../app/features/agent-runtime/agentRuntime.types";

function settingsPlan(
  target: "network.recommendation.enabled" | "network.recommendation.sort_mode" | "profile.enabled",
  value: boolean | "relevance" | "retrieved_at"
): RuntimeSkillPlan {
  return {
    intentId: "settings.update",
    kind: "skill",
    skill: {
      skillId: "settings.adjust",
      input: {
        target,
        value
      }
    }
  };
}

test("allows low-risk recommendation enabled settings to execute directly", () => {
  expect(evaluateRuntimeConfirmation(settingsPlan("network.recommendation.enabled", false))).toEqual({
    requiresConfirmation: false,
    riskLevel: "low"
  });
});

test("allows recommendation sort mode settings to execute directly", () => {
  expect(evaluateRuntimeConfirmation(settingsPlan("network.recommendation.sort_mode", "retrieved_at"))).toEqual({
    requiresConfirmation: false,
    riskLevel: "low"
  });
});

test("requires confirmation for profile sampling settings", () => {
  expect(evaluateRuntimeConfirmation(settingsPlan("profile.enabled", true))).toEqual({
    message: "用户画像会影响个性化采样与后续回答策略，请确认后再开启。",
    requiresConfirmation: true,
    riskLevel: "medium"
  });
});

test("allows non-settings skills to execute directly in this phase", () => {
  expect(
    evaluateRuntimeConfirmation({
      intentId: "organization.open_shared_library",
      kind: "skill",
      skill: {
        skillId: "organization.open_shared_library",
        input: {
          source: "organization_space"
        }
      }
    })
  ).toEqual({
    requiresConfirmation: false,
    riskLevel: "low"
  });
});
```

- [ ] **Step 2: Run the confirmation-policy test to verify it fails**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimeConfirmationPolicy.test.ts
```

Expected: FAIL because `confirmationPolicy` does not exist.

- [ ] **Step 3: Add the confirmation policy**

Create `products/liteasy/apps/desktop/src/app/features/agent-runtime/confirmationPolicy.ts`:

```ts
import type { ActionRiskLevel } from "../resources/resourceActionPolicy";
import type { RuntimeSkillPlan } from "./agentRuntime.types";

export type RuntimeConfirmationDecision =
  | {
      requiresConfirmation: false;
      riskLevel: ActionRiskLevel;
    }
  | {
      message: string;
      requiresConfirmation: true;
      riskLevel: ActionRiskLevel;
    };

export function evaluateRuntimeConfirmation(plan: RuntimeSkillPlan): RuntimeConfirmationDecision {
  if (plan.skill.skillId === "settings.adjust" && plan.skill.input.target === "profile.enabled") {
    return {
      message:
        plan.skill.input.value === true
          ? "用户画像会影响个性化采样与后续回答策略，请确认后再开启。"
          : "关闭用户画像会停止个性化采样，请确认后再关闭。",
      requiresConfirmation: true,
      riskLevel: "medium"
    };
  }

  return {
    requiresConfirmation: false,
    riskLevel: "low"
  };
}
```

- [ ] **Step 4: Run the confirmation-policy test to verify it passes**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimeConfirmationPolicy.test.ts
```

Expected: PASS for 4 tests.

- [ ] **Step 5: Commit**

Run:

```bash
git add products/liteasy/apps/desktop/src/app/features/agent-runtime/confirmationPolicy.ts products/liteasy/apps/desktop/src/tests/agentRuntimeConfirmationPolicy.test.ts
git commit -m "feat: add agent runtime confirmation policy"
```

## Task 3: Wrap Skill Execution In Runtime Events

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/agent-runtime/agentRuntime.types.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/agent-runtime/skillExecutor.ts`
- Test: `products/liteasy/apps/desktop/src/tests/agentRuntimeSkillExecutor.test.ts`

- [ ] **Step 1: Write the failing skill-executor test**

Create `products/liteasy/apps/desktop/src/tests/agentRuntimeSkillExecutor.test.ts`:

```ts
import { executeRuntimeSkill } from "../app/features/agent-runtime/skillExecutor";
import { createSettingsStore } from "../app/features/settings/settings.store";
import type { RuntimeSkillPlan } from "../app/features/agent-runtime/agentRuntime.types";

function recommendationPlan(): RuntimeSkillPlan {
  return {
    intentId: "settings.update",
    kind: "skill",
    skill: {
      skillId: "settings.adjust",
      input: {
        target: "network.recommendation.enabled",
        value: false
      }
    }
  };
}

test("executes a direct settings skill and emits assistant reply plus action request events", async () => {
  const settingsStore = createSettingsStore();

  const result = await executeRuntimeSkill(recommendationPlan(), {
    settingsStore
  });

  expect(result.settingsChanged).toBe(true);
  expect(result.events).toEqual([
    {
      action: {
        actionId: "settings.update",
        payload: {
          target: "network.recommendation.enabled",
          value: false
        }
      },
      type: "action_request"
    },
    {
      message: "已更新 联网推荐：false",
      type: "assistant_reply"
    }
  ]);
  expect(settingsStore.getState()["network.recommendation.enabled"]).toBe(false);
});

test("returns confirmation events before executing confirmation-required settings", async () => {
  const settingsStore = createSettingsStore();

  const result = await executeRuntimeSkill(
    {
      intentId: "settings.update",
      kind: "skill",
      skill: {
        skillId: "settings.adjust",
        input: {
          target: "profile.enabled",
          value: true
        }
      }
    },
    {
      profileUnlocked: true,
      settingsStore
    }
  );

  expect(result.settingsChanged).toBe(false);
  expect(result.events).toEqual([
    {
      action: {
        actionId: "settings.update",
        payload: {
          target: "profile.enabled",
          value: true
        }
      },
      summary: "用户画像会影响个性化采样与后续回答策略，请确认后再开启。",
      type: "confirmation_request"
    }
  ]);
  expect(settingsStore.getState()["profile.enabled"]).toBe(false);
});

test("turns execution errors into runtime error events", async () => {
  const result = await executeRuntimeSkill(
    {
      intentId: "organization.open_shared_library",
      kind: "skill",
      skill: {
        skillId: "organization.open_shared_library",
        input: {
          source: "organization_space"
        }
      }
    },
    {}
  );

  expect(result.settingsChanged).toBe(false);
  expect(result.events).toEqual([
    {
      message: "organization.open_shared_library requires an organization shared-library handler",
      recovery: "请检查该能力是否已注册到安全 action。",
      type: "runtime_error"
    }
  ]);
});
```

- [ ] **Step 2: Run the skill-executor test to verify it fails**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimeSkillExecutor.test.ts
```

Expected: FAIL because `skillExecutor` does not exist or runtime metadata types are missing.

- [ ] **Step 3: Extend runtime output metadata types**

Modify `products/liteasy/apps/desktop/src/app/features/agent-runtime/agentRuntime.types.ts` by adding this type after `AgentRuntimeEvent`:

```ts
export type RuntimeExecutionResult = {
  events: AgentRuntimeEvent[];
  settingsChanged: boolean;
};
```

- [ ] **Step 4: Add the skill executor**

Create `products/liteasy/apps/desktop/src/app/features/agent-runtime/skillExecutor.ts`:

```ts
import { executeSkill } from "../skills/skillRegistry";
import { evaluateRuntimeConfirmation } from "./confirmationPolicy";
import type {
  ActionRequest,
  AgentRuntimeEvent,
  AgentRuntimeExecutionContext,
  RuntimeExecutionResult,
  RuntimeSkillPlan
} from "./agentRuntime.types";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getActionRequest(plan: RuntimeSkillPlan): ActionRequest | null {
  if (plan.skill.skillId === "settings.adjust") {
    return {
      actionId: "settings.update",
      payload: {
        target: plan.skill.input.target,
        value: plan.skill.input.value
      }
    };
  }

  if (plan.skill.skillId === "organization.open_shared_library") {
    return {
      actionId: "organization.open_shared_library",
      payload: plan.skill.input
    };
  }

  return null;
}

export async function executeRuntimeSkill(
  plan: RuntimeSkillPlan,
  context: AgentRuntimeExecutionContext
): Promise<RuntimeExecutionResult> {
  const action = getActionRequest(plan);
  const confirmation = evaluateRuntimeConfirmation(plan);

  if (confirmation.requiresConfirmation) {
    return {
      events: [
        {
          action: action ?? {
            actionId: plan.skill.skillId,
            payload: plan.skill.input
          },
          summary: confirmation.message,
          type: "confirmation_request"
        }
      ],
      settingsChanged: false
    };
  }

  try {
    const result = await executeSkill(plan.skill, context);
    const events: AgentRuntimeEvent[] = [];

    if (action) {
      events.push({
        action,
        type: "action_request"
      });
    }

    events.push({
      message: result.message,
      type: "assistant_reply"
    });

    return {
      events,
      settingsChanged: plan.skill.skillId === "settings.adjust"
    };
  } catch (error) {
    return {
      events: [
        {
          message: getErrorMessage(error),
          recovery: "请检查该能力是否已注册到安全 action。",
          type: "runtime_error"
        }
      ],
      settingsChanged: false
    };
  }
}
```

- [ ] **Step 5: Run the skill-executor test to verify it passes**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimeSkillExecutor.test.ts
```

Expected: PASS for 3 tests.

- [ ] **Step 6: Commit**

Run:

```bash
git add products/liteasy/apps/desktop/src/app/features/agent-runtime/agentRuntime.types.ts products/liteasy/apps/desktop/src/app/features/agent-runtime/skillExecutor.ts products/liteasy/apps/desktop/src/tests/agentRuntimeSkillExecutor.test.ts
git commit -m "feat: emit runtime events for skill execution"
```

## Task 4: Add Runtime Orchestrator

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/agent-runtime/runtimeOrchestrator.ts`
- Test: `products/liteasy/apps/desktop/src/tests/agentRuntimeOrchestrator.test.ts`

- [ ] **Step 1: Write the failing orchestrator test**

Create `products/liteasy/apps/desktop/src/tests/agentRuntimeOrchestrator.test.ts`:

```ts
import { runAgentRuntime } from "../app/features/agent-runtime/runtimeOrchestrator";
import { createSettingsStore } from "../app/features/settings/settings.store";

test("returns runtime errors for unsupported commands", async () => {
  await expect(
    runAgentRuntime(
      {
        message: "同步云端模型策略",
        mode: "command"
      },
      {}
    )
  ).resolves.toEqual({
    events: [
      {
        message: "当前命令还没有注册到安全能力表中。",
        type: "runtime_error"
      }
    ],
    settingsChanged: false
  });
});

test("executes recommendation settings through runtime", async () => {
  const settingsStore = createSettingsStore();

  const result = await runAgentRuntime(
    {
      message: "关闭联网推荐",
      mode: "command"
    },
    {
      settingsStore
    }
  );

  expect(result.settingsChanged).toBe(true);
  expect(result.events).toEqual([
    {
      action: {
        actionId: "settings.update",
        payload: {
          target: "network.recommendation.enabled",
          value: false
        }
      },
      type: "action_request"
    },
    {
      message: "已更新 联网推荐：false",
      type: "assistant_reply"
    }
  ]);
  expect(settingsStore.getState()["network.recommendation.enabled"]).toBe(false);
});

test("returns confirmation for profile sampling before mutation", async () => {
  const settingsStore = createSettingsStore();

  const result = await runAgentRuntime(
    {
      message: "开启用户画像",
      mode: "command"
    },
    {
      profileUnlocked: true,
      settingsStore
    }
  );

  expect(result).toEqual({
    events: [
      {
        action: {
          actionId: "settings.update",
          payload: {
            target: "profile.enabled",
            value: true
          }
        },
        summary: "用户画像会影响个性化采样与后续回答策略，请确认后再开启。",
        type: "confirmation_request"
      }
    ],
    settingsChanged: false
  });
  expect(settingsStore.getState()["profile.enabled"]).toBe(false);
});

test("returns a clarification request when a mind map command lacks ready selection context", async () => {
  await expect(
    runAgentRuntime(
      {
        message: "生成思维导图",
        mode: "command"
      },
      {}
    )
  ).resolves.toEqual({
    events: [
      {
        missing: ["selected_document_set"],
        question: "请先勾选并锁定要分析的文献，再生成思维导图。",
        type: "clarification_request"
      }
    ],
    settingsChanged: false
  });
});
```

- [ ] **Step 2: Run the orchestrator test to verify it fails**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimeOrchestrator.test.ts
```

Expected: FAIL because `runtimeOrchestrator` does not exist.

- [ ] **Step 3: Add the runtime orchestrator**

Create `products/liteasy/apps/desktop/src/app/features/agent-runtime/runtimeOrchestrator.ts`:

```ts
import { routeAgentIntent } from "./intentRouter";
import { executeRuntimeSkill } from "./skillExecutor";
import type {
  AgentRuntimeEvent,
  AgentRuntimeExecutionContext,
  AgentRuntimeInput,
  RuntimeExecutionResult
} from "./agentRuntime.types";

function createArtifactContextEvents(context: AgentRuntimeExecutionContext): AgentRuntimeEvent[] | null {
  if (!context.startArtifactAnalysis) {
    return [
      {
        missing: ["selected_document_set"],
        question: "请先勾选并锁定要分析的文献，再生成思维导图。",
        type: "clarification_request"
      }
    ];
  }

  return null;
}

export async function runAgentRuntime(
  input: AgentRuntimeInput,
  context: AgentRuntimeExecutionContext
): Promise<RuntimeExecutionResult> {
  const plan = routeAgentIntent(input);

  if (plan.kind === "unknown") {
    return {
      events: [
        {
          message: plan.message,
          type: "runtime_error"
        }
      ],
      settingsChanged: false
    };
  }

  if (plan.kind === "artifact") {
    const contextEvents = createArtifactContextEvents(context);
    if (contextEvents) {
      return {
        events: contextEvents,
        settingsChanged: false
      };
    }

    return {
      events: [
        {
          artifact: {
            artifactType: plan.artifact.artifactType,
            payload: plan.artifact.payload
          },
          type: "artifact_request"
        },
        {
          message: context.startArtifactAnalysis(plan.artifact.artifactType),
          type: "assistant_reply"
        }
      ],
      settingsChanged: false
    };
  }

  return executeRuntimeSkill(plan, context);
}
```

- [ ] **Step 4: Run the orchestrator test to verify it passes**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimeOrchestrator.test.ts
```

Expected: PASS for 4 tests.

- [ ] **Step 5: Commit**

Run:

```bash
git add products/liteasy/apps/desktop/src/app/features/agent-runtime/runtimeOrchestrator.ts products/liteasy/apps/desktop/src/tests/agentRuntimeOrchestrator.test.ts
git commit -m "feat: orchestrate command runtime events"
```

## Task 5: Route Assistant Command Mode Through Runtime

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/assistant/AssistantPane.tsx`
- Modify: `products/liteasy/apps/desktop/src/tests/AssistantPane.test.tsx`

- [ ] **Step 1: Write the failing AssistantPane runtime integration test**

Append this test to `products/liteasy/apps/desktop/src/tests/AssistantPane.test.tsx`:

```tsx
test("routes command mode through runtime confirmation before profile sampling changes", async () => {
  const user = userEvent.setup();
  const settingsStore = createSettingsStore();

  render(
    <AssistantPane
      onGenerateArtifact={() => "unused"}
      profileUnlocked={true}
      selectedSetStatus={{
        importedCount: 1,
        selectedCount: 1,
        selectionLocked: true
      }}
      settingsStore={settingsStore}
    />
  );

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "开启用户画像");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText("开启用户画像")).toBeInTheDocument();
  expect(screen.getByText("用户画像会影响个性化采样与后续回答策略，请确认后再开启。")).toBeInTheDocument();
  expect(settingsStore.getState()["profile.enabled"]).toBe(false);
});
```

- [ ] **Step 2: Run the AssistantPane test to verify it fails**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/AssistantPane.test.tsx
```

Expected: FAIL because command mode still executes `executeSkill` directly and mutates profile sampling instead of returning a confirmation message.

- [ ] **Step 3: Replace direct command execution imports**

Modify `products/liteasy/apps/desktop/src/app/features/assistant/AssistantPane.tsx`.

Remove these imports:

```ts
import { routeCommand } from "./commandRouter";
import { executeSkill } from "../skills/skillRegistry";
```

Add this import:

```ts
import { runAgentRuntime } from "../agent-runtime/runtimeOrchestrator";
import type { AgentRuntimeEvent } from "../agent-runtime/agentRuntime.types";
```

- [ ] **Step 4: Add an event-to-message helper**

Add this helper below `createMessage` in `AssistantPane.tsx`:

```ts
function formatRuntimeEvent(event: AgentRuntimeEvent): string {
  if (event.type === "assistant_reply" || event.type === "runtime_error") {
    return event.message;
  }

  if (event.type === "confirmation_request") {
    return event.summary;
  }

  if (event.type === "clarification_request") {
    return event.question;
  }

  if (event.type === "action_request") {
    return `准备执行受控动作：${event.action.actionId}`;
  }

  if (event.type === "artifact_request") {
    return `准备打开产物：${event.artifact.artifactType}`;
  }

  return `任务已创建：${event.task.taskType}`;
}
```

- [ ] **Step 5: Route command mode through `runAgentRuntime`**

In `AssistantPane.tsx`, replace the entire `if (assistantState.mode === "command") { ... }` block inside `handleSend` with:

```ts
    if (assistantState.mode === "command") {
      assistantStoreRef.current.setPending(true);
      syncAssistant();

      try {
        const result = await runAgentRuntime(
          {
            message: normalizedInput,
            mode: assistantState.mode
          },
          {
            openOrganizationSharedLibrary: onOpenOrganizationSharedLibrary,
            profileUnlocked,
            settingsStore: settingsStoreRef.current,
            startArtifactAnalysis: onGenerateArtifact
          }
        );

        result.events.forEach((event) => {
          assistantStoreRef.current.addMessage(createMessage("assistant", formatRuntimeEvent(event)));
        });

        if (result.settingsChanged) {
          onSettingsChanged?.({ ...settingsStoreRef.current.getState() });
        }
        setInput("");
      } catch (error) {
        assistantStoreRef.current.addMessage(
          createMessage("assistant", getAssistantErrorMessage(error))
        );
      } finally {
        assistantStoreRef.current.setPending(false);
        syncAssistant();
      }
      return;
    }
```

- [ ] **Step 6: Run the AssistantPane test to verify it passes**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/AssistantPane.test.tsx
```

Expected: PASS for all AssistantPane tests.

- [ ] **Step 7: Run focused runtime and assistant tests**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/agentRuntimeIntentRouter.test.ts src/tests/agentRuntimeConfirmationPolicy.test.ts src/tests/agentRuntimeSkillExecutor.test.ts src/tests/agentRuntimeOrchestrator.test.ts src/tests/AssistantPane.test.tsx src/tests/commandRouter.test.ts src/tests/skillRegistry.test.ts src/tests/actionRegistry.test.ts
```

Expected: PASS for all listed tests.

- [ ] **Step 8: Commit**

Run:

```bash
git add products/liteasy/apps/desktop/src/app/features/assistant/AssistantPane.tsx products/liteasy/apps/desktop/src/tests/AssistantPane.test.tsx
git commit -m "feat: route assistant commands through runtime"
```

## Final Verification

- [ ] **Step 1: Run the full desktop test suite**

Run:

```bash
cd products/liteasy/apps/desktop && npm test
```

Expected: PASS for the full Vitest suite.

- [ ] **Step 2: Run the desktop production build**

Run:

```bash
cd products/liteasy/apps/desktop && npm run build
```

Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 3: Inspect git status**

Run:

```bash
git status --short
```

Expected: only pre-existing unrelated working-tree changes remain, or no changes if those have been handled separately.

## Self-Review

- Spec coverage: Tasks cover runtime intent routing, confirmation policy, skill execution event wrapping, runtime orchestration, AssistantPane command integration, focused tests, and final verification.
- Placeholder scan: This plan intentionally contains no placeholder markers or vague test/code steps.
- Type consistency: The plan uses `AgentRuntimeInput`, `AgentRuntimePlan`, `RuntimeSkillPlan`, `AgentRuntimeExecutionContext`, and `RuntimeExecutionResult` consistently across tasks.
