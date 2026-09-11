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
  const next = { ...activity, entries: [...entries, entry], statusText: detail || "正在生成薄读" };
  return {
    id: previous?.id ?? `artifact-progress:${task.id}`, role: "assistant",
    content: task.status === "completed" ? "薄读已保存，可打开阅读，也可在 Lib 的对应论文下重新打开。"
      : task.status === "failed" ? `薄读未完成：${detail}` : task.status === "cancelled" ? "薄读已取消。" : "",
    agentActivity: running ? next : completeAgentActivity(next, status),
    artifactTask: { id: task.id, artifactId: task.artifactId, status: task.status }
  };
}
