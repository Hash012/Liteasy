import type { AgentActivity, AgentActivityEntry } from "./assistant.types";

export type AgentWorkPreview = { text: string; omittedLines: number };

const previewLineLimit = 6;
const previewCharacterLimit = 720;

/** A display projection only; the original activity entry remains retained. */
export function previewAgentWorkText(value: string, maxLines = previewLineLimit): AgentWorkPreview {
  const normalized = value.trim();
  if (!normalized) return { omittedLines: 0, text: "" };
  const lines = normalized.split(/\r?\n/);
  if (lines.length <= maxLines && normalized.length <= previewCharacterLimit) {
    return { omittedLines: 0, text: normalized };
  }
  if (normalized.length > previewCharacterLimit && lines.length <= maxLines) {
    const half = Math.floor(previewCharacterLimit / 2);
    return { omittedLines: 1, text: `${normalized.slice(0, half)}\n… 内容已缩略，展开查看全部\n${normalized.slice(-half)}` };
  }
  const payloadLines = Math.max(1, maxLines - 1);
  const headCount = Math.ceil(payloadLines / 2);
  const tailCount = Math.floor(payloadLines / 2);
  const omittedLines = Math.max(1, lines.length - headCount - tailCount);
  return {
    omittedLines,
    text: [...lines.slice(0, headCount), `… 省略 ${omittedLines} 行，展开查看全部`, ...lines.slice(-tailCount)].join("\n")
  };
}

export function summarizeAgentActivity(activity: AgentActivity) {
  const counts = activity.entries.reduce<Record<AgentActivityEntry["kind"], number>>(
    (result, entry) => ({ ...result, [entry.kind]: (result[entry.kind] ?? 0) + 1 }),
    { analysis: 0, output: 0, tool: 0 }
  );
  return [
    counts.tool ? `${counts.tool} 个工具调用` : "",
    counts.analysis ? `${counts.analysis} 条分析` : "",
    counts.output ? `${counts.output} 条输出` : ""
  ].filter(Boolean).join(" · ") || "暂无可展开详情";
}

export function isHighSalienceAgentEntry(entry: AgentActivityEntry) {
  return entry.status === "failed" || entry.status === "waiting" || entry.status === "running";
}
