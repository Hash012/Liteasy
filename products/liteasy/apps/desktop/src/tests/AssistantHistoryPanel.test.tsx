import { mockFocusLayout } from "./fixtures/mockFocusLayout";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssistantHistoryPanel, formatSessionModifiedDate } from "../app/features/assistant/AssistantHistoryPanel";
import type { AssistantSessionHistoryItem } from "../app/features/assistant/assistantSessionHistory";

let restoreFocus: () => void;
beforeEach(() => { restoreFocus = mockFocusLayout(); });
afterEach(() => restoreFocus());

const session: AssistantSessionHistoryItem = { id: "session-1", messages: [{ content: "比较两个实验的误差", id: "message-1", role: "user" }], mode: "qa", title: "实验比较", updatedAt: "2026-10-14T08:35:00.000Z", messageCount: 8 };

test("shows an empty history hint", () => {
  render(<AssistantHistoryPanel history={[]} onRestoreSession={vi.fn()} />);
  expect(screen.getByText("暂无历史会话或匹配记录。")).toBeInTheDocument();
});
test("a compact clickable row exposes only its topic and approximate modification date", async () => {
  const open = vi.fn();
  render(<AssistantHistoryPanel history={[session]} onOpenSession={open} />);
  const row = screen.getByRole("button", { name: "打开会话：实验比较" });
  expect(row.querySelectorAll("span, time")).toHaveLength(2);
  expect(row.querySelector("time")).toHaveAttribute("dateTime", session.updatedAt);
  expect(row.querySelector("time")).toHaveAttribute("title", expect.stringContaining("修改于"));
  expect(row).not.toHaveTextContent("条消息"); expect(row).not.toHaveTextContent("比较两个实验的误差");
  await userEvent.click(row); expect(open).toHaveBeenCalledWith(session.id);
});
test("dates use bounded human units and handle missing or invalid timestamps", () => {
  const now = Date.parse("2026-10-15T09:00:00Z");
  expect(formatSessionModifiedDate("2026-10-15T08:00:00Z", now)).toBe("1小时");
  expect(formatSessionModifiedDate("2026-10-13T09:00:00Z", now)).toBe("2天");
  expect(formatSessionModifiedDate("2026-10-15T08:59:40Z", now)).toBe("刚刚");
  expect(formatSessionModifiedDate("bad", now)).toBe("时间未记录");
});
test("the row menu binds rename, AI rename and export to the selected conversation", async () => {
  const onUpdateSession = vi.fn(), onRenameWithAI = vi.fn().mockResolvedValue(undefined), onExportSession = vi.fn();
  render(<AssistantHistoryPanel history={[session]} onUpdateSession={onUpdateSession} onRenameWithAI={onRenameWithAI} onExportSession={onExportSession} onDeleteSession={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: "管理 实验比较" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "重命名对话", exact: true }));
  const dialog = screen.getByRole("dialog", { name: "重命名对话" });
  await userEvent.clear(within(dialog).getByRole("textbox", { name: "会话名称" }));
  await userEvent.type(within(dialog).getByRole("textbox", { name: "会话名称" }), "误差来源");
  await userEvent.click(within(dialog).getByRole("button", { name: "保存名称" }));
  expect(onUpdateSession).toHaveBeenCalledWith(session.id, { title: "误差来源", titleSource: "user" });
  await userEvent.click(await screen.findByRole("button", { name: "管理 实验比较" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "AI 重命名对话" }));
  expect(onRenameWithAI).toHaveBeenCalledWith(session.id);
  await userEvent.click(await screen.findByRole("button", { name: "管理 实验比较" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "导出对话" }));
  expect(onExportSession).toHaveBeenCalledWith(session.id);
});
test("deletion requires confirmation and AI failures retain the original title", async () => {
  const onDeleteSession = vi.fn(), onRenameWithAI = vi.fn().mockRejectedValue(new Error("internal-model-id-secret"));
  render(<AssistantHistoryPanel history={[session]} onOpenSession={vi.fn()} onUpdateSession={vi.fn()} onRenameWithAI={onRenameWithAI} onDeleteSession={onDeleteSession} />);
  await userEvent.click(await screen.findByRole("button", { name: "管理 实验比较" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "AI 重命名对话" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("原名称已保留");
  expect(screen.getByText(/internal-model-id-secret/)).not.toBeVisible();
  expect(screen.getByRole("button", { name: "打开会话：实验比较" })).toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: "管理 实验比较" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "删除对话" }));
  expect(onDeleteSession).not.toHaveBeenCalled();
  await userEvent.click(within(screen.getByRole("dialog", { name: "删除对话确认" })).getByRole("button", { name: "删除对话" }));
  expect(onDeleteSession).toHaveBeenCalledWith(session.id);
});


test("task rows retain actionable task status while conversation rows remain title and date only", () => {
  render(<AssistantHistoryPanel history={[{ ...session, kind: "artifact_generation", status: "failed" }]} />);
  expect(screen.getByRole("button", { name: "恢复会话：实验比较" })).toHaveTextContent("失败 ·");
});
