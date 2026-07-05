import { expect, test, vi } from "vitest";
import { executeSemanticPlan } from "../app/features/agent-runtime/planExecutor";
import type {
  AgentRuntimeExecutionContext,
  SemanticActionPlan
} from "../app/features/agent-runtime/agentRuntime.types";

test("generates ui_dsl_ready for low-risk theme commands", async () => {
  const plan: SemanticActionPlan = {
    actions: [
      {
        actionId: "theme.apply_preset",
        input: {
          preset: "playful",
          tone: "cartoon"
        }
      }
    ],
    confidence: "high",
    intentId: "theme.apply",
    planId: "plan-theme-cartoon",
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low",
    summary: "已应用卡通风格。"
  };
  const context: AgentRuntimeExecutionContext = {
    applyThemePreset: vi.fn(() => "已应用卡通风格。")
  };

  const result = await executeSemanticPlan(plan, context);
  const uiEvent = result.events.find((event) => event.type === "ui_dsl_ready");

  expect(uiEvent).toBeDefined();
  expect(uiEvent).toMatchObject({
    document: {
      intentPlanId: "plan-theme-cartoon",
      surface: "assistant"
    },
    type: "ui_dsl_ready"
  });
});

test("emits progress and task events for artifact commands", async () => {
  const plan: SemanticActionPlan = {
    actions: [
      {
        actionId: "artifact.generate",
        input: {
          artifactType: "comparison_table",
          source: "selected_document_set"
        }
      }
    ],
    confidence: "high",
    intentId: "artifact.generate",
    planId: "plan-artifact",
    requiredContext: ["selected_document_set"],
    requiresConfirmation: false,
    riskLevel: "low",
    summary: "生成对比表。"
  };
  const context: AgentRuntimeExecutionContext = {
    contextView: {
      cloud: {
        connected: true
      },
      profile: {
        enabled: false,
        requiresConfirmation: false
      },
      selection: {
        importedCount: 2,
        issues: [],
        locked: true,
        ready: true,
        selectedCount: 2
      },
      workspace: {
        type: "local"
      }
    },
    startArtifactAnalysis: vi.fn(() => "已创建对比表任务。")
  };

  const result = await executeSemanticPlan(plan, context);

  expect(result.events.map((event) => event.type)).toEqual(
    expect.arrayContaining(["plan_preview", "progress_started", "task_created", "ui_dsl_ready"])
  );
});

test("emits action_failed when a registered action handler is missing", async () => {
  const plan: SemanticActionPlan = {
    actions: [
      {
        actionId: "layout.split_two",
        input: {
          preset: "two_column"
        }
      }
    ],
    confidence: "high",
    intentId: "layout.change",
    planId: "plan-missing-layout",
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low",
    summary: "切换为双栏布局。"
  };

  const result = await executeSemanticPlan(plan, {});

  expect(result.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        action: expect.objectContaining({
          actionId: "layout.split_two"
        }),
        type: "action_failed"
      })
    ])
  );
});
