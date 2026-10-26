import "fake-indexeddb/auto";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AppShell } from "../app/layout/AppShell";
import type { LeftPaneProps } from "../app/layout/LeftPane";
import type { Paper } from "../app/features/workspace/workspace.types";
import type { PdfDocumentInfo } from "../app/features/pdf/pdfDocumentInfo";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createReadingLibraryRepository } from "../app/features/reading-library/readingLibraryRepository";
import { localWorkspaceScope } from "../app/features/local-recovery/runtimeProfile";

const fixture = vi.hoisted(() => ({ openCloud: vi.fn(), paperId: "" }));
// Keep the shell/controller/status-bar path real. The list emits the same
// supplied opener as LibraryPane, and the PDF canvas exposes its success event.
vi.mock("../app/layout/LeftPane", () => ({
  LeftPane: (props: LeftPaneProps) => <section aria-label="阅读动作列表">
    <button onClick={() => props.fileLibrary?.onInspect({ id: "cloud-document", title: "Cloud PDF", format: "pdf", available: true }, fixture.openCloud)}>检查云端文件</button>
    <button onClick={() => props.onOpenPaper?.(fixture.paperId)}>打开本地 PDF</button>
  </section>,
}));
vi.mock("../app/features/pdf/PdfReader", () => ({
  PdfReader: ({ selectedPapers, onDocumentInfo }: { selectedPapers: Paper[]; onDocumentInfo?: (info: PdfDocumentInfo) => void }) => <section aria-label="PDF 加载测试">
    <button onClick={() => onDocumentInfo?.({ paperId: selectedPapers[0].id, sourcePath: selectedPapers[0].sourcePath, pageCount: 2 })}>完成 PDF 加载</button>
  </section>,
}));

beforeEach(() => {
  localStorage.clear();
  fixture.openCloud.mockClear();
  fixture.paperId = `shell-pdf-${crypto.randomUUID()}`;
  vi.stubGlobal("fetch", vi.fn(async () => new Response("No network in shell regression", { status: 503 })));
});
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

async function start() {
  const user = userEvent.setup();
  const snapshot = { entries: [{ id: fixture.paperId, contentHash: "a".repeat(64), path: "/library/local.pdf", relativePath: "local.pdf", title: "Local PDF" }],
    folders: [], trashEntries: [], rootPath: "/library", libraryId: "reading-open-shell", revision: 1 };
  render(<AppShell initialPapers={[]} localLibraryLoader={async () => snapshot} />);
  await user.click(screen.getByRole("button", { name: "跳过，进入本地阅读器" }));
  await screen.findByRole("region", { name: "阅读动作列表" });
  return user;
}

test("the file inspector forwards the inspected cloud opener through AppShell", async () => {
  const user = await start();
  await user.click(screen.getByRole("button", { name: "检查云端文件" }));
  const status = screen.getByRole("contentinfo", { name: "文件状态栏" });
  await user.click(await within(status).findByRole("button", { name: "展开文件元信息" }));
  await user.click(screen.getByRole("button", { name: "开始阅读", exact: true }));
  expect(fixture.openCloud).toHaveBeenCalledOnce();
});

test("ordinary PDF open records reading status only when the reader reports a loaded document", async () => {
  const user = await start();
  const scope = localWorkspaceScope(undefined);
  const repository = createReadingLibraryRepository(createObjectStorage(scope, () => scope), scope);
  await user.click(screen.getByRole("button", { name: "打开本地 PDF" }));
  await screen.findByRole("button", { name: "完成 PDF 加载" });
  expect((await repository.metadata())[fixture.paperId]).toBeUndefined();
  await user.click(screen.getByRole("button", { name: "完成 PDF 加载" }));
  await waitFor(async () => expect((await repository.metadata())[fixture.paperId]?.readingStatus).toBe("reading"));
  await user.click(screen.getByRole("button", { name: "展开文件元信息" }));
  expect(screen.getAllByRole("button", { name: "编辑元信息", exact: true })).toHaveLength(1);
});
