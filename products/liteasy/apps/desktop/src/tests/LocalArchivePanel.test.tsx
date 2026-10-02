import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { LocalArchivePanel } from "../app/features/local-archive/LocalArchivePanel";
import type { LocalArchiveService } from "../app/features/local-archive/localArchiveService";

const manifest = {
  format: "liteasy-local-archive", version: 1,
  documents: [{ id: "document-0001", title: "Selected study", source: "sources/document-0001.pdf", annotations: "annotations/document-0001.json", note: "notes/document-0001.md" }],
  notes: [{ id: "note-0001", title: "Full research note", path: "notes/note-0001.md", documentIds: ["document-0001"] }],
  relations: [{ from: "note-0001", to: "document-0001", kind: "note-source", page: 2, quote: "Evidence" }],
  files: [{ path: "sources/document-0001.pdf", size: 10, sha256: "a".repeat(64) }], exclusions: ["账号凭据与配置"]
};
const preview = { planId: "plan", operation: "export", targetPath: "/synthetic/new-archive", totalBytes: 10, manifest };
function service(): LocalArchiveService {
  return {
    catalog: vi.fn(async () => [{ id: "private-id", title: "Selected study", available: true }]),
    prepareExport: vi.fn(async () => preview), prepareRestore: vi.fn(async () => ({ ...preview, operation: "restore" })),
    commit: vi.fn(async () => ({ receiptId: "receipt", status: "committed", path: preview.targetPath, manifestHash: "a".repeat(64), fileCount: 1, manifest })),
    cancel: vi.fn(async () => undefined), openDocument: vi.fn(async () => undefined), reveal: vi.fn(async () => undefined),
    readNote: vi.fn(async () => "# Complete note\n\n<script>untrusted text</script>")
  };
}

test("exports only selected documents after reviewing the concrete new directory and reopens restored content", async () => {
  const api = service(); const user = userEvent.setup();
  render(<LocalArchivePanel scopeId="local" service={api} />);
  await user.click(await screen.findByRole("checkbox", { name: "Selected study" }));
  await user.click(screen.getByRole("button", { name: "预览所选资料归档" }));
  expect(api.prepareExport).toHaveBeenCalledWith(["private-id"]);
  expect(api.commit).not.toHaveBeenCalled();
  expect(await screen.findByText("/synthetic/new-archive")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "确认写入新目录" }));
  await waitFor(() => expect(api.commit).toHaveBeenCalledWith("plan"));
  await user.click(await screen.findByRole("button", { name: "打开原文 Selected study" }));
  expect(api.openDocument).toHaveBeenCalledWith("receipt", "document-0001");
  await user.click(screen.getByRole("button", { name: "阅读笔记 Full research note" }));
  expect(await screen.findByText(/<script>untrusted text<\/script>/)).toBeVisible();
  expect(document.querySelector('section[aria-label="本地资料归档"] script')).toBeNull();
});

test("restoration validates before confirmation and preserves a conflict error without success receipt", async () => {
  const api = service(); const user = userEvent.setup();
  vi.mocked(api.commit).mockRejectedValueOnce(new Error("预览后源文件已改变，请重新预览。"));
  render(<LocalArchivePanel scopeId="local" service={api} />);
  await user.click(await screen.findByRole("button", { name: "校验归档并恢复" }));
  await screen.findByText("/synthetic/new-archive");
  expect(api.commit).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "确认写入新目录" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("预览后源文件已改变");
  expect(screen.queryByRole("button", { name: "打开原文 Selected study" })).toBeNull();
});

test("account switch discards a delayed preview and cancels its old-scope plan", async () => {
  const api = service(); const user = userEvent.setup();
  let resolve!: (result: typeof preview) => void;
  vi.mocked(api.prepareExport).mockImplementation(() => new Promise((done) => { resolve = done; }));
  const view = render(<LocalArchivePanel scopeId="local" service={api} />);
  await user.click(await screen.findByRole("checkbox", { name: "Selected study" }));
  await user.click(screen.getByRole("button", { name: "预览所选资料归档" }));
  view.rerender(<LocalArchivePanel scopeId="user:other" service={api} />);
  await act(async () => { resolve(preview); });
  await waitFor(() => expect(api.cancel).toHaveBeenCalledWith("plan"));
  expect(screen.queryByText("/synthetic/new-archive")).toBeNull();
  expect(api.commit).not.toHaveBeenCalled();
});
