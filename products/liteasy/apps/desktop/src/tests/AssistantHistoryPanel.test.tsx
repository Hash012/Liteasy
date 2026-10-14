import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { AssistantHistoryPanel } from "../app/features/assistant/AssistantHistoryPanel";
import type { AssistantSessionHistoryItem } from "../app/features/assistant/assistantSessionHistory";

describe("AssistantHistoryPanel", () => {
  test("shows an empty history hint", () => {
    render(<AssistantHistoryPanel history={[]} onRestoreSession={vi.fn()} />);

    expect(screen.getByLabelText("历史会话面板")).toBeInTheDocument();
    expect(screen.getByText("暂无历史会话或匹配记录。")).toBeInTheDocument();
  });

  test("restores a selected archived session", async () => {
    const user = userEvent.setup();
    const onRestoreSession = vi.fn();
    const history: AssistantSessionHistoryItem[] = [
      {
        archivedAt: "2026-05-15T00:00:00.000Z",
        id: "session-1",
        messages: [{ content: "你好", id: "message-1", role: "user" }],
        mode: "qa",
        title: "你好"
      }
    ];

    render(<AssistantHistoryPanel history={history} onRestoreSession={onRestoreSession} />);

    expect(screen.getByText("时间未记录")).toBeInTheDocument();
    expect(screen.getByText("1 条消息 · 问答")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "恢复会话：你好" }));

    expect(onRestoreSession).toHaveBeenCalledWith("session-1");
  });
});

test("shows last activity with time, message count and latest question in the clickable row", async () => {
  const open = vi.fn();
  render(<AssistantHistoryPanel history={[{ id: "timed", title: "实验比较", mode: "qa", updatedAt: "2026-10-14T08:35:00.000Z", messageCount: 8,
    messages: [{ id: "question", role: "user", content: "比较两个实验的误差" }] }]} onOpenSession={open} />);
  const row = screen.getByRole("button", { name: "打开会话：实验比较" });
  expect(row).toHaveTextContent(/上次活动：2026\/10\/14.*\d{2}:35/);
  expect(row).toHaveTextContent("8 条消息");
  expect(row).toHaveTextContent("比较两个实验的误差");
  expect(row.querySelector("time")).toHaveAttribute("dateTime", "2026-10-14T08:35:00.000Z");
  await userEvent.click(screen.getByText("比较两个实验的误差"));
  expect(open).toHaveBeenCalledWith("timed");
});

test("keeps normal conversation rows compact while exposing exceptional status", () => {
  const base: AssistantSessionHistoryItem = { id: "normal", title: "注意力机制", mode: "qa", status: "idle", messages: [] };
  render(<AssistantHistoryPanel history={[base, { ...base, id: "failed", title: "失败会话", status: "failed" }]} />);
  expect(screen.queryByText("普通对话 · 可继续")).not.toBeInTheDocument();
  expect(screen.getByText("普通对话 · 失败")).toBeInTheDocument();
});
