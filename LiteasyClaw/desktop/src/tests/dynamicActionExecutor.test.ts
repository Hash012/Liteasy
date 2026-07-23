import { describe, expect, test } from "vitest";
import {
  executeUIDslActionRef
} from "../app/features/agent-runtime/dynamicActionExecutor";
import { createSettingsStore } from "../app/features/settings/settings.store";

describe("executeUIDslActionRef", () => {
  test("validates dynamic action input against the registered action schema before execution", async () => {
    const applyLayoutRatio = vi.fn(() => "已调整工作台栏宽。");

    const result = await executeUIDslActionRef(
      {
        actionId: "layout.set_ratio",
        id: "unsafe-layout-ratio",
        input: {
          center: 0.5,
          unknown: true
        },
        label: "调整栏宽",
        riskLevel: "low"
      },
      {
        applyLayoutRatio
      },
      {
        mode: "command",
        traceId: "trace-invalid-action-ref"
      }
    );

    expect(applyLayoutRatio).not.toHaveBeenCalled();
    expect(result.events).toEqual([
      {
        message: "语义计划未通过动作契约校验。",
        recovery: "layout.set_ratio.unknown is not allowed",
        type: "runtime_error"
      },
      {
        document: expect.objectContaining({
          dataSources: expect.arrayContaining([
            expect.objectContaining({
              params: expect.objectContaining({
                reason: "runtime_error"
              }),
              sourceId: "runtime.context_view"
            })
          ])
        }),
        type: "ui_dsl_ready"
      }
    ]);
  });

  test("keeps non-command dynamic actions behind the mode gate", async () => {
    const settingsStore = createSettingsStore();

    const result = await executeUIDslActionRef(
      {
        actionId: "settings.update",
          id: "disable-recommendations-from-answer",
          input: {
            target: "network.recommendation.enabled",
            value: false
          },
          label: "关闭联网推荐",
          riskLevel: "low"
      },
      {
        settingsStore
      },
      {
        mode: "qa",
        traceId: "trace-answer-action"
      }
    );

    expect(settingsStore.getState()["network.recommendation.enabled"]).toBe(true);
    expect(result.events).toEqual([
      {
        kind: "command_mode",
        missing: ["command_mode"],
        question: "软件动作需要用 / 开始输入命令。",
        type: "clarification_request"
      },
      {
        document: expect.objectContaining({
          dataSources: expect.arrayContaining([
            expect.objectContaining({
              params: expect.objectContaining({
                reason: "clarify"
              })
            })
          ])
        }),
        type: "ui_dsl_ready"
      }
    ]);
  });

  test("rejects profile state changes from dynamic actions", async () => {
    const settingsStore = createSettingsStore();

    const result = await executeUIDslActionRef(
      {
        actionId: "settings.update",
          id: "enable-profile",
        input: {
          target: "profile.enabled",
          value: true
        },
        label: "开启画像",
        riskLevel: "medium"
      },
      {
          settingsStore
      },
      {
        traceId: "trace-dynamic-profile"
      }
    );

    expect(settingsStore.getState()).not.toHaveProperty("profile.enabled");
    expect(result.events.some((event) => event.type === "confirmation_request")).toBe(false);
    expect(result.events.some((event) => event.type === "runtime_error")).toBe(true);
  });
});
