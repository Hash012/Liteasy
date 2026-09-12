import type { ArtifactTask } from "../artifacts/artifact.types";
import type { AssistantMessage } from "./assistant.types";
import { createAgentActivity, completeAgentActivity, toUserVisibleAgentActivityText } from "./agentActivity";

export function projectArtifactTaskMessage(task: ArtifactTask, previous?: AssistantMessage): AssistantMessage {
  const detail = toUserVisibleAgentActivityText(task.failure?.message ?? task.message);
  const activity = previous?.agentActivity ?? createAgentActivity("薄读正在准备论文");
  const running = task.status === "queued" || task.status === "running";
  const status = task.status === "failed" ? "failed" : task.status === "cancelled" ? "cancelled" : "completed";
  const stageId = `${task.id}:${task.stage}`;
  const entry = { id: stageId, kind: "runtime" as const, label: detail || "处理论文", content: detail,
    status: running ? "running" as const : task.status === "failed" ? "failed" as const : "completed" as const };
  const entries = activity.entries.filter((item) => item.id !== stageId).map((item) =>
    item.status === "running" ? { ...item, status: "completed" as const } : item);
  const reasoningEntry = task.publicReasoning ? [{ id: `${task.id}:reasoning`, kind: "analysis" as const,
    label: "模型公开推理", content: task.publicReasoning, status: running ? "running" as const : "completed" as const }] : [];
  const draft = task.status !== "completed" && task.partialAnswer ? toUserVisibleAgentActivityText(task.partialAnswer) : "";
  const draftEntry = draft ? [{ id: `${task.id}:draft`, kind: "analysis" as const, label: "正文草稿", content: draft,
    status: running ? "running" as const : "completed" as const }] : [];
  const next = { ...activity, entries: [...entries.filter((item) => item.id !== `${task.id}:reasoning` && item.id !== `${task.id}:draft`), ...reasoningEntry, ...draftEntry, entry], statusText: detail || "正在生成薄读" };
  return {
    id: previous?.id ?? `artifact-progress:${task.id}`, role: "assistant",
    content: task.status === "completed" ? "薄读已保存，可打开阅读，也可在 Lib 的对应论文下重新打开。"
      : task.status === "failed" ? `薄读未完成：${detail}` : task.status === "cancelled" ? "薄读已中断，草稿与上下文已保留，可继续。" : "",
    agentActivity: running ? next : completeAgentActivity(next, status),
    artifactTask: { id: task.id, artifactId: task.artifactId, status: task.status }
  };
}
