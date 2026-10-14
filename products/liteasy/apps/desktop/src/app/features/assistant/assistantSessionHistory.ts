import { contextInstructionText } from "./inlineContext";
import type { createAssistantStore } from "./assistant.store";
import type { AssistantContextToken, AssistantMessage, AssistantMode, AssistantState } from "./assistant.types";
import type { ReaderConversationContext } from "./assistantContext.types";
import type { ArtifactTask, ArtifactType } from "../artifacts/artifact.types";
import { presentArtifactFailure } from "../artifacts/artifactFailurePresentation";
import { artifactDiagnostic, type ArtifactDiagnostic } from "../artifacts/artifactDiagnostic";
import { projectArtifactTaskMessage } from "./assistantArtifactActivity";

export type AssistantTaskStartResult = string | { message: string; taskIds: string[] };
export type ArtifactSessionOpenRequest = { requestId: string; taskId: string };
export type AssistantSessionDraft = { selectedResearchSkill?: import("../research-skills/researchDocument").ResearchSkillSelection; input: string; tokens: AssistantContextToken[]; readerContexts: ReaderConversationContext[]; selection?: { start: number; end: number }; thinkingDepth?: import("./thinkingDepth").ThinkingDepth };
import type { AssistantOrigin, AssistantTaskBinding } from "./assistantSessionContracts";
import type { ObjectRef } from "../objects/object.types";

export type AssistantSessionKind = "conversation" | "artifact_generation";
export type AssistantSessionStatus = "idle" | "running" | "completed" | "failed" | "cancelled" | "interrupted" | "unknown";

export type AssistantSessionHistoryItem = {
  schemaVersion?: "liteasy.assistant-session/v2";
  scopeId?: string;
  origin?: AssistantOrigin;
  titleSource?: "automatic" | "model" | "user";
  titleVersion?: number;
  titleNaming?: import("./assistantSessionTitles").SessionTitleNaming;
  lifecycle?: "active" | "archived" | "tombstoned";
  pinned?: boolean;
  readAt?: string;
  branchId?: string;
  parentConversationId?: string;
  branchBoundaryMessageId?: string;
  sourceTaskId?: string;
  resultRefs?: ObjectRef[];
  taskBinding?: AssistantTaskBinding;
  taskRuns?: Array<{ id: string; taskId: string; status: AssistantSessionStatus; messages: AssistantMessage[]; artifactId?: string; resultRefs?: ObjectRef[]; diagnostic?: ArtifactDiagnostic }>;
  taskInput?: {
    taskId: string;
    workflowId: string;
    sourcePaperIds: string[];
    contextRefs: import("../context/objectContext").ContextRef[];
    supplementalContext?: string;
    systemPrompt?: string;
    available: boolean;
  };
  messagesLoaded?: boolean;
  messageCount?: number;
  runId?: string;
  inbox?: { runId: string; sequence: number; eventIds: string[] };
  scrollAnchor?: { messageId: string; offset: number };
  outbox?: Array<{ requestId: string; userMessageId: string; state: "pending" | "accepted" | "finished" | "needs_review"; runId?: string; input: unknown }>;

  artifactId?: string;
  artifactTaskId?: string;
  artifactType?: ArtifactType;
  createdAt?: string;
  draft?: AssistantSessionDraft;
  id: string;
  kind?: AssistantSessionKind;
  messages: AssistantMessage[];
  mode: AssistantMode;
  publicAgentClientSessionId?: string;
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
  research_document: "科研文档",
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

export function getConversationTitle(messages: AssistantMessage[], fallback: string) {
  const first = messages.find((message) => message.role === "user");
  if (!first) return fallback;
  const request = contextInstructionText(first.content, first.contextTokens ?? []).trim();
  const topics: Array<[RegExp, string]> = [
    [/投稿|选题|\bidea[s]?\b/i, "研究选题"], [/对比|比较|compare/i, "文献比较"],
    [/翻译|translate/i, "翻译与理解"], [/总结|概括|摘要|summari/i, "内容总结"],
    [/写入|修改|笔记|编辑|\bedit\b/i, "笔记整理"], [/解释|讲解|分析|explain|analy/i, "阅读与分析"],
  ];
  const intent = topics.find(([pattern]) => pattern.test(request))?.[1];
  const subjects = (first.contextTokens ?? []).slice(0, 2).map((token) => {
    const name = token.label.replace(/^[@/$]/, "").split(/[:：]/)[0].trim();
    return name.length > 18 ? `${name.slice(0, 17)}…` : name;
  });
  const title = intent && subjects.length ? [...subjects, intent].join(" · ") : request.replace(/\s+/g, " ");
  return title.length > 48 ? `${title.slice(0, 47)}…` : title || fallback;
}

export function conversationDigest(messages: AssistantMessage[]) {
  const requests = messages.filter((message) => message.role === "user");
  const latest = [...messages].reverse().find((message) => message.role === "assistant" && message.content.trim());
  return { turns: requests.length, requests: requests.slice(-3).map((message) => contextInstructionText(message.content, message.contextTokens ?? []).slice(0, 320)),
    latest: latest?.content.slice(0, 1600) ?? "" };
}

function formatArtifactLiveOutput(value: string | undefined) {
  const content = value?.trim();
  if (!content) return "";
  // Keep readable streamed prose in the activity session, while preventing partial
  // JSON objects, trace IDs and tool envelopes from becoming user-facing chat text.
  if (/^[{\[]/.test(content.replace(/^```json\s*/i, ""))) {
    return "实时内容正在产物区域整理为可读页面。";
  }
  return `\n实时生成内容：\n${content}`;
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
  const sessionId = id ?? createSessionId(now, randomId);
  return {
    schemaVersion: "liteasy.assistant-session/v2",
    origin: { kind: "direct_chat", entryPoint: "assistant.composer", initiatedBy: { type: "user", id: "local" } },
    titleSource: "automatic",
    lifecycle: "active",
    branchId: sessionId,
    createdAt: timestamp,
    id: sessionId,
    kind,
    messages: [],
    mode,
    ...(kind === "conversation"
      ? { publicAgentClientSessionId: `assistant-pane:${sessionId}` }
      : {}),
    status: "idle",
    title,
    updatedAt: timestamp
  };
}

export function resolveAssistantPublicAgentClientSessionId(session: AssistantSessionHistoryItem) {
  return session.publicAgentClientSessionId ?? `assistant-pane:${session.id}`;
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
      : session.status && ["cancelled", "unknown", "interrupted"].includes(session.status)
        ? session.status
        : "idle",
    title: (session.titleSource === "user" || session.titleSource === "model") ? session.title : getConversationTitle(state.messages, session.title),
    messagesLoaded: true,
    messageCount: state.messages.length,
    updatedAt: state.messages.length !== session.messages.length || state.pending !== (session.status === "running")
      ? createTimestamp(now) : session.updatedAt
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

export function getArtifactTaskSessionId(
  taskId: string,
  task?: Pick<ArtifactTask, "artifactId" | "type">
) {
  // A thin-reading artifact is a paper-bound reading trail. Its root and every
  // deeper page therefore belong to one conversation surface, not one session per run.
  if (task?.type === "thin_reading" && task.artifactId) {
    return `artifact:thin-reading:${task.artifactId}`;
  }
  return `artifact-task:${taskId}`;
}

export function createArtifactTaskSession(
  task: ArtifactTask,
  previous?: AssistantSessionHistoryItem,
  now: () => number = Date.now,
  options: { developerDiagnostics?: boolean } = {}
): AssistantSessionHistoryItem {
  const sessionId = getArtifactTaskSessionId(task.id, task);
  const title = `生成：${artifactTypeLabels[task.type]}`;
  const failurePresentation = task.status === "failed" && task.failure
    ? presentArtifactFailure(task.failure, options.developerDiagnostics)
    : undefined;
  const progressMessage = [
    failurePresentation?.message ?? task.message,
    `阶段：${artifactStageLabels[task.stage]}`,
    task.status === "failed" && task.failure && options.developerDiagnostics
      ? [
          "\n错误信息：",
          `- 错误编号：${failurePresentation?.code}`,
          `- 原因：${failurePresentation?.message}`,
          `- 失败阶段：${artifactStageLabels[task.failure.failedStage]}`,
          `- 时间：${task.failure.occurredAt}`,
          ...(failurePresentation?.traceId
            ? [`- 追踪编号：${failurePresentation.traceId}`]
            : []),
          ...(failurePresentation?.diagnostics
            ? [
                `- 内部异常：${failurePresentation.diagnostics.message}`,
                ...(failurePresentation.diagnostics.endpoint
                  ? [`- 服务端点：${failurePresentation.diagnostics.endpoint}`]
                  : []),
                ...(failurePresentation.diagnostics.provider
                  ? [`- Provider：${failurePresentation.diagnostics.provider}`]
                  : []),
                ...(failurePresentation.diagnostics.model
                  ? [`- Model：${failurePresentation.diagnostics.model}`]
                  : [])
              ]
            : []),
          ...task.failure.recovery.map((item) => `- 建议：${item}`)
        ].filter(Boolean).join("\n")
      : "",
    formatArtifactLiveOutput(task.partialAnswer)
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

  const thinReadingMessages = previous?.messages.filter((message) => message.artifactTask) ?? [];
  if (task.type === "thin_reading") {
    const index = thinReadingMessages.findIndex((message) => message.artifactTask?.id === task.id);
    const message = projectArtifactTaskMessage(failurePresentation && task.failure
      ? { ...task, failure: { ...task.failure, message: failurePresentation.message } }
      : task, thinReadingMessages[index]);
    if (task.failure) message.content = `薄读未完成。\n${progressMessage}`;
    if (index >= 0) thinReadingMessages[index] = message;
    else thinReadingMessages.push(message);
  }

  const runId = task.agentRunId ?? `${task.id}:attempt:${task.attempt ?? 0}`;
  const runMessages: AssistantMessage[] = task.type === "thin_reading"
    ? thinReadingMessages.filter((message) => message.artifactTask?.id === task.id)
    : [{ content: progressMessage, id: `${sessionId}:progress`, role: "assistant", runId }];
  const taskRuns = (previous?.taskRuns ?? []).filter((run) => !(task.agentRunId && run.taskId === task.id && run.status === "running" && run.id === `${task.id}:attempt:${task.attempt ?? 0}`));
  const runIndex = taskRuns.findIndex((run) => run.id === runId);
  const attempt = { id: runId, taskId: task.id, status, messages: runMessages, diagnostic: artifactDiagnostic(task), artifactId: task.status === "completed" ? task.artifactId : undefined };
  if (runIndex < 0) taskRuns.push(attempt); else taskRuns[runIndex] = { ...taskRuns[runIndex], ...attempt };
  return {
    ...previous,
    taskRuns,
    schemaVersion: "liteasy.assistant-session/v2",
    origin: task.origin ?? previous?.origin ?? { kind: "legacy_unknown", entryPoint: "legacy", initiatedBy: { type: "import", id: "local" } },
    taskInput: previous?.taskInput ?? {
      taskId: task.id, workflowId: task.type, sourcePaperIds: task.sourcePaperIds ?? task.recovery?.papers.map((paper) => paper.id) ?? [],
      contextRefs: structuredClone(task.researchInvocation?.inputs.flatMap(input => input.refs) ?? task.recovery?.options?.contextRefs ?? []),
      supplementalContext: task.recovery?.options?.supplementalContext,
      systemPrompt: task.recovery?.options?.systemPrompt,
      available: !!task.recovery
    },
    taskBinding: {
      schemaVersion: "liteasy.workflow-task/v2", taskId: sessionId,
      origin: task.origin ?? previous?.origin ?? { kind: "legacy_unknown", entryPoint: "legacy", initiatedBy: { type: "import", id: "local" } },
      workflowId: task.researchInvocation?.skill.id ?? task.type, workflowVersion: task.researchInvocation?.skill.version ?? "1", inputSnapshotId: task.researchInvocation?.contextSnapshotId ?? previous?.taskBinding?.inputSnapshotId ?? `assistant/v2/task-input/${encodeURIComponent(task.id)}`,
      runIds: [...new Set([...(previous?.taskBinding?.runIds ?? []), ...(task.agentRunId ? [task.agentRunId] : [])])],
      resultRefs: previous?.taskBinding?.resultRefs ?? [], relatedConversationId: task.origin?.parentConversationId ?? previous?.taskBinding?.relatedConversationId
    },
    artifactId: task.artifactId ?? previous?.artifactId,
    artifactTaskId: task.id,
    artifactType: task.type,
    createdAt: previous?.createdAt ?? timestamp,
    draft: previous?.draft,
    id: sessionId,
    kind: "artifact_generation",
    messages: task.type === "thin_reading" ? [
      ...thinReadingMessages
    ] : [
      {
        content: progressMessage,
        id: `${sessionId}:progress`,
        role: "assistant"
      }
    ],
    mode: "qa",
    status,
    title: (previous?.titleSource === "user" || previous?.titleSource === "model") ? previous.title : title,
    updatedAt: previous?.status === status && previous.artifactTaskId === task.id ? previous.updatedAt : timestamp
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

  return [
    {
      id: createSessionId(now, randomId),
      messages,
      mode: state.mode,
      title: getConversationTitle(messages, "未命名会话")
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
