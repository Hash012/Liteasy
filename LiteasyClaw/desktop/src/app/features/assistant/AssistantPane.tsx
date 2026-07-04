import { useRef, useState } from "react";
import { AssistantComposer } from "./AssistantComposer";
import { AssistantHistoryPanel } from "./AssistantHistoryPanel";
import { AssistantMessageList } from "./AssistantMessageList";
import { ModeSwitch } from "./ModeSwitch";
import type {
  AssistantMessage,
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
import { createModelSemanticPlanner } from "../agent-runtime/modelSemanticPlanner";
import { runAgentRuntime } from "../agent-runtime/runtimeOrchestrator";
import type { AgentRuntimeEvent } from "../agent-runtime/agentRuntime.types";
import type { ModelTransport } from "../models/modelHttpClient";
import type { ActionContext } from "../skills/actionRegistry";
import type { Paper, WorkspaceSource } from "../workspace/workspace.types";
import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { SettingsState } from "../settings/settings.types";
import { generateAssistantAnswer } from "./generateAssistantAnswer";
import { AssistantContextPanel } from "./AssistantContextPanel";
import {
  getAssistantErrorMessage,
  getModeHint,
  getModeLabel,
  getSelectedSetReadyMessage
} from "./assistantPresentation";

type SettingsStoreLike = ReturnType<typeof createSettingsStore>;

type AssistantPaneProps = {
  importedChunksByPaperId?: Record<string, RetrievalChunk[]>;
  modelTransport?: ModelTransport;
  onApplyLayoutPreset?: ActionContext["applyLayoutPreset"];
  onApplyPanelAction?: ActionContext["applyPanelAction"];
  onApplyThemePreset?: ActionContext["applyThemePreset"];
  onGenerateArtifact: (artifactType: ArtifactType) => string;
  onImportSelectedSet?: ActionContext["importSelectedSet"];
  onOpenOrganizationSharedLibrary?: () => string | Promise<string>;
  onSettingsChanged?: (settings: SettingsState) => void;
  profileUnlocked?: boolean;
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

  if (event.type === "artifact_request") {
    return `准备打开产物：${event.artifact.artifactType}`;
  }

  return `任务已创建：${event.task.taskType}`;
}

export function AssistantPane({
  importedChunksByPaperId = {},
  modelTransport,
  onApplyLayoutPreset,
  onApplyPanelAction,
  onApplyThemePreset,
  onGenerateArtifact,
  onImportSelectedSet,
  onOpenOrganizationSharedLibrary,
  onSettingsChanged,
  profileUnlocked = false,
  runtimeOrganizationName,
  runtimeWorkspace,
  selectedPapers = [],
  selectedSetStatus,
  settingsStore
}: AssistantPaneProps) {
  const assistantStoreRef = useRef(createAssistantStore());
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const settingsStoreRef = useRef(settingsStore ?? createSettingsStore());
  const [assistantState, setAssistantState] = useState<AssistantState>(() =>
    cloneAssistantState(assistantStoreRef.current.getState())
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [input, setInput] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [voiceInputMessage, setVoiceInputMessage] = useState<string | undefined>();
  const [sessionHistory, setSessionHistory] = useState<AssistantSessionHistoryItem[]>([]);
  const runtimeContext = buildAgentRuntimeContextView({
    importedCount: selectedSetStatus.importedCount,
    organizationName: runtimeOrganizationName,
    profileEnabled: Boolean(settingsStoreRef.current.getState()["profile.enabled"]),
    profileUnlocked,
    selectedCount: selectedSetStatus.selectedCount,
    selectionLocked: selectedSetStatus.selectionLocked,
    workspace: runtimeWorkspace
  });

  function syncAssistant() {
    setAssistantState(cloneAssistantState(assistantStoreRef.current.getState()));
  }

  function setMode(mode: AssistantMode) {
    assistantStoreRef.current.setMode(mode);
    syncAssistant();
  }

  function switchModeAsNewSession(mode: AssistantMode) {
    const currentState = assistantStoreRef.current.getState();
    if (currentState.mode === mode) {
      return;
    }

    if (currentState.messages.length > 0) {
      archiveCurrentSession();
      assistantStoreRef.current.clearMessages();
      setHistoryOpen(false);
      setInput("");
      setEditingMessageId(null);
      setVoiceInputMessage(undefined);
    }

    assistantStoreRef.current.setMode(mode);
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

    setHistoryOpen(false);
    setInput("");
    setEditingMessageId(null);
    syncAssistant();
  }

  function showVoiceInputPlaceholder() {
    setVoiceInputMessage("语音输入接口已预留，当前版本请先使用文本输入。");
    inputRef.current?.focus();
  }

  async function runCommandMessage(message: string) {
    assistantStoreRef.current.setPending(true);
    syncAssistant();

    try {
      const result = await runAgentRuntime(
        {
          message,
          mode: "command"
        },
        {
          contextView: runtimeContext,
          applyLayoutPreset: onApplyLayoutPreset,
          applyPanelAction: onApplyPanelAction,
          applyThemePreset: onApplyThemePreset,
          importSelectedSet: onImportSelectedSet,
          openOrganizationSharedLibrary: onOpenOrganizationSharedLibrary,
          profileUnlocked,
          semanticPlanner: createModelSemanticPlanner({
            modelTransport,
            settings: settingsStoreRef.current.getState()
          }),
          settingsStore: settingsStoreRef.current,
          startArtifactAnalysis: onGenerateArtifact
        }
      );

      result.events.forEach((event) => {
        assistantStoreRef.current.addMessage(createMessage("assistant", formatRuntimeEvent(event)));
      });

      if (result.settingsChanged) {
        onSettingsChanged?.({ ...settingsStoreRef.current.getState() });
      }
      setInput("");
      setEditingMessageId(null);
    } catch (error) {
      assistantStoreRef.current.addMessage(createMessage("assistant", getAssistantErrorMessage(error)));
    } finally {
      assistantStoreRef.current.setPending(false);
      syncAssistant();
    }
  }

  async function runKnowledgeMessage(question: string, mode: Exclude<AssistantMode, "command">) {
    const readyMessage = getSelectedSetReadyMessage(selectedSetStatus);
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

    try {
      const answer = await generateAssistantAnswer({
        importedChunksByPaperId,
        modelTransport,
        mode,
        question,
        selectedPapers,
        settings: settingsStoreRef.current.getState()
      });
      const assistantMessage = createMessage("assistant", answer.content);
      assistantMessage.audit = answer.audit;
      assistantMessage.citations = answer.citations;
      assistantMessage.confidence = answer.confidence;
      assistantMessage.executionTrace = answer.executionTrace;

      assistantStoreRef.current.addMessage(assistantMessage);
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

  async function handleSend() {
    const normalizedInput = input.trim();
    if (normalizedInput.length === 0) {
      return;
    }

    const currentState = assistantStoreRef.current.getState();
    if (currentState.pending) {
      return;
    }

    const activeMode = currentState.mode;

    if (editingMessageId) {
      const messageIndex = currentState.messages.findIndex(
        (message) => message.id === editingMessageId && message.role === "user"
      );
      if (messageIndex >= 0) {
        assistantStoreRef.current.replaceMessages(currentState.messages.slice(0, messageIndex));
      }
    }

    assistantStoreRef.current.addMessage(createMessage("user", normalizedInput));

    if (activeMode === "command") {
      await runCommandMessage(normalizedInput);
      return;
    }

    await runKnowledgeMessage(normalizedInput, activeMode);
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
    setVoiceInputMessage(undefined);
    inputRef.current?.focus();
  }

  function cancelEdit() {
    setEditingMessageId(null);
    setInput("");
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

  const conversationStarted = assistantState.messages.length > 0;
  const readyMessage =
    assistantState.mode === "command" ? null : getSelectedSetReadyMessage(selectedSetStatus);
  const composerHint = readyMessage ?? getModeHint(assistantState.mode);

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
        {conversationStarted ? (
          <div className="assistant-mode-controls">
            <ModeSwitch mode={assistantState.mode} onChange={switchModeAsNewSession} />
          </div>
        ) : null}
      </div>
      <div className="assistant-mode-label">当前模式：{getModeLabel(assistantState.mode)}</div>

      {historyOpen ? (
        <AssistantHistoryPanel history={sessionHistory} onRestoreSession={restoreArchivedSession} />
      ) : null}

      <AssistantContextPanel context={runtimeContext} />

      <AssistantMessageList
        messages={assistantState.messages}
        mode={assistantState.mode}
        onEditMessage={handleEditMessage}
        onModeChange={switchModeAsNewSession}
        onRegenerateMessage={handleRegenerateMessage}
      />

      <AssistantComposer
        editing={Boolean(editingMessageId)}
        input={input}
        inputRef={inputRef}
        modeHint={composerHint}
        onCancelEdit={cancelEdit}
        onInputChange={setInput}
        onSend={handleSend}
        onVoiceInput={showVoiceInputPlaceholder}
        pending={assistantState.pending}
        voiceInputMessage={voiceInputMessage}
      />
    </div>
  );
}
