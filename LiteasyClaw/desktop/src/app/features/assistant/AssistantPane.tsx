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
import { routeCommand } from "./commandRouter";
import { createSettingsStore } from "../settings/settings.store";
import type { ArtifactType } from "../artifacts/artifact.types";
import { executeSkill } from "../skills/skillRegistry";
import { createAssistantStore } from "./assistant.store";
import {
  archiveAssistantSession,
  restoreAssistantSession,
  type AssistantSessionHistoryItem
} from "./assistantSessionHistory";
import type { Paper } from "../workspace/workspace.types";
import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { SettingsState } from "../settings/settings.types";
import { generateAssistantAnswer } from "./generateAssistantAnswer";
import {
  getAssistantErrorMessage,
  getModeHint,
  getModeLabel,
  getSelectedSetReadyMessage
} from "./assistantPresentation";

type SettingsStoreLike = ReturnType<typeof createSettingsStore>;

type AssistantPaneProps = {
  importedChunksByPaperId?: Record<string, RetrievalChunk[]>;
  onGenerateArtifact: (artifactType: ArtifactType) => string;
  onOpenOrganizationSharedLibrary?: () => string | Promise<string>;
  onSettingsChanged?: (settings: SettingsState) => void;
  profileUnlocked?: boolean;
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

export function AssistantPane({
  importedChunksByPaperId = {},
  onGenerateArtifact,
  onOpenOrganizationSharedLibrary,
  onSettingsChanged,
  profileUnlocked = false,
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
  const [voiceInputMessage, setVoiceInputMessage] = useState<string | undefined>();
  const [sessionHistory, setSessionHistory] = useState<AssistantSessionHistoryItem[]>([]);

  function syncAssistant() {
    setAssistantState(cloneAssistantState(assistantStoreRef.current.getState()));
  }

  function setMode(mode: AssistantMode) {
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
    syncAssistant();
  }

  function showVoiceInputPlaceholder() {
    setVoiceInputMessage("语音输入接口已预留，当前版本请先使用文本输入。");
    inputRef.current?.focus();
  }

  async function handleSend() {
    const normalizedInput = input.trim();
    if (normalizedInput.length === 0) {
      return;
    }

    assistantStoreRef.current.addMessage(createMessage("user", normalizedInput));

    if (assistantState.mode === "command") {
      const command = routeCommand(normalizedInput);
      if (!command) {
        assistantStoreRef.current.addMessage(
          createMessage("assistant", "当前命令还没有注册到安全能力表中。")
        );
        syncAssistant();
        setInput("");
        return;
      }

      assistantStoreRef.current.setPending(true);
      syncAssistant();

      try {
        const result = await executeSkill(command, {
          openOrganizationSharedLibrary: onOpenOrganizationSharedLibrary,
          profileUnlocked,
          settingsStore: settingsStoreRef.current,
          startArtifactAnalysis: onGenerateArtifact
        });

        assistantStoreRef.current.addMessage(createMessage("assistant", result.message));
        onSettingsChanged?.({ ...settingsStoreRef.current.getState() });
        setInput("");
      } catch (error) {
        assistantStoreRef.current.addMessage(
          createMessage("assistant", getAssistantErrorMessage(error))
        );
      } finally {
        assistantStoreRef.current.setPending(false);
        syncAssistant();
      }
      return;
    }

    const readyMessage = getSelectedSetReadyMessage(selectedSetStatus);
    if (readyMessage) {
      syncAssistant();
      inputRef.current?.focus();
      setInput("");
      return;
    }

    assistantStoreRef.current.setPending(true);
    syncAssistant();

    try {
      const answer = await generateAssistantAnswer({
        importedChunksByPaperId,
        mode: assistantState.mode,
        question: normalizedInput,
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
    } catch (error) {
      assistantStoreRef.current.addMessage(
        createMessage("assistant", getAssistantErrorMessage(error))
      );
    } finally {
      assistantStoreRef.current.setPending(false);
      syncAssistant();
    }
  }

  const conversationStarted = assistantState.messages.length > 0;
  const readyMessage =
    assistantState.mode === "command" ? null : getSelectedSetReadyMessage(selectedSetStatus);
  const composerHint = readyMessage ?? getModeHint(assistantState.mode);

  return (
    <div className={conversationStarted ? "assistant-pane in-conversation" : "assistant-pane initial-session"}>
      <div className="assistant-session-toolbar">
        {conversationStarted ? <ModeSwitch mode={assistantState.mode} onChange={setMode} /> : null}
        <div className="assistant-session-actions">
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
      <div className="assistant-mode-label">当前模式：{getModeLabel(assistantState.mode)}</div>

      {historyOpen ? (
        <AssistantHistoryPanel history={sessionHistory} onRestoreSession={restoreArchivedSession} />
      ) : null}

      <AssistantMessageList
        messages={assistantState.messages}
        mode={assistantState.mode}
        onModeChange={setMode}
      />

      <AssistantComposer
        input={input}
        inputRef={inputRef}
        modeHint={composerHint}
        onInputChange={setInput}
        onSend={handleSend}
        onVoiceInput={showVoiceInputPlaceholder}
        pending={assistantState.pending}
        voiceInputMessage={voiceInputMessage}
      />
    </div>
  );
}
