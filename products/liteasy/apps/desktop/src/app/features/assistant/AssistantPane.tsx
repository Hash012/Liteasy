import { readerContextDragMime, readDraggedReaderContext } from "./readerContextDrag";
import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@fluentui/react-components";
import { AddRegular, DismissRegular, HistoryRegular } from "@fluentui/react-icons";
import { AssistantComposer } from "./AssistantComposer";
import { AssistantHistoryPanel } from "./AssistantHistoryPanel";
import { AssistantMessageList } from "./AssistantMessageList";
import type {
  AssistantConfirmationRequest,
  AgentActivityStatus,
  AssistantMessage,
  AssistantComposerSuggestion,
  AssistantContextToken,
  AssistantMode,
  AssistantState,
  SelectedSetStatus
} from "./assistant.types";
import {
  applyAgentActivityEvent,
  completeAgentActivity,
  createAgentActivity
} from "./agentActivity";
import { formatAgentRuntimeError } from "../agent-runtime/runtimeObservability";
import type { FrontendAgentClient } from "../agent-api/frontendAgentClient";
import type {
  AgentAttachment,
  AgentConfirmationRequest,
  AgentEvent,
  AgentRun,
  PublicWorkflowAuditSummary
} from "../agent-api/agentApi.types";
import { createSettingsStore } from "../settings/settings.store";
import type { ArtifactTask, ArtifactType } from "../artifacts/artifact.types";
import { createAssistantStore } from "./assistant.store";
import {
  createArtifactTaskSession,
  createAssistantSession,
  getArtifactTaskSessionId,
  resolveAssistantPublicAgentClientSessionId,
  snapshotAssistantSession,
  upsertAssistantSession,
  type AssistantSessionHistoryItem
} from "./assistantSessionHistory";
import { buildAgentRuntimeContextView } from "../agent-runtime/contextView";
import { executeUIDslActionRef } from "../agent-runtime/dynamicActionExecutor";
import { adaptDefaultUiIntent, adaptTextIntent } from "../agent-runtime/intentInputAdapter";
import {
  executeConfirmedSemanticPlan,
  rejectHumanConfirmation
} from "../agent-runtime/planExecutor";
import type {
  AgentRuntimeEvent,
  AgentRuntimeExecutionContext,
  HumanConfirmationRequest,
  PendingCommandClarification
} from "../agent-runtime/agentRuntime.types";
import {
  createExecutionJournal,
  type ExecutionJournal
} from "../generative-ui/executionJournal";
import type { UIDslActionRef, UIDslDocument } from "../generative-ui/generativeUi.types";
import { validateUIDslDocument } from "../generative-ui/uiDslValidator";
import { createModelAssistedJournalAuditModel } from "../generative-ui/journalAuditModel";
import { createModelAssistedUIDslGenerator } from "../generative-ui/uiDslGenerator";
import { createModelAssistedClarification } from "../agent-runtime/modelClarification";
import { createModelSemanticPlanner } from "../agent-runtime/modelSemanticPlanner";
import { runAgentRuntime } from "../agent-runtime/runtimeOrchestrator";
import type { ModelTransport } from "../models/modelHttpClient";
import type { AcademicProfile } from "../profile/profile.types";
import type { ActionContext } from "../skills/actionRegistry";
import type { Paper, WorkspaceSource } from "../workspace/workspace.types";
import type { SettingsState } from "../settings/settings.types";
import type { Citation, RetrievalChunk } from "../retrieval/retrieval.types";
import { defaultAgentCoreConfig } from "../agent-core/agentCoreConfig";
import type { AnswerAuditResult } from "./answerAuditor";
import type { ModelExecutionTrace } from "../models/modelExecution";
import type { ModelAuditTransport } from "../models/modelAuditClient";
import { AssistantContextPanel } from "./AssistantContextPanel";
import {
  getAssistantErrorMessage,
  getModeHint,
  getSelectedSetReadyMessage
} from "./assistantPresentation";
import type { ReaderConversationContext } from "./assistantContext.types";
import { generateAssistantAnswer } from "./generateAssistantAnswer";

import { artifactSlashSuggestions, requestedArtifactType } from "../artifacts/artifactInvocation";
import { projectArtifactTaskMessage } from "./assistantArtifactActivity";
import type { AssistantHistoryPersistence, AssistantHistorySnapshot } from "./assistantHistoryPersistence";

type SettingsStoreLike = ReturnType<typeof createSettingsStore>;

type QueuedAssistantTurn = {
  attachedContextPrompt: string;
  contextTokens: AssistantContextToken[];
  message: string;
  mode: AssistantMode;
  policy: "after_run" | "after_tool" | "interrupt";
  readerContexts: ReaderConversationContext[];
  referencedPaperIds: string[];
  userContent: string;
  userMessageId: string;
};

export function hasPaperGroundedAuditScope(run: AgentRun) {
  return Boolean(
    run.attachments?.some(
      (attachment) => attachment.source === "paper" || attachment.source === "selection"
    ) || run.events.some(
      (event) => event.type === "assistant.message" && Boolean(event.citations?.length)
    )
  );
}

type AssistantPaneProps = {
  /**
   * The application always supplies the public Agent client. Keeping this optional
   * makes the pane usable in isolated previews and provides a real model-backed
   * fallback for legacy embeds while the Agent host is being initialized.
   */
  agentClient?: FrontendAgentClient;
  historyPersistence?: AssistantHistoryPersistence;
  academicProfile?: AcademicProfile;
  artifactTasks?: ArtifactTask[];
  developerDiagnostics?: boolean;
  executionJournal?: ExecutionJournal;
  importedChunksByPaperId?: Record<string, RetrievalChunk[]>;
  auditTransport?: ModelAuditTransport;
  modelTransport?: ModelTransport;
  onApplyGeneratedTheme?: ActionContext["applyGeneratedTheme"];
  onApplyLayoutPreset?: ActionContext["applyLayoutPreset"];
  onApplyPanelAction?: ActionContext["applyPanelAction"];
  onApplyThemePreset?: ActionContext["applyThemePreset"];
  onResumeArtifactTask?: (taskId: string) => Promise<void>;
  onCancelArtifactTask?: (taskId: string) => string | Promise<string>;
  onGenerateArtifact: (artifactType: ArtifactType, paperIds?: string[], context?: string) => string;
  onImportSelectedSet?: ActionContext["importSelectedSet"];
  onPreparePapersForContext?: (paperIds: string[]) => Promise<void>;
  onMoveDockItem?: ActionContext["moveDockItem"];
  onOpenAcademicArchive?: ActionContext["openAcademicArchive"];
  onOpenArtifact?: (artifactId: string) => void;
  onOpenCitation?: (citation: Citation) => void;
  onOpenOrganizationSharedLibrary?: () => string | Promise<string>;
  onActiveSessionChange?: (session: AssistantSessionHistoryItem) => void;
  onSettingsChanged?: (settings: SettingsState) => void;
  profilePersonalizationSummary?: string;
  profileUnlocked?: boolean;
  registrationWelcomeMessage?: { content: string; id: number };
  readerConversationContext?: ReaderConversationContext | null;
  runtimeOrganizationName?: string;
  availablePapers?: Paper[];
  runtimeWorkspace?: Partial<WorkspaceSource>;
  selectedPapers?: Paper[];
  selectedSetStatus: SelectedSetStatus;
  settingsStore?: SettingsStoreLike;
};

function isPublicConfirmation(
  confirmation: AssistantConfirmationRequest
): confirmation is AgentConfirmationRequest {
  return !("plan" in confirmation);
}

function cloneAssistantState(state: AssistantState): AssistantState {
  return {
    mode: state.mode,
    messages: [...state.messages],
    pending: state.pending
  };
}

function createMessage(role: AssistantMessage["role"], content: string): AssistantMessage {
  return {
    content,
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role
  };
}


function formatRuntimeEvent(event: AgentRuntimeEvent): string {
  if (event.type === "plan_preview") {
    return `计划：${event.plan.summary}`;
  }

  if (event.type === "assistant_reply" || event.type === "runtime_error") {
    return event.message;
  }

  if (event.type === "confirmation_request") {
    return event.summary;
  }

  if (event.type === "clarification_request") {
    return event.question;
  }

  if (event.type === "action_request") {
    return `准备执行受控动作：${event.action.actionId}`;
  }

  if (event.type === "action_failed") {
    return event.message;
  }

  if (event.type === "progress_started") {
    return `开始执行：${event.summary}`;
  }

  if (event.type === "artifact_request") {
    return `准备打开产物：${event.artifact.artifactType}`;
  }

  if (event.type === "ui_dsl_ready") {
    return "动态界面已准备。";
  }

  if (event.type === "task_created") {
    return `任务已创建：${event.task.taskType}`;
  }

  return `任务请求：${event.task.taskType}`;
}

function isHumanConfirmationEvent(event: AgentRuntimeEvent): event is HumanConfirmationRequest {
  return (
    event.type === "confirmation_request" &&
    "confirmationId" in event &&
    "plan" in event &&
    "traceId" in event
  );
}

function getTraceIdFromRuntimeEvents(events: AgentRuntimeEvent[]) {
  const progressEvent = events.find((event) => event.type === "progress_started");
  if (progressEvent?.type === "progress_started") {
    return progressEvent.traceId;
  }

  const confirmationEvent = events.find(isHumanConfirmationEvent);
  if (confirmationEvent) {
    return confirmationEvent.traceId;
  }

  const planEvent = events.find((event) => event.type === "plan_preview");
  if (planEvent?.type === "plan_preview") {
    return `trace-${planEvent.plan.planId}`;
  }

  const uiDslEvent = events.find((event) => event.type === "ui_dsl_ready");
  if (uiDslEvent?.type === "ui_dsl_ready") {
    return uiDslEvent.document.audit.traceId;
  }

  return undefined;
}

function createConversationIdempotencyKey(mode: AssistantMode) {
  const randomPart = globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `conversation:${mode}:${randomPart}`;
}

export function AssistantPane({
  agentClient,
  historyPersistence,
  academicProfile,
  artifactTasks = [],
  auditTransport,
  developerDiagnostics = false,
  executionJournal,
  importedChunksByPaperId = {},
  modelTransport,
  onApplyGeneratedTheme,
  onApplyLayoutPreset,
  onApplyPanelAction,
  onApplyThemePreset,
  onResumeArtifactTask,
  onCancelArtifactTask,
  onGenerateArtifact,
  onImportSelectedSet,
  onPreparePapersForContext,
  onMoveDockItem,
  onOpenAcademicArchive,
  onOpenArtifact,
  onOpenCitation,
  onOpenOrganizationSharedLibrary,
  onActiveSessionChange,
  onSettingsChanged,
  profilePersonalizationSummary,
  profileUnlocked = false,
  registrationWelcomeMessage,
  readerConversationContext = null,
  runtimeOrganizationName,
  runtimeWorkspace,
  selectedPapers = [],
  availablePapers = selectedPapers,
  selectedSetStatus,
  settingsStore
}: AssistantPaneProps) {
  const assistantStoreRef = useRef(createAssistantStore());
  const initialSessionRef = useRef(
    createAssistantSession({
      mode: "command"
    })
  );
  const activeSessionIdRef = useRef(initialSessionRef.current.id);
  const sessionRegistryRef = useRef<AssistantSessionHistoryItem[]>([
    initialSessionRef.current
  ]);
  const knownArtifactTaskIdsRef = useRef(new Set<string>());
  const deliveredRegistrationWelcomeMessageIdsRef = useRef(new Set<number>());
  const executionJournalRef = useRef(executionJournal ?? createExecutionJournal());
  const processedAgentRunSequencesRef = useRef(new Map<string, number>());
  const processedAgentActivityEventIdsRef = useRef(new Set<string>());
  const processedAgentMessageEventIdsRef = useRef(new Set<string>());
  const agentActivityMessageIdsByRunRef = useRef(new Map<string, string>());
  const activeConversationRunRef = useRef<{
    cancelRequested: boolean;
    cancelSent: boolean;
    client: FrontendAgentClient;
    activityMessageId: string;
    message: string;
    runId?: string;
  } | null>(null);
  const queuedAssistantTurnsRef = useRef<QueuedAssistantTurn[]>([]);
  const publicAgentClientsRef = useRef(new Map<string, FrontendAgentClient>());
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const lastReaderContextKeyRef = useRef<string | null>(null);
  const commandPaperIdsRef = useRef<string[] | undefined>();
  const pendingCommandClarificationRef = useRef<PendingCommandClarification | undefined>();
  const settingsStoreRef = useRef(settingsStore ?? createSettingsStore());
  const [assistantState, setAssistantState] = useState<AssistantState>(() =>
    cloneAssistantState(assistantStoreRef.current.getState())
  );
  const [activeSessionId, setActiveSessionId] = useState(initialSessionRef.current.id);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [input, setInput] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [voiceInputMessage, setVoiceInputMessage] = useState<string | undefined>();
  const [sessionHistory, setSessionHistory] = useState<AssistantSessionHistoryItem[]>([
    initialSessionRef.current
  ]);
  const [composerContextTokens, setComposerContextTokens] = useState<AssistantContextToken[]>([]);
  const [readerContexts, setReaderContexts] = useState<ReaderConversationContext[]>([]);
  const [cancellingSession, setCancellingSession] = useState(false);
  const [historyReady, setHistoryReady] = useState(!historyPersistence);
  const historyReadyRef = useRef(!historyPersistence);
  const mountedRef = useRef(true);
  const [historyError, setHistoryError] = useState<string>();
  const [historyLoadAttempt, setHistoryLoadAttempt] = useState(0);
  const draftRef = useRef({ input, tokens: composerContextTokens, readerContexts });
  draftRef.current = { input, tokens: composerContextTokens, readerContexts };

  function persistConversation() {
    if (!historyPersistence || !historyReadyRef.current || !mountedRef.current) return;
    const snapshot: AssistantHistorySnapshot = {
      version: "liteasy.assistant-history/v1", activeSessionId: activeSessionIdRef.current,
      sessions: sessionRegistryRef.current, draft: draftRef.current
    };
    void historyPersistence.save(snapshot).then(() => {
      if (mountedRef.current) setHistoryError(undefined);
    }).catch((error) => {
      if (mountedRef.current) setHistoryError(`对话保存失败：${error instanceof Error ? error.message : String(error)}`);
    });
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      persistConversation();
      mountedRef.current = false;
      const run = activeConversationRunRef.current;
      if (run?.runId) void run.client.cancel(run.runId, "对话面板已关闭，保留已有消息").catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!historyPersistence) return;
    let cancelled = false;
    void historyPersistence.load().then((snapshot) => {
      if (cancelled) return;
      if (snapshot?.sessions.length) {
        const session = snapshot.sessions.find((item) => item.id === snapshot.activeSessionId) ?? snapshot.sessions[0];
        sessionRegistryRef.current = snapshot.sessions;
        activeSessionIdRef.current = session.id;
        assistantStoreRef.current.restoreSession(session.mode, session.messages);
        setAssistantState(cloneAssistantState(assistantStoreRef.current.getState()));
        setSessionHistory(snapshot.sessions);
        setActiveSessionId(session.id);
        setInput(snapshot.draft.input);
        setComposerContextTokens(snapshot.draft.tokens);
        setReaderContexts(snapshot.draft.readerContexts);
      }
      historyReadyRef.current = true;
      setHistoryReady(true);
      setHistoryError(undefined);
    }).catch((error) => {
      if (!cancelled) setHistoryError(`对话读取失败：${error instanceof Error ? error.message : String(error)}`);
    });
    return () => { cancelled = true; };
  }, [historyPersistence, historyLoadAttempt]);

  useEffect(() => { persistConversation(); }, [historyReady, sessionHistory, activeSessionId, input, composerContextTokens, readerContexts]);
  useEffect(() => {
    const flush = () => persistConversation();
    window.addEventListener("blur", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("blur", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [historyPersistence]);
  const runtimeContext = buildAgentRuntimeContextView({
    academicProfile,
    importedCount: selectedSetStatus.importedCount,
    organizationName: runtimeOrganizationName,
    profileEnabled: Boolean(settingsStoreRef.current.getState()["profile.enabled"]),
    profilePersonalizationSummary,
    profileUnlocked,
    selectedCount: selectedSetStatus.selectedCount,
    selectionLocked: selectedSetStatus.selectionLocked,
    workspace: runtimeWorkspace
  });

  function addReaderContext(readerConversationContext: ReaderConversationContext | null | undefined) {
    if (!readerConversationContext) {
      return;
    }

    const contextKey = [
      readerConversationContext.paperId ?? "unknown-paper",
      readerConversationContext.page,
      readerConversationContext.excerpt
    ].join("::");
    if (lastReaderContextKeyRef.current === contextKey) {
      return;
    }

    lastReaderContextKeyRef.current = contextKey;
    setReaderContexts((currentContexts) => {
      const withoutDuplicate = currentContexts.filter((context) => {
        return !(
          context.paperId === readerConversationContext.paperId &&
          context.page === readerConversationContext.page &&
          context.excerpt === readerConversationContext.excerpt
        );
      });

      // 只保留最近几个 PDF 选区，避免用户连续框选时把模型上下文撑得过大。
      return [...withoutDuplicate, readerConversationContext].slice(-4);
    });
    const sourceLabel = readerConversationContext.source === "figures"
      ? "论文插图"
      : readerConversationContext.source === "extracted_text"
        ? "论文提取文本"
        : "PDF 选区";
    setComposerContextTokens((currentTokens) => [
      ...currentTokens.filter((token) => token.id !== `pdf-selection-${contextKey}`),
      {
        detail: `第 ${readerConversationContext.page} 页`,
        id: `pdf-selection-${contextKey}`,
        kind: "pdf_selection",
        label: readerConversationContext.paperTitle ?? sourceLabel,
        prompt: [
          `${sourceLabel}：${readerConversationContext.paperTitle ?? "当前文档"} 第 ${
            readerConversationContext.page
          } 页`,
          readerConversationContext.excerpt
        ].join("\n")
      }
    ]);
    inputRef.current?.focus();
  }

  useEffect(() => { addReaderContext(readerConversationContext); }, [readerConversationContext]);

  useEffect(() => {
    if (!historyReady || artifactTasks.length === 0) {
      return;
    }

    const activeSessionBeforeVisibilityFilter = sessionRegistryRef.current.find(
      (session) => session.id === activeSessionIdRef.current
    );
    const hidActiveThinReadingSession = !developerDiagnostics &&
      activeSessionBeforeVisibilityFilter?.kind === "artifact_generation" &&
      activeSessionBeforeVisibilityFilter.artifactType === "thin_reading";
    let nextSessions = developerDiagnostics
      ? sessionRegistryRef.current
      : sessionRegistryRef.current.filter((session) => (
          session.kind !== "artifact_generation" || session.artifactType !== "thin_reading"
        ));
    const currentSession = nextSessions.find(
      (session) => session.id === activeSessionIdRef.current
    );
    if (!hidActiveThinReadingSession && currentSession?.kind !== "artifact_generation") {
      nextSessions = upsertAssistantSession(
        nextSessions,
        snapshotAssistantSession({
          session: currentSession ?? initialSessionRef.current,
          state: cloneAssistantState(assistantStoreRef.current.getState())
        })
      );
    }

    const newRunningTasks: ArtifactTask[] = [];
    let migratedActiveSessionId: string | undefined;
    const visibleArtifactTasks = developerDiagnostics
      ? artifactTasks
      : artifactTasks.filter((task) => task.type !== "thin_reading");
    visibleArtifactTasks.forEach((task) => {
      const sessionId = getArtifactTaskSessionId(task.id, task);
      const previousSession = nextSessions.find((session) => session.id === sessionId) ??
        nextSessions.find((session) => session.artifactTaskId === task.id);
      const nextSession = createArtifactTaskSession(task, previousSession, Date.now, {
        developerDiagnostics
      });
      if (previousSession && previousSession.id !== nextSession.id) {
        nextSessions = nextSessions.filter((session) => session.id !== previousSession.id);
        if (activeSessionIdRef.current === previousSession.id) {
          migratedActiveSessionId = nextSession.id;
        }
      }
      nextSessions = upsertAssistantSession(
        nextSessions,
        nextSession
      );
      if (
        !knownArtifactTaskIdsRef.current.has(task.id) &&
        (task.status === "queued" || task.status === "running") &&
        // Thin-reading pages update their paper-bound session quietly. Generating a
        // lower level must never steal focus from the reader's active conversation.
        (task.type !== "thin_reading" || !task.artifactId)
      ) {
        newRunningTasks.push(task);
      }
      knownArtifactTaskIdsRef.current.add(task.id);
    });

    const taskToOpen = newRunningTasks[newRunningTasks.length - 1];
    const fallbackConversation = nextSessions.find((session) => session.kind !== "artifact_generation") ??
      initialSessionRef.current;
    const nextActiveSessionId = taskToOpen
      ? getArtifactTaskSessionId(taskToOpen.id, taskToOpen)
      : hidActiveThinReadingSession
        ? fallbackConversation.id
        : migratedActiveSessionId ?? activeSessionIdRef.current;
    const sessionToRestore = nextSessions.find((session) => session.id === nextActiveSessionId);

    sessionRegistryRef.current = nextSessions;
    setSessionHistory([...nextSessions]);
    if (sessionToRestore && (sessionToRestore.kind === "artifact_generation" || hidActiveThinReadingSession)) {
      activeSessionIdRef.current = sessionToRestore.id;
      setActiveSessionId(sessionToRestore.id);
      assistantStoreRef.current.restoreSession(
        sessionToRestore.mode,
        sessionToRestore.messages
      );
      setAssistantState(cloneAssistantState(assistantStoreRef.current.getState()));
      if (taskToOpen) {
        setHistoryOpen(false);
        setInput("");
        setEditingMessageId(null);
      }
    }
  }, [artifactTasks, developerDiagnostics, historyReady]);

  useEffect(() => {
    if (!historyReady || developerDiagnostics) return;
    const tasks = artifactTasks.filter((task) => task.type === "thin_reading");
    if (!tasks.length) return;
    let sessions = sessionRegistryRef.current;
    for (const task of tasks) {
      const owner = sessions.find((session) => session.messages.some((message) => message.artifactTask?.id === task.id)) ??
        sessions.find((session) => session.id === activeSessionIdRef.current);
      if (!owner) continue;
      const previous = owner.messages.find((message) => message.artifactTask?.id === task.id);
      const message = projectArtifactTaskMessage(task, previous);
      sessions = upsertAssistantSession(sessions, { ...owner,
        messages: previous ? owner.messages.map((item) => item.id === previous.id ? message : item) : [...owner.messages, message]
      });
    }
    sessionRegistryRef.current = sessions;
    const active = sessions.find((session) => session.id === activeSessionIdRef.current);
    if (active) {
      assistantStoreRef.current.replaceMessages(active.messages);
      setAssistantState(cloneAssistantState(assistantStoreRef.current.getState()));
    }
    setSessionHistory([...sessions]);
  }, [artifactTasks, historyReady, developerDiagnostics]);

  useEffect(() => {
    const activeSession = sessionRegistryRef.current.find(
      (session) => session.id === activeSessionId
    );
    if (activeSession) {
      onActiveSessionChange?.(activeSession);
    }
  }, [activeSessionId, onActiveSessionChange, sessionHistory]);

  function syncAssistant() {
    const nextState = cloneAssistantState(assistantStoreRef.current.getState());
    setAssistantState(nextState);
    const activeSession = sessionRegistryRef.current.find(
      (session) => session.id === activeSessionIdRef.current
    );
    if (!activeSession || activeSession.kind === "artifact_generation") {
      return;
    }
    const nextSession = snapshotAssistantSession({
      session: activeSession,
      state: nextState
    });
    const nextSessions = upsertAssistantSession(sessionRegistryRef.current, nextSession);
    sessionRegistryRef.current = nextSessions;
    setSessionHistory([...nextSessions]);
  }

  useEffect(() => {
    if (
      !historyReady || !registrationWelcomeMessage ||
      deliveredRegistrationWelcomeMessageIdsRef.current.has(registrationWelcomeMessage.id)
    ) {
      return;
    }

    deliveredRegistrationWelcomeMessageIdsRef.current.add(registrationWelcomeMessage.id);
    assistantStoreRef.current.addMessage(
      createMessage("assistant", registrationWelcomeMessage.content)
    );
    syncAssistant();
  }, [registrationWelcomeMessage, historyReady]);

  function saveActiveConversation() {
    const activeSession = sessionRegistryRef.current.find(
      (session) => session.id === activeSessionIdRef.current
    );
    if (!activeSession || activeSession.kind === "artifact_generation") {
      return;
    }

    const nextSession = snapshotAssistantSession({
      session: activeSession,
      state: cloneAssistantState(assistantStoreRef.current.getState())
    });
    const nextSessions = upsertAssistantSession(sessionRegistryRef.current, nextSession);
    sessionRegistryRef.current = nextSessions;
    setSessionHistory([...nextSessions]);
  }

  function clearReaderConversationContexts() {
    lastReaderContextKeyRef.current = null;
    pendingCommandClarificationRef.current = undefined;
    queuedAssistantTurnsRef.current = [];
    setReaderContexts([]);
    setComposerContextTokens([]);
  }

  function getPublicAgentClient(session: AssistantSessionHistoryItem) {
    if (!agentClient || session.kind === "artifact_generation") {
      return null;
    }
    const existing = publicAgentClientsRef.current.get(session.id);
    if (existing) {
      return existing;
    }
    const client = agentClient.createSessionClient?.(
      resolveAssistantPublicAgentClientSessionId(session)
    ) ?? agentClient;
    publicAgentClientsRef.current.set(session.id, client);
    return client;
  }

  function getActivePublicAgentClient() {
    const activeSession = sessionRegistryRef.current.find(
      (session) => session.id === activeSessionIdRef.current
    );
    return activeSession ? getPublicAgentClient(activeSession) : null;
  }

  function connectPublicAgentSession(session: AssistantSessionHistoryItem) {
    const client = getPublicAgentClient(session);
    const connect = client?.connect;
    if (!connect) {
      return;
    }
    void connect().catch(() => undefined);
  }

  function addComposerContextToken(token: AssistantContextToken) {
    setComposerContextTokens((currentTokens) => [
      ...currentTokens.filter((currentToken) => currentToken.id !== token.id),
      token
    ]);
  }

  function removeComposerContextToken(tokenId: string) {
    setReaderContexts((contexts) => contexts.filter((context) =>
      `pdf-selection-${[context.paperId ?? "unknown-paper", context.page, context.excerpt].join("::")}` !== tokenId
    ));
    lastReaderContextKeyRef.current = null;
    setComposerContextTokens((currentTokens) =>
      currentTokens.filter((token) => token.id !== tokenId)
    );
  }

  function buildComposerSuggestions(): AssistantComposerSuggestion[] {
    const commandSuggestions: AssistantComposerSuggestion[] = [
      "打开设置面板",
      "打开组织共享文献库",
      "关闭联网推荐",
      "开启用户画像",
      "把窗口切分成两个",
      "把 AI 助手放到下栏"
    ].map((command) => ({
      detail: "受控命令",
      id: `command-${command}`,
      insertText: `/${command}`,
      label: command,
      trigger: "/"
    }));

    const paperSuggestions: AssistantComposerSuggestion[] = availablePapers.map((paper) => {
      const paperToken: AssistantContextToken = {
        detail: "整篇论文",
        id: `paper-${paper.id}`,
        kind: "paper",
        label: paper.title,
        prompt: `用户指定论文上下文：${paper.title}（paperId=${paper.id}）`
      };
      return {
        detail: "整篇论文",
        id: `paper-${paper.id}`,
        label: paper.title,
        token: paperToken,
        trigger: "@" as const
      };
    });

    // 先提供所有“整篇论文”候选，避免每篇的页码把后续论文挤出首屏；
    // 输入标题或 p.页码时仍可检索到下面的精确页码上下文。
    const pageSuggestions: AssistantComposerSuggestion[] = availablePapers.flatMap((paper) =>
      Array.from({ length: 20 }, (_, index) => index + 1).map((page) => ({
        detail: `${paper.title} · 第 ${page} 页`,
        id: `page-${paper.id}-${page}`,
        label: `${paper.title} p.${page}`,
        token: {
          detail: `第 ${page} 页`,
          id: `page-${paper.id}-${page}`,
          kind: "page",
          label: paper.title,
          prompt: `用户指定论文页面上下文：${paper.title}（paperId=${paper.id}），第 ${page} 页。`
        },
        trigger: "@" as const
      }))
    );

    const skillSuggestions: AssistantComposerSuggestion[] = defaultAgentCoreConfig.skills.map((skill) => ({
      detail: skill.description,
      id: `skill-${skill.id}`,
      label: skill.id,
      token: {
        detail: skill.label,
        id: `skill-${skill.id}`,
        kind: "skill",
        label: skill.id,
        prompt: `用户指定调用 skill：${skill.id}。目标：${skill.description}`
      },
      trigger: "$"
    }));

    return [...artifactSlashSuggestions, ...commandSuggestions, ...paperSuggestions, ...pageSuggestions, ...skillSuggestions];
  }

  function setMode(mode: AssistantMode) {
    const adapted = adaptDefaultUiIntent({
      action: "select_mode",
      mode
    });
    if (adapted.kind !== "mode_change") {
      return;
    }

    assistantStoreRef.current.setMode(adapted.mode);
    syncAssistant();
  }

  function switchModeAsNewSession(mode: AssistantMode) {
    const adapted = adaptDefaultUiIntent({
      action: "select_mode",
      mode
    });
    if (adapted.kind !== "mode_change") {
      return;
    }

    const currentState = assistantStoreRef.current.getState();
    if (currentState.mode === adapted.mode) {
      return;
    }

    if (currentState.messages.length > 0) {
      startNewSession(adapted.mode);
      return;
    }

    assistantStoreRef.current.setMode(adapted.mode);
    syncAssistant();
  }

  function startNewSession(mode: AssistantMode = "qa") {
    if (!historyReadyRef.current) return;
    if (assistantStoreRef.current.getState().pending) {
      return;
    }
    saveActiveConversation();
    const session = createAssistantSession({ mode });
    const nextSessions = upsertAssistantSession(sessionRegistryRef.current, session);
    sessionRegistryRef.current = nextSessions;
    activeSessionIdRef.current = session.id;
    setSessionHistory([...nextSessions]);
    setActiveSessionId(session.id);
    processedAgentRunSequencesRef.current.clear();
    processedAgentActivityEventIdsRef.current.clear();
    processedAgentMessageEventIdsRef.current.clear();
    clearReaderConversationContexts();
    assistantStoreRef.current.restoreSession(session.mode, session.messages);
    setHistoryOpen(false);
    setInput("");
    setEditingMessageId(null);
    setVoiceInputMessage(undefined);
    connectPublicAgentSession(session);
    syncAssistant();
  }

  function openSession(sessionId: string) {
    if (!historyReadyRef.current) return;
    if (assistantStoreRef.current.getState().pending) {
      return;
    }
    saveActiveConversation();
    const session = sessionRegistryRef.current.find((candidate) => candidate.id === sessionId);
    if (!session) {
      return;
    }

    processedAgentRunSequencesRef.current.clear();
    processedAgentActivityEventIdsRef.current.clear();
    processedAgentMessageEventIdsRef.current.clear();
    clearReaderConversationContexts();
    activeSessionIdRef.current = session.id;
    setActiveSessionId(session.id);
    assistantStoreRef.current.restoreSession(session.mode, session.messages);
    setHistoryOpen(false);
    setInput("");
    setEditingMessageId(null);
    connectPublicAgentSession(session);
    syncAssistant();
  }

  function showVoiceInputPlaceholder() {
    setVoiceInputMessage("语音输入接口已预留，当前版本请先使用文本输入。");
    inputRef.current?.focus();
  }

  function createRuntimeExecutionContext(): AgentRuntimeExecutionContext {
    return {
      contextView: runtimeContext,
      applyGeneratedTheme: onApplyGeneratedTheme,
      applyLayoutPreset: onApplyLayoutPreset,
      applyPanelAction: onApplyPanelAction,
      applyThemePreset: onApplyThemePreset,
      generateUIDsl: createModelAssistedUIDslGenerator({
        modelTransport,
        settings: settingsStoreRef.current.getState()
      }),
      importSelectedSet: onImportSelectedSet,
      journal: executionJournalRef.current,
      moveDockItem: onMoveDockItem,
      openAcademicArchive: onOpenAcademicArchive,
      openOrganizationSharedLibrary: onOpenOrganizationSharedLibrary,
      clarifySemanticPlan: createModelAssistedClarification({
        modelTransport,
        settings: settingsStoreRef.current.getState()
      }),
      pendingClarification: pendingCommandClarificationRef.current,
      profileUnlocked,
      semanticPlanner: createModelSemanticPlanner({
        modelTransport,
        settings: settingsStoreRef.current.getState()
      }),
      settingsStore: settingsStoreRef.current,
      startArtifactAnalysis: (artifactType) => onGenerateArtifact(artifactType, commandPaperIdsRef.current)
    };
  }

  function appendRuntimeEvent(event: AgentRuntimeEvent) {
    if (event.type === "ui_dsl_ready") {
      const currentMessages = assistantStoreRef.current.getState().messages;
      const lastMessage = currentMessages[currentMessages.length - 1];
      if (lastMessage?.role === "assistant") {
        assistantStoreRef.current.replaceMessages([
          ...currentMessages.slice(0, -1),
          {
            ...lastMessage,
            uiDsl: event.document
          }
        ]);
        return;
      }

      const assistantMessage = createMessage("assistant", formatRuntimeEvent(event));
      assistantMessage.uiDsl = event.document;
      assistantStoreRef.current.addMessage(assistantMessage);
      return;
    }

    const assistantMessage = createMessage("assistant", formatRuntimeEvent(event));
    if (isHumanConfirmationEvent(event)) {
      assistantMessage.confirmation = event;
    }
    assistantStoreRef.current.addMessage(assistantMessage);
  }

  function appendRuntimeEvents(events: AgentRuntimeEvent[]) {
    events.forEach((event) => {
      appendRuntimeEvent(event);
    });
  }

  function startAgentActivity() {
    const activityMessage = createMessage("assistant", "");
    assistantStoreRef.current.addMessage(activityMessage);
    return activityMessage.id;
  }

  function updateAgentActivity(
    messageId: string,
    update: (activity: NonNullable<AssistantMessage["agentActivity"]>) => NonNullable<AssistantMessage["agentActivity"]>
  ) {
    const currentMessages = assistantStoreRef.current.getState().messages;
    assistantStoreRef.current.replaceMessages(
      currentMessages.map((message) =>
        message.id === messageId && message.agentActivity
          ? { ...message, agentActivity: update(message.agentActivity) }
          : message
      )
    );
  }

  function updateAgentMessage(
    messageId: string,
    update: (message: AssistantMessage) => AssistantMessage
  ) {
    const currentMessages = assistantStoreRef.current.getState().messages;
    assistantStoreRef.current.replaceMessages(
      currentMessages.map((message) => message.id === messageId ? update(message) : message)
    );
  }

  function appendPublicAgentActivityEvent(event: AgentEvent) {
    if (processedAgentActivityEventIdsRef.current.has(event.eventId)) {
      return;
    }
    const activityMessageId = agentActivityMessageIdsByRunRef.current.get(event.runId);
    if (!activityMessageId) {
      return;
    }
    processedAgentActivityEventIdsRef.current.add(event.eventId);
    if (
      event.type === "execution.route" &&
      (event.runtime === "custom_manager" || event.runtime === "openai_agents_sdk")
    ) {
      updateAgentMessage(activityMessageId, (message) => ({
        ...message,
        agentActivity: applyAgentActivityEvent(createAgentActivity(), event)
      }));
      return;
    }
    updateAgentActivity(activityMessageId, (activity) => applyAgentActivityEvent(activity, event));
  }

  function updateQueuedMessagePolicy(
    messageId: string,
    policy: QueuedAssistantTurn["policy"] | undefined
  ) {
    updateAgentMessage(messageId, (message) => ({
      ...message,
      queuedDelivery: policy ? { policy } : undefined
    }));
  }

  function releaseQueuedTurnAfterToolBoundary(event: AgentEvent) {
    const isToolBoundary =
      (event.type === "manager.activity" && event.kind === "tool_result") ||
      event.type === "action.failed" ||
      event.type === "task.created" ||
      event.type === "artifact.requested" ||
      event.type === "ui.render";
    if (!isToolBoundary) return;
    const nextTurn = queuedAssistantTurnsRef.current[0];
    if (!nextTurn || nextTurn.policy !== "after_tool") return;
    nextTurn.policy = "interrupt";
    updateQueuedMessagePolicy(nextTurn.userMessageId, "interrupt");
    syncAssistant();
    void cancelActiveSession();
  }

  function finalizePublicAgentActivity(run: AgentRun) {
    const activityMessageId = agentActivityMessageIdsByRunRef.current.get(run.runId);
    if (!activityMessageId) {
      return;
    }
    const status: Exclude<AgentActivityStatus, "working"> =
      run.status === "completed"
        ? "completed"
        : run.status === "cancelled"
          ? "cancelled"
          : run.status === "failed"
            ? "failed"
            : "waiting";
    updateAgentActivity(activityMessageId, (activity) => completeAgentActivity(activity, status));
  }

  function rememberPendingClarification(events: AgentRuntimeEvent[], previousInput: string) {
    const clarificationEvent = [...events]
      .reverse()
      .find((event) => event.type === "clarification_request");
    if (
      clarificationEvent?.type === "clarification_request" &&
      clarificationEvent.kind === "ambiguous_action" &&
      clarificationEvent.candidates?.length
    ) {
      pendingCommandClarificationRef.current = {
        clarification: {
          candidates: clarificationEvent.candidates,
          kind: clarificationEvent.kind,
          missing: clarificationEvent.missing,
          question: clarificationEvent.question
        },
        previousInput
      };
      return;
    }

    pendingCommandClarificationRef.current = undefined;
  }

  function appendPublicAgentEvent(event: AgentEvent) {
    if (processedAgentMessageEventIdsRef.current.has(event.eventId)) {
      return;
    }
    const activityMessageId = agentActivityMessageIdsByRunRef.current.get(event.runId);
    if (!activityMessageId) {
      return;
    }
    processedAgentMessageEventIdsRef.current.add(event.eventId);

    if (event.type === "ui.render") {
      const document = event.document as unknown as UIDslDocument;
      const validation = validateUIDslDocument(document);
      if (!validation.valid) {
        updateAgentMessage(activityMessageId, (message) => ({
          ...message,
          content: `Agent 返回的界面数据无效：${validation.errors.join("；")}`
        }));
        return;
      }
      updateAgentMessage(activityMessageId, (message) => ({ ...message, uiDsl: document }));
      return;
    }

    if (event.type === "assistant.message") {
      let audit: AnswerAuditResult | undefined;
      let executionTrace: ModelExecutionTrace | undefined;
      if (event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)) {
        const metadata = event.metadata as {
          audit?: AnswerAuditResult;
          executionTrace?: ModelExecutionTrace;
        };
        audit = metadata.audit;
        executionTrace = metadata.executionTrace;
      }
      updateAgentMessage(activityMessageId, (message) => ({
        ...message,
        audit: event.citations?.length ? audit : undefined,
        citations: event.citations,
        confidence: event.confidence,
        content: event.message,
        executionTrace
      }));
      return;
    }

    if (event.type === "assistant.delta") {
      updateAgentMessage(activityMessageId, (message) => ({
        ...message,
        content: `${message.content}${event.delta}`
      }));
      return;
    }

    if (event.type === "clarification.required") {
      updateAgentMessage(activityMessageId, (message) => ({ ...message, content: event.question }));
      return;
    }

    if (event.type === "confirmation.required") {
      updateAgentMessage(activityMessageId, (message) => ({
        ...message,
        confirmation: event,
        content: event.summary
      }));
      return;
    }

    if (event.type === "action.failed" || event.type === "run.failed") {
      updateAgentMessage(activityMessageId, (message) => ({
        ...message,
        content: event.error ? formatAgentRuntimeError(event.error) : event.message
      }));
      return;
    }

    if (event.type === "run.cancelled") {
      updateAgentMessage(activityMessageId, (message) => ({
        ...message,
        content: event.reason ? `运行已取消：${event.reason}` : "运行已取消。"
      }));
    }
  }

  function consumePublicAgentRun(run: AgentRun) {
    const lastSequence = processedAgentRunSequencesRef.current.get(run.runId) ?? 0;
    run.events
      .filter((event) => event.sequence > lastSequence)
      .forEach((event) => {
        appendPublicAgentActivityEvent(event);
        appendPublicAgentEvent(event);
        releaseQueuedTurnAfterToolBoundary(event);
      });
    const latestSequence = run.events[run.events.length - 1]?.sequence ?? lastSequence;
    processedAgentRunSequencesRef.current.set(run.runId, latestSequence);
    finalizePublicAgentActivity(run);
  }

  function appendPublicWorkflowAuditsToLatestAssistantMessage(
    publicWorkflowAudits: PublicWorkflowAuditSummary[]
  ) {
    if (!publicWorkflowAudits.length) {
      return;
    }
    const currentMessages = assistantStoreRef.current.getState().messages;
    let lastAssistantIndex = -1;
    for (let index = currentMessages.length - 1; index >= 0; index -= 1) {
      if (currentMessages[index].role === "assistant") {
        lastAssistantIndex = index;
        break;
      }
    }
    if (lastAssistantIndex < 0) {
      return;
    }

    assistantStoreRef.current.replaceMessages(
      currentMessages.map((message, index) =>
        index === lastAssistantIndex
          ? {
              ...message,
              publicWorkflowAudits
            }
          : message
      )
    );
  }

  async function appendPublicWorkflowAuditForRun(run: AgentRun, client: FrontendAgentClient) {
    if (!settingsStoreRef.current.getState()["assistant.public_audit.enabled"]) {
      return;
    }
    if (!hasPaperGroundedAuditScope(run)) {
      return;
    }

    const result = await client.listPublicWorkflowAuditSummaries({
      runId: run.runId,
      sessionId: run.sessionId
    });
    if (!result.ok) {
      return;
    }
    appendPublicWorkflowAuditsToLatestAssistantMessage(result.data);
  }

  function getTraceIdFromPublicRun(run: AgentRun) {
    const progress = run.events.find((event) => event.type === "progress.started");
    if (progress?.type === "progress.started") {
      return progress.traceId;
    }
    const confirmation = run.events.find((event) => event.type === "confirmation.required");
    if (confirmation?.type === "confirmation.required") {
      return confirmation.traceId;
    }
    const plan = run.events.find((event) => event.type === "plan.preview");
    return plan?.type === "plan.preview" ? `trace-${plan.plan.planId}` : undefined;
  }

  async function runPublicAgentMessage(
    message: string,
    mode: AssistantMode,
    attachments?: AgentAttachment[]
  ) {
    const sessionAgentClient = getActivePublicAgentClient();
    if (!sessionAgentClient) {
      const attachedPaperIds = (attachments ?? []).flatMap((attachment) => {
        const match = attachment.source === "paper"
          ? /^liteasy:\/\/paper\/(.+)$/.exec(attachment.uri)
          : null;
        if (!match) return [];
        try {
          return [decodeURIComponent(match[1])];
        } catch {
          return [];
        }
      });
      await runEmbeddedAgentMessage(message, mode, attachedPaperIds);
      return;
    }

    const idempotencyKey = createConversationIdempotencyKey(mode);
    const activityMessageId = startAgentActivity();
    const trackedRun = {
      activityMessageId,
      cancelRequested: false,
      cancelSent: false,
      client: sessionAgentClient,
      idempotencyKey,
      message
    } as {
      cancelRequested: boolean;
      cancelSent: boolean;
      client: FrontendAgentClient;
      activityMessageId: string;
      idempotencyKey: string;
      message: string;
      runId?: string;
    };
    activeConversationRunRef.current = trackedRun;
    const cancelTrackedRun = async () => {
      if (!trackedRun.runId || trackedRun.cancelSent) {
        return;
      }
      trackedRun.cancelSent = true;
      try {
        const cancelled = await trackedRun.client.cancel(trackedRun.runId, "用户终止了 AI 对话");
        if (cancelled.ok) {
          return;
        }
        trackedRun.cancelSent = false;
        setCancellingSession(false);
        assistantStoreRef.current.addMessage(
          createMessage("assistant", `终止失败：${getAssistantErrorMessage(cancelled.error, {
            developerDiagnostics
          })}`)
        );
        syncAssistant();
      } catch (error) {
        trackedRun.cancelSent = false;
        setCancellingSession(false);
        assistantStoreRef.current.addMessage(
          createMessage("assistant", `终止失败：${getAssistantErrorMessage(error, {
            developerDiagnostics
          })}`)
        );
        syncAssistant();
      }
    };
    const unsubscribe = sessionAgentClient.subscribe((event) => {
      if (
        event.type === "run.started" &&
        event.idempotencyKey === idempotencyKey &&
        activeConversationRunRef.current === trackedRun
      ) {
        trackedRun.runId = event.runId;
        agentActivityMessageIdsByRunRef.current.set(event.runId, trackedRun.activityMessageId);
        appendPublicAgentActivityEvent(event);
        appendPublicAgentEvent(event);
        syncAssistant();
        if (trackedRun.cancelRequested) {
          void cancelTrackedRun();
        }
        return;
      }
      if (trackedRun.runId === event.runId && activeConversationRunRef.current === trackedRun) {
        appendPublicAgentActivityEvent(event);
        appendPublicAgentEvent(event);
        releaseQueuedTurnAfterToolBoundary(event);
        syncAssistant();
      }
    });
    assistantStoreRef.current.setPending(true);
    syncAssistant();
    try {
      const result = await sessionAgentClient.send(
        { message, mode },
        { attachments, idempotencyKey }
      );
      if (!result.ok) {
        updateAgentActivity(activityMessageId, (activity) => completeAgentActivity(activity, "failed"));
        updateAgentMessage(activityMessageId, (current) => ({
          ...current,
          content: getAssistantErrorMessage(result.error, { developerDiagnostics })
        }));
        return;
      }
      agentActivityMessageIdsByRunRef.current.set(result.data.runId, activityMessageId);
      consumePublicAgentRun(result.data);
      await appendPublicWorkflowAuditForRun(result.data, sessionAgentClient);
      if (result.data.status === "cancelled") {
        const currentSession = sessionRegistryRef.current.find(
          (session) => session.id === activeSessionIdRef.current
        );
        if (currentSession && currentSession.kind !== "artifact_generation") {
          const cancelledSession = {
            ...currentSession,
            status: "cancelled" as const
          };
          sessionRegistryRef.current = upsertAssistantSession(
            sessionRegistryRef.current,
            cancelledSession
          );
          setSessionHistory([...sessionRegistryRef.current]);
        }
      }
      if (mode === "command") {
        await appendJournalAudit(getTraceIdFromPublicRun(result.data));
      }
      setInput("");
      setEditingMessageId(null);
    } catch (error) {
      updateAgentActivity(activityMessageId, (activity) => completeAgentActivity(activity, "failed"));
      updateAgentMessage(activityMessageId, (current) => ({
        ...current,
        content: getAssistantErrorMessage(error, { developerDiagnostics })
      }));
    } finally {
      unsubscribe();
      if (activeConversationRunRef.current === trackedRun) {
        activeConversationRunRef.current = null;
      }
      setCancellingSession(false);
      assistantStoreRef.current.setPending(false);
      syncAssistant();
      void executeNextQueuedTurn();
    }
  }

  /**
   * The normal desktop route is the public Agent API above. This path is only a
   * compatibility bridge for isolated pane consumers: it still calls the same
   * configured model gateway, so a greeting exercises the configured service
   * rather than falling back to a static instruction message.
   */
  async function runEmbeddedAgentMessage(
    message: string,
    mode: AssistantMode,
    referencedPaperIds: string[] = []
  ) {
    assistantStoreRef.current.setPending(true);
    syncAssistant();

    try {
      if (mode === "command") {
        const result = await runAgentRuntime(
          { message, mode },
          createRuntimeExecutionContext()
        );
        rememberPendingClarification(result.events, message);
        appendRuntimeEvents(result.events);
        await appendJournalAudit(getTraceIdFromRuntimeEvents(result.events));
        if (result.settingsChanged) {
          onSettingsChanged?.({ ...settingsStoreRef.current.getState() });
        }
      } else {
        const scopedPaperIds = new Set(referencedPaperIds);
        const scopedPapers = scopedPaperIds.size > 0
          ? availablePapers.filter((paper) => scopedPaperIds.has(paper.id))
          : selectedPapers;
        const scopedChunks = scopedPaperIds.size > 0
          ? Object.fromEntries([...scopedPaperIds].map((paperId) => [
              paperId,
              importedChunksByPaperId[paperId] ?? []
            ]))
          : importedChunksByPaperId;
        const answer = await generateAssistantAnswer({
          auditTransport,
          enableVisualizationDecisionPlanner: true,
          importedChunksByPaperId: scopedChunks,
          mode,
          modelTransport,
          question: message,
          selectedPapers: scopedPapers,
          settings: settingsStoreRef.current.getState(),
          thinReadingExternalKnowledgeTransport: modelTransport,
          thinReadingExternalPdfTransport: modelTransport
        });
        const assistantMessage = createMessage("assistant", answer.content);
        assistantMessage.audit = answer.citations.length ? answer.audit : undefined;
        assistantMessage.citations = answer.citations;
        assistantMessage.confidence = answer.confidence;
        assistantMessage.executionTrace = answer.executionTrace;
        assistantMessage.uiDsl = answer.uiDsl;
        assistantStoreRef.current.addMessage(assistantMessage);
      }
      setInput("");
      setEditingMessageId(null);
    } catch (error) {
      assistantStoreRef.current.addMessage(
        createMessage("assistant", getAssistantErrorMessage(error, { developerDiagnostics }))
      );
    } finally {
      assistantStoreRef.current.setPending(false);
      syncAssistant();
      void executeNextQueuedTurn();
    }
  }

  async function cancelActiveSession() {
    if (cancellingSession) {
      return;
    }
    setCancellingSession(true);
    const currentSession = sessionRegistryRef.current.find(
      (session) => session.id === activeSessionIdRef.current
    );
    if (currentSession?.kind === "artifact_generation" && currentSession.artifactTaskId) {
      try {
        await onCancelArtifactTask?.(currentSession.artifactTaskId);
      } finally {
        setCancellingSession(false);
      }
      return;
    }

    const trackedRun = activeConversationRunRef.current;
    if (!trackedRun) {
      setCancellingSession(false);
      return;
    }
    trackedRun.cancelRequested = true;
    if (!trackedRun.runId || trackedRun.cancelSent) {
      return;
    }
    trackedRun.cancelSent = true;
    try {
      const result = await trackedRun.client.cancel(trackedRun.runId, "用户终止了 AI 对话");
      if (result.ok) {
        return;
      }
      trackedRun.cancelSent = false;
      setCancellingSession(false);
      assistantStoreRef.current.addMessage(
        createMessage("assistant", `终止失败：${getAssistantErrorMessage(result.error, {
          developerDiagnostics
        })}`)
      );
      syncAssistant();
    } catch (error) {
      trackedRun.cancelSent = false;
      setCancellingSession(false);
      assistantStoreRef.current.addMessage(
        createMessage("assistant", `终止失败：${getAssistantErrorMessage(error, {
          developerDiagnostics
        })}`)
      );
      syncAssistant();
    }
  }

  async function appendJournalAudit(traceId: string | undefined) {
    if (!traceId) {
      return;
    }

    const trace = executionJournalRef.current.getTrace(traceId);
    const hasFinalizedFact = trace.some(
      (entry) =>
        entry.type === "action_result" ||
        entry.type === "ui_dsl" ||
        (entry.type === "confirmation" && entry.decision === "rejected")
    );
    if (!hasFinalizedFact) {
      return;
    }

    const assistantMessage = createMessage("assistant", "执行审计");
    assistantMessage.uiDsl = await createModelAssistedJournalAuditModel({
      modelTransport,
      settings: settingsStoreRef.current.getState()
    })({
      trace,
      traceId
    });
    assistantStoreRef.current.addMessage(assistantMessage);
  }

  function clearConfirmationMessage(confirmationId: string) {
    const currentMessages = assistantStoreRef.current.getState().messages;
    assistantStoreRef.current.replaceMessages(
      currentMessages.map((message) =>
        message.confirmation?.confirmationId === confirmationId
          ? {
              ...message,
              confirmation: undefined
            }
          : message
      )
    );
  }

  async function runCommandMessage(message: string) {
    await runPublicAgentMessage(message, "command");
  }

  async function handleConfirmRequest(confirmation: AssistantConfirmationRequest) {
    assistantStoreRef.current.setPending(true);
    clearConfirmationMessage(confirmation.confirmationId);
    syncAssistant();

    try {
      if (isPublicConfirmation(confirmation)) {
        const sessionAgentClient = getActivePublicAgentClient();
        if (!sessionAgentClient) {
          throw new Error("AI 服务尚未初始化，请稍后重试。");
        }
        const result = await sessionAgentClient.confirm(confirmation.confirmationId, "approve");
        if (!result.ok) {
          throw result.error;
        }
        consumePublicAgentRun(result.data);
        await appendJournalAudit(confirmation.traceId);
        return;
      }
      const result = await executeConfirmedSemanticPlan(
        confirmation,
        createRuntimeExecutionContext()
      );
      appendRuntimeEvents(result.events);
      await appendJournalAudit(confirmation.traceId);
      if (result.settingsChanged) {
        onSettingsChanged?.({ ...settingsStoreRef.current.getState() });
      }
    } catch (error) {
      assistantStoreRef.current.addMessage(createMessage(
        "assistant",
        getAssistantErrorMessage(error, { developerDiagnostics })
      ));
    } finally {
      assistantStoreRef.current.setPending(false);
      syncAssistant();
      inputRef.current?.focus();
      void executeNextQueuedTurn();
    }
  }

  async function handleRejectRequest(confirmation: AssistantConfirmationRequest) {
    clearConfirmationMessage(confirmation.confirmationId);
    if (isPublicConfirmation(confirmation)) {
      const sessionAgentClient = getActivePublicAgentClient();
      if (!sessionAgentClient) {
        assistantStoreRef.current.addMessage(
          createMessage("assistant", "AI 服务尚未初始化，请稍后重试。")
        );
        syncAssistant();
        inputRef.current?.focus();
        return;
      }
      const result = await sessionAgentClient.confirm(confirmation.confirmationId, "reject");
      if (!result.ok) {
        assistantStoreRef.current.addMessage(createMessage(
          "assistant",
          getAssistantErrorMessage(result.error, { developerDiagnostics })
        ));
      } else {
        consumePublicAgentRun(result.data);
        await appendJournalAudit(confirmation.traceId);
      }
      syncAssistant();
      inputRef.current?.focus();
      return;
    }
    const result = rejectHumanConfirmation(confirmation, {
      journal: executionJournalRef.current
    });
    appendRuntimeEvents(result.events);
    await appendJournalAudit(confirmation.traceId);
    syncAssistant();
    inputRef.current?.focus();
  }

  async function handleUIDslAction(action: UIDslActionRef, traceId: string) {
    const adapted = adaptDefaultUiIntent({
      action: "trigger_action",
      actionRef: action,
      activeMode: assistantStoreRef.current.getState().mode,
      traceId
    });
    if (adapted.kind !== "dynamic_action") {
      return;
    }

    assistantStoreRef.current.setPending(true);
    syncAssistant();

    try {
      const result = await executeUIDslActionRef(
        adapted.actionRef,
        createRuntimeExecutionContext(),
        {
          mode: adapted.mode,
          traceId: adapted.traceId
        }
      );
      appendRuntimeEvents(result.events);
      await appendJournalAudit(getTraceIdFromRuntimeEvents(result.events) ?? traceId);
      if (result.settingsChanged) {
        onSettingsChanged?.({ ...settingsStoreRef.current.getState() });
      }
    } catch (error) {
      assistantStoreRef.current.addMessage(createMessage(
        "assistant",
        getAssistantErrorMessage(error, { developerDiagnostics })
      ));
    } finally {
      assistantStoreRef.current.setPending(false);
      syncAssistant();
      inputRef.current?.focus();
    }
  }

  function buildReaderContextPrompt() {
    if (readerContexts.length === 0) {
      return "";
    }

    return readerContexts
      .map((context, index) => {
        const title = context.paperTitle ?? "当前 PDF";
        return [
          `PDF 选区 ${index + 1}：${title} 第 ${context.page} 页`,
          context.excerpt
        ].join("\n");
      })
      .join("\n\n");
  }

  function buildComposerTokenPrompt(tokens: AssistantContextToken[]) {
    if (tokens.length === 0) {
      return "";
    }

    return tokens
      .map((token, index) => [`上下文 ${index + 1} [${token.kind}]：${token.label}`, token.prompt].join("\n"))
      .join("\n\n");
  }

  async function runKnowledgeMessage(
    question: string,
    mode: Exclude<AssistantMode, "command">,
    options: { attachedContextPrompt?: string; referencedPaperIds?: string[] } = {}
  ) {
    const referencedPaperIds = [...new Set(options.referencedPaperIds ?? [])];
    if (referencedPaperIds.length > 0) {
      await onPreparePapersForContext?.(referencedPaperIds);
    }
    const readerContextPrompt = buildReaderContextPrompt();
    const attachedContextPrompt = options.attachedContextPrompt ?? "";
    const combinedContextPrompt =
      attachedContextPrompt.length > 0 ? attachedContextPrompt : readerContextPrompt;
    const readyMessage =
      combinedContextPrompt.length > 0 ? null : getSelectedSetReadyMessage(selectedSetStatus);

    const publicQuestion =
      combinedContextPrompt.length > 0
        ? `${combinedContextPrompt}\n\n用户问题：${question}`
        : readyMessage
          ? `${question}\n\n系统上下文：当前尚未准备论文任务。请自然、友好地先回答用户，不要复述系统上下文或错误提示。回答末尾简短提醒：可在左栏勾选并锁定一些论文，或使用 @ 添加论文后开始分析。`
          : question;
    const paperById = new Map(availablePapers.map((paper) => [paper.id, paper]));
    const attachments: AgentAttachment[] = [
      ...(selectedSetStatus.selectionLocked && selectedPapers.length > 0
        ? [{
            metadata: { paperIds: selectedPapers.map((paper) => paper.id) },
            name: "当前锁定文献集",
            source: "selection" as const,
            uri: "liteasy://selection/current"
          }]
        : []),
      ...referencedPaperIds.map((paperId) => ({
        name: paperById.get(paperId)?.title,
        source: "paper" as const,
        uri: `liteasy://paper/${encodeURIComponent(paperId)}`
      }))
    ];
    await runPublicAgentMessage(publicQuestion, mode, attachments);
  }

  async function executePreparedTurn(turn: QueuedAssistantTurn) {
    assistantStoreRef.current.setMode(turn.mode);
    updateQueuedMessagePolicy(turn.userMessageId, undefined);
    syncAssistant();

    const artifactType = requestedArtifactType(turn.message);
    // The artifact workflow creates a task, submits its artifactType to the main Agent,
    // and saves the specialist result. Keep slash shortcuts on that complete path.
    if (artifactType && (artifactType === "thin_reading" ||
      (turn.mode === "command" && getActivePublicAgentClient()))) {
      const previousPaperIds = assistantStoreRef.current.getState().messages.slice(0, -1).reverse()
        .find((message) => message.role === "user" && message.contextTokens?.some((token) => token.kind === "paper"))
        ?.contextTokens?.filter((token) => token.kind === "paper").map((token) => token.id.replace(/^paper-/, ""));
      const paperIds = turn.referencedPaperIds.length ? turn.referencedPaperIds
        : selectedSetStatus.selectionLocked ? selectedPapers.map((paper) => paper.id) : previousPaperIds;
      const recentContext = assistantStoreRef.current.getState().messages.filter((message) => !message.artifactTask && !message.agentActivity)
        .slice(-6).map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`).join("\n").slice(-8_000);
      const context = [turn.message, turn.attachedContextPrompt, recentContext].filter(Boolean).join("\n\n");
      try {
        const result = onGenerateArtifact(artifactType, paperIds, context);
        assistantStoreRef.current.addMessage(createMessage("assistant", result));
      } catch (error) {
        assistantStoreRef.current.addMessage(createMessage("assistant", getAssistantErrorMessage(error, { developerDiagnostics })));
      }
      syncAssistant();
      void executeNextQueuedTurn();
      return;
    }

    if (turn.mode === "command") {
      commandPaperIdsRef.current = turn.referencedPaperIds;
      try {
        const artifactType = requestedArtifactType(turn.message);
        if (artifactType && turn.referencedPaperIds.length > 0) {
          const message = onGenerateArtifact(artifactType, turn.referencedPaperIds, [turn.message, turn.attachedContextPrompt].filter(Boolean).join("\n\n"));
          assistantStoreRef.current.addMessage(createMessage("assistant", message));
          syncAssistant();
          void executeNextQueuedTurn();
          return;
        }
        await runCommandMessage(turn.message);
      } finally {
        commandPaperIdsRef.current = undefined;
      }
      return;
    }

    try {
      await runKnowledgeMessage(turn.message, turn.mode, {
        attachedContextPrompt: turn.attachedContextPrompt,
        referencedPaperIds: turn.referencedPaperIds
      });
    } catch (error) {
      assistantStoreRef.current.addMessage(createMessage(
        "assistant",
        getAssistantErrorMessage(error, { developerDiagnostics })
      ));
      syncAssistant();
      void executeNextQueuedTurn();
    }
  }

  async function executeNextQueuedTurn() {
    if (assistantStoreRef.current.getState().pending) return;
    const nextTurn = queuedAssistantTurnsRef.current.shift();
    if (!nextTurn) return;
    await executePreparedTurn(nextTurn);
  }

  function changeQueuedTurnPolicy(
    messageId: string,
    policy: QueuedAssistantTurn["policy"]
  ) {
    const turnIndex = queuedAssistantTurnsRef.current.findIndex(
      (turn) => turn.userMessageId === messageId
    );
    if (turnIndex < 0) return;
    const [turn] = queuedAssistantTurnsRef.current.splice(turnIndex, 1);
    turn.policy = policy;
    if (policy === "interrupt") {
      queuedAssistantTurnsRef.current = [turn, ...queuedAssistantTurnsRef.current];
    } else {
      queuedAssistantTurnsRef.current.splice(turnIndex, 0, turn);
    }
    updateQueuedMessagePolicy(messageId, policy);
    syncAssistant();
    if (policy === "interrupt") {
      void cancelActiveSession();
    }
  }

  function withdrawQueuedTurn(messageId: string) {
    const turnIndex = queuedAssistantTurnsRef.current.findIndex(
      (turn) => turn.userMessageId === messageId
    );
    if (turnIndex < 0) return;
    const [turn] = queuedAssistantTurnsRef.current.splice(turnIndex, 1);
    const messages = assistantStoreRef.current.getState().messages.filter(
      (message) => message.id !== messageId
    );
    assistantStoreRef.current.replaceMessages(messages);
    setInput(turn.userContent);
    setComposerContextTokens(turn.contextTokens);
    setReaderContexts(turn.readerContexts);
    syncAssistant();
    inputRef.current?.focus();
  }

  async function handleSend() {
    if (!historyReadyRef.current) return;
    const currentState = assistantStoreRef.current.getState();
    const contextTokensForTurn = [...composerContextTokens];
    const referencedPaperIds = contextTokensForTurn
      .filter((token) => token.kind === "paper")
      .map((token) => token.id.replace(/^paper-/, ""));
    const attachedContextPrompt = buildComposerTokenPrompt(contextTokensForTurn) ||
      buildReaderContextPrompt();
    const adapted = adaptTextIntent({
      activeMode: "qa",
      parseSlashCommand: true,
      value: input
    });

    if (adapted.kind === "idle") {
      return;
    }

    if (editingMessageId) {
      if (currentState.pending) return;
      const messageIndex = currentState.messages.findIndex(
        (message) => message.id === editingMessageId && message.role === "user"
      );
      if (messageIndex >= 0) {
        assistantStoreRef.current.replaceMessages(currentState.messages.slice(0, messageIndex));
      }
    }

    const activeMode = adapted.runtimeInput.mode;
    assistantStoreRef.current.setMode(activeMode);
    const userMessage = createMessage("user", adapted.userMessageContent);
    userMessage.contextTokens = contextTokensForTurn;
    if (currentState.pending) {
      userMessage.queuedDelivery = { policy: "after_tool" };
    }
    assistantStoreRef.current.addMessage(userMessage);
    setComposerContextTokens([]);
    setReaderContexts([]);
    lastReaderContextKeyRef.current = null;
    setInput("");
    setEditingMessageId(null);
    setVoiceInputMessage(undefined);

    const preparedTurn: QueuedAssistantTurn = {
      attachedContextPrompt,
      contextTokens: contextTokensForTurn,
      message: adapted.runtimeInput.message,
      mode: activeMode,
      policy: currentState.pending ? "after_tool" : "interrupt",
      readerContexts: [...readerContexts],
      referencedPaperIds,
      userContent: adapted.userMessageContent,
      userMessageId: userMessage.id
    };
    if (currentState.pending) {
      queuedAssistantTurnsRef.current.push(preparedTurn);
      syncAssistant();
      return;
    }
    syncAssistant();
    await executePreparedTurn(preparedTurn);
  }

  function handleEditMessage(messageId: string) {
    if (assistantStoreRef.current.getState().pending) {
      return;
    }
    const message = assistantStoreRef.current
      .getState()
      .messages.find((candidate) => candidate.id === messageId && candidate.role === "user");

    if (!message) {
      return;
    }

    setEditingMessageId(message.id);
    setInput(message.content);
    setComposerContextTokens(message.contextTokens ?? []);
    setVoiceInputMessage(undefined);
    inputRef.current?.focus();
  }

  function cancelEdit() {
    setEditingMessageId(null);
    setInput("");
    setComposerContextTokens([]);
    inputRef.current?.focus();
  }

  async function handleRegenerateMessage(messageId: string) {
    const currentState = assistantStoreRef.current.getState();
    if (currentState.mode === "command" || currentState.pending) {
      return;
    }

    const assistantIndex = currentState.messages.findIndex(
      (message) => message.id === messageId && message.role === "assistant"
    );
    if (assistantIndex < 0) {
      return;
    }

    let previousUserIndex = -1;
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
      if (currentState.messages[index].role === "user") {
        previousUserIndex = index;
        break;
      }
    }
    if (previousUserIndex < 0) {
      return;
    }

    const previousUserMessage = currentState.messages[previousUserIndex];
    const contextTokens = previousUserMessage.contextTokens ?? [];
    const referencedPaperIds = contextTokens
      .filter((token) => token.kind === "paper")
      .map((token) => token.id.replace(/^paper-/, ""));
    assistantStoreRef.current.replaceMessages(currentState.messages.slice(0, assistantIndex));
    setEditingMessageId(null);
    setInput("");
    await runKnowledgeMessage(previousUserMessage.content, currentState.mode, {
      attachedContextPrompt: buildComposerTokenPrompt(contextTokens),
      referencedPaperIds
    });
  }

  async function handleRetryUserMessage(messageId: string) {
    const currentState = assistantStoreRef.current.getState();
    if (currentState.pending) {
      return;
    }

    const messageIndex = currentState.messages.findIndex(
      (message) => message.id === messageId && message.role === "user"
    );
    const message = currentState.messages[messageIndex];
    if (!message || message.role !== "user") {
      return;
    }

    assistantStoreRef.current.replaceMessages(currentState.messages.slice(0, messageIndex));
    const adapted = adaptTextIntent({
      activeMode: "qa",
      parseSlashCommand: true,
      value: message.content
    });
    if (adapted.kind === "idle") {
      return;
    }
    const activeMode = adapted.runtimeInput.mode;
    const contextTokens = message.contextTokens ?? [];
    const attachedContextPrompt = buildComposerTokenPrompt(contextTokens);
    const referencedPaperIds = contextTokens
      .filter((token) => token.kind === "paper")
      .map((token) => token.id.replace(/^paper-/, ""));
    const retriedMessage = createMessage("user", adapted.userMessageContent);
    retriedMessage.contextTokens = message.contextTokens;
    assistantStoreRef.current.setMode(activeMode);
    assistantStoreRef.current.addMessage(retriedMessage);
    setInput("");
    setEditingMessageId(null);
    setComposerContextTokens([]);
    syncAssistant();

    await executePreparedTurn({
      attachedContextPrompt,
      contextTokens,
      message: adapted.runtimeInput.message,
      mode: activeMode,
      policy: "interrupt",
      readerContexts: [],
      referencedPaperIds,
      userContent: adapted.userMessageContent,
      userMessageId: retriedMessage.id
    });
  }

  function handleToggleFavoriteMessage(messageId: string) {
    const currentState = assistantStoreRef.current.getState();
    assistantStoreRef.current.replaceMessages(
      currentState.messages.map((message) =>
        message.id === messageId && message.role === "assistant"
          ? { ...message, favorite: !message.favorite }
          : message
      )
    );
    syncAssistant();
  }

  const conversationStarted = assistantState.messages.length > 0;
  const readyMessage =
    readerContexts.length > 0 ? null : getSelectedSetReadyMessage(selectedSetStatus);
  const composerHint = input.startsWith("/")
    ? getModeHint("command")
    : readyMessage
    ? "可以先直接对话来检查 AI 服务；需要论文分析时，再在左栏锁定论文或用 @ 添加论文。"
    : getModeHint("qa");
  const activeSession = sessionHistory.find((session) => session.id === activeSessionId);
  const activeSessionRunning = activeSession?.kind === "artifact_generation"
    ? activeSession.status === "running"
    : assistantState.pending;

  return (
    <div className={conversationStarted ? "assistant-pane in-conversation" : "assistant-pane initial-session"}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(readerContextDragMime)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
        event.currentTarget.classList.add("accepting-reader-context");
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          event.currentTarget.classList.remove("accepting-reader-context");
        }
      }}
      onDrop={(event) => {
        event.currentTarget.classList.remove("accepting-reader-context");
        if (!event.dataTransfer.types.includes(readerContextDragMime)) return;
        event.preventDefault();
        event.stopPropagation();
        const context = readDraggedReaderContext(event.dataTransfer.getData(readerContextDragMime));
        if (context) addReaderContext(context);
      }}
    >
      <div className="assistant-session-toolbar">
        <div className="assistant-active-session" aria-label="当前会话">
          <span className="assistant-active-session-kind">
            {activeSession?.kind === "artifact_generation"
              ? "产物生成"
              : "普通对话"}
          </span>
          <span className="assistant-active-session-title">
            {activeSession?.title ?? "新对话"}
          </span>
          {activeSession?.artifactId ? (
            <button
              className="assistant-session-open-artifact"
              onClick={() => onOpenArtifact?.(activeSession.artifactId!)}
              type="button"
            >
              打开产物
            </button>
          ) : null}
        </div>
        <div aria-label="会话操作" className="assistant-session-actions">
          {activeSessionRunning ? (
            <Tooltip content={cancellingSession ? "正在终止 AI 运行" : "终止当前 AI 运行"} positioning="below" relationship="description">
              <button
                aria-label={cancellingSession ? "终止中" : "终止"}
                className="assistant-session-button assistant-icon-button danger"
                disabled={cancellingSession}
                onClick={() => void cancelActiveSession()}
                title="终止当前 AI 运行"
                type="button"
              >
                <DismissRegular />
              </button>
            </Tooltip>
          ) : null}
          <Tooltip content="新建对话" positioning="below" relationship="description">
            <button
              aria-label="新建"
              className="assistant-session-button assistant-icon-button"
              disabled={assistantState.pending}
              onClick={() => startNewSession()}
              title="开始一个新的 AI 对话"
              type="button"
            >
              <AddRegular />
            </button>
          </Tooltip>
          <Tooltip content={historyOpen ? "隐藏历史会话" : "查看历史会话"} positioning="below" relationship="description">
            <button
              aria-expanded={historyOpen}
              aria-label={historyOpen ? "隐藏历史" : "历史"}
              className="assistant-session-button assistant-icon-button"
              onClick={() => setHistoryOpen((current) => !current)}
              title="查看历史会话"
              type="button"
            >
              <HistoryRegular />
            </button>
          </Tooltip>
        </div>
      </div>

      {historyOpen ? (
        <AssistantHistoryPanel
          activeSessionId={activeSessionId}
          history={sessionHistory}
          onOpenSession={openSession}
        />
      ) : null}

      {!historyReady && !historyError ? <p role="status">正在恢复对话…</p> : null}
      {historyError ? <div role="alert">{historyError}<button type="button" onClick={() => historyReady ? persistConversation() : setHistoryLoadAttempt((value) => value + 1)}>重试</button></div> : null}
      <AssistantContextPanel context={runtimeContext} />

      <AssistantMessageList
        onOpenArtifact={onOpenArtifact}
        onResumeArtifactTask={onResumeArtifactTask}
        onCancelArtifactTask={(id) => { void onCancelArtifactTask?.(id); }}
        papers={availablePapers}
        onOpenCitation={onOpenCitation}
        messages={assistantState.messages}
        mode={assistantState.mode}
        onConfirmRequest={(confirmation) => {
          void handleConfirmRequest(confirmation);
        }}
        onDynamicAction={(action, traceId) => {
          void handleUIDslAction(action, traceId);
        }}
        onEditMessage={handleEditMessage}
        onInterruptForQueuedMessage={(messageId) => {
          changeQueuedTurnPolicy(messageId, "interrupt");
        }}
        onModeChange={switchModeAsNewSession}
        onRegenerateMessage={handleRegenerateMessage}
        onRejectRequest={handleRejectRequest}
        onRetryUserMessage={(messageId) => {
          void handleRetryUserMessage(messageId);
        }}
        onToggleFavoriteMessage={handleToggleFavoriteMessage}
        onWaitForRunForQueuedMessage={(messageId) => {
          changeQueuedTurnPolicy(messageId, "after_run");
        }}
        onWithdrawQueuedMessage={withdrawQueuedTurn}
      />

      <AssistantComposer
        editing={Boolean(editingMessageId)}
        input={input}
        inputRef={inputRef}
        contextTokens={composerContextTokens}
        modeHint={composerHint}
        onAddContextToken={addComposerContextToken}
        onCancelEdit={cancelEdit}
        onInputChange={setInput}
        onRemoveContextToken={removeComposerContextToken}
        onSend={handleSend}
        onVoiceInput={showVoiceInputPlaceholder}
        pending={assistantState.pending || !historyReady}
        suggestions={buildComposerSuggestions()}
        voiceInputMessage={voiceInputMessage}
      />
    </div>
  );
}
