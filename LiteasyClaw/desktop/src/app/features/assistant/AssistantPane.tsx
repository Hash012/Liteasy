import { useEffect, useRef, useState } from "react";
import { AssistantComposer } from "./AssistantComposer";
import { AssistantHistoryPanel } from "./AssistantHistoryPanel";
import { AssistantMessageList } from "./AssistantMessageList";
import type {
  AssistantMessage,
  AssistantComposerSuggestion,
  AssistantContextToken,
  AssistantMode,
  AssistantState,
  SelectedSetStatus
} from "./assistant.types";
import { createSettingsStore } from "../settings/settings.store";
import type { ArtifactType } from "../artifacts/artifact.types";
import { createAssistantStore } from "./assistant.store";
import {
  archiveAssistantSession,
  restoreAssistantSession,
  type AssistantSessionHistoryItem
} from "./assistantSessionHistory";
import { buildAgentRuntimeContextView } from "../agent-runtime/contextView";
import { executeUIDslActionRef } from "../agent-runtime/dynamicActionExecutor";
import { adaptDefaultUiIntent, adaptTextIntent } from "../agent-runtime/intentInputAdapter";
import { createModelAssistedClarification } from "../agent-runtime/modelClarification";
import { createModelSemanticPlanner } from "../agent-runtime/modelSemanticPlanner";
import {
  executeConfirmedSemanticPlan,
  rejectHumanConfirmation
} from "../agent-runtime/planExecutor";
import { runAgentRuntime } from "../agent-runtime/runtimeOrchestrator";
import type {
  AgentRuntimeEvent,
  AgentRuntimeExecutionContext,
  HumanConfirmationRequest,
  PendingCommandClarification
} from "../agent-runtime/agentRuntime.types";
import { createExecutionJournal } from "../generative-ui/executionJournal";
import type { UIDslActionRef } from "../generative-ui/generativeUi.types";
import { createModelAssistedJournalAuditModel } from "../generative-ui/journalAuditModel";
import { createModelAssistedUIDslGenerator } from "../generative-ui/uiDslGenerator";
import type { ModelTransport } from "../models/modelHttpClient";
import type { ActionContext } from "../skills/actionRegistry";
import type { Paper, WorkspaceSource } from "../workspace/workspace.types";
import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { SettingsState } from "../settings/settings.types";
import {
  createAgentCoreSession,
  type AgentCorePreparedTurn
} from "../agent-core/agentCoreSession";
import { defaultAgentCoreConfig } from "../agent-core/agentCoreConfig";
import { generateAssistantAnswer } from "./generateAssistantAnswer";
import { AssistantContextPanel } from "./AssistantContextPanel";
import {
  getAssistantErrorMessage,
  getSelectedSetReadyMessage
} from "./assistantPresentation";
import type { ReaderConversationContext } from "./assistantContext.types";

type SettingsStoreLike = ReturnType<typeof createSettingsStore>;

type AssistantPaneProps = {
  importedChunksByPaperId?: Record<string, RetrievalChunk[]>;
  modelTransport?: ModelTransport;
  onApplyGeneratedTheme?: ActionContext["applyGeneratedTheme"];
  onApplyLayoutPreset?: ActionContext["applyLayoutPreset"];
  onApplyPanelAction?: ActionContext["applyPanelAction"];
  onApplyThemePreset?: ActionContext["applyThemePreset"];
  onGenerateArtifact: (artifactType: ArtifactType) => string;
  onImportSelectedSet?: ActionContext["importSelectedSet"];
  onMoveDockItem?: ActionContext["moveDockItem"];
  onOpenAcademicArchive?: ActionContext["openAcademicArchive"];
  onOpenOrganizationSharedLibrary?: () => string | Promise<string>;
  onSettingsChanged?: (settings: SettingsState) => void;
  profileUnlocked?: boolean;
  readerConversationContext?: ReaderConversationContext | null;
  runtimeOrganizationName?: string;
  runtimeWorkspace?: Partial<WorkspaceSource>;
  selectedPapers?: Paper[];
  selectedSetStatus: SelectedSetStatus;
  settingsStore?: SettingsStoreLike;
};

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

export function AssistantPane({
  importedChunksByPaperId = {},
  modelTransport,
  onApplyGeneratedTheme,
  onApplyLayoutPreset,
  onApplyPanelAction,
  onApplyThemePreset,
  onGenerateArtifact,
  onImportSelectedSet,
  onMoveDockItem,
  onOpenAcademicArchive,
  onOpenOrganizationSharedLibrary,
  onSettingsChanged,
  profileUnlocked = false,
  readerConversationContext = null,
  runtimeOrganizationName,
  runtimeWorkspace,
  selectedPapers = [],
  selectedSetStatus,
  settingsStore
}: AssistantPaneProps) {
  const assistantStoreRef = useRef(createAssistantStore());
  const agentCoreRef = useRef(createAgentCoreSession());
  const executionJournalRef = useRef(createExecutionJournal());
  const pendingCommandClarificationRef = useRef<PendingCommandClarification | undefined>();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const lastReaderContextKeyRef = useRef<string | null>(null);
  const settingsStoreRef = useRef(settingsStore ?? createSettingsStore());
  const [assistantState, setAssistantState] = useState<AssistantState>(() =>
    cloneAssistantState(assistantStoreRef.current.getState())
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [input, setInput] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [voiceInputMessage, setVoiceInputMessage] = useState<string | undefined>();
  const [sessionHistory, setSessionHistory] = useState<AssistantSessionHistoryItem[]>([]);
  const [composerContextTokens, setComposerContextTokens] = useState<AssistantContextToken[]>([]);
  const [readerContexts, setReaderContexts] = useState<ReaderConversationContext[]>([]);
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

  function syncAssistant() {
    setAssistantState(cloneAssistantState(assistantStoreRef.current.getState()));
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

    const paperSuggestions: AssistantComposerSuggestion[] = selectedPapers.flatMap((paper) => {
      const paperToken: AssistantContextToken = {
        detail: "整篇论文",
        id: `paper-${paper.id}`,
        kind: "paper",
        label: paper.title,
        prompt: `用户指定论文上下文：${paper.title}（paperId=${paper.id}）`
      };
      const pageTokens: AssistantComposerSuggestion[] = Array.from({ length: 20 }, (_, index) => index + 1).map((page) => ({
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
      }));

      return [
        {
          detail: "整篇论文",
          id: `paper-${paper.id}`,
          label: paper.title,
          token: paperToken,
          trigger: "@" as const
        },
        ...pageTokens
      ];
    });

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

    return [...commandSuggestions, ...paperSuggestions, ...skillSuggestions];
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
      archiveCurrentSession();
      agentCoreRef.current = createAgentCoreSession();
      clearReaderConversationContexts();
      assistantStoreRef.current.clearMessages();
      setHistoryOpen(false);
      setInput("");
      setEditingMessageId(null);
      setVoiceInputMessage(undefined);
    }

    assistantStoreRef.current.setMode(adapted.mode);
    syncAssistant();
  }

  function archiveCurrentSession() {
    const currentState = cloneAssistantState(assistantStoreRef.current.getState());
    setSessionHistory((currentHistory) =>
      archiveAssistantSession({
        currentHistory,
        state: currentState
      })
    );
  }

  function startNewSession() {
    archiveCurrentSession();
    agentCoreRef.current = createAgentCoreSession();
    clearReaderConversationContexts();
    assistantStoreRef.current.clearMessages();
    setHistoryOpen(false);
    setInput("");
    setEditingMessageId(null);
    syncAssistant();
  }

  function restoreArchivedSession(sessionId: string) {
    const restored = restoreAssistantSession({
      history: sessionHistory,
      sessionId,
      store: assistantStoreRef.current
    });
    if (!restored) {
      return;
    }

    agentCoreRef.current = createAgentCoreSession();
    clearReaderConversationContexts();
    setHistoryOpen(false);
    setInput("");
    setEditingMessageId(null);
    syncAssistant();
  }

  function showVoiceInputPlaceholder() {
    setVoiceInputMessage("语音输入接口已预留，当前版本请先使用文本输入。");
    inputRef.current?.focus();
  }

  function createRuntimeExecutionContext(
    options: {
      agentCoreTurn?: AgentCorePreparedTurn;
      includeSemanticPlanner?: boolean;
    } = {}
  ): AgentRuntimeExecutionContext {
    return {
      agentCore: options.agentCoreTurn?.runtimeContext,
      contextView: runtimeContext,
      clarifySemanticPlan: createModelAssistedClarification({
        modelTransport,
        settings: settingsStoreRef.current.getState()
      }),
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
      pendingClarification: pendingCommandClarificationRef.current,
      profileUnlocked,
      semanticPlanner: options.includeSemanticPlanner
        ? createModelSemanticPlanner({
            modelTransport,
            settings: settingsStoreRef.current.getState()
          })
        : undefined,
      settingsStore: settingsStoreRef.current,
      startArtifactAnalysis: onGenerateArtifact
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

  function updatePendingCommandClarification(input: string, events: AgentRuntimeEvent[]) {
    const clarification = events.find(
      (event) => event.type === "clarification_request" && event.kind === "ambiguous_action"
    );

    if (clarification?.type === "clarification_request") {
      pendingCommandClarificationRef.current = {
        clarification: {
          candidates: clarification.candidates,
          kind: clarification.kind,
          missing: clarification.missing,
          question: clarification.question
        },
        previousInput: input
      };
      return;
    }

    pendingCommandClarificationRef.current = undefined;
  }

  async function runCommandMessage(message: string) {
    assistantStoreRef.current.setPending(true);
    syncAssistant();

    let preparedTurn: AgentCorePreparedTurn | undefined;

    try {
      const prepared = agentCoreRef.current.prepareTurn({
        message,
        mode: "command",
        runtimeContext
      });

      if (!prepared.ok) {
        appendRuntimeEvents(prepared.events);
        setInput("");
        setEditingMessageId(null);
        return;
      }
      preparedTurn = prepared.turn;

      const result = await runAgentRuntime(
        {
          message,
          mode: "command"
        },
        createRuntimeExecutionContext({
          agentCoreTurn: preparedTurn,
          includeSemanticPlanner: true
        })
      );

      agentCoreRef.current.observeRuntimeTurn({
        events: result.events,
        turn: preparedTurn
      });
      appendRuntimeEvents(result.events);
      updatePendingCommandClarification(message, result.events);
      await appendJournalAudit(getTraceIdFromRuntimeEvents(result.events));

      if (result.settingsChanged) {
        onSettingsChanged?.({ ...settingsStoreRef.current.getState() });
      }
      setInput("");
      setEditingMessageId(null);
    } catch (error) {
      if (preparedTurn) {
        agentCoreRef.current.observeRuntimeTurn({
          events: [
            {
              message: getAssistantErrorMessage(error),
              recovery: "请稍后重试，或缩小命令范围后重新发送。",
              type: "runtime_error"
            }
          ],
          turn: preparedTurn
        });
      }
      assistantStoreRef.current.addMessage(createMessage("assistant", getAssistantErrorMessage(error)));
    } finally {
      assistantStoreRef.current.setPending(false);
      syncAssistant();
    }
  }

  async function handleConfirmRequest(confirmation: HumanConfirmationRequest) {
    assistantStoreRef.current.setPending(true);
    clearConfirmationMessage(confirmation.confirmationId);
    syncAssistant();

    try {
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

  function handleRejectRequest(confirmation: HumanConfirmationRequest) {
    clearConfirmationMessage(confirmation.confirmationId);
    const result = rejectHumanConfirmation(confirmation, {
      journal: executionJournalRef.current
    });
    appendRuntimeEvents(result.events);
    void appendJournalAudit(confirmation.traceId).then(syncAssistant);
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
    if (readyMessage) {
      assistantStoreRef.current.addMessage(createMessage("assistant", readyMessage));
      syncAssistant();
      inputRef.current?.focus();
      setInput("");
      setEditingMessageId(null);
      return;
    }

    assistantStoreRef.current.setPending(true);
    syncAssistant();

    const prepared = agentCoreRef.current.prepareTurn({
      // PDF 选区来自用户显式右键/按钮加入，应优先作为本轮问答的局部证据。
      message:
        combinedContextPrompt.length > 0
          ? `${combinedContextPrompt}\n\n用户问题：${question}`
          : question,
      mode,
      runtimeContext
    });

    if (!prepared.ok) {
      appendRuntimeEvents(prepared.events);
      assistantStoreRef.current.setPending(false);
      setInput("");
      setEditingMessageId(null);
      syncAssistant();
      inputRef.current?.focus();
      return;
    }

    try {
      const answer = await generateAssistantAnswer({
        agentCoreContext: prepared.turn.runtimeContext.prompt,
        importedChunksByPaperId,
        modelTransport,
        mode,
        question:
          combinedContextPrompt.length > 0
            ? `${combinedContextPrompt}\n\n用户问题：${question}`
            : question,
        selectedPapers,
        settings: settingsStoreRef.current.getState()
      });
      const assistantMessage = createMessage("assistant", answer.content);
      assistantMessage.audit = answer.audit;
      assistantMessage.citations = answer.citations;
      assistantMessage.confidence = answer.confidence;
      assistantMessage.executionTrace = answer.executionTrace;
      assistantMessage.uiDsl = answer.uiDsl;

      agentCoreRef.current.observeKnowledgeTurn({
        summary: answer.answer,
        turn: prepared.turn
      });
      assistantStoreRef.current.addMessage(assistantMessage);
      setInput("");
      setEditingMessageId(null);
    } catch (error) {
      agentCoreRef.current.observeKnowledgeTurn({
        failed: true,
        summary: getAssistantErrorMessage(error),
        turn: prepared.turn
      });
      assistantStoreRef.current.addMessage(
        createMessage("assistant", getAssistantErrorMessage(error))
      );
    } finally {
      assistantStoreRef.current.setPending(false);
      syncAssistant();
    }
  }

  async function handleSend() {
    const currentState = assistantStoreRef.current.getState();
    const trimmedInput = input.trim();
    const isSlashCommand = trimmedInput.startsWith("/");
    const commandMessage = isSlashCommand ? trimmedInput.slice(1).trim() : "";
    const contextTokensForTurn = [...composerContextTokens];
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
    setComposerContextTokens([]);
    setReaderContexts([]);
    lastReaderContextKeyRef.current = null;

    if (adapted.runtimeInput.mode === "command") {
      await runCommandMessage(adapted.runtimeInput.message);
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
  const composerHint =
    readyMessage ??
    "输入 / 开始软件命令；普通输入会结合 PDF 选区或当前文献上下文回答。";

  return (
    <div className={conversationStarted ? "assistant-pane in-conversation" : "assistant-pane initial-session"}>
      <div className="assistant-session-toolbar">
        <div aria-label="会话操作" className="assistant-session-actions">
          <button
            className="assistant-session-button"
            onClick={startNewSession}
            title="开始一个新的 AI 对话"
            type="button"
          >
            新建
          </button>
          <button
            className="assistant-session-button"
            onClick={() => setHistoryOpen((current) => !current)}
            title="查看历史会话"
            type="button"
          >
            {historyOpen ? "隐藏" : "历史"}
          </button>
        </div>
      </div>

      {historyOpen ? (
        <AssistantHistoryPanel history={sessionHistory} onRestoreSession={restoreArchivedSession} />
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
