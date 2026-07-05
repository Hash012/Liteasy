import { describe, expect, test } from "vitest";
import {
  executeConfirmedSemanticPlan,
  executeUIDslActionRef
} from "../app/features/agent-runtime/dynamicActionExecutor";
import { createExecutionJournal } from "../app/features/generative-ui/executionJournal";
import { createSettingsStore } from "../app/features/settings/settings.store";

describe("executeUIDslActionRef", () => {
  test("keeps non-command dynamic actions behind the mode gate", async () => {
    const settingsStore = createSettingsStore();

    const result = await executeUIDslActionRef(
      {
        actionId: "settings.update",
        id: "enable-profile-from-answer",
        input: {
          target: "profile.enabled",
          value: true
        },
        label: "开启画像",
        riskLevel: "medium"
      },
      {
        profileUnlocked: true,
        settingsStore
      },
      {
        mode: "qa",
        traceId: "trace-answer-action"
      }
    );

    expect(settingsStore.getState()["profile.enabled"]).toBe(false);
    expect(result.events).toEqual([
      {
        kind: "command_mode",
        missing: ["command_mode"],
        question: "当前模式不执行软件动作，请切换到命令模式。",
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

  test("routes medium-risk dynamic actions through resumable human confirmation", async () => {
    const journal = createExecutionJournal();
    const settingsStore = createSettingsStore();

    const pending = await executeUIDslActionRef(
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
        journal,
        profileUnlocked: true,
        settingsStore
      },
      {
        traceId: "trace-dynamic-profile"
      }
    );

    expect(settingsStore.getState()["profile.enabled"]).toBe(false);
    expect(pending.events).toEqual([
      {
        plan: expect.objectContaining({
          actions: [
            {
              actionId: "settings.update",
              input: {
                target: "profile.enabled",
                value: true
              }
            }
          ],
          planId: "dynamic-profile",
          summary: "开启画像"
        }),
        type: "plan_preview"
      },
      expect.objectContaining({
        action: {
          actionId: "settings.update",
          payload: {
            target: "profile.enabled",
            value: true
          }
        },
        confirmationId: "confirm-dynamic-profile-settings.update",
        summary: "用户画像会影响个性化采样与后续回答策略，请确认后再开启。",
        traceId: "trace-dynamic-profile",
        type: "confirmation_request"
      })
    ]);

    const confirmation = pending.events.find((event) => event.type === "confirmation_request");
    const result = await executeConfirmedSemanticPlan(confirmation, {
      journal,
      profileUnlocked: true,
      settingsStore
    });

    expect(settingsStore.getState()["profile.enabled"]).toBe(true);
    expect(result.events).toEqual([
      {
        action: {
          actionId: "settings.update",
          payload: {
            target: "profile.enabled",
            value: true
          }
        },
        type: "action_request"
      },
      {
        message: "已更新 用户画像：true",
        type: "assistant_reply"
      }
    ]);
    expect(journal.getTrace("trace-dynamic-profile")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionId: "settings.update",
          result: "confirm",
          type: "policy"
        }),
        expect.objectContaining({
          actionId: "settings.update",
          confirmationId: "confirm-dynamic-profile-settings.update",
          decision: "accepted",
          type: "confirmation"
        }),
        expect.objectContaining({
          actionId: "settings.update",
          result: "allow",
          type: "policy"
        })
      ])
    );
  });
});
