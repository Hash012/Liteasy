import type { UIDslActionRef } from "../generative-ui/generativeUi.types";
import type { AgentRuntimeInput, AssistantMode } from "./agentRuntime.types";

export type IntentInputSource =
  | {
      activeMode: AssistantMode;
      parseSlashCommand?: boolean;
      source: "text";
      value: string;
    }
  | {
      activeMode: AssistantMode;
      source: "voice";
      transcript: string;
    }
  | {
      command: string;
      requestedMode: AssistantMode;
      source: "automation";
    };

export type DefaultUiIntentSource =
  | {
      action: "select_mode";
      mode: AssistantMode;
    }
  | {
      action: "trigger_action";
      actionRef: UIDslActionRef;
      activeMode: AssistantMode;
      traceId?: string;
    };

export type AdaptedIntentInput =
  | {
      kind: "idle";
      reason: "empty_input";
    }
  | {
      kind: "message";
      runtimeInput: AgentRuntimeInput;
      userMessageContent: string;
    }
  | {
      kind: "mode_change";
      mode: AssistantMode;
      startConversation: false;
    }
  | {
      actionRef: UIDslActionRef;
      kind: "dynamic_action";
      mode: AssistantMode;
      traceId?: string;
    };

export type AdaptedMessageIntentInput = Exclude<
  AdaptedIntentInput,
  { kind: "dynamic_action" } | { kind: "mode_change" }
>;

function normalizeMessage(input: string) {
  return input.trim();
}

export function adaptIntentInput(source: IntentInputSource): AdaptedMessageIntentInput {
  const activeMode =
    source.source === "automation" ? source.requestedMode : source.activeMode;
  const rawMessage =
    source.source === "voice"
      ? source.transcript
      : source.source === "automation"
        ? source.command
        : source.value;
  const message = normalizeMessage(rawMessage);

  if (message.length === 0) {
    return {
      kind: "idle",
      reason: "empty_input"
    };
  }

  if (source.source === "text" && source.parseSlashCommand && message.startsWith("/")) {
    const commandMessage = normalizeMessage(message.slice(1));
    if (commandMessage.length === 0) {
      return {
        kind: "idle",
        reason: "empty_input"
      };
    }

    return {
      kind: "message",
      runtimeInput: {
        message: commandMessage,
        mode: "command"
      },
      userMessageContent: `/${commandMessage}`
    };
  }

  return {
    kind: "message",
    runtimeInput: {
      message,
      mode: activeMode
    },
    userMessageContent: message
  };
}

export function adaptTextIntent(input: {
  activeMode: AssistantMode;
  parseSlashCommand?: boolean;
  value: string;
}): AdaptedMessageIntentInput {
  return adaptIntentInput({
    activeMode: input.activeMode,
    parseSlashCommand: input.parseSlashCommand,
    source: "text",
    value: input.value
  });
}

export function adaptDefaultUiIntent(source: DefaultUiIntentSource): AdaptedIntentInput {
  if (source.action === "trigger_action") {
    return {
      actionRef: source.actionRef,
      kind: "dynamic_action",
      mode: source.activeMode,
      traceId: source.traceId
    };
  }

  return {
    kind: "mode_change",
    mode: source.mode,
    startConversation: false
  };
}
