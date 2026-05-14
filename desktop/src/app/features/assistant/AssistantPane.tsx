import { useState } from "react";
import { ModeSwitch } from "./ModeSwitch";
import type { AssistantMode } from "./assistant.types";
import type { createAssistantStore } from "./assistant.store";

type AssistantPaneProps = {
  assistantStore: ReturnType<typeof createAssistantStore>;
  onModeChange: (mode: AssistantMode) => void;
  onSend: (text: string) => void;
};

export function AssistantPane({ assistantStore, onModeChange, onSend }: AssistantPaneProps) {
  const [input, setInput] = useState("");
  const { mode, messages } = assistantStore.getState();

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="assistant-pane">
      <ModeSwitch mode={mode} onChange={onModeChange} />
      <div className="assistant-mode-label">当前模式：{modeLabel(mode)}</div>

      <div className="assistant-messages">
        {messages.length === 0 ? (
          <p className="assistant-empty">
            欢迎来到 Liteasy。你可以让我解释术语、控制设置或回答论文问题。
          </p>
        ) : (
          messages.map((msg) => (
            <div className={`assistant-message assistant-message--${msg.role}`} key={msg.id}>
              <div className="assistant-message-role">{msg.role === "user" ? "你" : "Liteasy"}</div>
              <div className="assistant-message-text">{msg.content}</div>
            </div>
          ))
        )}
      </div>

      <div className="assistant-input-wrap">
        <textarea
          className="assistant-input"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入你的问题或命令（Enter 发送，Shift+Enter 换行）"
          rows={4}
          value={input}
        />
        <button className="assistant-send" onClick={handleSend} type="button">
          发送
        </button>
      </div>
    </div>
  );
}

function modeLabel(mode: AssistantMode): string {
  switch (mode) {
    case "explain":
      return "名词解释";
    case "command":
      return "命令";
    case "qa":
      return "问答";
  }
}
