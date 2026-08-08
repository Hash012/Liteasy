import type { AgentEvent } from "../agent-api/agentApi.types";
import type {
  AgentActivity,
  AgentActivityEntry,
  AgentActivityStatus
} from "./assistant.types";
import { toUserVisibleAgentWorkMarkdown } from "../agent-runtime/agentWorkPresentation";

const maxGeneratedContentLength = 12_000;

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

  if (/^[{[]/.test(normalized)) {
    return true;
  }

  const lines = normalized.split(/\r?\n/).filter(Boolean);
  return lines.length > 1 && lines.every((line) => {
    const trimmed = line.trim();
    return /^(?:[{}\[\],]|"[^"\n]+"\s*:)/.test(trimmed);
  });
}

/**
 * Keeps the activity feed conversational. Agent protocols can stream JSON before
 * a final answer is available; that information is neither useful nor safe to
 * expose in the reader-facing sidebar.
 */
export function toUserVisibleAgentActivityText(value: string) {
  const withoutFencedPayloads = redactSensitiveText(value)
    .replace(/```(?:json|jsonc)?\s*[\s\S]*?```/gi, "")
    .trim();

  return isStructuredPayload(withoutFencedPayloads)
    ? ""
    : toUserVisibleAgentWorkMarkdown(withoutFencedPayloads);
}

function trimGeneratedContent(value: string) {
  const safeValue = toUserVisibleAgentActivityText(value);
  return safeValue.length > maxGeneratedContentLength
    ? `…${safeValue.slice(-maxGeneratedContentLength)}`
    : safeValue;
}

function replaceEntry(
  entries: AgentActivityEntry[],
  nextEntry: AgentActivityEntry
) {
  const index = entries.findIndex((entry) => entry.id === nextEntry.id);
  if (index < 0) {
    return [...entries, nextEntry];
  }

  return entries.map((entry, entryIndex) => entryIndex === index ? nextEntry : entry);
}

function completeRunningTools(entries: AgentActivityEntry[]) {
  return entries.map((entry) =>
    entry.kind === "tool" && entry.status === "running"
      ? { ...entry, status: "completed" as const }
      : entry
  );
}

function statusTextFor(status: AgentActivityStatus) {
  if (status === "completed") return "Agent 已完成本次工作";
  if (status === "failed") return "Agent 未能完成本次工作";
  if (status === "cancelled") return "Agent 工作已终止";
  if (status === "waiting") return "Agent 正在等待你的确认或补充";
  return "Agent 正在准备任务";
}

export function createAgentActivity(statusText = statusTextFor("working")): AgentActivity {
  return {
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
    entries: status === "completed" ? completeRunningTools(activity.entries) : activity.entries,
    status,
    statusText: statusTextFor(status)
  };
}

/** Maps public Agent events to safe, human-readable worklog entries. */
export function applyAgentActivityEvent(
  activity: AgentActivity,
  event: AgentEvent
): AgentActivity {
  if (event.type === "run.started") {
    return { ...activity, status: "working", statusText: "Agent 已接收任务，正在准备上下文" };
  }

  if (event.type === "context.prepared") {
    return { ...activity, status: "working", statusText: "任务上下文已准备，正在开始分析" };
  }

  if (event.type === "assistant.delta") {
    return {
      ...activity,
      generatedContent: trimGeneratedContent(`${activity.generatedContent}${event.delta}`),
      status: "working",
      statusText: "正在实时生成内容"
    };
  }

  if (event.type === "analysis.subtask.delta") {
    const entryId = `subtask:${event.subtaskId}`;
    const previous = activity.entries.find((entry) => entry.id === entryId);
    return {
      ...activity,
      entries: replaceEntry(activity.entries, {
        content: trimGeneratedContent(`${previous?.content ?? ""}${event.delta}`),
        id: entryId,
        kind: "analysis",
        label: `并行分析：${toUserVisibleAgentActivityText(event.label) || "正在分析"}`,
        status: "running"
      }),
      status: "working",
      statusText: `正在分析：${toUserVisibleAgentActivityText(event.label) || "当前任务"}`
    };
  }

  if (event.type === "plan.preview") {
    return {
      ...activity,
      entries: replaceEntry(activity.entries, {
        content: toUserVisibleAgentActivityText(event.plan.summary),
        id: event.eventId,
        kind: "analysis",
        label: "工作计划已准备",
        status: "completed"
      }),
      status: "working",
      statusText: "工作计划已准备，正在执行"
    };
  }

  if (event.type === "progress.started") {
    return {
      ...activity,
      progress: event.progress,
      status: "working",
      statusText: `正在执行：${toUserVisibleAgentActivityText(event.summary) || "当前步骤"}`
    };
  }

  if (event.type === "action.requested") {
    return {
      ...activity,
      entries: replaceEntry(activity.entries, {
        content: "调用参数已隐藏。",
        id: event.eventId,
        kind: "tool",
        label: `工具调用：${toUserVisibleAgentActivityText(event.action.actionId) || "已请求"}`,
        status: "running"
      }),
      status: "working",
      statusText: "正在调用工具"
    };
  }

  if (event.type === "confirmation.required" || event.type === "clarification.required") {
    return {
      ...activity,
      entries: replaceEntry(activity.entries, {
        content: toUserVisibleAgentActivityText(
          event.type === "confirmation.required" ? event.summary : event.question
        ),
        id: event.eventId,
        kind: "output",
        label: event.type === "confirmation.required" ? "等待执行确认" : "等待任务补充",
        status: "waiting"
      }),
      status: "waiting",
      statusText: statusTextFor("waiting")
    };
  }

  if (event.type === "action.failed") {
    return {
      ...activity,
      entries: [
        ...activity.entries.map((entry) =>
          entry.kind === "tool" && entry.label.endsWith(event.actionId)
            ? { ...entry, content: toUserVisibleAgentActivityText(event.message), status: "failed" as const }
            : entry
        ),
        {
          content: toUserVisibleAgentActivityText(
            event.recovery ? `${event.message}\n${event.recovery}` : event.message
          ),
          id: event.eventId,
          kind: "output" as const,
          label: "工具输出",
          status: "failed" as const
        }
      ],
      status: "failed",
      statusText: "工具调用未完成"
    };
  }

  if (event.type === "task.requested" || event.type === "task.created" || event.type === "artifact.requested" || event.type === "ui.render") {
    const label = event.type === "task.requested"
      ? "后台任务已请求"
      : event.type === "task.created"
        ? "后台任务已创建"
        : event.type === "artifact.requested"
          ? "产物已请求"
          : "动态界面已生成";
    return {
      ...activity,
      entries: replaceEntry(activity.entries, {
        id: event.eventId,
        kind: "output",
        label,
        status: "completed"
      }),
      status: "working",
      statusText: label
    };
  }

  if (event.type === "assistant.message") {
    return {
      ...activity,
      entries: replaceEntry(activity.entries, {
        id: event.eventId,
        kind: "output",
        label: "最终回复已返回",
        status: "completed"
      })
    };
  }

  if (event.type === "run.failed") {
    return {
      ...activity,
      entries: replaceEntry(activity.entries, {
        content: toUserVisibleAgentActivityText(
          event.recovery ? `${event.message}\n${event.recovery}` : event.message
        ),
        id: event.eventId,
        kind: "output",
        label: "Agent 输出",
        status: "failed"
      }),
      status: "failed",
      statusText: statusTextFor("failed")
    };
  }

  if (event.type === "run.cancelled") {
    return completeAgentActivity(activity, "cancelled");
  }

  if (event.type === "run.completed") {
    return completeAgentActivity(activity, "completed");
  }

  return activity;
}
