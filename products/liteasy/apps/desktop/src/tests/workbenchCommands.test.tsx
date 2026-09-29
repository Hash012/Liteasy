import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { useWorkbenchCommandsController } from "../app/controllers/useWorkbenchCommandsController";
import { WorkbenchWelcome } from "../app/features/workbench/WorkbenchWelcome";
import { WorkbenchCommandsDialog } from "../app/features/workbench/WorkbenchCommandsDialog";
import { WorkbenchCommandsContext } from "../app/features/workbench/workbenchCommandsContext";
import { commandKeys, matchWorkbenchShortcut } from "../app/features/workbench/workbenchCommands";
import { builtinHelpProviders } from "../app/features/help/builtinHelpProvider";

test("matches Windows and Mac shortcuts without taking plain typing, IME, AltGraph or repeated events", () => {
  const event = (input: KeyboardEventInit) => new KeyboardEvent("keydown", { cancelable: true, ...input });
  expect(matchWorkbenchShortcut(event({ key: "L", ctrlKey: true, shiftKey: true }), false)).toBe("library");
  expect(matchWorkbenchShortcut(event({ key: "Dead", code: "KeyI", metaKey: true, altKey: true }), true)).toBe("assistant");
  expect(matchWorkbenchShortcut(event({ key: ",", metaKey: true }), true)).toBe("settings");
  expect(matchWorkbenchShortcut(event({ key: "h", ctrlKey: true }), false)).toBe("page-history");
  expect(matchWorkbenchShortcut(event({ key: "t", ctrlKey: true }), false)).toBe("active-pages");
  expect(commandKeys("assistant", true)).toEqual(["⌘", "Option", "I"]);
  for (const input of [{ key: "i" }, { key: "p", ctrlKey: true }, { key: "i", ctrlKey: true, altKey: true, isComposing: true },
    { key: "i", ctrlKey: true, altKey: true, repeat: true }, { key: "F1", shiftKey: true }, { key: "i", ctrlKey: true, metaKey: true, altKey: true }]) {
    expect(matchWorkbenchShortcut(event(input), false)).toBeUndefined();
  }
  const handled = event({ key: ",", ctrlKey: true }); handled.preventDefault();
  expect(matchWorkbenchShortcut(handled, false)).toBeUndefined();
  const altGraph = event({ key: "i", ctrlKey: true, altKey: true });
  vi.spyOn(altGraph, "getModifierState").mockReturnValue(true);
  expect(matchWorkbenchShortcut(altGraph, false)).toBeUndefined();
});

test("uses current navigation callbacks, leaves drafts intact, blocks navigation behind modal dialogs and cleans up", () => {
  const actions = { library: vi.fn(), assistant: vi.fn(), settings: vi.fn(), help: vi.fn(), "page-history": vi.fn(), "active-pages": vi.fn() };
  const hook = renderHook((value) => useWorkbenchCommandsController(value), { initialProps: actions });
  const updated = { ...actions, assistant: vi.fn() }; hook.rerender(updated);
  const view = render(<textarea aria-label="草稿" defaultValue="尚未发送" />);
  const draft = screen.getByRole("textbox"); draft.focus();
  fireEvent.keyDown(draft, { key: "i", ctrlKey: true, altKey: true });
  expect(updated.assistant).toHaveBeenCalledOnce();
  expect(actions.assistant).not.toHaveBeenCalled();
  expect(draft).toHaveValue("尚未发送");
  view.rerender(<div role="dialog" aria-modal="true" aria-label="元数据"><input /></div>);
  fireEvent.keyDown(window, { key: ",", ctrlKey: true });
  expect(actions.settings).not.toHaveBeenCalled();
  view.rerender(<div role="dialog" aria-modal="true" aria-label="页面切换"><input /></div>);
  fireEvent.keyDown(window, { key: "t", ctrlKey: true });
  expect(actions["active-pages"]).toHaveBeenCalledOnce();
  fireEvent.keyDown(window, { key: "h", ctrlKey: true });
  expect(actions["page-history"]).toHaveBeenCalledOnce();
  view.unmount();
  fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
  expect(hook.result.current.open).toBe(true);
  act(() => hook.result.current.execute("settings"));
  expect(hook.result.current.open).toBe(false);
  expect(actions.settings).toHaveBeenCalledOnce();
  hook.unmount();
  fireEvent.keyDown(window, { key: "F1" });
  expect(actions.help).not.toHaveBeenCalled();
});

test("welcome actions use the shared vector without raster backing and side empties stay compact", async () => {
  const execute = vi.fn(); const user = userEvent.setup();
  const view = render(<WorkbenchCommandsContext.Provider value={execute}><WorkbenchWelcome /></WorkbenchCommandsContext.Provider>);
  expect(screen.getByRole("img").tagName.toLowerCase()).toBe("svg");
  expect(view.container.querySelector("img, image")).toBeNull();
  await user.click(screen.getByRole("button", { name: /打开文献库/ }));
  expect(execute).toHaveBeenCalledWith("library");
  await user.click(screen.getByRole("button", { name: /开始 AI 对话/ }));
  expect(execute).toHaveBeenCalledWith("assistant");
  view.rerender(<WorkbenchWelcome compact />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("quick actions can be searched and executed using the keyboard", async () => {
  const onExecute = vi.fn(); const user = userEvent.setup();
  render(<WorkbenchCommandsDialog onClose={vi.fn()} onExecute={onExecute} />);
  const search = screen.getByRole("textbox", { name: "搜索快捷操作" });
  await user.type(search, "主题");
  expect(screen.queryByRole("button", { name: /打开文献库/ })).not.toBeInTheDocument();
  await user.keyboard("{Enter}");
  expect(onExecute).toHaveBeenCalledWith("settings");
  await user.clear(search); await user.type(search, "不存在的操作");
  expect(screen.getByRole("status")).toHaveTextContent("没有匹配");
});

test("the offline getting-started guide includes actual keyboard bindings and current library interactions", async () => {
  const article = await builtinHelpProviders[0].read("getting-started.basics", { signal: new AbortController().signal, locale: "zh-CN" });
  expect(article?.body).toContain("双击");
  expect(article?.body).toContain("Ctrl + Shift + L");
  expect(article?.body).toContain("Ctrl + Alt + I");
});
