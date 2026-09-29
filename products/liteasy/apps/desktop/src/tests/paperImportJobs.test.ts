import { expect, test, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { createPaperImportJobs } from "../app/features/local-mcp/paperImportJobs";
import { createLocalAssetMcp } from "../app/features/local-mcp/localAssetMcp";
import type { AgentAssetService } from "../app/features/resource-filesystem/agentAssetService";
import type { ImportedPaper } from "../app/features/library/paperImport.types";

const saved: ImportedPaper = { paperId: "paper-1", title: "Memory", duplicate: false, filePath: "D:/Library/Download/Memory.pdf", message: "已下载" };
const batch = { operationId: "review-1", papers: [{ doi: "10.1234/memory", title: "Memory" }, { arxivId: "2402.12482" }, { url: "https://publisher.test/paper" }] };
function client(importPaper = vi.fn().mockResolvedValue(saved)) {
  const jobs = createPaperImportJobs("local", importPaper);
  const mcp = createLocalAssetMcp({} as AgentAssetService, jobs);
  const call = async (name: string, args: unknown = {}, writable = true) => JSON.parse((await mcp.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), { writable }))!).result;
  return { jobs, mcp, call, importPaper };
}

test("MCP returns a job promptly and exposes individual successes, duplicates and failures with navigable paths", async () => {
  let finish!: (value: ImportedPaper) => void;
  const importPaper = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockRejectedValueOnce(new Error("No public PDF"))
    .mockResolvedValueOnce({ ...saved, duplicate: true });
  const f = client(importPaper);
  const started = (await f.call("liteasy_import_papers", { ...batch, newFolderName: "Research" })).structuredContent.result;
  expect(started.status).toBe("running");
  expect(started.items.map((row: { status: string }) => row.status)).toEqual(["running", "queued", "queued"]);
  finish(saved);
  await waitFor(() => expect(f.jobs.status(started.jobId).status).toBe("completed"));
  const result = (await f.call("liteasy_import_status", { jobId: started.jobId })).structuredContent.result;
  expect(result.items.map((row: { status: string }) => row.status)).toEqual(["imported", "failed", "duplicate"]);
  expect(result.items[0].result.path).toBe("liteasy://papers/paper-1?scope=local");
  expect(result.items[1].error).toBe("No public PDF");
  expect(importPaper).toHaveBeenCalledWith(expect.objectContaining({ canonicalId: "doi:10.1234/memory" }), { newFolderName: "Research", targetFolderPath: undefined }, expect.any(AbortSignal));
});

test("retries do not enqueue or write twice, and different inputs cannot reuse an operationId", async () => {
  const f = client();
  const first = (await f.call("liteasy_import_papers", batch)).structuredContent.result;
  await waitFor(() => expect(f.jobs.status(first.jobId).status).toBe("completed"));
  const retry = (await f.call("liteasy_import_papers", batch)).structuredContent.result;
  expect(retry.jobId).toBe(first.jobId);
  expect(f.importPaper).toHaveBeenCalledTimes(3);
  expect((await f.call("liteasy_import_papers", { ...batch, newFolderName: "Other" })).structuredContent.error.code).toBe("invalid_request");
  retry.items[0].status = "failed";
  expect(f.jobs.status(first.jobId).items[0].status).toBe("imported");
});

test("read-only, notifications and malformed/oversized batches cannot import papers", async () => {
  const f = client();
  expect((await f.call("liteasy_import_papers", batch, false)).structuredContent.error.code).toBe("read_only");
  for (const papers of [[{ title: "Only a title" }], [{ arxivId: "Cicada" }], [{ pdfUrl: "file:///private.pdf" }], [{ url: "https://user:password@publisher.test/file" }], Array.from({ length: 51 }, () => batch.papers[0])]) {
    expect((await f.call("liteasy_import_papers", { ...batch, papers })).isError).toBe(true);
  }
  expect(await f.mcp.handleLine(JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: "liteasy_import_papers", arguments: batch } }), { writable: true })).toBeNull();
  expect(f.importPaper).not.toHaveBeenCalled();
  const list = JSON.parse((await f.mcp.handleLine('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', { writable: true }))!).result.tools;
  expect(list.find((tool: { name: string }) => tool.name === "liteasy_import_papers").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
});

test("cancels pending work while keeping a save that already committed, and disposing revokes jobs", async () => {
  let finish!: (value: ImportedPaper) => void;
  const f = client(vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; })));
  const first = f.jobs.start(batch);
  const cancelled = (await f.call("liteasy_cancel_import", { jobId: first.jobId })).structuredContent.result;
  expect(cancelled.status).toBe("cancelled");
  expect(f.importPaper.mock.calls[0][2].aborted).toBe(true);
  finish(saved);
  await waitFor(() => expect(f.jobs.status(first.jobId).items.map((row) => row.status)).toEqual(["imported", "cancelled", "cancelled"]));
  expect(f.importPaper).toHaveBeenCalledOnce();
  f.jobs.start({ ...batch, operationId: "second" });
  f.jobs.dispose();
  expect(f.importPaper.mock.calls[1][2].aborted).toBe(true);
  finish(saved);
  expect(() => f.jobs.start({ ...batch, operationId: "third" })).toThrow("session has ended");
});
