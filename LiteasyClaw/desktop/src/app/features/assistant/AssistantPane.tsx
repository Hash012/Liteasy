import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@fluentui/react-components";
import { AddRegular, DismissRegular, HistoryRegular } from "@fluentui/react-icons";
import { AssistantComposer } from "./AssistantComposer";
import { AssistantHistoryPanel } from "./AssistantHistoryPanel";
import { AssistantMessageList } from "./AssistantMessageList";
import type {
  AssistantConfirmationRequest,
  AssistantMessage,
  AssistantComposerSuggestion,
  AssistantContextToken,
  AssistantMode,
  AssistantState,
  SelectedSetStatus
} from "./assistant.types";
import type { FrontendAgentClient } from "../agent-api/frontendAgentClient";
import type {
  AgentConfirmationRequest,
  AgentEvent,
  AgentRun
} from "../agent-api/agentApi.types";
import { createSettingsStore } from "../settings/settings.store";
import type { ArtifactTask, ArtifactType } from "../artifacts/artifact.types";
import { createAssistantStore } from "./assistant.store";
import {
  createArtifactTaskSession,
  createAssistantSession,
  getArtifactTaskSessionId,
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
  HumanConfirmationRequest
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
import type { ActionContext } from "../skills/actionRegistry";
import type { Paper, WorkspaceSource } from "../workspace/workspace.types";
import type { SettingsState } from "../settings/settings.types";
import type { RetrievalChunk } from "../retrieval/retrieval.types";
import { defaultAgentCoreConfig } from "../agent-core/agentCoreConfig";
import type { AnswerAuditResult } from "./answerAuditor";
import type { ModelExecutionTrace } from "../models/modelExecution";
import { AssistantContextPanel } from "./AssistantContextPanel";
import {
  getAssistantErrorMessage,
  getSelectedSetReadyMessage
} from "./assistantPresentation";
import type { ReaderConversationContext } from "./assistantContext.types";
import { generateAssistantAnswer } from "./generateAssistantAnswer";

type SettingsStoreLike = ReturnType<typeof createSettingsStore>;

type AssistantPaneProps = {
  /**
   * The application always supplies the public Agent client. Keeping this optional
   * makes the pane usable in isolated previews and provides a real model-backed
   * fallback for legacy embeds while the Agent host is being initialized.
   */
  agentClient?: FrontendAgentClient;
  artifactTasks?: ArtifactTask[];
  executionJournal?: ExecutionJournal;
  importedChunksByPaperId?: Record<string, RetrievalChunk[]>;
  modelTransport?: ModelTransport;
  onApplyGeneratedTheme?: ActionContext["applyGeneratedTheme"];
  onApplyLayoutPreset?: ActionContext["applyLayoutPreset"];
  onApplyPanelAction?: ActionContext["applyPanelAction"];
  onApplyThemePreset?: ActionContext["applyThemePreset"];
  onCancelArtifactTask?: (taskId: string) => string | Promise<string>;
  onGenerateArtifact: (artifactType: ArtifactType, paperIds?: string[]) => string;
  onImportSelectedSet?: ActionContext["importSelectedSet"];
  onLockPapersForTask?: (paperIds: string[]) => void;
  onMoveDockItem?: ActionContext["moveDockItem"];
  onOpenAcademicArchive?: ActionContext["openAcademicArchive"];
  onOpenArtifact?: (artifactId: string) => void;
  onOpenOrganizationSharedLibrary?: () => string | Promise<string>;
  onActiveSessionChange?: (session: AssistantSessionHistoryItem) => void;
  onSettingsChanged?: (settings: SettingsState) => void;
  profileUnlocked?: boolean;
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

function getArtifactTypeFromCommand(message: string): ArtifactType | null {
  if (/分层关系图|分层图|obsidian|星图|关系网络/i.test(message)) return "layered_graph";
  if (/思维导图|脑图|mindmap/i.test(message)) return "mindmap";
  if (/树状图|树形图|树形展开/i.test(message)) return "tree";
  if (/对比表|对比矩阵|comparison table/i.test(message)) return "comparison_table";
  if (/\bppt\b|演示文稿|幻灯片/i.test(message)) return "ppt";
  return null;
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

export function AssistantPane({
  agentClient,
  artifactTasks = [],
  executionJournal,
  importedChunksByPaperId = {},
  modelTransport,
  onApplyGeneratedTheme,
  onApplyLayoutPreset,
  onApplyPanelAction,
  onApplyThemePreset,
  onCancelArtifactTask,
  onGenerateArtifact,
  onImportSelectedSet,
  onLockPapersForTask,
  onMoveDockItem,
  onOpenAcademicArchive,
  onOpenArtifact,
  onOpenOrganizationSharedLibrary,
  onActiveSessionChange,
  onSettingsChanged,
  profileUnlocked = false,
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
  const executionJournalRef = useRef(executionJournal ?? createExecutionJournal());
  const processedAgentRunSequencesRef = useRef(new Map<string, number>());
  const activeConversationRunRef = useRef<{
    cancelRequested: boolean;
    cancelSent: boolean;
    message: string;
    runId?: string;
  } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const lastReaderContextKeyRef = useRef<string | null>(null);
  const commandPaperIdsRef = useRef<string[] | undefined>();
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
  const runtimeContext = buildAgentRuntimeContextView({
    importedCount: selectedSetStatus.importedCount,
    organizationName: runtimeOrganizationName,
    profileEnabled: Boolean(settingsStoreRef.current.getState()["profile.enabled"]),
    profileUnlocked,
    selectedCount: selectedSetStatus.selectedCount,
    selectionLocked: selectedSetStatus.selectionLocked,
    workspace: runtimeWorkspace
  });

  useEffect(() => {
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
    setComposerContextTokens((currentTokens) => [
      ...currentTokens.filter((token) => token.id !== `pdf-selection-${contextKey}`),
      {
        detail: `第 ${readerConversationContext.page} 页`,
        id: `pdf-selection-${contextKey}`,
        kind: "pdf_selection",
        label: readerConversationContext.paperTitle ?? "PDF 选区",
        prompt: [
          `PDF 选区：${readerConversationContext.paperTitle ?? "当前文档"} 第 ${
            readerConversationContext.page
          } 页`,
          readerConversationContext.excerpt
        ].join("\n")
      }
    ]);
    inputRef.current?.focus();
  }, [readerConversationContext]);

  useEffect(() => {
    if (artifactTasks.length === 0) {
      return;
    }

    let nextSessions = sessionRegistryRef.current;
    const currentSession = nextSessions.find(
      (session) => session.id === activeSessionIdRef.current
    );
    if (currentSession?.kind !== "artifact_generation") {
      nextSessions = upsertAssistantSession(
        nextSessions,
        snapshotAssistantSession({
          session: currentSession ?? initialSessionRef.current,
          state: cloneAssistantState(assistantStoreRef.current.getState())
        })
      );
    }

    const newRunningTasks: ArtifactTask[] = [];
    artifactTasks.forEach((task) => {
      const sessionId = getArtifactTaskSessionId(task.id);
      const previousSession = nextSessions.find((session) => session.id === sessionId);
      nextSessions = upsertAssistantSession(
        nextSessions,
        createArtifactTaskSession(task, previousSession)
      );
      if (
        !knownArtifactTaskIdsRef.current.has(task.id) &&
        (task.status === "queued" || task.status === "running")
      ) {
        newRunningTasks.push(task);
      }
      knownArtifactTaskIdsRef.current.add(task.id);
    });

    const taskToOpen = newRunningTasks[newRunningTasks.length - 1];
    const nextActiveSessionId = taskToOpen
      ? getArtifactTaskSessionId(taskToOpen.id)
      : activeSessionIdRef.current;
    const activeArtifactSession = nextSessions.find(
      (session) => session.id === nextActiveSessionId && session.kind === "artifact_generation"
    );

    sessionRegistryRef.current = nextSessions;
    setSessionHistory([...nextSessions]);
    if (activeArtifactSession) {
      activeSessionIdRef.current = activeArtifactSession.id;
      setActiveSessionId(activeArtifactSession.id);
      assistantStoreRef.current.restoreSession(
        activeArtifactSession.mode,
        activeArtifactSession.messages
      );
      setAssistantState(cloneAssistantState(assistantStoreRef.current.getState()));
      if (taskToOpen) {
        setHistoryOpen(false);
        setInput("");
        setEditingMessageId(null);
      }
    }
  }, [artifactTasks]);

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
    setReaderContexts([]);
    setComposerContextTokens([]);
  }

  function addComposerContextToken(token: AssistantContextToken) {
    setComposerContextTokens((currentTokens) => [
      ...currentTokens.filter((currentToken) => currentToken.id !== token.id),
      token
    ]);
  }

  function removeComposerContextToken(tokenId: string) {
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
      "生成思维导图",
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

    return [...commandSuggestions, ...paperSuggestions, ...pageSuggestions, ...skillSuggestions];
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
    clearReaderConversationContexts();
    assistantStoreRef.current.restoreSession(session.mode, session.messages);
    setHistoryOpen(false);
    setInput("");
    setEditingMessageId(null);
    setVoiceInputMessage(undefined);
    syncAssistant();
  }

  function openSession(sessionId: string) {
    if (assistantStoreRef.current.getState().pending) {
      return;
    }
    saveActiveConversation();
    const session = sessionRegistryRef.current.find((candidate) => candidate.id === sessionId);
    if (!session) {
      return;
    }

    processedAgentRunSequencesRef.current.clear();
    clearReaderConversationContexts();
    activeSessionIdRef.current = session.id;
    setActiveSessionId(session.id);
    assistantStoreRef.current.restoreSession(session.mode, session.messages);
    setHistoryOpen(false);
    setInput("");
    setEditingMessageId(null);
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

  function appendPublicAgentEvent(event: AgentEvent) {
    if (event.type === "ui.render") {
      const document = event.document as unknown as UIDslDocument;
      const validation = validateUIDslDocument(document);
      if (!validation.valid) {
        assistantStoreRef.current.addMessage(
          createMessage("assistant", `Agent 返回的界面数据无效：${validation.errors.join("；")}`)
        );
        return;
      }

      const currentMessages = assistantStoreRef.current.getState().messages;
      const lastMessage = currentMessages[currentMessages.length - 1];
      if (lastMessage?.role === "assistant") {
        assistantStoreRef.current.replaceMessages([
          ...currentMessages.slice(0, -1),
          {
            ...lastMessage,
            uiDsl: document
          }
        ]);
        return;
      }
      const assistantMessage = createMessage("assistant", "动态界面已准备。");
      assistantMessage.uiDsl = document;
      assistantStoreRef.current.addMessage(assistantMessage);
      return;
    }

    if (event.type === "assistant.message") {
      const assistantMessage = createMessage("assistant", event.message);
      assistantMessage.citations = event.citations;
      assistantMessage.confidence = event.confidence;
      if (event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)) {
        const metadata = event.metadata as {
          audit?: AnswerAuditResult;
          executionTrace?: ModelExecutionTrace;
        };
        assistantMessage.audit = metadata.audit;
        assistantMessage.executionTrace = metadata.executionTrace;
      }
      assistantStoreRef.current.addMessage(assistantMessage);
      return;
    }

    let message: string | null = null;
    if (event.type === "plan.preview") {
      message = `计划：${event.plan.summary}`;
    } else if (event.type === "progress.started") {
      message = `开始执行：${event.summary}`;
    } else if (event.type === "clarification.required") {
      message = event.question;
    } else if (event.type === "confirmation.required") {
      message = event.summary;
    } else if (event.type === "action.requested") {
      message = `准备执行受控动作：${event.action.actionId}`;
    } else if (event.type === "action.failed" || event.type === "run.failed") {
      message = event.message;
    } else if (event.type === "task.requested") {
      message = "后台任务已请求。";
    } else if (event.type === "task.created") {
      message = "后台任务已创建。";
    } else if (event.type === "artifact.requested") {
      message = "产物创建已请求。";
    } else if (event.type === "run.cancelled") {
      message = event.reason ? `运行已取消：${event.reason}` : "运行已取消。";
    }

    if (!message) {
      return;
    }
    const assistantMessage = createMessage("assistant", message);
    if (event.type === "confirmation.required") {
      assistantMessage.confirmation = event;
    }
    assistantStoreRef.current.addMessage(assistantMessage);
  }

  function consumePublicAgentRun(run: AgentRun) {
    const lastSequence = processedAgentRunSequencesRef.current.get(run.runId) ?? 0;
    run.events
      .filter((event) => event.sequence > lastSequence)
      .forEach(appendPublicAgentEvent);
    const latestSequence = run.events[run.events.length - 1]?.sequence ?? lastSequence;
    processedAgentRunSequencesRef.current.set(run.runId, latestSequence);
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

  async function runPublicAgentMessage(message: string, mode: AssistantMode) {
    if (!agentClient) {
      await runEmbeddedAgentMessage(message, mode);
      return;
    }

    const trackedRun = {
      cancelRequested: false,
      cancelSent: false,
      message
    } as {
      cancelRequested: boolean;
      cancelSent: boolean;
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
        const cancelled = await agentClient.cancel(trackedRun.runId, "用户终止了 AI 对话");
        if (cancelled.ok) {
          return;
        }
        trackedRun.cancelSent = false;
        setCancellingSession(false);
        assistantStoreRef.current.addMessage(
          createMessage("assistant", `终止失败：${cancelled.error.message}`)
        );
        syncAssistant();
      } catch (error) {
        trackedRun.cancelSent = false;
        setCancellingSession(false);
        assistantStoreRef.current.addMessage(
          createMessage("assistant", `终止失败：${getAssistantErrorMessage(error)}`)
        );
        syncAssistant();
      }
    };
    const unsubscribe = agentClient.subscribe((event) => {
      if (
        event.type === "run.started" &&
        event.message === message &&
        activeConversationRunRef.current === trackedRun
      ) {
        trackedRun.runId = event.runId;
        if (trackedRun.cancelRequested) {
          void cancelTrackedRun();
        }
      }
    });
    assistantStoreRef.current.setPending(true);
    syncAssistant();
    try {
      const result = await agentClient.send({ message, mode });
      if (!result.ok) {
        assistantStoreRef.current.addMessage(createMessage("assistant", result.error.message));
        return;
      }
      consumePublicAgentRun(result.data);
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
      assistantStoreRef.current.addMessage(
        createMessage("assistant", getAssistantErrorMessage(error))
      );
    } finally {
      unsubscribe();
      if (activeConversationRunRef.current === trackedRun) {
        activeConversationRunRef.current = null;
      }
      setCancellingSession(false);
      assistantStoreRef.current.setPending(false);
      syncAssistant();
    }
  }

  /**
   * The normal desktop route is the public Agent API above. This path is only a
   * compatibility bridge for isolated pane consumers: it still calls the same
   * configured model gateway, so a greeting exercises the configured service
   * rather than falling back to a static instruction message.
   */
  async function runEmbeddedAgentMessage(message: string, mode: AssistantMode) {
    assistantStoreRef.current.setPending(true);
    syncAssistant();

    try {
      if (mode === "command") {
        const result = await runAgentRuntime(
          { message, mode },
          createRuntimeExecutionContext()
        );
        appendRuntimeEvents(result.events);
        await appendJournalAudit(getTraceIdFromRuntimeEvents(result.events));
        if (result.settingsChanged) {
          onSettingsChanged?.({ ...settingsStoreRef.current.getState() });
        }
      } else {
        const answer = await generateAssistantAnswer({
          importedChunksByPaperId,
          mode,
          modelTransport,
          question: message,
          selectedPapers,
          settings: settingsStoreRef.current.getState()
        });
        const assistantMessage = createMessage("assistant", answer.content);
        assistantMessage.audit = answer.audit;
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
        createMessage("assistant", getAssistantErrorMessage(error))
      );
    } finally {
      assistantStoreRef.current.setPending(false);
      syncAssistant();
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
    if (!trackedRun || !agentClient) {
      setCancellingSession(false);
      return;
    }
    trackedRun.cancelRequested = true;
    if (!trackedRun.runId || trackedRun.cancelSent) {
      return;
    }
    trackedRun.cancelSent = true;
    try {
      const result = await agentClient.cancel(trackedRun.runId, "用户终止了 AI 对话");
      if (result.ok) {
        return;
      }
      trackedRun.cancelSent = false;
      setCancellingSession(false);
      assistantStoreRef.current.addMessage(
        createMessage("assistant", `终止失败：${result.error.message}`)
      );
      syncAssistant();
    } catch (error) {
      trackedRun.cancelSent = false;
      setCancellingSession(false);
      assistantStoreRef.current.addMessage(
        createMessage("assistant", `终止失败：${getAssistantErrorMessage(error)}`)
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
        if (!agentClient) {
          throw new Error("AI 服务尚未初始化，请稍后重试。");
        }
        const result = await agentClient.confirm(confirmation.confirmationId, "approve");
        if (!result.ok) {
          throw new Error(result.error.message);
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
      assistantStoreRef.current.addMessage(createMessage("assistant", getAssistantErrorMessage(error)));
    } finally {
      assistantStoreRef.current.setPending(false);
      syncAssistant();
      inputRef.current?.focus();
    }
  }

  async function handleRejectRequest(confirmation: AssistantConfirmationRequest) {
    clearConfirmationMessage(confirmation.confirmationId);
    if (isPublicConfirmation(confirmation)) {
      if (!agentClient) {
        assistantStoreRef.current.addMessage(
          createMessage("assistant", "AI 服务尚未初始化，请稍后重试。")
        );
        syncAssistant();
        inputRef.current?.focus();
        return;
      }
      const result = await agentClient.confirm(confirmation.confirmationId, "reject");
      if (!result.ok) {
        assistantStoreRef.current.addMessage(createMessage("assistant", result.error.message));
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
      assistantStoreRef.current.addMessage(createMessage("assistant", getAssistantErrorMessage(error)));
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
    options: { attachedContextPrompt?: string } = {}
  ) {
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
    await runPublicAgentMessage(publicQuestion, mode);
  }

  async function handleSend() {
    const currentState = assistantStoreRef.current.getState();
    const trimmedInput = input.trim();
    const isSlashCommand = trimmedInput.startsWith("/");
    const commandMessage = isSlashCommand ? trimmedInput.slice(1).trim() : "";
    const contextTokensForTurn = [...composerContextTokens];
    const referencedPaperIds = contextTokensForTurn
      .filter((token) => token.kind === "paper")
      .map((token) => token.id.replace(/^paper-/, ""));
    const attachedContextPrompt = buildComposerTokenPrompt(contextTokensForTurn);
    const activeMode: AssistantMode = isSlashCommand ? "command" : "qa";
    const adapted = adaptTextIntent({
      activeMode,
      value: isSlashCommand ? commandMessage : input
    });

    if (adapted.kind === "idle") {
      return;
    }

    if (currentState.pending) {
      return;
    }

    if (editingMessageId) {
      const messageIndex = currentState.messages.findIndex(
        (message) => message.id === editingMessageId && message.role === "user"
      );
      if (messageIndex >= 0) {
        assistantStoreRef.current.replaceMessages(currentState.messages.slice(0, messageIndex));
      }
    }

    assistantStoreRef.current.setMode(activeMode);
    const userMessage = createMessage(
      "user",
      isSlashCommand ? `/${adapted.userMessageContent}` : adapted.userMessageContent
    );
    userMessage.contextTokens = contextTokensForTurn;
    assistantStoreRef.current.addMessage(userMessage);
    if (referencedPaperIds.length > 0) {
      // @ 引用和左栏“选择并锁定”是同一个任务上下文，而非仅拼进提示词的装饰。
      onLockPapersForTask?.([...new Set(referencedPaperIds)]);
    }
    setComposerContextTokens([]);
    setReaderContexts([]);
    lastReaderContextKeyRef.current = null;

    if (adapted.runtimeInput.mode === "command") {
      commandPaperIdsRef.current = referencedPaperIds;
      try {
        const artifactType = getArtifactTypeFromCommand(adapted.runtimeInput.message);
        if (artifactType && commandPaperIdsRef.current.length > 0) {
          const message = onGenerateArtifact(artifactType, commandPaperIdsRef.current);
          assistantStoreRef.current.addMessage(createMessage("assistant", message));
          setInput("");
          setEditingMessageId(null);
          syncAssistant();
          return;
        }
        await runCommandMessage(adapted.runtimeInput.message);
      } finally {
        commandPaperIdsRef.current = undefined;
      }
      return;
    }

    await runKnowledgeMessage(adapted.runtimeInput.message, adapted.runtimeInput.mode, {
      attachedContextPrompt
    });
  }

  function handleEditMessage(messageId: string) {
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
    assistantStoreRef.current.replaceMessages(currentState.messages.slice(0, assistantIndex));
    setEditingMessageId(null);
    setInput("");
    await runKnowledgeMessage(previousUserMessage.content, currentState.mode);
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
    const rawContent = message.content;
    const isSlashCommand = rawContent.trim().startsWith("/");
    const runtimeMessage = isSlashCommand ? rawContent.trim().slice(1).trim() : rawContent;
    const activeMode: AssistantMode = isSlashCommand ? "command" : "qa";
    const attachedContextPrompt = buildComposerTokenPrompt(message.contextTokens ?? []);
    const retriedMessage = createMessage("user", rawContent);
    retriedMessage.contextTokens = message.contextTokens;
    assistantStoreRef.current.setMode(activeMode);
    assistantStoreRef.current.addMessage(retriedMessage);
    setInput("");
    setEditingMessageId(null);
    setComposerContextTokens([]);
    syncAssistant();

    if (activeMode === "command") {
      await runCommandMessage(runtimeMessage);
      return;
    }

    await runKnowledgeMessage(runtimeMessage, activeMode, {
      attachedContextPrompt
    });
  }

  const conversationStarted = assistantState.messages.length > 0;
  const readyMessage =
    readerContexts.length > 0 ? null : getSelectedSetReadyMessage(selectedSetStatus);
  const composerHint = readyMessage
    ? "可以先直接对话来检查 AI 服务；需要论文分析时，再在左栏锁定论文或用 @ 添加论文。"
    : "输入 / 开始软件命令；普通输入会结合 PDF 选区或当前文献上下文回答。";
  const activeSession = sessionHistory.find((session) => session.id === activeSessionId);
  const activeSessionRunning = activeSession?.kind === "artifact_generation"
    ? activeSession.status === "running"
    : assistantState.pending;

  return (
    <div className={conversationStarted ? "assistant-pane in-conversation" : "assistant-pane initial-session"}>
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

      <AssistantContextPanel context={runtimeContext} />

      <AssistantMessageList
        messages={assistantState.messages}
        mode={assistantState.mode}
        onConfirmRequest={(confirmation) => {
          void handleConfirmRequest(confirmation);
        }}
        onDynamicAction={(action, traceId) => {
          void handleUIDslAction(action, traceId);
        }}
        onEditMessage={handleEditMessage}
        onModeChange={switchModeAsNewSession}
        onRegenerateMessage={handleRegenerateMessage}
        onRejectRequest={handleRejectRequest}
        onRetryUserMessage={(messageId) => {
          void handleRetryUserMessage(messageId);
        }}
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
        pending={assistantState.pending}
        suggestions={buildComposerSuggestions()}
        voiceInputMessage={voiceInputMessage}
      />
    </div>
  );
}
