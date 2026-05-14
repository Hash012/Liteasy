import { useRef, useState } from "react";
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
import type { Paper } from "../workspace/workspace.types";
import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { SettingsState } from "../settings/settings.types";
import { generateAssistantAnswer } from "./generateAssistantAnswer";
import { formatModelExecutionLabel, type ModelExecutionTrace } from "../models/modelExecution";

type SettingsStoreLike = ReturnType<typeof createSettingsStore>;

type AssistantPaneProps = {
  importedChunksByPaperId?: Record<string, RetrievalChunk[]>;
  onGenerateArtifact: (artifactType: ArtifactType) => string;
  onModelExecution?: (trace: ModelExecutionTrace) => void;
  onOpenOrganizationSharedLibrary?: () => string;
  onSettingsChanged?: (settings: SettingsState) => void;
  onSyncCloudPolicy?: () => Promise<string>;
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

function getModeHint(mode: AssistantMode) {
  if (mode === "command") {
    return "命令模式下可以直接输入“关闭联网推荐”等设置指令。";
  }

  if (mode === "qa") {
    return "问答模式会基于已导入的选中文献集给出带引用回答。";
  }

  return "名词解释模式会基于已导入文献给出概念说明。";
}

function getSelectedSetReadyMessage(selectedSetStatus: SelectedSetStatus) {
  if (selectedSetStatus.selectedCount === 0) {
    return "请先在左栏勾选文件，形成选中文献集。";
  }

  if (!selectedSetStatus.selectionLocked) {
    return "请先锁定选中文献集，再使用右栏自然语言分支能力。";
  }

  if (selectedSetStatus.importedCount < selectedSetStatus.selectedCount) {
    return "请先将当前选中文献集导入 AI 流程，再进行问答或解释。";
  }

  return null;
}

function getAssistantErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.length > 0) {
    return `模型服务暂时不可用，请检查当前模型端点配置或稍后重试。\n详细信息：${error.message}`;
  }

  return "模型服务暂时不可用，请检查当前模型端点配置或稍后重试。";
}

function getAuditVerdictLabel(verdict: "pass" | "review" | "fail") {
  if (verdict === "pass") {
    return "通过";
  }

  if (verdict === "review") {
    return "需复核";
  }

  return "未通过";
}

export function AssistantPane({
  importedChunksByPaperId = {},
  onGenerateArtifact,
  onModelExecution,
  onOpenOrganizationSharedLibrary,
  onSettingsChanged,
  onSyncCloudPolicy,
  selectedPapers = [],
  selectedSetStatus,
  settingsStore
}: AssistantPaneProps) {
  const assistantStoreRef = useRef(createAssistantStore());
  const settingsStoreRef = useRef(settingsStore ?? createSettingsStore());
  const [assistantState, setAssistantState] = useState<AssistantState>(() =>
    cloneAssistantState(assistantStoreRef.current.getState())
  );
  const [input, setInput] = useState("");

  function syncAssistant() {
    setAssistantState(cloneAssistantState(assistantStoreRef.current.getState()));
  }

  function setMode(mode: AssistantMode) {
    assistantStoreRef.current.setMode(mode);
    syncAssistant();
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
          settingsStore: settingsStoreRef.current,
          startArtifactAnalysis: onGenerateArtifact,
          syncCloudPolicy: onSyncCloudPolicy
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
      assistantStoreRef.current.addMessage(createMessage("assistant", readyMessage));
      syncAssistant();
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
      onModelExecution?.(answer.executionTrace);
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

  return (
    <div className="assistant-pane">
      <ModeSwitch mode={assistantState.mode} onChange={setMode} />
      <div className="assistant-mode-label">当前模式：{assistantState.mode}</div>

      <div className="assistant-messages">
        {assistantState.messages.length === 0 ? (
          <div className="assistant-message">
            <div className="assistant-message-title">分支能力说明</div>
            <div className="assistant-answer-text">
              右栏自然语言能力默认建立在“已导入的选中文献集”之上，可用于问答、解释、补充产物与设置控制。
            </div>
          </div>
        ) : (
          assistantState.messages.map((message) => (
            <div className="assistant-message" key={message.id}>
              <div className="assistant-message-title">
                {message.role === "user" ? "你的输入" : "助手回复"}
              </div>
              <div className="assistant-answer-text">{message.content}</div>
              {message.citations?.length ? (
                <div className="assistant-citation-card">
                  <strong>原文定位</strong>
                  <span>
                    {message.citations[0].paperId} · 第 {message.citations[0].page} 页
                  </span>
                  <span>{message.citations[0].snippet}</span>
                  <span>可信度 {message.confidence?.toFixed(2)}</span>
                </div>
              ) : null}
              {message.audit ? (
                <div className={`assistant-audit-card ${message.audit.verdict}`}>
                  <strong>模型审计</strong>
                  <span>审计模型 {message.audit.model}</span>
                  <span>
                    审计评分 {message.audit.score.toFixed(2)} · {getAuditVerdictLabel(message.audit.verdict)}
                  </span>
                  <span>{message.audit.rationale}</span>
                </div>
              ) : null}
              {message.executionTrace ? (
                <div className="assistant-execution-trace">
                  模型链路：{formatModelExecutionLabel(message.executionTrace)}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="assistant-input-wrap">
        <div className="assistant-command-feedback">
          {assistantState.pending ? "AI 正在整理回答..." : getModeHint(assistantState.mode)}
        </div>
        <textarea
          className="assistant-input"
          onChange={(event) => setInput(event.target.value)}
          placeholder="输入你的问题或命令"
          rows={4}
          value={input}
        />
        <button className="assistant-send" type="button" onClick={handleSend}>
          发送
        </button>
      </div>
    </div>
  );
}
