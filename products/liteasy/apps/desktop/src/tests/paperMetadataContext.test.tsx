import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useObjectWorkbenchController } from "../app/controllers/useObjectWorkbenchController";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { liteasyPath } from "../app/features/resource-filesystem/liteasyPath";
import { loadUserPaperArtifact } from "../app/features/library/userPaperArtifactClient";
import type { Paper } from "../app/features/workspace/workspace.types";
import type { RetrievalChunk } from "../app/features/retrieval/retrieval.types";

vi.mock("../app/features/library/userPaperArtifactClient", async (original) => ({
  ...await original<typeof import("../app/features/library/userPaperArtifactClient")>(),
  loadUserPaperArtifact: vi.fn(async () => undefined),
}));
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); vi.mocked(loadUserPaperArtifact).mockReset().mockResolvedValue(undefined); });

function fixture(initial: Paper = { id: "cicada", title: "Cicada" }) {
  let paper = initial;
  const readPaperBytes = vi.fn(async () => new Uint8Array([1, 2, 3]));
  const scopeId = crypto.randomUUID();
  const hook = renderHook(() => useObjectWorkbenchController({ scopeId,
    getApi: () => { throw new Error("No model call expected"); }, getPapers: () => [paper],
    getSettings: () => createSettingsStore().getState(), openEvidence: vi.fn(), readPaperBytes,
  }));
  return { hook, readPaperBytes, scopeId, setPaper(next: Paper) { paper = next; } };
}

test("attaches an unparsed paper as metadata without reading PDF bytes or parsed full text", async () => {
  const f = fixture();
  let refs!: Awaited<ReturnType<NonNullable<typeof f.hook.result.current.port.capturePaperContext>>>;
  await act(async () => { refs = await f.hook.result.current.port.capturePaperContext!(["cicada"]); });
  const object = await f.hook.result.current.repository.get(refs[0]);
  expect(object.kind).toBe("source.document");
  expect(object.content.payload).toMatchObject({ paperId: "cicada", text: expect.stringContaining("Cicada"), legacyKey: "paper-context-metadata:cicada" });
  expect(object.content.payload).not.toHaveProperty("documentHash");
  expect(object.content.payload).not.toHaveProperty("pages");
  expect(loadUserPaperArtifact).not.toHaveBeenCalled();
  expect(f.readPaperBytes).not.toHaveBeenCalled();
  const path = liteasyPath(f.scopeId, { kind: "object", ref: refs[0] });
  expect((await f.hook.result.current.agentAssets.stat(path)).summary).toContain("题录");
  vi.mocked(loadUserPaperArtifact).mockResolvedValue({ version: 2, parser: "local_pdfjs", extractedAt: "", pages: [{ page: 1, text: "Cicada introduction" }, { page: 3, text: "Cicada experiments" }] });
  const read = await f.hook.result.current.agentAssets.read(path);
  expect(read.text).toContain("Cicada experiments");
  expect(read.text).toContain("正文版本未固定");
  expect(read.text).toContain("论文总页数未知");
  expect(read.asset.path).toBe(path);
  expect(loadUserPaperArtifact).toHaveBeenCalledTimes(1);
  expect(f.readPaperBytes).not.toHaveBeenCalled();
  f.hook.unmount();
});

test("metadata attachment preserves existing full-text snapshots and refuses changed source hashes", async () => {
  const f = fixture({ id: "cicada", title: "Cicada", contentHash: "known-source-sha" });
  const existing = await f.hook.result.current.repository.projectLegacy("paper-cicada", { kind: "source.document", title: "Cicada", content: {
    schema: "liteasy.source-document/v1", payload: { paperId: "cicada", legacyKey: "cicada", availability: "local", text: "Preserved full text" },
  } });
  let refs!: Awaited<ReturnType<NonNullable<typeof f.hook.result.current.port.capturePaperContext>>>;
  await act(async () => { refs = await f.hook.result.current.port.capturePaperContext!(["cicada"]); });
  expect(refs[0].objectId).not.toBe(existing.objectId);
  expect((await f.hook.result.current.repository.resolveLatest(existing.objectId)).content.payload).toMatchObject({ text: "Preserved full text" });
  expect((await f.hook.result.current.repository.get(refs[0])).content.payload).toMatchObject({ documentHash: "known-source-sha" });
  f.setPaper({ id: "cicada", title: "Cicada", contentHash: "new-source-sha" });
  await expect(f.hook.result.current.agentAssets.read(liteasyPath(f.scopeId, { kind: "object", ref: refs[0] }))).rejects.toMatchObject({ code: "revision_conflict" });
  expect(loadUserPaperArtifact).not.toHaveBeenCalled();
  f.hook.unmount();
});

test("artifact-specific capture still fixes parsed full text while plain attachment does not", async () => {
  const f = fixture({ id: "cicada", title: "Cicada", contentHash: "known-source-sha" });
  vi.mocked(loadUserPaperArtifact).mockResolvedValue({ version: 2, parser: "local_pdfjs", extractedAt: "", pages: [{ page: 2, text: "Full-text evidence for slides" }] });
  let refs!: Awaited<ReturnType<NonNullable<typeof f.hook.result.current.port.capturePaperContext>>>;
  await act(async () => { refs = await f.hook.result.current.port.capturePaperFulltextContext!(["cicada"]); });
  expect((await f.hook.result.current.repository.get(refs[0])).content.payload).toMatchObject({ pages: [{ page: 2, text: "Full-text evidence for slides" }] });
  expect(loadUserPaperArtifact).toHaveBeenCalledTimes(1);
  f.hook.unmount();
});

test("upgrades metadata-only paper tokens to real parsed sources when an artifact requests a context snapshot", async () => {
  const f = fixture({ id: "cicada", title: "Cicada", contentHash: "known-source-sha" });
  let refs!: Awaited<ReturnType<NonNullable<typeof f.hook.result.current.port.capturePaperContext>>>;
  await act(async () => { refs = await f.hook.result.current.port.capturePaperContext!(["cicada"]); });
  vi.mocked(loadUserPaperArtifact).mockResolvedValue({ version: 2, parser: "local_pdfjs", extractedAt: "", pages: [{ page: 4, text: "Evidence that must reach the PPT model" }] });
  const snapshot = await f.hook.result.current.resolveContext({ sessionId: "artifact-session", idempotencyKey: "ppt-test",
    contextRefs: refs, input: { message: "Generate slides from this paper", mode: "qa", artifactType: "ppt" } });
  expect(snapshot.entries[0].text).toContain("Evidence that must reach the PPT model");
  expect(snapshot.entries[0].ref).not.toEqual(refs[0]);
  expect(snapshot.entries[0].text).not.toContain("此引用仅固定论文题录");
  f.hook.unmount();
});

test("parses only when the Agent explicitly reads an unparsed paper and keeps abstract selectors fixed", async () => {
  let chunks: RetrievalChunk[] = [];
  const ensurePaperImported = vi.fn(async () => {
    chunks = [{ paperId: "cicada", paperTitle: "Cicada", page: 1, summary: "", tags: [], snippet: "Abstract A newly parsed study. Introduction Full body." }];
  });
  const scopeId = crypto.randomUUID();
  const hook = renderHook(() => useObjectWorkbenchController({ scopeId,
    getApi: () => { throw new Error("No model call expected"); }, getPapers: () => [{ id: "cicada", title: "Cicada" }],
    getSettings: () => createSettingsStore().getState(), openEvidence: vi.fn(),
    getImportedChunksForPaperId: () => chunks, ensurePaperImported,
  }));
  let refs!: Awaited<ReturnType<NonNullable<typeof hook.result.current.port.capturePaperContext>>>;
  await act(async () => { refs = await hook.result.current.port.capturePaperContext!(["cicada"]); });
  expect(ensurePaperImported).not.toHaveBeenCalled();
  const path = liteasyPath(scopeId, { kind: "object", ref: refs[0] });
  expect((await hook.result.current.agentAssets.read(path)).text).toContain("Full body.");
  expect(ensurePaperImported).toHaveBeenCalledTimes(1);
  await act(async () => { refs = await hook.result.current.port.capturePaperContext!(["cicada"]); });
  const abstractPath = liteasyPath(scopeId, { kind: "object", ref: { ...refs[0], selectorId: "abstract" } });
  chunks = [{ ...chunks[0], snippet: "Different current source" }];
  expect((await hook.result.current.agentAssets.read(abstractPath)).text).toBe("A newly parsed study.");
  expect(ensurePaperImported).toHaveBeenCalledTimes(1);
  hook.unmount();
});
