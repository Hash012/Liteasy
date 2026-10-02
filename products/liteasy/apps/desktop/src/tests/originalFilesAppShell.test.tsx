import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AppShell } from "../app/layout/AppShell";
import type { OriginalFileDescriptor } from "../app/features/original-files/originalFileService";
import type { Paper } from "../app/features/workspace/workspace.types";

// Only native transport and the PDF canvas are substitutes. AppShell, the open
// controller, content identities, reader resolution, and Dock lifecycle are real.
const native = vi.hoisted(() => ({
  choose: vi.fn(), read: vi.fn(), release: vi.fn(), drain: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(),
  pending: [] as OriginalFileDescriptor[],
  wake: undefined as (() => void) | undefined
}));
vi.mock("../app/features/original-files/originalFileService", async (importOriginal) => ({
  ...await importOriginal<typeof import("../app/features/original-files/originalFileService")>(),
  isOriginalFileOpenAvailable: () => true,
  createOriginalFileService: () => native
}));
vi.mock("../app/features/pdf/PdfReader", () => ({
  PdfReader: ({ selectedPapers }: { selectedPapers: Paper[] }) => <section
    aria-label="原文件 PDF 阅读器替身"
    data-source-path={selectedPapers[0]?.sourcePath}
    data-paper-id={selectedPapers[0]?.id}
  >{selectedPapers[0]?.title}</section>
}));

const emptyLibrary = {
  entries: [], folders: [], trashEntries: [], libraryId: "original-wiring-library", revision: 1, rootPath: "/synthetic/library"
};
const loadLibrary = async () => emptyLibrary;
const original = (name: string): OriginalFileDescriptor => ({
  id: `grant-${name}`, path: `/synthetic/originals/${name}.pdf`, fileName: `${name}.pdf`,
  format: "pdf", sizeBytes: 40, modifiedUnixMs: 1000
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  native.pending = [];
  native.wake = undefined;
  native.choose.mockResolvedValue(null);
  native.read.mockImplementation(async (file: OriginalFileDescriptor) => new TextEncoder().encode(`%PDF-1.7\nSynthetic ${file.fileName}`));
  native.release.mockResolvedValue(undefined);
  native.drain.mockImplementation(async () => ({ files: native.pending.splice(0), errors: [] }));
  native.subscribe.mockImplementation(async (wake: () => void) => {
    native.wake = wake;
    return native.unsubscribe;
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("Local wiring test has no network transport", { status: 503 })));
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function startWorkbench() {
  const user = userEvent.setup();
  render(<AppShell initialPapers={[]} localLibraryLoader={loadLibrary} />);
  await user.click(screen.getByRole("button", { name: "跳过，进入本地阅读器" }));
  const library = await screen.findByRole("region", { name: "本地文献库" });
  // This fails on the pre-integration AppShell: no controller subscribes or drains.
  await waitFor(() => expect(native.subscribe).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(native.drain).toHaveBeenCalledTimes(1));
  return { user, library };
}

async function deliver(...files: OriginalFileDescriptor[]) {
  native.pending.push(...files);
  act(() => native.wake!());
  await screen.findByRole("tab", { name: files.at(-1)!.fileName.replace(/\.pdf$/, "") });
}

test("opens a queued original over another center view, retains its non-library tab, and releases it on single close", async () => {
  const { user, library } = await startWorkbench();
  await user.click(screen.getByRole("button", { name: "设置", exact: true }));
  expect(screen.getByRole("region", { name: "应用设置" })).toBeVisible();
  const file = original("Outside manual");

  await deliver(file);

  const tab = screen.getByRole("tab", { name: "Outside manual", exact: true });
  expect(tab).toHaveAttribute("aria-selected", "true");
  const reader = await screen.findByRole("region", { name: "原文件 PDF 阅读器替身" });
  expect(reader).toBeVisible();
  expect(reader).toHaveAttribute("data-source-path", file.path);
  expect(reader.getAttribute("data-paper-id")).toMatch(/^paper-[a-f0-9]{64}$/);
  expect(within(library).getByText("本地文献库为空")).toBeInTheDocument();
  expect(within(library).queryByRole("button", { name: "Outside manual", exact: true })).not.toBeInTheDocument();
  expect(native.release).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "关闭 Outside manual", exact: true }));

  await waitFor(() => expect(native.release).toHaveBeenCalledWith(file));
  expect(screen.queryByRole("tab", { name: "Outside manual", exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "原文件 PDF 阅读器替身" })).not.toBeInTheDocument();
  expect(emptyLibrary.entries).toEqual([]);
});

test("closing the main region releases every original grant without importing or deleting library entries", async () => {
  const { user, library } = await startWorkbench();
  const first = original("First original");
  const second = original("Second original");
  await deliver(first, second);
  expect(screen.getByRole("tab", { name: "First original", exact: true })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Second original", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(native.read.mock.calls.map(([file]) => file.id)).toEqual([first.id, second.id]);
  expect(native.release).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "主内容区面板选项", exact: true }));
  await user.click(await screen.findByRole("menuitem", { name: "关闭面板", exact: true }));

  await waitFor(() => expect(native.release).toHaveBeenCalledTimes(2));
  expect(native.release.mock.calls.map(([file]) => file.id).sort()).toEqual([first.id, second.id].sort());
  expect(screen.queryByRole("tab", { name: "First original", exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Second original", exact: true })).not.toBeInTheDocument();
  expect(within(library).getByText("本地文献库为空")).toBeInTheDocument();
  expect(emptyLibrary.entries).toEqual([]);
});
