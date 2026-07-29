import type { createAssistantStore } from "./assistant.store";
import type { AssistantMessage, AssistantMode, AssistantState } from "./assistant.types";
import type { ArtifactTask, ArtifactType } from "../artifacts/artifact.types";

export type AssistantSessionKind = "conversation" | "artifact_generation";
export type AssistantSessionStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

export type AssistantSessionHistoryItem = {
  artifactId?: string;
  artifactTaskId?: string;
  createdAt?: string;
  id: string;
  kind?: AssistantSessionKind;
  messages: AssistantMessage[];
  mode: AssistantMode;
  status?: AssistantSessionStatus;
  title: string;
  updatedAt?: string;
};

type CreateAssistantSessionInput = {
  id?: string;
  kind?: AssistantSessionKind;
  mode?: AssistantMode;
  now?: () => number;
  randomId?: () => string;
  title?: string;
};

type SnapshotAssistantSessionInput = {
  now?: () => number;
  session: AssistantSessionHistoryItem;
  state: AssistantState;
};

type ArchiveAssistantSessionInput = {
  currentHistory: AssistantSessionHistoryItem[];
  now?: () => number;
  randomId?: () => string;
  state: AssistantState;
};

type RestoreAssistantSessionInput = {
  history: AssistantSessionHistoryItem[];
  sessionId: string;
  store: ReturnType<typeof createAssistantStore>;
};

function createSessionId(now: () => number, randomId: () => string) {
  return `session-${now()}-${randomId()}`;
}

const artifactTypeLabels: Record<ArtifactType, string> = {
  comparison_table: "论文对比表",
  layered_graph: "分层关系图",
  mindmap: "思维导图",
  ppt: "演示文稿",
  skill_doc: "技能文档",
  thin_reading: "薄读",
  tree: "文献树"
};

const artifactStageLabels: Record<ArtifactTask["stage"], string> = {
  auditing_answer: "核验回答",
  cancelled: "已终止",
  completed: "生成完成",
  failed: "生成失败",
  generating_answer: "流式生成",
  preparing_context: "准备上下文",
  retrieving_evidence: "检索论文证据",
  saving_result: "持久保存",
  structuring_artifact: "构建产物结构",
  thin_reading_generating_branch: "生成薄读下一层",
  thin_reading_generating_root: "生成薄读总述",
  thin_reading_parsing_document: "解析论文文本",
  thin_reading_planning: "规划薄读路径",
  thin_reading_repairing_trace: "修复句级证据映射",
  thin_reading_retrieving_evidence: "检索薄读证据",
  thin_reading_retrieving_external_knowledge: "检索外部文献",
  thin_reading_saving: "保存薄读节点",
  thin_reading_validating: "核验薄读证据",
  waiting_for_import: "等待 PDF 解析"
};

function createTimestamp(now: () => number) {
  return new Date(now()).toISOString();
}

function getConversationTitle(messages: AssistantMessage[], fallback: string) {
  return messages.find((message) => message.role === "user")?.content.trim() || fallback;
}

export function createAssistantSession({
  id,
  kind = "conversation",
  mode = "qa",
  now = Date.now,
  randomId = () => Math.random().toString(36).slice(2, 8),
  title = "新对话"
}: CreateAssistantSessionInput = {}): AssistantSessionHistoryItem {
  const timestamp = createTimestamp(now);
  return {
    createdAt: timestamp,
    id: id ?? createSessionId(now, randomId),
    kind,
    messages: [],
    mode,
    status: "idle",
    title,
    updatedAt: timestamp
  };
}

export function snapshotAssistantSession({
  now = Date.now,
  session,
  state
}: SnapshotAssistantSessionInput): AssistantSessionHistoryItem {
  return {
    ...session,
    kind: session.kind ?? "conversation",
    messages: [...state.messages],
    mode: state.mode,
    status: state.pending
      ? "running"
      : session.status === "cancelled"
        ? "cancelled"
        : "idle",
    title: getConversationTitle(state.messages, session.title),
    updatedAt: createTimestamp(now)
  };
}

export function upsertAssistantSession(
  sessions: AssistantSessionHistoryItem[],
  session: AssistantSessionHistoryItem
) {
  const existingIndex = sessions.findIndex((candidate) => candidate.id === session.id);
  if (existingIndex < 0) {
    return [session, ...sessions];
  }

  return sessions.map((candidate) => candidate.id === session.id ? session : candidate);
}

export function getArtifactTaskSessionId(taskId: string) {
  return `artifact-task:${taskId}`;
}

export function createArtifactTaskSession(
  task: ArtifactTask,
  previous?: AssistantSessionHistoryItem,
  now: () => number = Date.now
): AssistantSessionHistoryItem {
  const sessionId = getArtifactTaskSessionId(task.id);
  const title = `生成：${artifactTypeLabels[task.type]}`;
  const progress = Math.max(0, Math.min(100, Math.round(task.progress)));
  const progressMessage = [
    task.message,
    `阶段：${artifactStageLabels[task.stage]}`,
    `进度：${progress}%`,
    task.failure
      ? [
          "\n失败诊断：",
          `- 原因：${task.failure.message}`,
          `- 失败阶段：${artifactStageLabels[task.failure.failedStage]}`,
          task.failure.endpoint ? `- Agent 服务端点：${task.failure.endpoint}` : "",
          task.failure.provider ? `- Provider：${task.failure.provider}` : "",
          task.failure.model ? `- Model：${task.failure.model}` : "",
          `- 时间：${task.failure.occurredAt}`,
          ...task.failure.recovery.map((item) => `- 建议：${item}`)
        ].filter(Boolean).join("\n")
      : "",
    task.partialAnswer?.trim() ? `\n实时生成内容：\n${task.partialAnswer.trim()}` : ""
  ].filter(Boolean).join("\n");
  const timestamp = createTimestamp(now);
  const status: AssistantSessionStatus =
    task.status === "completed"
      ? "completed"
      : task.status === "failed"
        ? "failed"
        : task.status === "cancelled"
          ? "cancelled"
        : "running";

  return {
    artifactId: task.artifactId ?? previous?.artifactId,
    artifactTaskId: task.id,
    createdAt: previous?.createdAt ?? timestamp,
    id: sessionId,
    kind: "artifact_generation",
    messages: [
      {
        content: title,
        id: `${sessionId}:request`,
        role: "user"
      },
      {
        content: progressMessage,
        id: `${sessionId}:progress`,
        role: "assistant"
      }
    ],
    mode: "qa",
    status,
    title,
    updatedAt: timestamp
  };
}

export function archiveAssistantSession({
  currentHistory,
  now = Date.now,
  randomId = () => Math.random().toString(36).slice(2, 8),
  state
}: ArchiveAssistantSessionInput): AssistantSessionHistoryItem[] {
  if (state.messages.length === 0) {
    return currentHistory;
  }

  const messages = [...state.messages];
  const firstUserMessage = messages.find((message) => message.role === "user");

  return [
    {
      id: createSessionId(now, randomId),
      messages,
      mode: state.mode,
      title: firstUserMessage?.content ?? "未命名会话"
    },
    ...currentHistory
  ];
}

export function restoreAssistantSession({
  history,
  sessionId,
  store
}: RestoreAssistantSessionInput) {
  const session = history.find((historyItem) => historyItem.id === sessionId);
  if (!session) {
    return false;
  }

  store.restoreSession(session.mode, session.messages);
  return true;
}
