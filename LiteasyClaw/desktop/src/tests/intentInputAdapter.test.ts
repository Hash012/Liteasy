import { describe, expect, test } from "vitest";
import {
  adaptDefaultUiIntent,
  adaptIntentInput,
  adaptTextIntent
} from "../app/features/agent-runtime/intentInputAdapter";

describe("IntentInputAdapter", () => {
  test("keeps the default UI idle for empty text input", () => {
    expect(
      adaptTextIntent({
        activeMode: "command",
        value: "   \n\t  "
      })
    ).toEqual({
      kind: "idle",
      reason: "empty_input"
    });
  });

  test("normalizes text into runtime input without changing the selected mode", () => {
    expect(
      adaptTextIntent({
        activeMode: "command",
        value: "  打开组织  "
      })
    ).toEqual({
      kind: "message",
      runtimeInput: {
        message: "打开组织",
        mode: "command"
      },
      userMessageContent: "打开组织"
    });

    expect(
      adaptTextIntent({
        activeMode: "qa",
        value: "  这篇论文核心贡献是什么？ "
      })
    ).toMatchObject({
      kind: "message",
      runtimeInput: {
        message: "这篇论文核心贡献是什么？",
        mode: "qa"
      }
    });
  });

  test("unifies voice transcript and automation events with text input", () => {
    expect(
      adaptIntentInput({
        activeMode: "explain",
        source: "voice",
        transcript: "  什么是 late interaction "
      })
    ).toMatchObject({
      kind: "message",
      runtimeInput: {
        message: "什么是 late interaction",
        mode: "explain"
      }
    });

    expect(
      adaptIntentInput({
        command: "打开学术人格里的学术档案",
        requestedMode: "command",
        source: "automation"
      })
    ).toMatchObject({
      kind: "message",
      runtimeInput: {
        message: "打开学术人格里的学术档案",
        mode: "command"
      }
    });
  });

  test("keeps default UI mode selection as an input event without creating a message", () => {
    expect(
      adaptDefaultUiIntent({
        action: "select_mode",
        mode: "qa"
      })
    ).toEqual({
      kind: "mode_change",
      mode: "qa",
      startConversation: false
    });
  });

  test("unifies default UI action events without executing them in the adapter", () => {
    expect(
      adaptDefaultUiIntent({
        action: "trigger_action",
        actionRef: {
          actionId: "artifact.open_tab",
          id: "open-map",
          input: {
            artifactId: "map-1",
            artifactType: "mind_map"
          },
          label: "打开产物",
          riskLevel: "low"
        },
        activeMode: "qa",
        traceId: "trace-answer-map"
      })
    ).toEqual({
      actionRef: {
        actionId: "artifact.open_tab",
        id: "open-map",
        input: {
          artifactId: "map-1",
          artifactType: "mind_map"
        },
        label: "打开产物",
        riskLevel: "low"
      },
      kind: "dynamic_action",
      mode: "qa",
      traceId: "trace-answer-map"
    });
  });
});
