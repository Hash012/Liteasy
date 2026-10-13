import { OptionPicker } from "../../shared/ui/productPrimitives";
import "../../features/assistant/assistantView.css";
import { createAssistantSessionService } from "./assistantSessionService";
import { registerQuickAskTransfer } from "../../features/pdf/quickAskTransfer";
import { getAccountSessionGeneration } from "../../features/account/accountSessionStorage";
import { assistantContentRevision, hasAssistantContent, type AssistantView } from "../../features/assistant/assistantView";
import { liteasyPath } from "../../features/resource-filesystem/liteasyPath";
import { redactDiagnostic } from "../../features/context/objectContext";
import { isTauri } from "@tauri-apps/api/core";
import { AssistantPane, AssistantTranscript } from "../../features/assistant/AssistantPane";
import { parseEvidenceReport } from "../../features/evidence/evidenceReport";
import { parseResearchTask } from "../../features/research-loop/researchLoop";
import { catalogSearchMetadata } from "../../features/search/searchMetadata";
import type { ReadingCatalogEntry } from "../../features/library/readingCatalog.types";
import { conversationTurnsFromMessages } from "../../features/assistant/assistantConversationContext";
import { GenerationPromptEditor } from "../../features/ai-prompts/GenerationPromptEditor";
import { artifactPromptTask, getGenerationPrompt, settingsWithGenerationPrompt, type GenerationPromptTask } from "../../features/ai-prompts/generationPrompts";
import { mergeAssistantAssetWrites, parseAssistantAssetWrites } from "../../features/assistant/assistantAssetWrites";
import { AssistantModelPicker } from "../../features/models/AssistantModelPicker";
import { contextPreviewText } from "../../features/assistant/contextAssetPreview";
import { thinkingDepthInstruction, type ThinkingDepth } from "../../features/assistant/thinkingDepth";
import { collectPaperAnchors } from "../../features/paper-anchors/paperAnchorEntity";
import { parseContextCoverageReport } from "../../features/assistant/contextCoverageReport";
import { parseLiteasyPath } from "../../features/resource-filesystem/liteasyPath";
import { readerContextDragMime, readDraggedReaderContext } from "../../features/assistant/readerContextDrag";
import { useObjectWorkbench } from "../../features/objects/objectWorkbenchPort";
import { hasResourceContextTransfer, readContextPaper } from "../../features/object-transfer/contextTransfer";
import { contextRefSchema, type ContextRef } from "../../features/context/objectContext";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { contextInstructionText, insertContextNames, type ContextInsertion } from "../../features/assistant/inlineContext";
import { Button, Input } from "@fluentui/react-components";
import { AssistantSessionToolbar } from "../../features/assistant/AssistantSessionToolbar";
import { AssistantComposer } from "../../features/assistant/AssistantComposer";
import { AssistantHistoryPanel } from "../../features/assistant/AssistantHistoryPanel";
import { AssistantMessageList } from "../../features/assistant/AssistantMessageList";
import type {
  AssistantConfirmationRequest,
  AgentActivityStatus,
  AgentContextUsage,
  AssistantMessage,
  AssistantComposerSuggestion,
  AssistantContextToken,
  AssistantMode,
  AssistantState,
  SelectedSetStatus
} from "../../features/assistant/assistant.types";
import {
  applyAgentActivityEvent,
  completeAgentActivity,
  createAgentActivity
} from "../../features/assistant/agentActivity";
import { formatAgentRuntimeError } from "../../features/agent-runtime/runtimeObservability";
import type { FrontendAgentClient } from "../../features/agent-api/frontendAgentClient";
import type {
  AgentAttachment,
  AgentConfirmationRequest,
  AgentEvent,
  AgentRun,
  PublicWorkflowAuditSummary
} from "../../features/agent-api/agentApi.types";
import { createSettingsStore } from "../../features/settings/settings.store";
import type { ArtifactTask, ArtifactType } from "../../features/artifacts/artifact.types";
import { createAssistantStore } from "../../features/assistant/assistant.store";
import {
  createArtifactTaskSession,
  createAssistantSession,
  getArtifactTaskSessionId,
  resolveAssistantPublicAgentClientSessionId,
  snapshotAssistantSession,
  upsertAssistantSession,
  type AssistantSessionHistoryItem,
  type ArtifactSessionOpenRequest
} from "../../features/assistant/assistantSessionHistory";
import { buildAgentRuntimeContextView } from "../../features/agent-runtime/contextView";
import { executeUIDslActionRef } from "../../features/agent-runtime/dynamicActionExecutor";
import { adaptDefaultUiIntent, adaptTextIntent } from "../../features/agent-runtime/intentInputAdapter";
import {
  executeConfirmedSemanticPlan,
  rejectHumanConfirmation
} from "../../features/agent-runtime/planExecutor";
import type {
  AgentRuntimeEvent,
  AgentRuntimeExecutionContext,
  HumanConfirmationRequest,
  PendingCommandClarification
} from "../../features/agent-runtime/agentRuntime.types";
import {
  createExecutionJournal,
  type ExecutionJournal
} from "../../features/generative-ui/executionJournal";
import type { UIDslActionRef, UIDslDocument } from "../../features/generative-ui/generativeUi.types";
import { validateUIDslDocument } from "../../features/generative-ui/uiDslValidator";
import { createModelAssistedJournalAuditModel } from "../../features/generative-ui/journalAuditModel";
import { createModelAssistedUIDslGenerator } from "../../features/generative-ui/uiDslGenerator";
import { createModelAssistedClarification } from "../../features/agent-runtime/modelClarification";
import { createModelSemanticPlanner } from "../../features/agent-runtime/modelSemanticPlanner";
import { runAgentRuntime } from "../../features/agent-runtime/runtimeOrchestrator";
import type { ModelTransport } from "../../features/models/modelHttpClient";
import type { AcademicProfile } from "../../features/profile/profile.types";
import type { ActionContext } from "../../features/skills/actionRegistry";
import type { Paper, WorkspaceSource } from "../../features/workspace/workspace.types";
import type { SettingsState } from "../../features/settings/settings.types";
import type { Citation, RetrievalChunk } from "../../features/retrieval/retrieval.types";
import { defaultAgentCoreConfig } from "../../features/agent-core/agentCoreConfig";
import type { AnswerAuditResult } from "../../features/assistant/answerAuditor";
import type { ModelExecutionTrace } from "../../features/models/modelExecution";
import type { ModelAuditTransport } from "../../features/models/modelAuditClient";
import { AssistantContextPanel } from "../../features/assistant/AssistantContextPanel";
import {
  getAssistantErrorMessage,
  getModeHint,
  getSelectedSetReadyMessage
} from "../../features/assistant/assistantPresentation";
import type { ReaderConversationContext } from "../../features/assistant/assistantContext.types";
import { generateAssistantAnswer } from "../../features/assistant/generateAssistantAnswer";

import { artifactSlashSuggestions, requestedArtifactType } from "../../features/artifacts/artifactInvocation";
import type { AssistantHistoryPersistence, AssistantHistorySnapshot } from "../../features/assistant/assistantHistoryPersistence";

type SettingsStoreLike = ReturnType<typeof createSettingsStore>;
const emptyImportedChunks: Record<string, RetrievalChunk[]> = {};

type QueuedAssistantTurn = {
  systemPrompt?: string;
  thinkingDepth: ThinkingDepth;
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

export type AssistantPaneProps = {
  contextUsage?: AgentContextUsage;
  /**
   * The application always supplies the public Agent client. Keeping this optional
   * makes the pane usable in isolated previews and provides a real model-backed
   * fallback for legacy embeds while the Agent host is being initialized.
   */
  agentClient?: FrontendAgentClient;
  historyPersistence?: AssistantHistoryPersistence;
  academicProfile?: AcademicProfile;
  artifactTasks?: ArtifactTask[];
  artifactSessionOpenRequest?: ArtifactSessionOpenRequest;
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
  onGenerateArtifact: (artifactType: ArtifactType, paperIds?: string[], context?: string, contextRefs?: import("../../features/context/objectContext").ContextRef[], systemPrompt?: string, origin?: import("../../features/assistant/assistantSessionContracts").AssistantOrigin) => import("../../features/assistant/assistantSessionHistory").AssistantTaskStartResult;
  onImportSelectedSet?: ActionContext["importSelectedSet"];
  lazyPaperContext?: boolean;
  onPreparePapersForContext?: (paperIds: string[]) => Promise<void>;
  onExpand?: () => void;
  onMoveDockItem?: ActionContext["moveDockItem"];
  onOpenAcademicArchive?: ActionContext["openAcademicArchive"];
  onOpenArtifact?: (artifactId: string) => void;
  onOpenAsset?: import("../../features/resource-filesystem/assetNavigation").OpenAgentAsset;
  onOpenCitation?: (citation: Citation) => void;
  onOpenOrganizationSharedLibrary?: () => string | Promise<string>;
  onActiveSessionChange?: (session: AssistantSessionHistoryItem) => void;
  onSettingsChanged?: (settings: SettingsState) => void;
  profilePersonalizationSummary?: string;
  profileUnlocked?: boolean;
  profileEnabled?: boolean;
  registrationWelcomeMessage?: { content: string; id: number };
  readerConversationContext?: ReaderConversationContext | null;
  runtimeOrganizationName?: string;
  availablePapers?: Paper[];
  searchEntries?: ReadingCatalogEntry[];
  contextSuggestions?: AssistantComposerSuggestion[];
  contextCatalogStatus?: string;
  onRefreshContextCatalog?: () => void;
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

export function AssistantSessionController({
  contextUsage,
  agentClient,
  historyPersistence,
  academicProfile,
  artifactTasks = [],
  artifactSessionOpenRequest,
  auditTransport,
  developerDiagnostics = false,
  executionJournal,
  importedChunksByPaperId = emptyImportedChunks,
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
  lazyPaperContext = false,
  onExpand,
  onMoveDockItem,
  onOpenAcademicArchive,
  onOpenArtifact,
  onOpenAsset,
  onOpenCitation,
  onOpenOrganizationSharedLibrary,
  onActiveSessionChange,
  onSettingsChanged,
  profilePersonalizationSummary,
  profileUnlocked = false,
  profileEnabled,
  registrationWelcomeMessage,
  readerConversationContext = null,
  runtimeOrganizationName,
  contextCatalogStatus,
  onRefreshContextCatalog,
  runtimeWorkspace,
  selectedPapers = [],
  availablePapers = selectedPapers,
  contextSuggestions = [],
  searchEntries = [],
  selectedSetStatus,
  settingsStore
}: AssistantPaneProps) {
  const objectWorkbench = useObjectWorkbench();
  const [contextDropCount, setContextDropCount] = useState(0);
  const [contextDropMessage, setContextDropMessage] = useState("");
  const [thinkingDepth, setThinkingDepth] = useState<ThinkingDepth>("balanced");
  const initialSessionRef = useRef(
    createAssistantSession({
      mode: "command"
    })
  );
  const owner = useRef(createAssistantSessionService(initialSessionRef.current.id)).current;
  const assistantStoreRef = { get current() { return owner.store(); } };
  const activeSessionIdRef = useRef(initialSessionRef.current.id);
  const sessionRegistryRef = useRef<AssistantSessionHistoryItem[]>([
    initialSessionRef.current
  ]);
  const knownArtifactTaskIdsRef = useRef(new Set<string>());
  const openedArtifactRequestRef = useRef<string>();
  const deliveredRegistrationWelcomeMessageIdsRef = useRef(new Set<number>());
  const executionJournalRef = useRef(executionJournal ?? createExecutionJournal());
  const processedAgentRunSequencesRef = useRef(new Map<string, number>());
  const processedAgentActivityEventIdsRef = useRef(new Set<string>());
  const processedAgentMessageEventIdsRef = useRef(new Set<string>());
  const agentActivityMessageIdsByRunRef = useRef(new Map<string, string>());
  const activeConversationRunRef = {
    get current() { return owner.runs.get(owner.target()) ?? null; },
    set current(run: import("./assistantSessionService").OwnedAssistantRun | null) {
      if (run) owner.runs.set(owner.target(), run); else owner.runs.delete(owner.target());
    }
  };
  const queuedAssistantTurnsRef = {
    get current() { return owner.queue<QueuedAssistantTurn>(); },
    set current(turns: QueuedAssistantTurn[]) { owner.replaceQueue(turns); }
  };
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
  const [view, setView] = useState<AssistantView>({ kind: "home" });
  const historyOpen = view.kind === "history" || view.kind === "task-list";
  const historyKind = view.kind === "task-list" ? "artifact_generation" : view.kind === "history" ? "conversation" : undefined;
  const sendLockRef = useRef(new Set<string>());
  const taskDiscussionLocksRef = useRef(new Set<string>());
  const resultLookupsRef = useRef(new Set<string>());
  const [embeddedUsage, setEmbeddedUsage] = useState<{ sessionId: string; usage: AgentContextUsage }>();
  const [generationPrompts, setGenerationPrompts] = useState<Partial<Record<GenerationPromptTask, string>>>({});
  const [input, setInput] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [voiceInputMessage, setVoiceInputMessage] = useState<string | undefined>();
  const [sessionHistory, setSessionHistory] = useState<AssistantSessionHistoryItem[]>([
    initialSessionRef.current
  ]);
  const [composerContextTokens, setComposerContextTokens] = useState<AssistantContextToken[]>([]);
  const promptTask = artifactPromptTask(requestedArtifactType(contextInstructionText(input, composerContextTokens)));
  const [readerContexts, setReaderContexts] = useState<ReaderConversationContext[]>([]);
  const [cancellingSession, setCancellingSession] = useState(false);
  const [historyReady, setHistoryReady] = useState(!historyPersistence);
  const historyReadyRef = useRef(!historyPersistence);
  const mountedRef = useRef(true);
  const [saveStatus, setSaveStatus] = useState<import("../../features/assistant/assistantSessionContracts").AssistantPersistenceStatus>("dirty");
  const savedRevisionsRef = useRef(new Map<string, string>());
  const currentSaveTargetRef = useRef({ scope: "", target: "", revision: "" });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [historyError, setHistoryError] = useState<string>();
  const [historyLoadAttempt, setHistoryLoadAttempt] = useState(0);
  const [taskHydrationEpoch, setTaskHydrationEpoch] = useState(0);
  const hydratingTasksRef = useRef(new Set<string>());
  const draftRef = useRef({ input, tokens: composerContextTokens, readerContexts });
  draftRef.current = { input, tokens: composerContextTokens, readerContexts };
  const contextCaretRef = useRef<{ input: string; caret: number; sessionId: string }>();
  useLayoutEffect(() => {
    const pending = contextCaretRef.current;
    if (!pending) return;
    contextCaretRef.current = undefined;
    if (pending.input === input && pending.sessionId === activeSessionId) {
      inputRef.current?.setSelectionRange(pending.caret, pending.caret);
    }
  }, [input, activeSessionId, composerContextTokens]);

  function persistConversation(): Promise<void> {
    if (!historyPersistence || !historyReadyRef.current) return Promise.resolve();
    const snapshot: AssistantHistorySnapshot = {
      version: "liteasy.assistant-history/v1", activeSessionId: activeSessionIdRef.current,
      sessions: sessionRegistryRef.current.map((session) => session.id === activeSessionIdRef.current
        ? { ...session, draft: draftRef.current } : session).filter(hasAssistantContent), draft: draftRef.current
    };
    const scope = objectWorkbench?.scopeId ?? "local";
    const revisions = snapshot.sessions.filter(hasAssistantContent).map((session) => ({
      target: session.id, revision: assistantContentRevision(session, session.id === snapshot.activeSessionId ? snapshot.draft : session.draft)
    }));
    if (!revisions.length) return Promise.resolve();
    const savingTarget = currentSaveTargetRef.current;
    const persistence = historyPersistence;
    if (mountedRef.current && revisions.some((item) => item.target === savingTarget.target && item.revision === savingTarget.revision)) setSaveStatus("saving");
    return persistence.save(snapshot).then(() => {
      for (const item of revisions) savedRevisionsRef.current.set(`${scope}:${item.target}`, item.revision);
      const current = currentSaveTargetRef.current;
      if (mountedRef.current && current.scope === scope && revisions.some((item) => item.target === current.target && item.revision === current.revision)) {
        setHistoryError(undefined); setSaveStatus("saved");
      }
    }).catch((error) => {
      const current = currentSaveTargetRef.current;
      if (mountedRef.current && current.scope === scope && savingTarget.target === current.target && savingTarget.revision === current.revision) {
        setSaveStatus(error && typeof error === "object" && "code" in error && error.code === "revision_conflict" ? "conflict" : "failed"); setHistoryError(`对话保存失败：${error instanceof Error ? error.message : String(error)}`);
      }
      throw error;
    });
  }

  useEffect(() => {
    mountedRef.current = true;
    owner.activate();
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
      void persistConversation().catch(() => {});
      mountedRef.current = false;
      // Only the application/account owner exits here. Closing the feature view does not cancel runs.
      owner.dispose();
      publicAgentClientsRef.current.forEach((client) => client.detach?.());
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
        owner.select(session.id);
        assistantStoreRef.current.restoreSession(session.mode, session.messages);
        setAssistantState(cloneAssistantState(assistantStoreRef.current.getState()));
        setSessionHistory(snapshot.sessions);
        setActiveSessionId(session.id);
        setView(session.kind === "artifact_generation" ? { kind: "task-detail", taskId: session.id } : session.messages.length ? { kind: "conversation", conversationId: session.id } : { kind: "home" });
        for (const item of snapshot.sessions) savedRevisionsRef.current.set(`${objectWorkbench?.scopeId ?? "local"}:${item.id}`, assistantContentRevision(item, item.id === session.id ? snapshot.draft : item.draft));
        setInput(snapshot.draft.input);
        setComposerContextTokens(snapshot.draft.tokens);
        setReaderContexts(snapshot.draft.readerContexts);
      }
      historyReadyRef.current = true;
      setHistoryReady(true);
      setSaveStatus("saved");
      setHistoryError(snapshot?.quarantined?.length ? "部分旧记录已隔离，原始备份已保留。" : undefined);
    }).catch((error) => {
      if (!cancelled) setHistoryError(`对话读取失败：${error instanceof Error ? error.message : String(error)}`);
    });
    return () => { cancelled = true; };
  }, [historyPersistence, historyLoadAttempt]);

  useEffect(() => {
    if (!historyReady) return;
    setSaveStatus("dirty");
    // Throttle rather than debounce: a continuous stream must still commit recoverable fragments.
    if (!saveTimerRef.current) saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = undefined;
      void persistConversation().catch(() => {});
    }, 250);
  }, [historyReady, sessionHistory, activeSessionId, input, composerContextTokens, readerContexts]);
  useEffect(() => {
    const flush = () => { void persistConversation().catch(() => {}); };
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
    profileEnabled: profileEnabled ?? Boolean(settingsStoreRef.current.getState()["profile.enabled"]),
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
    addComposerContextToken({
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
    });
    inputRef.current?.focus();
  }

  useEffect(() => { addReaderContext(readerConversationContext); }, [readerConversationContext]);

  useEffect(() => {
    if (!historyReady || artifactTasks.length === 0) return;
    const unloaded = sessionRegistryRef.current.filter((session) => session.messagesLoaded === false && artifactTasks.some((task) => getArtifactTaskSessionId(task.id, task) === session.id));
    if (unloaded.length && historyPersistence?.loadSession) {
      for (const session of unloaded) {
        if (hydratingTasksRef.current.has(session.id)) continue;
        hydratingTasksRef.current.add(session.id);
        void historyPersistence.loadSession(session.id).then((loaded) => {
          if (!mountedRef.current || !loaded) return;
          sessionRegistryRef.current = upsertAssistantSession(sessionRegistryRef.current, loaded);
          setTaskHydrationEpoch((value) => value + 1);
        }).catch((error) => { if (mountedRef.current) setHistoryError(String(error)); }).finally(() => hydratingTasksRef.current.delete(session.id));
      }
      return;
    }
    let nextSessions = sessionRegistryRef.current;
    const currentSession = nextSessions.find((session) => session.id === activeSessionIdRef.current);
    if (currentSession?.kind !== "artifact_generation") {
      nextSessions = upsertAssistantSession(nextSessions, snapshotAssistantSession({
        session: currentSession ?? initialSessionRef.current,
        state: cloneAssistantState(assistantStoreRef.current.getState())
      }));
    }
    let migratedActiveSessionId: string | undefined;
    // Tasks arrive newest first. Apply older layers first so the reading session
    // keeps its whole trail and its status comes from the most recent layer.
    for (const task of [...artifactTasks].reverse()) {
      const sessionId = getArtifactTaskSessionId(task.id, task);
      const previousSession = nextSessions.find((session) => session.id === sessionId) ??
        nextSessions.find((session) => session.artifactTaskId === task.id);
      const nextSession = createArtifactTaskSession(task, previousSession, Date.now, { developerDiagnostics });
      if (previousSession && previousSession.id !== nextSession.id) {
        nextSessions = nextSessions.filter((session) => session.id !== previousSession.id);
        if (activeSessionIdRef.current === previousSession.id) migratedActiveSessionId = nextSession.id;
      }
      nextSessions = upsertAssistantSession(nextSessions, nextSession);
      knownArtifactTaskIdsRef.current.add(task.id);
    }
    // A resumed older layer remains the active operation even if a newer layer completed.
    nextSessions = nextSessions.map((session) => {
      const running = artifactTasks.find((task) => task.type === "thin_reading" &&
        (task.status === "running" || task.status === "queued") &&
        getArtifactTaskSessionId(task.id, task) === session.id);
      return running ? { ...session, status: "running", artifactTaskId: running.id } : session;
    });
    const nextActiveSessionId = migratedActiveSessionId ?? activeSessionIdRef.current;
    const sessionToRestore = nextSessions.find((session) => session.id === nextActiveSessionId);
    sessionRegistryRef.current = nextSessions;
    setSessionHistory([...nextSessions]);
    // Updating a background reading must leave the active conversation and its draft intact.
    if (sessionToRestore?.kind === "artifact_generation") {
      activeSessionIdRef.current = sessionToRestore.id;
      setActiveSessionId(sessionToRestore.id);
      assistantStoreRef.current.restoreSession(sessionToRestore.mode, sessionToRestore.messages);
      setAssistantState(cloneAssistantState(assistantStoreRef.current.getState()));
    }
  }, [artifactTasks, developerDiagnostics, historyReady, taskHydrationEpoch]);

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
    if (mountedRef.current && owner.target() === activeSessionIdRef.current) setAssistantState(nextState);
    const activeSession = sessionRegistryRef.current.find(
      (session) => session.id === owner.target()
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
    if (mountedRef.current) setSessionHistory([...nextSessions]);
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
    if (!activeSession) {
      return;
    }

    const nextSession = { ...(activeSession.kind === "artifact_generation" ? activeSession : snapshotAssistantSession({
      session: activeSession,
      state: cloneAssistantState(assistantStoreRef.current.getState())
    })), draft: structuredClone(draftRef.current) };
    const nextSessions = upsertAssistantSession(sessionRegistryRef.current, nextSession);
    sessionRegistryRef.current = nextSessions;
    setSessionHistory([...nextSessions]);
  }

  function clearReaderConversationContexts() {
    lastReaderContextKeyRef.current = null;
    pendingCommandClarificationRef.current = undefined;
    setReaderContexts([]);
    setComposerContextTokens([]);
  }

  useEffect(() => {
    if (!objectWorkbench?.resolveLiteasyPath) return;
    const scope = objectWorkbench.scopeId ?? "local";
    for (const session of sessionHistory) {
      const run = session.taskRuns?.at(-1);
      if (session.kind !== "artifact_generation" || run?.status !== "completed" || !run.artifactId || run.resultRefs?.length) continue;
      const key = `${scope}:${session.id}:${run.id}`;
      if (resultLookupsRef.current.has(key)) continue;
      resultLookupsRef.current.add(key);
      void objectWorkbench.resolveLiteasyPath(liteasyPath(scope, { kind: "artifact", artifactId: run.artifactId })).then((attachments) => {
        if (owner.disposed || currentSaveTargetRef.current.scope !== scope) return;
        const refs = attachments.flatMap((attachment) => attachment.refs);
        // A later attempt may have replaced this mutable artifact path while resolution was pending.
        if (!refs.length || sessionRegistryRef.current.find((item) => item.id === session.id)?.taskRuns?.at(-1)?.id !== run.id) return;
        sessionRegistryRef.current = sessionRegistryRef.current.map((item) => item.id !== session.id ? item : { ...item,
          taskRuns: item.taskRuns?.map((candidate) => candidate.id === run.id ? { ...candidate, resultRefs: refs } : candidate),
          taskBinding: item.taskBinding ? { ...item.taskBinding, resultRefs: refs } : undefined
        });
        setSessionHistory([...sessionRegistryRef.current]);
      }).catch(() => { resultLookupsRef.current.delete(key); });
    }
  }, [sessionHistory, objectWorkbench]);

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
      (session) => session.id === owner.target()
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

  async function reconcileSavedSend(sessionId: string, requestId: string) {
    let session = sessionRegistryRef.current.find((item) => item.id === sessionId);
    if (session?.messagesLoaded === false) session = await historyPersistence?.loadSession?.(sessionId);
    if (!session || owner.disposed) return;
    const client = getPublicAgentClient(session);
    if (!client?.findRunByRequest) { setHistoryError("执行方暂不支持核对回执，保留请求；请勿直接重复执行有副作用的动作。"); return; }
    const result = await client.findRunByRequest(requestId);
    if (owner.disposed) return;
    if (!result.ok) { setHistoryError("无法联系执行方，运行状态仍待核对。"); return; }
    if (!result.data) { setHistoryError("执行方未找到回执；请求尚未自动重新执行，可从原问题发起新尝试。"); return; }
    const run = result.data;
    const targetStore = owner.store(sessionId);
    if (!targetStore.getState().messages.length) targetStore.restoreSession(session.mode, session.messages);
    let activity = targetStore.getState().messages.find((message) => message.runId === run.runId);
    if (!activity) { activity = { ...createMessage("assistant", ""), runId: run.runId, agentActivity: createAgentActivity() }; targetStore.addMessage(activity); }
    agentActivityMessageIdsByRunRef.current.set(run.runId, activity.id);
    owner.withTarget(sessionId, () => {
      run.events.forEach((event) => { appendPublicAgentActivityEvent(event); appendPublicAgentEvent(event); });
      finalizePublicAgentActivity(run); targetStore.setPending(false);
      sessionRegistryRef.current = sessionRegistryRef.current.map((item) => item.id === sessionId ? { ...item,
        status: run.status === "interrupted" ? "interrupted" : run.status === "running" ? "unknown" : run.status === "cancelled" ? "cancelled" : "idle",
        outbox: item.outbox?.map((entry) => entry.requestId === requestId ? { ...entry, runId: run.runId, state: ["completed", "failed", "cancelled", "interrupted"].includes(run.status) ? "finished" : "needs_review" } : entry) } : item);
      syncAssistant();
    });
    setHistoryError(run.status === "interrupted" ? "执行方确认上次运行已中断，已保留已提交内容。" : run.status === "running" ? "执行方仍在运行，保留原请求；请稍后再次核对。" : undefined);
  }

  function captureContextInsertion(): ContextInsertion {
    const value = draftRef.current.input;
    const pending = contextCaretRef.current;
    if (pending?.input === value && pending.sessionId === activeSessionIdRef.current)
      return { input: value, start: pending.caret, end: pending.caret };
    return { input: value, start: inputRef.current?.selectionStart ?? value.length,
      end: inputRef.current?.selectionEnd ?? value.length };
  }

  function addComposerContextTokens(tokens: AssistantContextToken[], insertion = captureContextInsertion()) {
    const nextTokens = [...new Map([...draftRef.current.tokens, ...tokens].map((token) => [token.id, token])).values()];
    const next = insertContextNames(draftRef.current.input, tokens, insertion);
    draftRef.current = { ...draftRef.current, input: next.input, tokens: nextTokens };
    contextCaretRef.current = { ...next, sessionId: activeSessionIdRef.current };
    setComposerContextTokens(nextTokens);
    setInput(next.input);
  }

  function addComposerContextToken(token: AssistantContextToken, insertion?: ContextInsertion) {
    addComposerContextTokens([token], insertion);
  }

  async function resolveComposerContextToken(resolve: () => Promise<AssistantContextToken>, insertion = captureContextInsertion()) {
    const sessionId = activeSessionIdRef.current;
    setContextDropCount((count) => count + 1);
    setContextDropMessage("");
    try {
      const token = await resolve();
      if (!mountedRef.current || activeSessionIdRef.current !== sessionId) return false;
      addComposerContextToken(token, insertion);
      return true;
    } catch (error) {
      if (mountedRef.current && activeSessionIdRef.current === sessionId)
        setContextDropMessage(error instanceof Error ? error.message : "添加上下文失败，请重试。");
      return false;
    } finally {
      if (mountedRef.current) setContextDropCount((count) => count - 1);
    }
  }

  async function addDroppedResources(data: DataTransfer) {
    const sessionId = activeSessionIdRef.current;
    const insertion = captureContextInsertion();
    setContextDropCount((count) => count + 1);
    setContextDropMessage("");
    try {
      const paper = readContextPaper(data, availablePapers);
      const tokens: AssistantContextToken[] = paper ? [{
        id: `paper-${paper.id}`, kind: "paper", label: paper.title,
        detail: "论文", prompt: `用户指定论文上下文：${paper.title}（paperId=${paper.id}）`,
      }] : (await objectWorkbench?.receiveContextDrop?.(data) ?? []).map((attachment) => ({
        id: `object-${JSON.stringify(attachment.ref)}`, kind: "object", label: attachment.title,
        detail: attachment.detail, prompt: "", contextRefs: attachment.refs,
      }));
      if (!tokens.length) throw new Error("当前内容不能加入对话。");
      if (!mountedRef.current || activeSessionIdRef.current !== sessionId) return;
      addComposerContextTokens(tokens, insertion);
      inputRef.current?.focus();
    } catch (error) {
      if (mountedRef.current && activeSessionIdRef.current === sessionId)
        setContextDropMessage(error instanceof Error ? error.message : "添加上下文失败，请重试。");
    } finally {
      if (mountedRef.current) setContextDropCount((count) => count - 1);
    }
  }

  async function addLiteasyPath(path: string) {
    const sessionId = activeSessionIdRef.current;
    const insertion = captureContextInsertion();
    setContextDropCount((count) => count + 1);
    setContextDropMessage("");
    try {
      if (!objectWorkbench?.resolveLiteasyPath) throw new Error("资源服务尚未就绪，请稍后重试。");
      if (objectWorkbench.scopeId && !path.trim().startsWith("liteasy://resources/")) {
        const target = parseLiteasyPath(path.trim(), objectWorkbench.scopeId);
        if (target.kind === "paper" && !lazyPaperContext) await onPreparePapersForContext?.([target.paperId]);
      }
      const attachments = await objectWorkbench.resolveLiteasyPath(path.trim());
      if (!mountedRef.current || activeSessionIdRef.current !== sessionId) return false;
      const tokens: AssistantContextToken[] = attachments.map((attachment) => ({
        id: `object-${JSON.stringify(attachment.ref)}`, kind: "object", label: attachment.title,
        detail: attachment.detail, prompt: "", contextRefs: attachment.refs,
      }));
      if (!tokens.length) throw new Error("此路径没有可分析的内容。");
      addComposerContextTokens(tokens, insertion);
      inputRef.current?.focus();
      return true;
    } catch (error) {
      if (mountedRef.current && activeSessionIdRef.current === sessionId)
        setContextDropMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally { if (mountedRef.current) setContextDropCount((count) => count - 1); }
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
        detail: paper.sourcePath ?? "整篇论文",
        id: `paper-${paper.id}`,
        kind: "paper",
        label: paper.title,
        prompt: `用户指定论文上下文：${paper.title}（paperId=${paper.id}）`
      };
      return {
        detail: paper.sourcePath ?? "整篇论文",
        searchMetadata: catalogSearchMetadata(searchEntries.find((entry) => entry.id === paper.id) ?? { id: paper.id, title: paper.title, format: "pdf", subjects: paper.literature?.subjects }),
        category: "论文", description: "整篇论文问答；也可在项目中按页选择原文或图片。", readOnly: true,
        preview: contextPreviewText((importedChunksByPaperId[paper.id] ?? []).map((chunk) => `第 ${chunk.page} 页\n${chunk.snippet}`).join("\n\n")) ||
          [paper.title, paper.authors?.length ? `作者：${typeof paper.authors === "string" ? paper.authors : paper.authors.join("、")}` : "",
            "尚未读取论文正文。添加后将准备可用内容；解析完成后可在项目中预览原文和图片。"].filter(Boolean).join("\n\n"),
        id: `paper-${paper.id}`,
        label: paper.title,
        token: paperToken,
        trigger: "@" as const
      };
    });

    // 先提供所有“整篇论文”候选，避免每篇的页码把后续论文挤出首屏；
    // 输入标题或 p.页码时仍可检索到下面的精确页码上下文。
    const pageSuggestions: AssistantComposerSuggestion[] = availablePapers.flatMap((paper) =>
      [...new Set((importedChunksByPaperId[paper.id] ?? []).map((chunk) => chunk.page))].sort((a, b) => a - b).map((page) => ({
        category: "原文", readOnly: true, description: "已识别的论文页面。",
        preview: contextPreviewText((importedChunksByPaperId[paper.id] ?? []).filter((chunk) => chunk.page === page).map((chunk) => chunk.snippet).join("\n\n")),
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

    return [...artifactSlashSuggestions, ...commandSuggestions, ...paperSuggestions, ...contextSuggestions, ...pageSuggestions, ...skillSuggestions];
  }

  const composerSuggestions = useMemo(buildComposerSuggestions, [availablePapers, contextSuggestions, importedChunksByPaperId, searchEntries]);

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
    if (assistantStoreRef.current.getState().pending && !agentClient) return;
    saveActiveConversation();
    const session = createAssistantSession({ mode });
    const nextSessions = upsertAssistantSession(sessionRegistryRef.current, session);
    sessionRegistryRef.current = nextSessions;
    activeSessionIdRef.current = session.id;
    owner.select(session.id);
    setCancellingSession(false);
    setSessionHistory([...nextSessions]);
    setActiveSessionId(session.id);
    clearReaderConversationContexts();
    assistantStoreRef.current.restoreSession(session.mode, session.messages);
    setView({ kind: "home" });
    setHistoryError(undefined);
    setInput("");
    setEditingMessageId(null);
    setVoiceInputMessage(undefined);
    connectPublicAgentSession(session);
    syncAssistant();
  }

  async function openSession(sessionId: string, checkCurrent?: () => void) {
    checkCurrent?.();
    if (!historyReadyRef.current) return;
    if (assistantStoreRef.current.getState().pending && !agentClient) return;
    saveActiveConversation();
    let session = sessionRegistryRef.current.find((candidate) => candidate.id === sessionId);
    if (session?.messagesLoaded === false && historyPersistence?.loadSession) {
      try {
        session = await historyPersistence.loadSession(sessionId);
        checkCurrent?.();
        if (!mountedRef.current || !session) return;
        sessionRegistryRef.current = upsertAssistantSession(sessionRegistryRef.current, session);
      } catch (error) { setHistoryError(String(error)); return; }
    }
    if (!session) {
      return;
    }

    clearReaderConversationContexts();
    activeSessionIdRef.current = session.id;
    owner.select(session.id);
    setCancellingSession(owner.runs.get(session.id)?.cancelRequested ?? false);
    setActiveSessionId(session.id);
    sessionRegistryRef.current = sessionRegistryRef.current.map((item) => item.id === session!.id ? { ...item, readAt: new Date().toISOString() } : item);
    if (session.kind === "artifact_generation" || !assistantStoreRef.current.getState().messages.length) assistantStoreRef.current.restoreSession(session.mode, session.messages);
    setView(session.kind === "artifact_generation" ? { kind: "task-detail", taskId: session.id } : { kind: "conversation", conversationId: session.id });
    setHistoryError(undefined);
    setInput(session.draft?.input ?? "");
    setComposerContextTokens(session.draft?.tokens ?? []);
    setReaderContexts(session.draft?.readerContexts ?? []);
    setEditingMessageId(null);
    connectPublicAgentSession(session);
    syncAssistant();
  }

  useEffect(() => {
    if (!historyReady) return;
    const scope = objectWorkbench?.scopeId ?? "local";
    let registered = true;
    const unregister = registerQuickAskTransfer(scope, async (transfer, destinationConversationId) => {
      const generation = getAccountSessionGeneration();
      const checkCurrent = () => {
        if (!registered || !mountedRef.current || currentSaveTargetRef.current.scope !== scope || getAccountSessionGeneration() !== generation) throw new Error("账号或对话已变化，未转入其他范围。");
      };
      checkCurrent();
      if (!mountedRef.current || !historyReadyRef.current || currentSaveTargetRef.current.scope !== scope || transfer.receipt.context.source.scopeId !== scope) throw new Error("账号或速问来源已变化。");
      if (assistantStoreRef.current.getState().pending && !agentClient) throw new Error("当前对话正在运行，请完成后再转到新对话。");
      saveActiveConversation();
      await persistConversation();
      checkCurrent();
      let session = sessionRegistryRef.current.find(item => item.id === destinationConversationId);
      if (!session) {
        session = createAssistantSession({ id: destinationConversationId, title: `速问 · ${transfer.paperTitle}`, mode: "qa" });
        session.scopeId = scope;
        session.origin = { kind: "direct_chat", entryPoint: "pdf.quick-ask.transfer", initiatedBy: { type: "user", id: scope } };
        session.messages = [{ id: `${destinationConversationId}:source`, role: "user", content: `选段：\n${transfer.excerpt}\n\n原指令：\n${transfer.receipt.effectiveInstruction}`, quickAskSource: { receipt: transfer.receipt, excerpt: transfer.excerpt, paperTitle: transfer.paperTitle } },
          { id: `${destinationConversationId}:answer`, role: "assistant", content: transfer.answer, turnOutcome: transfer.receipt.terminal === "completed" ? "completed" : "failed" }];
        sessionRegistryRef.current = upsertAssistantSession(sessionRegistryRef.current, session);
        setSessionHistory([...sessionRegistryRef.current]);
      }
      await openSession(session.id, checkCurrent);
      checkCurrent();
      draftRef.current = session.draft ?? { input: "", tokens: [], readerContexts: [] };
      await persistConversation();
      checkCurrent();
      return { conversationId: session.id };
    });
    return () => { registered = false; unregister(); };
  }, [historyReady, objectWorkbench?.scopeId, historyPersistence]);

  useEffect(() => {
    if (!historyReady || !artifactSessionOpenRequest ||
      openedArtifactRequestRef.current === artifactSessionOpenRequest.requestId) return;
    const task = artifactTasks.find((item) => item.id === artifactSessionOpenRequest.taskId);
    const session = task
      ? sessionRegistryRef.current.find((item) => item.id === getArtifactTaskSessionId(task.id, task))
      : sessionRegistryRef.current.find((item) => item.artifactTaskId === artifactSessionOpenRequest.taskId);
    if (!session) return;
    openedArtifactRequestRef.current = artifactSessionOpenRequest.requestId;
    openSession(session.id);
  }, [artifactSessionOpenRequest, artifactTasks, historyReady, assistantState.pending, sessionHistory]);

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
      startArtifactAnalysis: (artifactType) => { const result = onGenerateArtifact(artifactType, commandPaperIdsRef.current); return typeof result === "string" ? result : result.message; }
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
    const activityMessage = { ...createMessage("assistant", ""), agentActivity: createAgentActivity() };
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
    updateAgentMessage(activityMessageId, (message) => ({
      ...message,
      agentActivity: applyAgentActivityEvent(message.agentActivity ?? createAgentActivity(), event)
    }));
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
          : run.status === "failed" || run.status === "interrupted"
            ? "failed"
            : "waiting";
    updateAgentMessage(activityMessageId, (message) => {
      if (!message.agentActivity) return message;
      if (["completed", "cancelled", "failed"].includes(message.agentActivity.status) && message.agentActivity.status !== status) return message;
      const reason = message.researchLoop?.stopReason;
      const unfinished = reason && reason !== "task_completed";
      const statusText = reason === "loop_exhausted" || reason === "context_exhausted" ? "已暂停 · 预算已用完"
        : reason === "needs_review" ? "已暂停 · 需要复核"
          : reason === "request_user" ? "等待补充研究条件"
            : reason === "interrupted" ? "研究已中断" : reason === "waiting_confirmation" ? "等待确认修改" : undefined;
      return { ...message, agentActivity: { ...completeAgentActivity(message.agentActivity, status), ...(unfinished ? { status: reason === "interrupted" ? "failed" as const : "waiting" as const, connectionText: "本轮已结束" } : {}), ...(statusText ? { statusText } : {}) } };
    });
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

    if (event.type === "asset.written") {
      const receipts = parseAssistantAssetWrites([event.receipt]);
      if (receipts) updateAgentMessage(activityMessageId, (message) => ({
        ...message, assetWrites: mergeAssistantAssetWrites(message.assetWrites, receipts)
      }));
      return;
    }

    if (event.type === "assistant.message") {
      let assetWrites: AssistantMessage["assetWrites"];
      let audit: AnswerAuditResult | undefined;
      let evidenceReport: AssistantMessage["evidenceReport"];
      let researchLoop: AssistantMessage["researchLoop"];
      let paperAnchors: AssistantMessage["paperAnchors"];
      let contextCoverage: AssistantMessage["contextCoverage"];
      let executionTrace: ModelExecutionTrace | undefined;
      if (event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)) {
        const metadata = event.metadata as {
          assetWrites?: unknown;
          audit?: AnswerAuditResult;
          evidenceReport?: unknown;
          researchLoop?: unknown;
          executionTrace?: ModelExecutionTrace;
          paperAnchors?: unknown;
          contextCoverage?: unknown;
        };
        assetWrites = parseAssistantAssetWrites(metadata.assetWrites);
        audit = metadata.audit;
        evidenceReport = parseEvidenceReport(metadata.evidenceReport);
        researchLoop = parseResearchTask(metadata.researchLoop);
        executionTrace = metadata.executionTrace;
        if (Array.isArray(metadata.paperAnchors)) paperAnchors = collectPaperAnchors(metadata.paperAnchors);
        contextCoverage = parseContextCoverageReport(metadata.contextCoverage);
      }
      updateAgentMessage(activityMessageId, (message) => ({
        ...message,
        assetWrites: assetWrites ? mergeAssistantAssetWrites(message.assetWrites, assetWrites) : message.assetWrites,
        audit: event.citations?.length ? audit : undefined,
        evidenceReport,
        researchLoop,
        citations: event.citations,
        paperAnchors,
        contextCoverage,
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
    attachments?: AgentAttachment[],
    contextRefs?: ContextRef[],
    depth?: ThinkingDepth,
    systemPrompt?: string
  ) {
    const sessionAgentClient = getActivePublicAgentClient();
    if (!sessionAgentClient) {
      if (contextRefs?.length) throw new Error("当前服务不支持对象上下文，请连接 Agent 后重试。");
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
      await runEmbeddedAgentMessage(depth && mode !== "command" ? `${thinkingDepthInstruction(depth)}\n\n${message}` : message, mode, attachedPaperIds, systemPrompt);
      return;
    }

    const targetId = owner.target();
    const runStore = owner.store(targetId);
    const session = sessionRegistryRef.current.find((item) => item.id === targetId)!;
    const intent = [...(session.outbox ?? [])].reverse().find((item) => item.state === "pending" && item.userMessageId === owner.dispatchingMessages.get(targetId));
    const idempotencyKey = intent?.requestId ?? createConversationIdempotencyKey(mode);
    const input = { message, mode, ...(depth ? { thinkingDepth: depth } : {}), ...(systemPrompt ? { systemPrompt } : {}),
      ...(session.parentConversationId ? { conversationHistory: conversationTurnsFromMessages(runStore.getState().messages), branchId: session.branchId ?? session.id } : {}) };
    const sendOptions = { attachments, idempotencyKey, ...(contextRefs?.length ? { contextRefs, contextPurpose: message } : {}) };
    const scoped = <T,>(callback: () => T) => owner.withTarget(targetId, callback);
    const activityMessageId = startAgentActivity();
    const trackedRun = { activityMessageId, cancelRequested: false, cancelSent: false, client: sessionAgentClient, message, runId: undefined as string | undefined };
    owner.runs.set(targetId, trackedRun);
    runStore.setPending(true);
    syncAssistant();
    const applyEvent = (event: AgentEvent) => scoped(() => {
      appendPublicAgentActivityEvent(event); appendPublicAgentEvent(event);
      sessionRegistryRef.current = sessionRegistryRef.current.map((item) => item.id === targetId ? { ...item,
        inbox: { runId: event.runId, sequence: event.sequence, eventIds: [...(item.inbox?.runId === event.runId ? item.inbox.eventIds : []), event.eventId] } } : item);
      releaseQueuedTurnAfterToolBoundary(event); syncAssistant();
    });
    const consumeEvent = (event: AgentEvent) => {
      if (owner.disposed) return;
      try { owner.accept(event, applyEvent); }
      catch (error) { if (mountedRef.current) setHistoryError(String(error)); }
    };
    const cancelTracked = async () => {
      if (!trackedRun.runId || trackedRun.cancelSent || owner.disposed) return;
      trackedRun.cancelSent = true;
      const result = await trackedRun.client.cancel(trackedRun.runId, "用户终止了 AI 对话");
      if (result.ok) scoped(() => { consumePublicAgentRun(result.data); syncAssistant(); });
      else scoped(() => { trackedRun.cancelSent = false; setCancellingSession(false); });
    };
    const unsubscribe = sessionAgentClient.subscribe((event) => {
      if (owner.disposed) return;
      if (event.type === "run.started" && event.idempotencyKey === idempotencyKey) {
        trackedRun.runId = event.runId;
        agentActivityMessageIdsByRunRef.current.set(event.runId, activityMessageId);
        scoped(() => {
          sessionRegistryRef.current = sessionRegistryRef.current.map((item) => item.id === targetId ? { ...item, runId: event.runId,
            outbox: item.outbox?.map((entry) => entry.requestId === idempotencyKey ? { ...entry, runId: event.runId, state: "accepted" } : entry) } : item);
        });
        if (trackedRun.cancelRequested) void cancelTracked().catch(() => {});
      }
      if (trackedRun.runId !== event.runId) return;
      consumeEvent(event);
      if (owner.hasGap(event.runId) && sessionAgentClient.getRun) {
        void sessionAgentClient.getRun(event.runId).then((result) => {
          if (result.ok) result.data.events.forEach(consumeEvent);
        }).catch(() => {});
      }
    });
    try {
      // Freeze the actual wire payload in the durable intent before dispatching across stores.
      if (intent) {
        sessionRegistryRef.current = sessionRegistryRef.current.map((item) => item.id === targetId ? { ...item,
          outbox: item.outbox?.map((entry) => entry.requestId === idempotencyKey ? { ...entry, input: { input, options: sendOptions } } : entry) } : item);
        await persistConversation();
      }
      if (owner.disposed) return;
      const result = await sessionAgentClient.send(input, sendOptions);
      if (owner.disposed) return;
      if (!result.ok) {
        scoped(() => {
          updateAgentActivity(activityMessageId, (activity) => completeAgentActivity(activity, "failed"));
          updateAgentMessage(activityMessageId, (current) => ({ ...current, content: getAssistantErrorMessage(result.error, { developerDiagnostics }) }));
        });
        return;
      }
      trackedRun.runId = result.data.runId;
      agentActivityMessageIdsByRunRef.current.set(result.data.runId, activityMessageId);
      result.data.events.forEach(consumeEvent);
      scoped(() => { finalizePublicAgentActivity(result.data); });
      if (settingsStoreRef.current.getState()["assistant.public_audit.enabled"] && hasPaperGroundedAuditScope(result.data)) {
        const audits = await sessionAgentClient.listPublicWorkflowAuditSummaries({ runId: result.data.runId, sessionId: result.data.sessionId });
        if (audits.ok) scoped(() => appendPublicWorkflowAuditsToLatestAssistantMessage(audits.data));
      }
      scoped(() => {
        sessionRegistryRef.current = sessionRegistryRef.current.map((item) => item.id === targetId ? { ...item,
          runId: result.data.runId, status: result.data.status === "interrupted" ? "interrupted" : result.data.status === "cancelled" ? "cancelled" : "idle",
          outbox: item.outbox?.map((entry) => entry.requestId === idempotencyKey ? { ...entry, runId: result.data.runId, state: "finished" } : entry) } : item);
      });
    } catch (error) {
      scoped(() => {
        updateAgentActivity(activityMessageId, (activity) => completeAgentActivity(activity, "failed"));
        updateAgentMessage(activityMessageId, (current) => ({ ...current, content: getAssistantErrorMessage(error, { developerDiagnostics }) }));
      });
    } finally {
      unsubscribe();
      scoped(() => {
        owner.runs.delete(targetId);
        if (activeSessionIdRef.current === targetId) setCancellingSession(false);
        runStore.setPending(false); syncAssistant();
        void persistConversation().catch(() => {});
        void executeNextQueuedTurn();
      });
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
    referencedPaperIds: string[] = [],
    systemPrompt?: string
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
        const embeddedSessionId = activeSessionIdRef.current;
        let latestUsage: AgentContextUsage | undefined;
        const answer = await generateAssistantAnswer({
          auditTransport,
          conversationHistory: conversationTurnsFromMessages(assistantStoreRef.current.getState().messages),
          onContextUsage: (usage) => {
            latestUsage = usage;
            setEmbeddedUsage({ sessionId: embeddedSessionId, usage });
          },
          enableVisualizationDecisionPlanner: true,
          importedChunksByPaperId: scopedChunks,
          mode,
          modelTransport,
          question: message,
          selectedPapers: scopedPapers,
          settings: settingsWithGenerationPrompt(settingsStoreRef.current.getState(), systemPrompt),
          thinReadingExternalKnowledgeTransport: modelTransport,
          thinReadingExternalPdfTransport: modelTransport
        });
        const assistantMessage = createMessage("assistant", answer.content);
        assistantMessage.turnOutcome = "completed";
        if (latestUsage) assistantMessage.agentActivity = { ...completeAgentActivity(createAgentActivity(), "completed"), contextUsage: latestUsage };
        assistantMessage.audit = answer.citations.length ? answer.audit : undefined;
        assistantMessage.citations = answer.citations;
        assistantMessage.evidenceReport = answer.evidenceReport;
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
    const targetId = owner.target();
    const targetStore = owner.store(targetId);
    const scoped = <T,>(callback: () => T) => owner.withTarget(targetId, callback);
    if (cancellingSession && targetId === activeSessionIdRef.current) {
      return;
    }
    if (activeSessionIdRef.current === targetId) setCancellingSession(true);
    const currentSession = sessionRegistryRef.current.find(
      (session) => session.id === targetId
    );
    if (currentSession?.kind === "artifact_generation" && currentSession.artifactTaskId) {
      try {
        await onCancelArtifactTask?.(currentSession.artifactTaskId);
      } finally {
        if (activeSessionIdRef.current === targetId) setCancellingSession(false);
      }
      return;
    }

    const trackedRun = activeConversationRunRef.current;
    if (!trackedRun) {
      if (activeSessionIdRef.current === targetId) setCancellingSession(false);
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
        scoped(() => { consumePublicAgentRun(result.data); syncAssistant(); });
        return;
      }
      trackedRun.cancelSent = false;
      if (activeSessionIdRef.current === targetId) setCancellingSession(false);
      targetStore.addMessage(
        createMessage("assistant", `终止失败：${getAssistantErrorMessage(result.error, {
          developerDiagnostics
        })}`)
      );
      scoped(syncAssistant);
    } catch (error) {
      trackedRun.cancelSent = false;
      if (activeSessionIdRef.current === targetId) setCancellingSession(false);
      targetStore.addMessage(
        createMessage("assistant", `终止失败：${getAssistantErrorMessage(error, {
          developerDiagnostics
        })}`)
      );
      scoped(syncAssistant);
    }
  }

  async function appendJournalAudit(traceId: string | undefined) {
    const targetId = owner.target();
    const targetStore = owner.store(targetId);
    const scoped = <T,>(callback: () => T) => owner.withTarget(targetId, callback);
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
    targetStore.addMessage(assistantMessage);
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
    const targetId = owner.target();
    const targetStore = owner.store(targetId);
    const scoped = <T,>(callback: () => T) => owner.withTarget(targetId, callback);
    targetStore.setPending(true);
    clearConfirmationMessage(confirmation.confirmationId);
    scoped(syncAssistant);

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
        scoped(() => consumePublicAgentRun(result.data));
        await scoped(() => appendJournalAudit(confirmation.traceId));
        return;
      }
      const result = await executeConfirmedSemanticPlan(
        confirmation,
        createRuntimeExecutionContext()
      );
      scoped(() => appendRuntimeEvents(result.events));
      await scoped(() => appendJournalAudit(confirmation.traceId));
      if (result.settingsChanged) {
        onSettingsChanged?.({ ...settingsStoreRef.current.getState() });
      }
    } catch (error) {
      targetStore.addMessage(createMessage(
        "assistant",
        getAssistantErrorMessage(error, { developerDiagnostics })
      ));
    } finally {
      targetStore.setPending(false);
      scoped(syncAssistant);
      if (activeSessionIdRef.current === targetId) inputRef.current?.focus();
      scoped(() => { void executeNextQueuedTurn(); });
    }
  }

  async function handleRejectRequest(confirmation: AssistantConfirmationRequest) {
    const targetId = owner.target();
    const targetStore = owner.store(targetId);
    const scoped = <T,>(callback: () => T) => owner.withTarget(targetId, callback);
    clearConfirmationMessage(confirmation.confirmationId);
    if (isPublicConfirmation(confirmation)) {
      const sessionAgentClient = getActivePublicAgentClient();
      if (!sessionAgentClient) {
        targetStore.addMessage(
          createMessage("assistant", "AI 服务尚未初始化，请稍后重试。")
        );
        scoped(syncAssistant);
        if (activeSessionIdRef.current === targetId) inputRef.current?.focus();
        return;
      }
      const result = await sessionAgentClient.confirm(confirmation.confirmationId, "reject");
      if (!result.ok) {
        targetStore.addMessage(createMessage(
          "assistant",
          getAssistantErrorMessage(result.error, { developerDiagnostics })
        ));
      } else {
        scoped(() => consumePublicAgentRun(result.data));
        await scoped(() => appendJournalAudit(confirmation.traceId));
      }
      scoped(syncAssistant);
      if (activeSessionIdRef.current === targetId) inputRef.current?.focus();
      return;
    }
    const result = rejectHumanConfirmation(confirmation, {
      journal: executionJournalRef.current
    });
    scoped(() => appendRuntimeEvents(result.events));
    await scoped(() => appendJournalAudit(confirmation.traceId));
    scoped(syncAssistant);
    if (activeSessionIdRef.current === targetId) inputRef.current?.focus();
  }

  async function handleUIDslAction(action: UIDslActionRef, traceId: string) {
    const targetId = owner.target();
    const targetStore = owner.store(targetId);
    const scoped = <T,>(callback: () => T) => owner.withTarget(targetId, callback);
    const adapted = adaptDefaultUiIntent({
      action: "trigger_action",
      actionRef: action,
      activeMode: targetStore.getState().mode,
      traceId
    });
    if (adapted.kind !== "dynamic_action") {
      return;
    }

    targetStore.setPending(true);
    scoped(syncAssistant);

    try {
      const result = await executeUIDslActionRef(
        adapted.actionRef,
        createRuntimeExecutionContext(),
        {
          mode: adapted.mode,
          traceId: adapted.traceId
        }
      );
      scoped(() => appendRuntimeEvents(result.events));
      await appendJournalAudit(getTraceIdFromRuntimeEvents(result.events) ?? traceId);
      if (result.settingsChanged) {
        onSettingsChanged?.({ ...settingsStoreRef.current.getState() });
      }
    } catch (error) {
      targetStore.addMessage(createMessage(
        "assistant",
        getAssistantErrorMessage(error, { developerDiagnostics })
      ));
    } finally {
      targetStore.setPending(false);
      scoped(syncAssistant);
      if (activeSessionIdRef.current === targetId) inputRef.current?.focus();
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

    return tokens.filter((token) => !token.contextRefs?.length)
      .map((token, index) => [`上下文 ${index + 1} [${token.kind}]：${token.label}`, token.prompt].join("\n"))
      .join("\n\n");
  }

  function selectedContextRefs(tokens: AssistantContextToken[]): ContextRef[] {
    const refs = tokens.flatMap((token) => token.contextRefs ?? []).map((ref) => contextRefSchema.parse(ref));
    return [...new Map(refs.map((ref) => [JSON.stringify(ref), ref])).values()];
  }

  async function runKnowledgeMessage(
    question: string,
    mode: Exclude<AssistantMode, "command">,
    options: { systemPrompt?: string; thinkingDepth?: ThinkingDepth; attachedContextPrompt?: string; referencedPaperIds?: string[]; contextRefs?: ContextRef[] } = {}
  ) {
    const targetId = owner.target();
    const referencedPaperIds = [...new Set([
      ...(options.referencedPaperIds ?? []),
      ...(options.contextRefs?.length && selectedSetStatus.selectionLocked
        ? selectedPapers.map((paper) => paper.id) : []),
    ])];
    if (referencedPaperIds.length > 0 && !lazyPaperContext) {
      await onPreparePapersForContext?.(referencedPaperIds);
    }
    let contextRefs = options.contextRefs;
    if (contextRefs?.length && referencedPaperIds.length) {
      if (!objectWorkbench?.capturePaperContext) throw new Error("当前服务不支持组合论文与对象上下文。");
      contextRefs = [...contextRefs, ...await objectWorkbench.capturePaperContext(referencedPaperIds)];
    }
    const readerContextPrompt = buildReaderContextPrompt();
    const attachedContextPrompt = options.attachedContextPrompt ?? "";
    const combinedContextPrompt =
      attachedContextPrompt.length > 0 ? attachedContextPrompt : readerContextPrompt;
    const readyMessage =
      combinedContextPrompt.length > 0 || options.contextRefs?.length ? null : getSelectedSetReadyMessage(selectedSetStatus);

    const publicQuestion =
      combinedContextPrompt.length > 0
        ? `${combinedContextPrompt}\n\n用户问题：${question}`
        : readyMessage
          ? `${question}\n\n系统上下文：当前尚未准备论文任务。请自然、友好地先回答用户，不要复述系统上下文或错误提示。回答末尾简短提醒：可从顶栏 AI 工作台选择论文和能力，或使用 @ 添加论文后开始分析。`
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
    await owner.withTarget(targetId, () => runPublicAgentMessage(publicQuestion, mode, contextRefs?.length ? undefined : attachments, contextRefs, options.thinkingDepth, options.systemPrompt));
  }

  async function executePreparedTurn(turn: QueuedAssistantTurn) {
    owner.dispatchingMessages.set(owner.target(), turn.userMessageId);
    assistantStoreRef.current.setMode(turn.mode);
    updateQueuedMessagePolicy(turn.userMessageId, undefined);
    syncAssistant();

    const targetId = owner.target();
    const origin: import("../../features/assistant/assistantSessionContracts").AssistantOrigin = {
      kind: "conversation_action", entryPoint: "assistant.slash", initiatedBy: { type: "user", id: objectWorkbench?.scopeId ?? "local" },
      parentConversationId: targetId, triggerMessageId: turn.userMessageId
    };
    const recordTaskReceipt = (result: import("../../features/assistant/assistantSessionHistory").AssistantTaskStartResult) => owner.withTarget(targetId, () => {
      if (typeof result === "string") assistantStoreRef.current.addMessage(createMessage("assistant", result));
      else if (!result.taskIds.length) assistantStoreRef.current.addMessage(createMessage("assistant", result.message));
      else for (const taskId of result.taskIds) assistantStoreRef.current.addMessage({ ...createMessage("assistant", result.message), id: `task-reference:${turn.userMessageId}:${taskId}`, kind: "task_reference", taskReference: { taskId, title: result.message } });
      sessionRegistryRef.current = sessionRegistryRef.current.map((item) => item.id === targetId ? { ...item,
        outbox: item.outbox?.map((entry) => entry.userMessageId === turn.userMessageId ? { ...entry, state: "finished" } : entry) } : item);
      syncAssistant();
      void persistConversation().catch(() => {});
    });
    const artifactType = requestedArtifactType(contextInstructionText(turn.message, turn.contextTokens));
    // The artifact workflow creates a task, submits its artifactType to the main Agent,
    // and saves the specialist result. Keep slash shortcuts on that complete path.
    if (artifactType && (artifactType === "thin_reading" || getActivePublicAgentClient())) {
      const previousPaperIds = assistantStoreRef.current.getState().messages.slice(0, -1).reverse()
        .find((message) => message.role === "user" && message.contextTokens?.some((token) => token.kind === "paper"))
        ?.contextTokens?.filter((token) => token.kind === "paper").map((token) => token.id.replace(/^paper-/, ""));
      const paperIds = turn.referencedPaperIds.length ? turn.referencedPaperIds
        : selectedSetStatus.selectionLocked ? selectedPapers.map((paper) => paper.id) : previousPaperIds;
      const recentContext = assistantStoreRef.current.getState().messages.filter((message) => !message.artifactTask && !message.agentActivity)
        .slice(-6).map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`).join("\n").slice(-8_000);
      const context = [thinkingDepthInstruction(turn.thinkingDepth), turn.message, turn.attachedContextPrompt, recentContext].filter(Boolean).join("\n\n");
      try {
        let contextRefs = selectedContextRefs(turn.contextTokens);
        if (contextRefs.length && paperIds?.length) {
          if (!objectWorkbench?.capturePaperContext) throw new Error("资源上下文尚未准备好，请重试。");
          await onPreparePapersForContext?.(paperIds);
          contextRefs = [...contextRefs, ...await (objectWorkbench.capturePaperFulltextContext ?? objectWorkbench.capturePaperContext)(paperIds)];
        }
        if (owner.disposed) return;
        const result = contextRefs.length ? onGenerateArtifact(artifactType, paperIds, context, contextRefs, turn.systemPrompt, origin)
          : onGenerateArtifact(artifactType, paperIds, context, undefined, turn.systemPrompt, origin);
        recordTaskReceipt(result);
      } catch (error) {
        owner.withTarget(targetId, () => assistantStoreRef.current.addMessage(createMessage("assistant", getAssistantErrorMessage(error, { developerDiagnostics }))));
      }
      owner.withTarget(targetId, () => { syncAssistant(); void executeNextQueuedTurn(); });
      return;
    }

    if (turn.mode === "command") {
      commandPaperIdsRef.current = turn.referencedPaperIds;
      try {
        if (artifactType && turn.referencedPaperIds.length > 0) {
          const message = onGenerateArtifact(artifactType, turn.referencedPaperIds, [turn.message, turn.attachedContextPrompt].filter(Boolean).join("\n\n"));
          recordTaskReceipt(message);
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

    assistantStoreRef.current.setPending(true); syncAssistant();
    try {
      await runKnowledgeMessage(turn.message, turn.mode, {
        systemPrompt: turn.systemPrompt,
        thinkingDepth: turn.thinkingDepth,
        attachedContextPrompt: turn.attachedContextPrompt,
        referencedPaperIds: turn.referencedPaperIds,
        contextRefs: selectedContextRefs(turn.contextTokens)
      });
    } catch (error) {
      owner.withTarget(targetId, () => {
        assistantStoreRef.current.addMessage(createMessage("assistant", getAssistantErrorMessage(error, { developerDiagnostics })));
        assistantStoreRef.current.setPending(false); syncAssistant(); void executeNextQueuedTurn();
      });
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
    const task = artifactPromptTask(requestedArtifactType(contextInstructionText(turn.message, turn.contextTokens)));
    setGenerationPrompts((drafts) => ({ ...drafts, [task]: turn.systemPrompt }));
    syncAssistant();
    inputRef.current?.focus();
  }

  async function beginTaskDiscussion(taskSession: AssistantSessionHistoryItem) {
    const taskId = taskSession.id;
    if (taskDiscussionLocksRef.current.has(taskId)) return;
    taskDiscussionLocksRef.current.add(taskId);
    try {
    const requestedRun = view.kind === "task-detail" && view.runId ? taskSession.taskRuns?.find((run) => run.id === view.runId) : undefined;
    if (requestedRun?.status === "completed" && !requestedRun.resultRefs?.length) throw new Error("所选结果版本尚未核对，未使用其他版本。请重新打开结果核对。");
    let refs = requestedRun?.resultRefs ?? taskSession.taskBinding?.resultRefs ?? [];
    if (!refs.length) {
      if (!taskSession.artifactId || !objectWorkbench?.resolveLiteasyPath) throw new Error("结果尚不可引用，请等待保存完成后重试。");
      const attachments = await objectWorkbench.resolveLiteasyPath(liteasyPath(objectWorkbench.scopeId ?? "local", { kind: "artifact", artifactId: taskSession.artifactId }));
      if (owner.disposed) return;
      refs = attachments.flatMap((attachment) => attachment.refs);
      if (!refs.length) throw new Error("结果版本不可用，未替换为其他资料。");
    }
    const relatedId = taskSession.origin?.parentConversationId ?? taskSession.taskBinding?.relatedConversationId;
    let related = relatedId ? sessionRegistryRef.current.find((item) => item.id === relatedId) : undefined;
    if (!related) {
      startNewSession("qa");
      related = sessionRegistryRef.current.find((item) => item.id === activeSessionIdRef.current)!;
      related = { ...related, sourceTaskId: taskId, resultRefs: refs };
      sessionRegistryRef.current = upsertAssistantSession(sessionRegistryRef.current, related);
    } else await openSession(related.id);
    if (owner.disposed) return;
    sessionRegistryRef.current = sessionRegistryRef.current.map((item) => item.id === taskId ? { ...item,
      taskBinding: item.taskBinding ? { ...item.taskBinding, resultRefs: refs, relatedConversationId: related!.id } : undefined } : item);
    const resultToken: AssistantContextToken = { id: `task-result:${taskId}:${refs.map((ref) => ref.revision).join(":")}`,
      kind: "object", label: `${taskSession.title} · 结果版本`, prompt: "", contextRefs: refs,
      detail: refs.map((ref) => ref.revision).join(" · ") };
    setComposerContextTokens((tokens) => [...tokens.filter((token) => !token.id.startsWith(`task-result:${taskId}:`)), resultToken]);
    setSessionHistory([...sessionRegistryRef.current]);
    inputRef.current?.focus();
    } finally { taskDiscussionLocksRef.current.delete(taskId); }
  }

  function updateSessionMetadata(id: string, patch: Partial<AssistantSessionHistoryItem>) {
    sessionRegistryRef.current = sessionRegistryRef.current.map((item) => item.id === id ? { ...item, ...patch } : item);
    setSessionHistory([...sessionRegistryRef.current]);
  }

  async function exportSession(id: string) {
    let session = sessionRegistryRef.current.find((item) => item.id === id);
    if (session?.messagesLoaded === false) session = await historyPersistence?.loadSession?.(id);
    if (!session || owner.disposed) return;
    const text = redactDiagnostic(`# ${session.title}\n\n` + session.messages.filter((message) => message.content && message.kind !== "system_notice")
      .map((message) => `## ${message.kind === "task_reference" ? "任务引用" : message.role === "user" ? "用户" : "AI 派生内容"}\n\n${message.content}`).join("\n\n") +
      (session.resultRefs?.length ? `\n\n结果引用：${session.resultRefs.map((ref) => JSON.stringify(ref)).join("\n")}` : ""));
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "conversation.md"; link.click(); URL.revokeObjectURL(url);
  }

  function branchConversation(boundary: number) {
    const source = sessionRegistryRef.current.find((item) => item.id === owner.target());
    if (!source) return;
    const retained = owner.store().getState().messages.slice(0, boundary);
    startNewSession(source.mode);
    const branch = sessionRegistryRef.current.find((item) => item.id === activeSessionIdRef.current)!;
    sessionRegistryRef.current = upsertAssistantSession(sessionRegistryRef.current, { ...branch, parentConversationId: source.id,
      branchBoundaryMessageId: retained.at(-1)?.id, messages: retained, branchId: branch.id });
    owner.store().restoreSession(source.mode, retained); syncAssistant();
  }

  async function handleSend() {
    if (!historyReadyRef.current || contextDropCount > 0) return;
    let currentState = assistantStoreRef.current.getState();
    const contextTokensForTurn = [...composerContextTokens];
    const referencedPaperIds = contextTokensForTurn
      .filter((token) => token.kind === "paper")
      .map((token) => token.id.replace(/^paper-/, ""));
    let attachedContextPrompt = buildComposerTokenPrompt(contextTokensForTurn) ||
      buildReaderContextPrompt();
    const adapted = adaptTextIntent({
      activeMode: "qa",
      parseSlashCommand: true,
      value: input
    });

    if (adapted.kind === "idle") {
      return;
    }

    const requestedType = requestedArtifactType(contextInstructionText(adapted.runtimeInput.message, contextTokensForTurn));
    if (composerContextTokens.some((token) => token.contextRefs?.length) &&
      requestedType !== "ppt" && requestedType !== "tree" && (adapted.runtimeInput.mode === "command" || requestedType)) {
      setContextDropMessage("已加入的内容支持提问、审阅、生成演示文稿和大纲；当前命令尚不支持这些资源。");
      return;
    }

    const viewedSession = sessionRegistryRef.current.find((session) => session.id === activeSessionIdRef.current);
    if (viewedSession?.kind === "artifact_generation") {
      // Explicit result discussion binds an immutable ObjectRef; arbitrary task chat is not a hidden new session.
      setContextDropMessage("请先点击“围绕此结果提问”，选择已保存的结果版本。");
      return;
    }

    if (editingMessageId) {
      if (currentState.pending) return;
      const messageIndex = currentState.messages.findIndex(
        (message) => message.id === editingMessageId && message.role === "user"
      );
      if (messageIndex >= 0) {
        branchConversation(messageIndex);
        currentState = assistantStoreRef.current.getState();
      }
    }

    const activeMode = adapted.runtimeInput.mode;
    assistantStoreRef.current.setMode(activeMode);
    const userMessage = createMessage("user", adapted.userMessageContent);
    userMessage.contextTokens = contextTokensForTurn;
    userMessage.thinkingDepth = thinkingDepth;
    if (currentState.pending) {
      userMessage.queuedDelivery = { policy: "after_tool" };
    }
    const sendTarget = owner.target();
    if (sendLockRef.current.has(sendTarget)) return;
    sendLockRef.current.add(sendTarget);
    const previousMessages = [...assistantStoreRef.current.getState().messages];
    userMessage.kind = "user_message";
    userMessage.requestId = createConversationIdempotencyKey(activeMode);
    userMessage.contextSnapshotRefs = selectedContextRefs(contextTokensForTurn);
    assistantStoreRef.current.addMessage(userMessage);

    const turnPromptTask = artifactPromptTask(requestedArtifactType(contextInstructionText(adapted.runtimeInput.message, contextTokensForTurn)));
    const preparedTurn: QueuedAssistantTurn = {
      systemPrompt: getGenerationPrompt(turnPromptTask, settingsStoreRef.current.getState(), generationPrompts[turnPromptTask]),
      thinkingDepth,
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
    syncAssistant();
    const previousSessions = sessionRegistryRef.current;
    const previousDraft = draftRef.current;
    sessionRegistryRef.current = sessionRegistryRef.current.map((session) => session.id === sendTarget ? { ...session,
      draft: { input: "", tokens: [], readerContexts: [] }, outbox: [...(session.outbox ?? []), {
        requestId: userMessage.requestId!, userMessageId: userMessage.id, state: "pending", input: structuredClone(preparedTurn)
      }] } : session);
    draftRef.current = { input: "", tokens: [], readerContexts: [] };
    try { await persistConversation(); }
    catch {
      owner.store(sendTarget).replaceMessages(previousMessages);
      sessionRegistryRef.current = previousSessions.map((session) => session.id === sendTarget ? { ...session, messages: previousMessages } : session);
      draftRef.current = previousDraft;
      owner.withTarget(sendTarget, syncAssistant);
      sendLockRef.current.delete(sendTarget);
      return;
    }
    sendLockRef.current.delete(sendTarget);
    if (owner.disposed) return;
    if (activeSessionIdRef.current === sendTarget) {
      setComposerContextTokens([]); setReaderContexts([]); lastReaderContextKeyRef.current = null;
      setInput(""); setEditingMessageId(null); setVoiceInputMessage(undefined);
    }
    setGenerationPrompts((drafts) => ({ ...drafts, [turnPromptTask]: undefined }));
    if (currentState.pending) {
      owner.queue<QueuedAssistantTurn>(sendTarget).push(preparedTurn);
      owner.withTarget(sendTarget, syncAssistant);
      return;
    }
    owner.withTarget(sendTarget, syncAssistant);
    await owner.withTarget(sendTarget, () => executePreparedTurn(preparedTurn));
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

  async function commitRetryTurn(message: AssistantMessage, turn: QueuedAssistantTurn) {
    const targetId = owner.target();
    const targetStore = owner.store(targetId);
    const before = [...targetStore.getState().messages];
    message.requestId = createConversationIdempotencyKey(turn.mode);
    message.kind = "user_message"; message.contextSnapshotRefs = selectedContextRefs(turn.contextTokens);
    targetStore.addMessage(message); syncAssistant();
    const beforeSessions = sessionRegistryRef.current;
    sessionRegistryRef.current = sessionRegistryRef.current.map((item) => item.id === targetId ? { ...item,
      outbox: [...(item.outbox ?? []), { requestId: message.requestId!, userMessageId: message.id, state: "pending", input: structuredClone(turn) }] } : item);
    try { await persistConversation(); }
    catch {
      targetStore.replaceMessages(before);
      sessionRegistryRef.current = beforeSessions.map((item) => item.id === targetId ? { ...item, messages: before } : item);
      if (activeSessionIdRef.current === targetId) { setInput(message.content); setComposerContextTokens(turn.contextTokens); }
      owner.withTarget(targetId, syncAssistant); return;
    }
    if (owner.disposed) return;
    if (activeSessionIdRef.current === targetId) { setInput(""); setEditingMessageId(null); setComposerContextTokens([]); }
    await owner.withTarget(targetId, () => executePreparedTurn(turn));
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
    branchConversation(previousUserIndex);
    const retriedMessage = { ...createMessage("user", previousUserMessage.content), contextTokens, thinkingDepth: previousUserMessage.thinkingDepth ?? thinkingDepth };
    await commitRetryTurn(retriedMessage, {
      thinkingDepth: previousUserMessage.thinkingDepth ?? thinkingDepth, attachedContextPrompt: buildComposerTokenPrompt(contextTokens),
      contextTokens, referencedPaperIds, message: previousUserMessage.content, mode: currentState.mode,
      policy: "interrupt", readerContexts: [], userContent: previousUserMessage.content, userMessageId: retriedMessage.id
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

    branchConversation(messageIndex);
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
    retriedMessage.thinkingDepth = message.thinkingDepth ?? thinkingDepth;
    await commitRetryTurn(retriedMessage, {
      thinkingDepth: message.thinkingDepth ?? thinkingDepth,
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

  useEffect(() => {
    if (view.kind === "home" && assistantState.messages.length) setView({ kind: "conversation", conversationId: activeSessionId });
  }, [assistantState.messages.length, activeSessionId, view.kind]);
  const conversationStarted = view.kind === "conversation" || view.kind === "task-detail";
  const readyMessage =
    readerContexts.length > 0 ? null : getSelectedSetReadyMessage(selectedSetStatus);
  const composerHint = input.startsWith("/")
    ? getModeHint("command")
    : readyMessage
    ? "可以先直接对话来检查 AI 服务；需要论文分析时，从顶栏 AI 工作台选择论文，或用 @ 添加论文。"
    : getModeHint("qa");
  const activeSession = sessionHistory.find((session) => session.id === activeSessionId);
  const currentRevision = activeSession ? assistantContentRevision(activeSession, draftRef.current) : "";
  const currentScope = objectWorkbench?.scopeId ?? "local";
  currentSaveTargetRef.current = { scope: currentScope, target: activeSessionId, revision: currentRevision };
  const hasCurrentContent = !!activeSession && hasAssistantContent({ ...activeSession, draft: draftRef.current });
  const projectedSaveStatus = saveStatus === "saved" && savedRevisionsRef.current.get(`${currentScope}:${activeSessionId}`) !== currentRevision ? "dirty" : saveStatus;
  const selectedTaskRun = view.kind === "task-detail" ? activeSession?.taskRuns?.find((run) => run.id === view.runId) ?? activeSession?.taskRuns?.at(-1) : undefined;
  const taskMessages = selectedTaskRun?.messages ?? assistantState.messages;
  const selectedTaskStatus = selectedTaskRun?.status ?? activeSession?.status ?? "unknown";
  const taskFailure = selectedTaskStatus === "failed" ? [...taskMessages].reverse().find(message => message.role === "assistant" && message.content.trim())?.content : undefined;
  const taskHasSavedResult = !!activeSession && (!!activeSession.taskBinding?.resultRefs.length || activeSession.taskRuns?.some((run) => run.status === "completed" && run.artifactId) || activeSession.status === "completed");
  const activeSessionRunning = activeSession?.kind === "artifact_generation"
    ? activeSession.status === "running"
    : assistantState.pending;

  return (
    <AssistantPane conversationStarted={conversationStarted}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(readerContextDragMime) && !hasResourceContextTransfer(event.dataTransfer)) return;
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
        if (hasResourceContextTransfer(event.dataTransfer)) {
          event.preventDefault();
          event.stopPropagation();
          void addDroppedResources(event.dataTransfer);
          return;
        }
        if (!event.dataTransfer.types.includes(readerContextDragMime)) return;
        event.preventDefault();
        event.stopPropagation();
        const context = readDraggedReaderContext(event.dataTransfer.getData(readerContextDragMime));
        if (context) addReaderContext(context);
      }}
    >
      <AssistantSessionToolbar
        messages={historyOpen ? [] : assistantState.messages}
        onExpand={onExpand}
        title={view.kind === "task-list" ? "任务" : view.kind === "history" ? "历史对话" : activeSession?.title ?? "新对话"}
        kind={activeSession?.kind ?? "conversation"}
        historyOpen={historyOpen}
        running={!historyOpen && activeSessionRunning}
        cancelling={cancellingSession}
        newSessionDisabled={!historyReady || (assistantState.pending && !agentClient)}
        onToggleHistory={() => setView(historyOpen ? activeSession?.kind === "artifact_generation" ? { kind: "task-detail", taskId: activeSessionId } : assistantState.messages.length ? { kind: "conversation", conversationId: activeSessionId } : { kind: "home" } : { kind: "history", filter: "conversations" })}
        onNewSession={() => startNewSession()}
        onCancel={() => void cancelActiveSession()}
        onOpenArtifact={view.kind === "task-detail" && activeSession?.artifactId && onOpenArtifact ? () => onOpenArtifact(activeSession.artifactId!) : undefined}
        onOpenSettings={onApplyPanelAction ? () => onApplyPanelAction({ operation: "open", panel: "settings" }) : undefined}
        onDragStart={(event) => {
          void persistConversation().catch(() => {});
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-liteasy-dock-item", "assistant");
        }}
      />

      <div className="assistant-target-tabs" role="group" aria-label="对话与任务导航">
        <Button size="small" appearance={view.kind === "home" ? "primary" : "subtle"} onClick={() => startNewSession()}>首页</Button>
        <Button size="small" appearance={view.kind === "conversation" || view.kind === "history" ? "primary" : "subtle"} onClick={() => setView({ kind: "history", filter: "conversations" })}>对话</Button>
        <Button size="small" appearance={view.kind === "task-list" || view.kind === "task-detail" ? "primary" : "subtle"} onClick={() => setView({ kind: "task-list" })}>任务{sessionHistory.some((session) => session.kind === "artifact_generation" && session.status === "running") ? ` ${sessionHistory.filter((session) => session.kind === "artifact_generation" && session.status === "running").length}` : ""}</Button>
      </div>
      {historyOpen ? (
        <AssistantHistoryPanel
          kind={historyKind}
          archived={view.kind === "history" ? view.filter === "archived" : undefined}
          onArchivedChange={view.kind === "history" ? (archived) => setView({ kind: "history", filter: archived ? "archived" : "conversations" }) : undefined}
          onUpdateSession={updateSessionMetadata}
          onExportSession={(id) => { void exportSession(id).catch((error) => setHistoryError(String(error))); }}
          activeSessionId={activeSessionId}
          history={sessionHistory.filter((item) => item.kind === "artifact_generation" || item.messageCount || item.messages.length || item.draft?.input.trim())}
          onOpenSession={(id) => { void openSession(id); }}
        />
      ) : null}

      {view.kind === "home" ? <section aria-label="助手首页">
        <h3>开始新对话</h3>
        {selectedPapers.length ? <><p>可使用的已选资料：{selectedPapers.map((paper) => paper.title).join("、")}</p>
          <Button onClick={() => { setInput(selectedPapers.length > 1 ? "比较这些论文的方法与证据" : "概述这篇论文的方法与证据"); setComposerContextTokens(selectedPapers.map((paper) => ({ id: `paper-${paper.id}`, kind: "paper", label: paper.title, prompt: `论文：${paper.title}` }))); }}>根据已选资料提问</Button>
        </> : <p>可以直接对话；分析文献时，用 @ 添加资料。尚未读取任何论文。</p>}
        {sessionHistory.filter((session) => session.id !== activeSessionId && session.lifecycle !== "archived" && session.lifecycle !== "tombstoned" && hasAssistantContent(session)).slice(0, 3).map((session) => <Button key={session.id} onClick={() => { void openSession(session.id); }}>最近：{session.title}</Button>)}
        <Button appearance="subtle" onClick={() => setView({ kind: "history", filter: "conversations" })}>查看全部</Button>
      </section> : null}
      {!historyReady && !historyError ? <p role="status">正在恢复对话…</p> : null}
      {contextDropCount > 0 ? <p role="status">正在添加所选内容…</p> : null}
      {contextDropMessage ? <p role="alert">{contextDropMessage}</p> : null}
      {historyError ? <div role="alert">{historyError}<button type="button" onClick={() => { if (historyReady) void persistConversation().catch(() => {}); else setHistoryLoadAttempt((value) => value + 1); }}>重试</button></div> : null}
      {activeSession?.outbox?.filter((entry) => entry.state === "needs_review" || (activeSession.status === "unknown" && entry.state === "accepted")).map((entry) => <div key={entry.requestId} className="assistant-recovery-notice" role="status">
        <span>已保存的发送记录需要核对，不会自动重放。</span><Button size="small" onClick={() => { void reconcileSavedSend(activeSession.id, entry.requestId).catch((error) => setHistoryError(String(error))); }}>核对发送回执</Button>
      </div>)}
      {developerDiagnostics ? <AssistantContextPanel context={runtimeContext} /> : null}

      {view.kind === "task-detail" && activeSession ? <section aria-label="任务详情">
        <Button appearance="subtle" onClick={() => setView({ kind: "task-list" })}>返回任务列表</Button>
        <h3>{activeSession.title}</h3>
        <p>{({ idle: "可继续", running: "运行中", completed: "已完成", failed: "本次失败", cancelled: "已终止", interrupted: "运行已中断", unknown: "状态待核对" } as const)[selectedTaskStatus]}{taskHasSavedResult ? " · 已保存结果可用" : " · 尚无已保存结果"}</p>
        {taskHasSavedResult ? <p>结果版本：{(selectedTaskRun?.status === "completed" ? selectedTaskRun.resultRefs : activeSession.taskBinding?.resultRefs)?.map((ref) => ref.revision).join(" · ") || "旧版结果，版本待核对"}</p> : null}
        {activeSession.taskRuns?.length ? <div><span>运行记录</span><OptionPicker aria-label="选择运行记录" density="compact" value={selectedTaskRun?.id ?? ""} onValueChange={(runId) => setView({ kind: "task-detail", taskId: activeSession.id, runId })} options={activeSession.taskRuns.map((run, index) => ({ value: run.id, label: `第 ${index + 1} 次 · ${({ idle: "可继续", running: "运行中", completed: "已完成", failed: "失败", cancelled: "已终止", interrupted: "已中断", unknown: "待核对" } as const)[run.status]}` }))} /></div> : null}
        {selectedTaskStatus === "failed" ? <div role="alert"><p>{taskFailure ? taskFailure.replace(/^薄读未完成：/, "") : "本次运行未完成，请查看运行详情。"}</p><p>核对资料与模型设置后，可从发起对话或 AI 工作台重新发起任务。</p></div> : null}
      </section> : null}
      {view.kind === "conversation" || view.kind === "task-detail" ? <AssistantTranscript task={view.kind === "task-detail"} details={view.kind === "task-detail" && activeSession ? <div className="assistant-run-origin"><p>来源：{activeSession.origin?.kind === "conversation_action" ? "从对话发起" : activeSession.origin?.kind === "workflow_entry" ? "AI 工作台" : "旧版来源未记录"}</p>{selectedTaskRun ? <p>运行标识：<code>{selectedTaskRun.id}</code></p> : null}<h4>运行日志</h4></div> : undefined}>
      <AssistantMessageList
        targetId={activeSessionId}
        scrollAnchor={activeSession?.scrollAnchor}
        onScrollAnchor={(anchor) => updateSessionMetadata(activeSessionId, { scrollAnchor: anchor })}
        onOpenTask={(taskId) => { const task = artifactTasks.find((item) => item.id === taskId); if (task) void openSession(getArtifactTaskSessionId(task.id, task)); }}
        onOpenAsset={onOpenAsset}
        onOpenArtifact={onOpenArtifact}
        onResumeArtifactTask={onResumeArtifactTask}
        onCancelArtifactTask={(id) => { void onCancelArtifactTask?.(id); }}
        papers={availablePapers}
        onOpenCitation={onOpenCitation}
        messages={view.kind === "task-detail" ? taskMessages : assistantState.messages}
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
      /></AssistantTranscript> : null}

      {contextCatalogStatus ? <div role="status" className="assistant-command-feedback">
        <span>{contextCatalogStatus}</span>
        {onRefreshContextCatalog ? <Button appearance="subtle" size="small" onClick={onRefreshContextCatalog}>重试</Button> : null}
      </div> : null}
      {!historyOpen && historyPersistence && hasCurrentContent ? <p className="assistant-save-status" role="status">{{ dirty: "有未保存内容", saving: "正在保存…", saved: isTauri() ? "已保存本机" : "已保存到此浏览器", failed: "保存失败 · 内容仍保留", conflict: "其他窗口已有更新 · 当前内容仍保留" }[projectedSaveStatus]}</p> : null}
      {view.kind === "task-detail" && activeSession?.kind === "artifact_generation" ? <div className="assistant-task-discussion">
        <Button disabled={!activeSession.artifactId || !taskHasSavedResult} onClick={() => { void beginTaskDiscussion(activeSession).catch((error) => setContextDropMessage(error instanceof Error ? error.message : String(error))); }}>围绕此结果提问</Button>
        {activeSession.origin?.parentConversationId ? <Button appearance="subtle" onClick={() => { void openSession(activeSession.origin!.parentConversationId!); }}>返回发起对话</Button> : null}
      </div> : !historyOpen ? <AssistantComposer
        contextUsage={contextUsage ?? (embeddedUsage?.sessionId === activeSessionId ? embeddedUsage.usage : undefined) ?? [...assistantState.messages].reverse()
          .find((message) => message.agentActivity?.contextUsage)?.agentActivity?.contextUsage ?? {
            usedTokens: 0,
            maxTokens: Number(settingsStoreRef.current.getState()["assistant.context_window"]) || 32768,
            estimated: true
          }}
        contextScopeId={`${objectWorkbench?.scopeId ?? "local"}:${activeSessionId}`}
        modelPicker={<AssistantModelPicker settingsStore={settingsStoreRef.current} onSettingsChanged={onSettingsChanged}
          disabled={assistantState.pending || !historyReady || queuedAssistantTurnsRef.current.length > 0} />}
        thinkingDepth={thinkingDepth}
        onThinkingDepthChange={setThinkingDepth}
        thinkingRules={<GenerationPromptEditor key={promptTask} task={promptTask} value={generationPrompts[promptTask]}
          onChange={(value) => setGenerationPrompts((drafts) => ({ ...drafts, [promptTask]: value }))} />}
        editing={Boolean(editingMessageId)}
        input={input}
        inputRef={inputRef}
        contextTokens={composerContextTokens}
        modeHint={composerHint}
        onAddContextToken={addComposerContextToken}
        onResolveContextToken={resolveComposerContextToken}
        contextLoading={contextDropCount > 0}
        onCancelEdit={cancelEdit}
        onInputChange={setInput}
        onPasteLiteasyPath={objectWorkbench?.resolveLiteasyPath ? (path) => { void addLiteasyPath(path); } : undefined}
        onRemoveContextToken={removeComposerContextToken}
        onSend={handleSend}
        onVoiceInput={showVoiceInputPlaceholder}
        pending={assistantState.pending || !historyReady}
        suggestions={composerSuggestions}
        voiceInputMessage={voiceInputMessage}
      /> : null}
    </AssistantPane>
  );
}
