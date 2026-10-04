import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { useBibliographicMetadataController } from "../app/controllers/useBibliographicMetadataController";
import { BibliographicMetadataEditor } from "../app/features/library/BibliographicMetadataEditor";
import type { ReadingCatalogEntry } from "../app/features/library/readingCatalog.types";
import { ExtensionLibrary } from "../app/features/extensions/ExtensionViews";
import { ExtensionWorkbenchContext, type ExtensionWorkbench } from "../app/features/extensions/extensionWorkbenchContext";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { HelpPanel } from "../app/features/help/HelpPanel";
import { useHelpController } from "../app/controllers/useHelpController";
import { builtinHelpProviders } from "../app/features/help/builtinHelpProvider";
import { AssistantSessionToolbar } from "../app/features/assistant/AssistantSessionToolbar";

const paper: ReadingCatalogEntry = { id: "p1", title: "Long research title", authors: ["Alice Researcher"], format: "pdf", year: 2024, abstract: "Research context" };

test("metadata starts as readable information, pins edits and returns to information after saving", async () => {
  const user = userEvent.setup(); const save = vi.fn(async () => {});
  let controller: ReturnType<typeof useBibliographicMetadataController>;
  function Fixture({ selected }: { selected: ReadingCatalogEntry }) {
    controller = useBibliographicMetadataController({ scope: "review", entries: [paper, selected], selected, save });
    return <BibliographicMetadataEditor model={controller} />;
  }
  const view = render(<Fixture selected={paper} />);
  expect(await screen.findByRole("heading", { name: paper.title })).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "标题" })).not.toBeInTheDocument();
  view.rerender(<Fixture selected={{ ...paper, title: "Registry update" }} />);
  expect(await screen.findByRole("heading", { name: "Registry update" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "编辑元信息" }));
  fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "My revised title" } });
  view.rerender(<Fixture selected={{ ...paper, id: "p2", title: "Other paper" }} />);
  expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue("My revised title");
  await user.click(screen.getByRole("button", { name: "保存元信息" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(paper.id, expect.objectContaining({ title: "My revised title" }), 0));
  expect(await screen.findByRole("heading", { name: "My revised title" })).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "标题" })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByRole("combobox", { name: "信息关联方式" }), "follow");
  expect(await screen.findByRole("heading", { name: "Other paper" })).toBeVisible();
  act(() => { controller.open(paper); controller.change({ title: "Unsaved again" }); });
  vi.spyOn(window, "confirm").mockReturnValueOnce(false);
  await user.selectOptions(screen.getByRole("combobox", { name: "信息关联方式" }), "follow");
  expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue("Unsaved again");
});

test("extension loading failures have retry and are distinct from a genuinely empty library", async () => {
  const user = userEvent.setup();
  const list = vi.fn().mockRejectedValueOnce(new Error("Local store unavailable")).mockResolvedValue([]);
  const host = { packages: { store: { list, versions: vi.fn() }, snapshot: { packages: [] } }, error: "", openStudio: vi.fn(), openRuns: vi.fn() } as unknown as ExtensionWorkbench;
  render(<ExtensionWorkbenchContext.Provider value={host}><ExtensionLibrary /></ExtensionWorkbenchContext.Provider>);
  expect(await screen.findByRole("alert")).toHaveTextContent("扩展列表未能载入");
  expect(screen.queryByText("还没有添加扩展")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "重试" }));
  expect(await screen.findByRole("heading", { name: "还没有添加扩展" })).toBeVisible();
  expect(screen.getByRole("button", { name: "导入扩展", exact: true })).toBeVisible();
  expect(list).toHaveBeenCalledTimes(2);
});

test("density persists independently of font size and invalid old values fall back safely", () => {
  localStorage.removeItem("liteasy.view-settings.v1");
  const store = createSettingsStore(); const font = store.getState()["view.font_size"];
  store.apply({ intent: "update_setting", target: "view.list_density", value: "compact" });
  expect(createSettingsStore().getState()).toMatchObject({ "view.list_density": "compact", "view.font_size": font });
  expect(() => store.apply({ intent: "update_setting", target: "view.list_density", value: "tiny" })).toThrow();
  localStorage.setItem("liteasy.view-settings.v1", '{"view.list_density":"future"}');
  expect(createSettingsStore().getState()["view.list_density"]).toBe("comfortable");
});

test("help home leads to real articles and keeps the complete catalog accessible", async () => {
  const user = userEvent.setup();
  function Fixture() { const help = useHelpController({ providers: builtinHelpProviders, onOpen: vi.fn(), visible: true }); return <HelpPanel model={help.model} />; }
  render(<Fixture />);
  await user.click(await screen.findByRole("button", { name: /开始阅读第一份材料/ }));
  expect(await screen.findByRole("heading", { name: "第一次使用：读完并留下第一条研究笔记" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "帮助首页" }));
  await user.click(await screen.findByRole("button", { name: "完整文档目录" }));
  expect(await screen.findByRole("button", { name: "核对和修正论文元信息" })).toBeVisible();
});

test("conversation expansion is a layout action and does not submit another request", async () => {
  const expand = vi.fn(); const send = vi.fn();
  render(<AssistantSessionToolbar title="Research" kind="conversation" historyOpen={false} running={false} cancelling={false} newSessionDisabled={false} onToggleHistory={vi.fn()} onNewSession={send} onCancel={vi.fn()} onDragStart={vi.fn()} onExpand={expand} />);
  await userEvent.click(screen.getByRole("button", { name: "在主区打开对话" }));
  expect(expand).toHaveBeenCalledOnce(); expect(send).not.toHaveBeenCalled();
});
