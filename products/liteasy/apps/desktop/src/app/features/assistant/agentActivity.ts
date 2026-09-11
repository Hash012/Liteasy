import type { AgentEvent } from "../agent-api/agentApi.types";
import type {
  AgentActivity,
  AgentActivityEntry,
  AgentActivityStatus
} from "./assistant.types";
import { toUserVisibleAgentWorkMarkdown } from "../agent-runtime/agentWorkPresentation";
import { formatAgentRuntimeError } from "../agent-runtime/runtimeObservability";

const maxDetailLength = 12_000;

function redactSensitiveText(value: string) {
  return value
    .replace(/\b(sk-[A-Za-z0-9_-]{16,})\b/g, "[已隐藏的密钥]")
    .replace(
      /\b(api[_-]?key|authorization|bearer|secret|password)\s*[:=]\s*([^\s,;]+)/gi,
      "$1: [已隐藏]"
    );
}

function isStructuredPayload(value: string) {
  const normalized = value.trim();
  if (!normalized) return false;
  if (/^[{[]/.test(normalized)) return true;
  const lines = normalized.split(/\r?\n/).filter(Boolean);
  return lines.length > 1 && lines.every((line) => {
    const trimmed = line.trim();
    return /^(?:[{}\[\],]|"[^"\n]+"\s*:)/.test(trimmed);
  });
}

/** Removes credentials and opaque protocol payloads from SDK-provided summaries. */
export function toUserVisibleAgentActivityText(value: string) {
  const withoutFencedPayloads = redactSensitiveText(value)
    .replace(/```(?:json|jsonc)?\s*[\s\S]*?```/gi, "")
    .trim();
  return isStructuredPayload(withoutFencedPayloads)
    ? ""
    : toUserVisibleAgentWorkMarkdown(withoutFencedPayloads);
}

function safeDetail(value: string | undefined) {
  if (!value) return undefined;
  const safeValue = toUserVisibleAgentActivityText(value);
  if (!safeValue) return undefined;
  return safeValue.length > maxDetailLength
    ? `…${safeValue.slice(-maxDetailLength)}`
    : safeValue;
}

function replaceEntry(entries: AgentActivityEntry[], nextEntry: AgentActivityEntry) {
  const index = entries.findIndex((entry) => entry.id === nextEntry.id);
  return index < 0
    ? [...entries, nextEntry]
    : entries.map((entry, entryIndex) => entryIndex === index ? nextEntry : entry);
}

function statusTextFor(status: AgentActivityStatus) {
  if (status === "completed") return "Manager 已完成本次运行";
  if (status === "failed") return "Manager 运行失败";
  if (status === "cancelled") return "Manager 运行已取消";
  if (status === "waiting") return "Manager 正在等待你的操作";
  return "Manager 正在运行";
}

export function createAgentActivity(statusText = statusTextFor("working")): AgentActivity {
  return {
    connectionText: "已连接主 Agent",
    entries: [],
    generatedContent: "",
    status: "working",
    statusText
  };
}

export function completeAgentActivity(
  activity: AgentActivity,
  status: Exclude<AgentActivityStatus, "working">
): AgentActivity {
  return {
    ...activity,
    connectionText: status === "waiting"
      ? "主 Agent 连接保持中"
      : "主 Agent 连接已结束",
    entries: activity.entries.map((entry) =>
      status === "completed" && entry.status === "running"
        ? { ...entry, status: "completed" as const }
        : entry
    ),
    status,
    statusText: statusTextFor(status)
  };
}

/** Projects the stable public activity events emitted by the active Manager. */
export function applyAgentActivityEvent(activity: AgentActivity, event: AgentEvent): AgentActivity {
  if (event.type === "context.prepared" || event.type === "progress.started" || event.type === "analysis.subtask.delta") {
    const id = event.type === "analysis.subtask.delta" ? event.subtaskId
      : event.type === "progress.started" ? `${event.planId}-${event.phase ?? "progress"}` : `${event.runId}-context`;
    const previous = activity.entries.find((entry) => entry.id === id);
    const label = event.type === "context.prepared" ? "已准备论文与对话上下文"
      : event.type === "progress.started" ? event.summary : event.label;
    const detail = event.type === "analysis.subtask.delta" ? `${previous?.content ?? ""}${event.delta}`
      : event.type === "progress.started" ? event.summary : "本轮使用的上下文已准备完成。";
    return {
      ...activity,
      entries: replaceEntry(activity.entries, {
        id, label: toUserVisibleAgentActivityText(label), content: safeDetail(detail),
        kind: event.type === "analysis.subtask.delta" ? "analysis" : "runtime",
        status: event.type === "context.prepared" ? "completed" : "running"
      })
    };
  }
  if (
    event.type === "execution.route" &&
    (event.runtime === "custom_manager" || event.runtime === "openai_agents_sdk")
  ) {
    return {
      ...activity,
      connectionText: event.label,
      statusText: event.label
    };
  }

  if (event.type === "manager.activity") {
    const kind: AgentActivityEntry["kind"] = event.kind === "reasoning_summary"
      ? "analysis"
      : event.kind === "handoff"
        ? "runtime"
        : event.kind === "tool_call"
          ? "tool"
          : "output";
    const label = toUserVisibleAgentActivityText(event.label) || "Manager 事件";
    return {
      ...activity,
      entries: replaceEntry(activity.entries, {
        content: safeDetail(event.detail),
        id: event.activityId,
        kind,
        label,
        status: event.status
      }),
      status: event.status === "failed" ? "failed" : "working",
      statusText: label
    };
  }

  if (event.type === "run.failed") {
    const failureText = event.error
      ? formatAgentRuntimeError(event.error)
      : event.recovery
        ? `${event.message}\n${event.recovery}`
        : event.message;
    return {
      ...activity,
      entries: replaceEntry(activity.entries, {
        content: safeDetail(failureText),
        id: event.eventId,
        kind: "output",
        label: "Manager 输出",
        status: "failed"
      }),
      status: "failed",
      statusText: statusTextFor("failed")
    };
  }

  if (event.type === "run.cancelled") return completeAgentActivity(activity, "cancelled");
  if (event.type === "run.completed") return completeAgentActivity(activity, "completed");
  return activity;
}
