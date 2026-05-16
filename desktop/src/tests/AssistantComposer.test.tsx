import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { AssistantComposer } from "../app/features/assistant/AssistantComposer";

describe("AssistantComposer", () => {
  test("renders mode hint and forwards typed input", async () => {
    const user = userEvent.setup();
    const onInputChange = vi.fn();
    const onSend = vi.fn();

    render(
      <AssistantComposer
        input=""
        modeHint="命令模式提示"
        onInputChange={onInputChange}
        onSend={onSend}
        onVoiceInput={vi.fn()}
      />
    );

    expect(screen.getByPlaceholderText("输入你的问题或命令")).toHaveAttribute("title", "命令模式提示");
    await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "打开组织共享文献库");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(onInputChange).toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  test("shows pending and voice placeholder states", async () => {
    const user = userEvent.setup();
    const onVoiceInput = vi.fn();

    render(
      <AssistantComposer
        input=""
        modeHint="问答提示"
        onInputChange={vi.fn()}
        onSend={vi.fn()}
        onVoiceInput={onVoiceInput}
        pending={true}
        voiceInputMessage="语音输入接口已预留，当前版本请先使用文本输入。"
      />
    );

    expect(screen.getByText("AI 正在整理回答...")).toBeInTheDocument();
    expect(screen.getByText("语音输入接口已预留，当前版本请先使用文本输入。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "语音输入（预留）" }));

    expect(onVoiceInput).toHaveBeenCalledTimes(1);
  });
});
