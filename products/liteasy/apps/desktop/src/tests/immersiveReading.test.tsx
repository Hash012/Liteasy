import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useImmersiveReadingController } from "../app/controllers/useImmersiveReadingController";

const host = vi.hoisted(() => ({ native: false, fullscreen: false, setFullscreen: vi.fn(), isFullscreen: vi.fn(), onResized: vi.fn(), resized: () => {}, unlisten: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => host.native }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => host }));
let full: Element | null;
const request = vi.fn();
const leave = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); full = null; host.native = false; host.fullscreen = false;
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => full });
  Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: request });
  Object.defineProperty(document, "exitFullscreen", { configurable: true, value: leave });
  request.mockImplementation(async () => { full = document.documentElement; document.dispatchEvent(new Event("fullscreenchange")); });
  leave.mockImplementation(async () => { full = null; document.dispatchEvent(new Event("fullscreenchange")); });
  host.setFullscreen.mockImplementation(async (value: boolean) => { host.fullscreen = value; });
  host.isFullscreen.mockImplementation(async () => host.fullscreen);
  host.onResized.mockImplementation(async (callback: () => void) => { host.resized = callback; return host.unlisten; });
});
afterEach(() => { vi.useRealTimers(); });

function Workspace() {
  const focus = useImmersiveReadingController();
  return <div ref={focus.root} data-testid="frame" data-mode={focus.mode} data-edge={focus.edge} onClickCapture={focus.onClickCapture}>
    <button data-reading-entry="true">Paper</button><button>Folder</button>
    <section data-region="main" tabIndex={-1}><textarea defaultValue="unsaved draft" /></section>
    <aside data-region="left"><button>Library</button></aside>
  </div>;
}

test("only a plain triple click on a reading entry enters immersion and Escape restores focus without remounting drafts", () => {
  render(<Workspace />);
  const paper = screen.getByRole("button", { name: "Paper" });
  const draft = screen.getByRole("textbox");
  fireEvent.click(screen.getByRole("button", { name: "Folder" }), { detail: 3 });
  fireEvent.click(paper, { detail: 2 });
  fireEvent.click(paper, { detail: 3, ctrlKey: true });
  expect(screen.getByTestId("frame")).toHaveAttribute("data-mode", "off");
  paper.focus(); fireEvent.click(paper, { detail: 3 });
  expect(screen.getByTestId("frame")).toHaveAttribute("data-mode", "reading");
  expect(request).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.getByTestId("frame")).toHaveAttribute("data-mode", "off");
  expect(paper).toHaveFocus(); expect(screen.getByRole("textbox")).toBe(draft);
  expect(draft).toHaveValue("unsaved draft");
});

test("F11 toggles actual browser fullscreen, ignores repeats and follows browser exit", async () => {
  const { result } = renderHook(useImmersiveReadingController);
  fireEvent.keyDown(window, { key: "F11", repeat: true }); expect(request).not.toHaveBeenCalled();
  await act(async () => { fireEvent.keyDown(window, { key: "F11" }); });
  expect(request).toHaveBeenCalledOnce(); expect(result.current.mode).toBe("fullscreen");
  await act(async () => { fireEvent.keyDown(window, { key: "F11" }); });
  expect(leave).toHaveBeenCalledOnce(); expect(result.current.mode).toBe("off");
  await act(async () => { result.current.toggleFullscreen(); });
  act(() => { full = null; document.dispatchEvent(new Event("fullscreenchange")); });
  expect(result.current.mode).toBe("off");
});

test("triple clicking still works when opening the file replaces its row between clicks", () => {
  render(<Workspace />);
  fireEvent.click(screen.getByRole("button", { name: "Paper" }), { detail: 2, clientX: 150, clientY: 200 });
  fireEvent.click(screen.getByTestId("frame"), { detail: 3, clientX: 150, clientY: 200 });
  expect(screen.getByTestId("frame")).toHaveAttribute("data-mode", "reading");
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Paper" }), { detail: 2, clientX: 150, clientY: 200 });
  fireEvent.click(screen.getByTestId("frame"), { detail: 3, clientX: 900, clientY: 200 });
  expect(screen.getByTestId("frame")).toHaveAttribute("data-mode", "off");
});

test("Escape during a pending fullscreen request cannot strand the user in fullscreen", async () => {
  let complete!: () => void;
  request.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = () => { full = document.documentElement; resolve(); }; }));
  const { result } = renderHook(useImmersiveReadingController);
  act(() => result.current.toggleFullscreen());
  act(() => result.current.exit());
  await act(async () => complete());
  expect(result.current.mode).toBe("off"); expect(full).toBeNull(); expect(leave).toHaveBeenCalledOnce();
});

test("fullscreen rejection preserves usable windowed immersion and allows retry", async () => {
  request.mockRejectedValueOnce(new Error("denied"));
  const { result } = renderHook(useImmersiveReadingController);
  await act(async () => result.current.toggleFullscreen());
  expect(result.current.mode).toBe("reading"); expect(result.current.error).toContain("未能进入全屏");
  await act(async () => result.current.toggleFullscreen());
  expect(result.current.mode).toBe("fullscreen"); expect(result.current.error).toBe("");
});

test("native fullscreen uses Tauri commands and follows external window changes", async () => {
  host.native = true;
  const { result, unmount } = renderHook(useImmersiveReadingController);
  await act(async () => result.current.toggleFullscreen());
  expect(host.setFullscreen).toHaveBeenCalledWith(true); expect(request).not.toHaveBeenCalled();
  await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
  expect(host.setFullscreen).toHaveBeenLastCalledWith(false); expect(result.current.mode).toBe("off");
  await act(async () => result.current.toggleFullscreen());
  host.fullscreen = false;
  await act(async () => { await host.resized(); });
  await waitFor(() => expect(result.current.mode).toBe("off"));
  unmount(); expect(host.unlisten).toHaveBeenCalledOnce();
});

test("a rejected native exit keeps the exit controls available for retry", async () => {
  host.native = true;
  const { result } = renderHook(useImmersiveReadingController);
  await act(async () => result.current.toggleFullscreen());
  host.setFullscreen.mockRejectedValueOnce(new Error("window busy"));
  await act(async () => result.current.exit());
  expect(result.current.mode).toBe("fullscreen"); expect(result.current.edge).toBe("top");
  await act(async () => { fireEvent.keyDown(window, { key: "F11" }); });
  expect(result.current.mode).toBe("off"); expect(host.fullscreen).toBe(false);
});

test("edge panels remain usable while hovered and hide after returning to reading", () => {
  vi.useFakeTimers(); render(<Workspace />);
  const frame = screen.getByTestId("frame");
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1200, 800));
  fireEvent.click(screen.getByRole("button", { name: "Paper" }), { detail: 3 });
  const move = (target: Element, x: number, y: number) => fireEvent(target, new MouseEvent("pointermove", { bubbles: true, clientX: x, clientY: y }));
  move(frame, 1, 400); expect(frame).toHaveAttribute("data-edge", "left");
  move(screen.getByRole("button", { name: "Library" }), 100, 400);
  act(() => vi.advanceTimersByTime(500)); expect(frame).toHaveAttribute("data-edge", "left");
  move(frame, 600, 400);
  act(() => vi.advanceTimersByTime(500)); expect(frame).not.toHaveAttribute("data-edge");
  for (const [edge, x, y] of [["top", 600, 1], ["right", 1199, 400], ["bottom", 600, 799]] as const) {
    move(frame, x, y); expect(frame).toHaveAttribute("data-edge", edge);
  }
});

test("Escape lets a menu close before exiting immersion", () => {
  const { result } = renderHook(useImmersiveReadingController);
  act(() => result.current.enter());
  const menu = document.createElement("div"); menu.setAttribute("role", "menu"); document.body.append(menu);
  fireEvent.keyDown(window, { key: "Escape" }); expect(result.current.mode).toBe("reading");
  menu.remove(); fireEvent.keyDown(window, { key: "Escape" }); expect(result.current.mode).toBe("off");
});
