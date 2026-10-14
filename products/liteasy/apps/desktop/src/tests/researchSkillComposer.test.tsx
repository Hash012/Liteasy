import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { AssistantSessionController } from "../app/controllers/assistant/AssistantSessionController";
import { ResearchSkillsContext, type ResearchSkillsPort } from "../app/features/research-skills/researchSkillsPort";
const destination = { kind: "entry-child" as const, canonicalEntryId: "entry-B", paperId: "paper-B", scopeId: "local", title: "保存目标论文 B" };
function setup() {
  const start = vi.fn(async () => ({ message: "科研任务已创建", taskIds: ["research-task"] }));
  const port: ResearchSkillsPort = { destinations: [destination], start, retry: vi.fn(), cancel: vi.fn(), createEditableCopy: vi.fn() };
  const generic = vi.fn(() => "generic");
  render(<ResearchSkillsContext.Provider value={port}><AssistantSessionController onGenerateArtifact={generic} selectedSetStatus={{ importedCount: 0, selectedCount: 0, selectionLocked: false }} /></ResearchSkillsContext.Provider>);
  return { start, generic, user: userEvent.setup() };
}
test("explicit skill requires a separate owner and takes priority over generic chat with an empty prompt", async () => {
  const { start, generic, user } = setup();
  const editor = screen.getByPlaceholderText("输入你的问题或命令");
  await user.type(editor, "$research-read");
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "发送", exact: true }));
  expect(await screen.findByLabelText("所选科研方法")).toBeInTheDocument();
  expect(start).not.toHaveBeenCalled();
  await user.click(screen.getByRole("combobox", { name: "科研文档保存到" }));
  await user.click(screen.getByRole("option", { name: destination.title }));
  await user.clear(editor);
  await user.click(screen.getByRole("button", { name: "生成并保存", exact: true }));
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(start.mock.calls[0][0]).toMatchObject({ prompt: "", refs: [], selection: { destination, skill: { id: "research-read", version: "0.1.0" } } });
  expect(generic).not.toHaveBeenCalled();
});
test("dollar picker selects structured skill without adding a context token; IME enter does not send", async () => {
  const { start, user } = setup();
  const editor = screen.getByPlaceholderText("输入你的问题或命令");
  await user.type(editor, "$research-read");
  await user.click(await screen.findByRole("button", { name: /论文研究卡/ }));
  expect(editor).toHaveValue("");
  expect(screen.getByLabelText("所选科研方法")).toBeInTheDocument();
  fireEvent.keyDown(editor, { key: "Enter", isComposing: true, keyCode: 229 });
  expect(start).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "移除科研方法" }));
  expect(screen.queryByLabelText("所选科研方法")).not.toBeInTheDocument();
});

test("owner-only changes are saved without typing and restore the same method version", async () => {
  const { createAssistantHistoryPersistence } = await import("../app/features/assistant/assistantHistoryPersistence");
  type Snapshot = import("../app/features/assistant/assistantHistoryPersistence").AssistantHistorySnapshot;
  let disk: Snapshot | null = null;
  const transport = { load: async () => disk, save: async (snapshot: Snapshot) => { disk = structuredClone(snapshot); } };
  const port: ResearchSkillsPort = { destinations: [destination], start: vi.fn(), retry: vi.fn(), cancel: vi.fn(), createEditableCopy: vi.fn() };
  const ui = () => <ResearchSkillsContext.Provider value={port}><AssistantSessionController historyPersistence={createAssistantHistoryPersistence(transport)} onGenerateArtifact={() => ""} selectedSetStatus={{ importedCount: 0, selectedCount: 0, selectionLocked: false }} /></ResearchSkillsContext.Provider>;
  const first = render(ui());
  const user = userEvent.setup();
  await waitFor(() => expect(screen.queryByText("正在恢复对话…")).not.toBeInTheDocument());
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "$research-read");
  await user.keyboard("{Tab}");
  await waitFor(() => expect(disk?.draft.selectedResearchSkill?.skill.id).toBe("research-read"));
  await user.click(screen.getByRole("combobox", { name: "科研文档保存到" }));
  await user.click(screen.getByRole("option", { name: destination.title }));
  await waitFor(() => expect(disk?.draft.selectedResearchSkill?.destination).toEqual(destination));
  const selected = structuredClone(disk!.draft.selectedResearchSkill);
  first.unmount();
  render(ui());
  await waitFor(() => expect(screen.getByRole("combobox", { name: "科研文档保存到" })).toHaveTextContent(destination.title));
  expect(disk!.draft.selectedResearchSkill).toEqual(selected);
  expect(port.start).not.toHaveBeenCalled();
});
