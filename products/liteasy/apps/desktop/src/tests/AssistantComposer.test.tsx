import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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

    expect(screen.getByText(/当前回复仍在执行；发送的新消息会先暂存/)).toBeInTheDocument();
    expect(screen.getByText("语音输入接口已预留，当前版本请先使用文本输入。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "语音输入（预留）" }));

    expect(onVoiceInput).toHaveBeenCalledTimes(1);
  });

  test("sends with Enter while keeping Shift Enter as a newline", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    function ControlledComposer() {
      const [input, setInput] = useState("");

      return (
        <AssistantComposer
          input={input}
          modeHint="问答提示"
          onInputChange={setInput}
          onSend={onSend}
          onVoiceInput={vi.fn()}
        />
      );
    }

    render(<ControlledComposer />);

    const textarea = screen.getByPlaceholderText("输入你的问题或命令");
    await user.type(textarea, "第一行{Shift>}{Enter}{/Shift}第二行");

    expect(textarea).toHaveValue("第一行\n第二行");

    await user.keyboard("{Enter}");

    expect(onSend).toHaveBeenCalledTimes(1);
  });
});


test("renders a selected slash command as a capsule and sends after dismissing suggestions", async () => {
  const user = userEvent.setup();
  const send = vi.fn();
  function Composer() {
    const [input, setInput] = useState("");
    return <AssistantComposer input={input} modeHint="命令" onInputChange={setInput}
      onSend={() => send(input)} onVoiceInput={vi.fn()}
      suggestions={[{ id: "thin", label: "生成薄读", trigger: "/", insertText: "/生成薄读" }]} />;
  }
  render(<Composer />);
  const input = screen.getByPlaceholderText("输入你的问题或命令");
  await user.type(input, "/{Enter}");
  expect(input).toHaveValue("/生成薄读 ");
  expect(document.querySelector(".assistant-command-chip")).toHaveTextContent("/生成薄读");
  expect(screen.queryByLabelText("输入候选")).not.toBeInTheDocument();
  await user.keyboard("{Enter}");
  expect(send).toHaveBeenCalledWith("/生成薄读 ");
});

test("searches nested paths with spaces and navigates beyond eight results", async () => {
  const user = userEvent.setup();
  const add = vi.fn();
  function Composer() {
    const [input, setInput] = useState("");
    return <AssistantComposer input={input} modeHint="上下文" onInputChange={setInput}
      onSend={vi.fn()} onVoiceInput={vi.fn()} onAddContextToken={add}
      suggestions={Array.from({ length: 12 }, (_, index) => ({
        id: `paper-${index}`, label: `论文 ${index}`, trigger: "@" as const,
        detail: `/research/Shared Papers/topic-${index}/paper.pdf`,
        token: { id: `paper-${index}`, label: `论文 ${index}`, kind: "paper" as const, prompt: "原文" },
      }))} />;
  }
  render(<Composer />);
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "@Shared Papers");
  expect(screen.getByRole("button", { name: /论文 11/ })).toBeInTheDocument();
  await user.keyboard("{ArrowDown}{ArrowDown}{Tab}");
  expect(add).toHaveBeenCalledWith(expect.objectContaining({ id: "paper-2" }));
  expect(screen.getByPlaceholderText("输入你的问题或命令")).toHaveValue("");
});

test("inserts a mention at the caret without deleting the remaining message", async () => {
  const user = userEvent.setup();
  const add = vi.fn();
  function Composer() {
    const [input, setInput] = useState("请解释 @Paper 后面的结论");
    return <AssistantComposer input={input} modeHint="上下文" onInputChange={setInput}
      onSend={vi.fn()} onVoiceInput={vi.fn()} onAddContextToken={add}
      suggestions={[{ id: "paper", label: "Paper", trigger: "@", token: { id: "paper", label: "Paper", kind: "paper", prompt: "原文" } }]} />;
  }
  render(<Composer />);
  const input = screen.getByPlaceholderText("输入你的问题或命令") as HTMLTextAreaElement;
  await user.click(input);
  input.setSelectionRange(10, 10);
  await user.keyboard("{ArrowLeft}");
  await user.keyboard("{Enter}");
  expect(add).toHaveBeenCalledOnce();
  expect(input.value).toBe("请解释 后面的结论");
});


test("recognizes a mention directly after Chinese text", async () => {
  const user = userEvent.setup();
  const add = vi.fn();
  function Composer() {
    const [input, setInput] = useState("");
    return <AssistantComposer input={input} modeHint="上下文" onInputChange={setInput}
      onSend={vi.fn()} onVoiceInput={vi.fn()} onAddContextToken={add}
      suggestions={[{ id: "paper", label: "注意力论文", trigger: "@", token: { id: "paper", label: "注意力论文", kind: "paper", prompt: "原文" } }]} />;
  }
  render(<Composer />);
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "解释一下@注意力");
  await user.keyboard("{Enter}");
  expect(add).toHaveBeenCalledOnce();
  expect(screen.getByPlaceholderText("输入你的问题或命令")).toHaveValue("解释一下");
});

test("opens the full asset browser from an empty mention result with the keyboard", async () => {
  const user = userEvent.setup();
  const send = vi.fn();
  function Composer() {
    const [input, setInput] = useState("");
    return <AssistantComposer input={input} modeHint="上下文" onInputChange={setInput}
      onSend={send} onVoiceInput={vi.fn()} suggestions={[]} />;
  }
  render(<Composer />);
  expect(screen.getByRole("button", { name: "添加上下文" })).toBeInTheDocument();
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "@找不到的论文{Enter}");
  expect(screen.getByRole("dialog", { name: "上下文资产浏览器" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "搜索全部上下文资产" })).toHaveValue("找不到的论文");
  expect(send).not.toHaveBeenCalled();
});

test("closes the browser and ignores pending additions when the context scope changes", async () => {
  const user = userEvent.setup();
  const add = vi.fn();
  let complete!: (token: import("../app/features/assistant/assistant.types").AssistantContextToken) => void;
  const props = { input: "", modeHint: "上下文", onInputChange: vi.fn(), onSend: vi.fn(), onVoiceInput: vi.fn(),
    onAddContextToken: add, suggestions: [{ id: "asset", label: "原文", trigger: "@" as const,
      resolveToken: () => new Promise<import("../app/features/assistant/assistant.types").AssistantContextToken>((resolve) => { complete = resolve; }) }] };
  const { rerender } = render(<AssistantComposer {...props} contextScopeId="account-a/session-1" />);
  await user.click(screen.getByRole("button", { name: "添加上下文" }));
  await user.click(screen.getByRole("checkbox", { name: "选择 原文" }));
  await user.click(screen.getByRole("button", { name: "添加所选（1）" }));
  rerender(<AssistantComposer {...props} contextScopeId="account-b/session-2" />);
  complete({ id: "source", label: "原文", kind: "object", prompt: "" });
  expect(screen.queryByRole("dialog", { name: "上下文资产浏览器" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "添加上下文" }));
  expect(add).not.toHaveBeenCalled();
  expect(screen.getByText("已选 0 项")).toBeInTheDocument();
});

test("keeps thinking depth collapsed until clicked and supports keyboard adjustment and dismissal", async () => {
  function Composer() {
    const [depth, setDepth] = useState<"quick" | "balanced" | "deliberate">("balanced");
    return <AssistantComposer input="" modeHint="问答" onInputChange={vi.fn()} onSend={vi.fn()} onVoiceInput={vi.fn()}
      thinkingDepth={depth} onThinkingDepthChange={setDepth} />;
  }
  const user = userEvent.setup();
  render(<Composer />);
  expect(screen.queryByRole("slider", { name: "思考深度" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "调整思考深度：均衡" }));
  const slider = screen.getByRole("slider", { name: "思考深度" });
  slider.focus();
  // jsdom does not implement native range keyboard changes; the browser suite covers dragging/keys.
  fireEvent.change(slider, { target: { value: "0" } });
  expect(slider).toHaveAttribute("aria-valuetext", "快速");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("slider", { name: "思考深度" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "调整思考深度：快速" })).toBeInTheDocument();
});
