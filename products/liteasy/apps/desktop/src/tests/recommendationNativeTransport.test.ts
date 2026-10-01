import { afterEach, expect, test, vi } from "vitest";
import { requestPaperDocument } from "../app/features/paper-services/paperFullTextTransport";
import { paperServiceRequest } from "../app/features/paper-services/paperServiceTransport";
import { ExternalNavigation } from "../app/features/navigation/externalNavigation";
import { createSemanticIndex } from "../app/features/semantic-index/semanticIndexClient";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: native.invoke, Channel: class { onmessage = () => undefined; } }));
afterEach(() => native.invoke.mockReset());

test("desktop source links use the host browser command and reject non-web schemes", async () => {
  native.invoke.mockResolvedValue(undefined);
  await ExternalNavigation.open("https://doi.org/10.1234/paper");
  expect(native.invoke).toHaveBeenCalledWith("open_external_url", { url: "https://doi.org/10.1234/paper" });
  await expect(ExternalNavigation.open("file:///C:/secret")).rejects.toThrow();
  expect(native.invoke).toHaveBeenCalledOnce();
});

test("native download returns a handle and releases a completion that arrived after cancel", async () => {
  let complete!: (value: unknown) => void;
  native.invoke.mockImplementation((command) => command === "request_public_document" ? new Promise((resolve) => { complete = resolve; }) : Promise.resolve());
  const abort = new AbortController();
  const task = requestPaperDocument("https://paper.test/paper.pdf", { nativeDownload: true, signal: abort.signal });
  abort.abort(); complete({ status: 200, finalUrl: "https://paper.test/paper.pdf", bodyBase64: "", downloadId: "saved", contentHash: "a".repeat(64), byteLength: 100 });
  await expect(task).rejects.toThrow();
  expect(native.invoke).toHaveBeenCalledWith("cancel_public_document", { requestId: expect.any(String) });
  expect(native.invoke).toHaveBeenCalledWith("release_downloaded_pdf", { downloadId: "saved" });
});

test("metadata requests and index scans forward cancellation instead of merely ignoring their results", async () => {
  for (const kind of ["metadata", "index"] as const) {
    native.invoke.mockClear(); let complete!: (value: unknown) => void;
    native.invoke.mockImplementation((command) => command.startsWith("cancel_") || command === "semantic_index_cancel" ? Promise.resolve() : new Promise((resolve) => { complete = resolve; }));
    const abort = new AbortController();
    const task = kind === "metadata" ? paperServiceRequest({ provider: "crossref", endpoint: "https://api.crossref.org" }, "https://api.crossref.org/works", { signal: abort.signal })
      : createSemanticIndex({ scope: "local", workspace: "work", model: "one", active: () => true }).search("database", undefined, abort.signal);
    abort.abort(); complete(kind === "metadata" ? { status: 200, bodyBase64: "" } : []);
    await expect(task).rejects.toThrow();
    expect(native.invoke).toHaveBeenCalledWith(kind === "metadata" ? "cancel_public_document" : "semantic_index_cancel", { requestId: expect.any(String) });
  }
});
