import { useState } from "react";
import { ModeSwitch } from "./ModeSwitch";
import type { AssistantMode } from "./assistant.types";

const starterMessages = [
  {
    id: "assistant-1",
    role: "assistant" as const,
    content: "欢迎来到 Liteasy。你可以让我解释术语、控制设置或回答论文问题。"
  }
];

export function AssistantPane() {
  const [mode, setMode] = useState<AssistantMode>("command");
  const [input, setInput] = useState("");

  return (
    <div className="assistant-pane">
      <ModeSwitch mode={mode} onChange={setMode} />
      <div className="assistant-mode-label">当前模式：{mode}</div>

      <div className="assistant-messages">
        {starterMessages.map((message) => (
          <div className="assistant-message" key={message.id}>
            {message.content}
          </div>
        ))}
      </div>

      <div className="assistant-input-wrap">
        <textarea
          className="assistant-input"
          onChange={(event) => setInput(event.target.value)}
          placeholder="输入你的问题或命令"
          rows={4}
          value={input}
        />
        <button className="assistant-send" type="button">
          发送
        </button>
      </div>
    </div>
  );
}
