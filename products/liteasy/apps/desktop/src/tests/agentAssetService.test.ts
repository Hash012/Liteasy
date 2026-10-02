import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { objectText, refOf } from "../app/features/objects/object.types";
import { createPaperProjectRepository } from "../app/features/paper-projects/paperProjectRepository";
import { createWorkspaceAgentAssetService } from "../app/features/resource-filesystem/workspaceAgentAssetService";
import { createAgentAssetService, readAgentAssetText } from "../app/features/resource-filesystem/agentAssetService";
import { liteasyPath } from "../app/features/resource-filesystem/liteasyPath";
import type { NoteFileService, NoteFileSnapshot } from "../app/features/note-files/noteFileService";
import type { AgentAssetAdapter } from "../app/features/resource-filesystem/agentAsset.types";
import { stageImage } from "../app/features/objects/objectAssets";
import { createReadingLibraryRepository } from "../app/features/reading-library/readingLibraryRepository";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));

function fixture() {
  const scopeId = crypto.randomUUID();
  let active = true;
  const storage = createObjectStorage(scopeId, () => active ? scopeId : "other-account");
  const repository = createObjectRepository(storage, scopeId);
  const projects = createPaperProjectRepository(storage, scopeId);
  const paper = { id: "cicada", title: "Cicada: Dependably Fast Multi-Core In-Memory Transactions" };
  const service = createWorkspaceAgentAssetService({ repository, projects, active: () => active, getPapers: () => [paper] });
  return { scopeId, storage, repository, projects, service, paper, switchAccount() { active = false; } };
}

describe("workspace agent assets", () => {
  test("does not return an unsupported original's saved-file placeholder as extracted body", async () => {
    const f = fixture();
    const library = createReadingLibraryRepository(f.storage, f.scopeId);
    const { entry } = await library.importFile("observations.csv", new TextEncoder().encode("sample,value\nA,1"), {
      format: "other", title: "Field observations", authors: [], chapters: [], toc: [], resources: [], warnings: []
    });
    const path = liteasyPath(f.scopeId, { kind: "object", ref: entry.ref });
    expect((await f.service.search({ query: "Field observations" }))[0].title).toBe("Field observations");
    await expect(f.service.read(path)).rejects.toMatchObject({ code: "unavailable", message: expect.stringContaining("尚未提取正文") });
    expect(Array.from((await library.readFile(entry.id)).bytes)).toEqual(Array.from(new TextEncoder().encode("sample,value\nA,1")));
  });

  test("discovers a new CicN note, writes the real project asset, retains history, and re-adds the saved revision as context", async () => {
    const f = fixture();
    expect(await f.service.search({ query: "CicN" })).toEqual([]);
    const project = await f.projects.ensurePaperProject({ paperId: f.paper.id, title: f.paper.title });
    const created = await f.projects.createNote(project.projectId, "# CicN\n\n", "CicN");
    const [found] = await f.service.search({ query: "cic" });
    expect(found).toMatchObject({ title: "CicN", relatedPaperIds: ["cicada"], capabilities: expect.arrayContaining(["read", "write", "add_context"]) });
    expect((await f.service.search({ query: found.path }))[0].path).toBe(found.path);
    const read = await f.service.read(found.path);
    expect(read.text).toBe("# CicN\n\n");
    const text = "# CicN\n\nCicada combines optimistic concurrency control with multi-version storage.\n";
    const written = await f.service.write(found.path, { text, expectedRevision: read.asset.revision! });
    expect(written).toMatchObject({ changed: true, previousRevision: created.ref!.revision, addedLines: 1, removedLines: 0 });
    expect(written.asset.revision).not.toBe(read.asset.revision);
    expect(objectText(await f.repository.resolveLatest(created.ref!.objectId))).toBe(text);
    expect(objectText(await f.repository.get(created.ref!))).toBe("# CicN\n\n");
    expect((await f.projects.listAssets(project.projectId))[0].ref?.revision).toBe(written.asset.revision);
    expect((await f.service.context(found.path))[0].ref.revision).toBe(written.asset.revision);
    expect((await f.service.read(found.path)).text).toBe(text);
  });

  test("never loads object bodies or paper full text during discovery", async () => {
    const f = fixture();
    const project = await f.projects.ensurePaperProject({ paperId: f.paper.id, title: f.paper.title });
    await f.projects.registerSource(project.projectId, { assetId: "fulltext", paperId: f.paper.id, title: "Cicada 原文", kind: "text", text: "LONG FULL PAPER BODY" });
    const get = vi.spyOn(f.storage, "get");
    const readPaper = vi.fn(async () => "Full paper only when requested");
    const service = createWorkspaceAgentAssetService({ repository: f.repository, projects: f.projects, getPapers: () => [f.paper], readPaper, active: () => true });
    const found = await service.search({ query: "Cicada" });
    expect(found).toHaveLength(2);
    expect(JSON.stringify(found)).not.toContain("LONG FULL PAPER BODY");
    expect(get.mock.calls.some(([key]) => key.startsWith("head/") || key.startsWith("revision/"))).toBe(false);
    expect(readPaper).not.toHaveBeenCalled();
    const paper = found.find((asset) => asset.kind === "paper")!;
    expect((await service.read(paper.path)).text).toBe("Full paper only when requested");
    expect(readPaper).toHaveBeenCalledTimes(1);
  });

  test("reports sources as read-only and refuses source writes without touching storage", async () => {
    const f = fixture();
    const project = await f.projects.ensurePaperProject({ paperId: f.paper.id, title: f.paper.title });
    const source = await f.projects.registerSource(project.projectId, { assetId: "fulltext", paperId: f.paper.id, title: "Cicada 原文", kind: "text", text: "Original content" });
    const path = liteasyPath(f.scopeId, { kind: "object", ref: source.ref! });
    expect((await f.service.stat(path)).capabilities).not.toContain("write");
    await expect(f.service.write(path, { text: "overwrite", expectedRevision: source.ref!.revision })).rejects.toMatchObject({ code: "read_only" });
    expect(objectText(await f.repository.get(source.ref!))).toBe("Original content");
  });

  test("keeps a pinned revision and exact abstract/page selector throughout stat and read", async () => {
    const f = fixture();
    const source = await f.repository.projectLegacy("paper-cicada", { title: "Cicada", kind: "source.document",
      content: { schema: "liteasy.source-document/v1", payload: { paperId: "cicada", text: "Old complete text", legacyKey: "cicada", availability: "local",
        abstractText: "An exact abstract.", pages: [{ page: 2, text: "The second page." }] } } });
    await f.repository.projectLegacy("paper-cicada", { title: "Changed title", kind: "source.document",
      content: { schema: "liteasy.source-document/v1", payload: { ...source.content.payload, text: "New complete text", abstractText: "New abstract" } } });
    const path = liteasyPath(f.scopeId, { kind: "object", ref: { ...refOf(source), selectorId: "abstract" } });
    expect(await f.service.stat(path)).toMatchObject({ path, revision: source.revision, title: "Cicada" });
    expect(await f.service.read(path)).toMatchObject({ asset: { path, revision: source.revision }, text: "An exact abstract." });
    const pagePath = liteasyPath(f.scopeId, { kind: "object", ref: { ...refOf(source), selectorId: "page:2" } });
    expect((await f.service.read(pagePath)).text).toBe("The second page.");
    await expect(f.service.read(liteasyPath(f.scopeId, { kind: "object", ref: { ...refOf(source), selectorId: "page:3" } }))).rejects.toMatchObject({ code: "unavailable" });
  });

  test("isolates unavailable external mounts so current project notes remain discoverable", async () => {
    const f = fixture();
    await f.repository.create({ title: "CicN", kind: "content.note", content: { schema: "liteasy.note/v1", payload: { text: "# CicN", origin: "user" } } });
    const files = { listMounts: vi.fn(async () => { throw new Error("drive disconnected"); }) } as unknown as NoteFileService;
    const service = createWorkspaceAgentAssetService({ repository: f.repository, files, active: () => true });
    expect((await service.search({ query: "Cic" })).map((entry) => entry.title)).toEqual(["CicN"]);
  });

  test("reads fixed board layouts after the live board changes and rejects cross-scope or revision snapshots", async () => {
    const f = fixture();
    const board = await f.repository.create({ kind: "workspace.board", title: "Research board", content: { schema: "liteasy.board/v1", payload: { description: "" } } });
    const path = liteasyPath(f.scopeId, { kind: "object", ref: refOf(board) });
    const [attachment] = await f.service.context(path);
    const fixedRef = attachment.refs.find((ref) => ref.selectorId?.startsWith("board-context:"))!;
    const snapshotPath = liteasyPath(f.scopeId, { kind: "object", ref: fixedRef });
    const note = await f.repository.create({ kind: "content.note", title: "Later addition", content: { schema: "liteasy.note/v1", payload: { text: "Not in the fixed layout", origin: "user" } } });
    await f.repository.applyBoardPatch({ boardRef: refOf(board), operationId: "add-later", add: [refOf(note)] });
    const read = await f.service.read(snapshotPath);
    expect(read.asset.path).toBe(snapshotPath);
    expect(read.asset.revision).toBe(board.revision);
    expect(read.asset.capabilities).not.toContain("write");
    expect(read.text).toContain('"elements": []');
    expect(read.text).not.toContain("Not in the fixed layout");
    const forged = { snapshotId: "foreign-layout", scopeId: "other-account", boardRef: refOf(board), text: "Wrong scope" };
    await f.repository.saveSnapshot(forged);
    await expect(f.service.read(liteasyPath(f.scopeId, { kind: "object", ref: { ...refOf(board), selectorId: "board-context:foreign-layout" } }))).rejects.toMatchObject({ code: "invalid_request" });
    await f.repository.saveSnapshot({ ...forged, snapshotId: "wrong-revision", scopeId: f.scopeId, boardRef: { ...refOf(board), revision: "different" } });
    await expect(f.service.read(liteasyPath(f.scopeId, { kind: "object", ref: { ...refOf(board), selectorId: "board-context:wrong-revision" } }))).rejects.toMatchObject({ code: "invalid_request" });
  });

  test("reads only the selected generated-document or conversation block", async () => {
    const f = fixture();
    const document = await f.repository.create({ kind: "artifact.document", title: "Generated document", content: { schema: "liteasy.document/v1", payload: { blocks: [
      { blockId: "first", type: "markdown", text: "First block only", sourceRefs: [] },
      { blockId: "second", type: "markdown", text: "Hidden second block", sourceRefs: [] },
    ] } } });
    const path = liteasyPath(f.scopeId, { kind: "object", ref: { ...refOf(document), selectorId: "first" } });
    expect((await f.service.read(path)).text).toBe("First block only");
    const message = await f.repository.create({ kind: "conversation.message", title: "Saved reply", content: { schema: "liteasy.message/v1", payload: {
      messageId: "reply-1", blockId: "answer", text: "Saved answer", partial: false,
    } } });
    const messagePath = liteasyPath(f.scopeId, { kind: "object", ref: { ...refOf(message), selectorId: "answer" } });
    expect((await f.service.read(messagePath)).text).toBe("Saved answer");
    await expect(f.service.read(liteasyPath(f.scopeId, { kind: "object", ref: { ...refOf(message), selectorId: "other" } }))).rejects.toMatchObject({ code: "invalid_request" });
  });

  test("reads image bytes only on demand and rejects altered source bytes", async () => {
    const f = fixture();
    const staged = await stageImage(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]), "image/png");
    const object = await f.repository.createImage(staged, "An architecture figure");
    const path = liteasyPath(f.scopeId, { kind: "object", ref: refOf(object) });
    const readAsset = vi.spyOn(f.repository, "readAsset");
    await f.service.stat(path);
    await f.service.read(path);
    expect(readAsset).not.toHaveBeenCalled();
    expect(await f.service.resolveImages(path)).toEqual([{ mediaType: "image/png", base64: staged.base64, label: "资料图片：An architecture figure" }]);
    readAsset.mockResolvedValue({ ...staged, base64: btoa(String.fromCharCode(137, 80, 78, 71, 13, 10, 26, 10, 4, 3, 2, 1)) });
    await expect(f.service.resolveImages(path)).rejects.toMatchObject({ code: "revision_conflict" });
  });

  test("uses cached abstract metadata without extracting paper bodies and labels missing abstracts", async () => {
    const f = fixture();
    const readPaper = vi.fn(async () => "Entire full text");
    const getPaperAbstract = vi.fn(() => "A concise abstract already extracted.");
    const service = createWorkspaceAgentAssetService({ repository: f.repository, active: () => true, getPapers: () => [f.paper], readPaper, getPaperAbstract });
    const path = liteasyPath(f.scopeId, { kind: "paper", paperId: f.paper.id });
    expect((await service.stat(path)).summary).toContain("A concise abstract already extracted.");
    expect(readPaper).not.toHaveBeenCalled();
    expect((await f.service.stat(path)).summary).toContain("摘要尚未提取");
  });

  test("edits internal boards through validated JSON Canvas while preserving source objects and project membership", async () => {
    const f = fixture();
    const project = await f.projects.ensurePaperProject({ paperId: f.paper.id, title: f.paper.title });
    const source = await f.projects.registerSource(project.projectId, { assetId: "source", paperId: f.paper.id, title: "Original paper text", kind: "text", text: "Immutable source" });
    const asset = await f.projects.createBoard(project.projectId, "Cicada board");
    const [boardRef] = await f.repository.applyBoardPatch({ boardRef: asset.ref!, operationId: "place-source", add: [source.ref!] });
    const path = liteasyPath(f.scopeId, { kind: "object", ref: boardRef, followLatest: true });
    const read = await f.service.read(path);
    expect(read.asset.capabilities).toContain("write");
    const document = JSON.parse(read.text);
    document.nodes[0].text = "An annotated interpretation";
    document.nodes.push({ id: "new-card", type: "text", text: "Follow-up experiment", x: 420, y: 0, width: 320, height: 200 });
    document.edges.push({ id: "relationship", fromNode: document.nodes[0].id, toNode: "new-card", label: "supports" });
    const saved = await f.service.write(path, { expectedRevision: read.asset.revision!, mode: "replace", text: JSON.stringify(document) });
    expect(saved.changed).toBe(true);
    const placements = await f.repository.listPlacements(boardRef.objectId);
    expect(placements).toHaveLength(2);
    const modified = await f.repository.get(placements.find((placement) => placement.placementId === document.nodes[0].id)!.ref);
    expect(modified.kind).toBe("content.note");
    expect(modified.provenance.derivedFrom).toEqual([source.ref]);
    expect(objectText(modified)).toBe("An annotated interpretation");
    expect(objectText(await f.repository.get(source.ref!))).toBe("Immutable source");
    expect((await f.repository.listEdges(boardRef.objectId))[0].label).toBe("supports");
    expect((await f.projects.listAssets(project.projectId)).find((entry) => entry.assetId === asset.assetId)!.ref?.revision).toBe(saved.asset.revision);
    await expect(f.service.write(path, { expectedRevision: read.asset.revision!, mode: "replace", text: read.text })).rejects.toMatchObject({ code: "revision_conflict" });
  });

  test("rejects invalid or partial board updates before mutating the board", async () => {
    const f = fixture();
    const board = await f.repository.create({ kind: "workspace.board", title: "Board", content: { schema: "liteasy.board/v1", payload: { description: "Retain this description", paperId: "cicada" } } });
    const path = liteasyPath(f.scopeId, { kind: "object", ref: refOf(board), followLatest: true });
    await expect(f.service.write(path, { expectedRevision: board.revision, mode: "append", text: "more" })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(f.service.write(path, { expectedRevision: board.revision, mode: "replace", text: JSON.stringify({ nodes: [], edges: [{ id: "bad", fromNode: "missing", toNode: "missing" }] }) })).rejects.toThrow("白板连接");
    expect((await f.repository.resolveLatest(board.objectId)).revision).toBe(board.revision);
    const saved = await f.service.write(path, { expectedRevision: board.revision, mode: "replace", text: JSON.stringify({ nodes: [{ id: "text", type: "text", text: "New note", x: 0, y: 0, width: 320, height: 200 }], edges: [] }) });
    expect((await f.repository.resolveLatest(board.objectId)).content.payload).toEqual({ description: "Retain this description", paperId: "cicada" });
    await f.repository.setBoardFileBinding(board.objectId, { mountId: "vault", path: "board.canvas", savedRevision: saved.asset.revision });
    expect((await f.service.stat(path)).capabilities).not.toContain("write");
  });

  test("detects stale pinned revisions and simultaneous edits instead of overwriting newer notes", async () => {
    const f = fixture();
    const note = await f.repository.create({ title: "CicN", kind: "content.note", content: { schema: "liteasy.note/v1", payload: { text: "initial", origin: "user" } } });
    const path = liteasyPath(f.scopeId, { kind: "object", ref: refOf(note) });
    const changed = await f.repository.editNote(refOf(note), "user changed this");
    await expect(f.service.write(path, { text: "overwrite", expectedRevision: note.revision })).rejects.toMatchObject({ code: "revision_conflict" });
    const latestPath = liteasyPath(f.scopeId, { kind: "object", ref: refOf(changed), followLatest: true });
    const results = await Promise.allSettled([
      f.service.write(latestPath, { text: "A", expectedRevision: changed.revision }),
      f.service.write(latestPath, { text: "B", expectedRevision: changed.revision }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await f.repository.history(note.objectId))).toHaveLength(3);
  });

  test("bounds reads, supports follow-up ranges, and checks cancellation and account scope", async () => {
    const f = fixture();
    const note = await f.repository.create({ title: "N", kind: "content.note", content: { schema: "liteasy.note/v1", payload: { text: "abcdef", origin: "user" } } });
    const path = liteasyPath(f.scopeId, { kind: "object", ref: refOf(note) });
    expect(await f.service.read(path, { maxCharacters: 3 })).toMatchObject({ text: "abc", totalCharacters: 6, truncated: true, nextOffset: 3 });
    expect(await f.service.read(path, { maxCharacters: 3, offset: 3 })).toMatchObject({ text: "def", offset: 3, totalCharacters: 6 });
    await expect(f.service.read(path, { maxCharacters: 80001 })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(f.service.stat(liteasyPath("other", { kind: "object", ref: refOf(note) }))).rejects.toMatchObject({ code: "invalid_path" });
    const abort = new AbortController(); abort.abort();
    await expect(f.service.write(path, { text: "never", expectedRevision: note.revision, signal: abort.signal })).rejects.toMatchObject({ name: "AbortError" });
    f.switchAccount();
    await expect(f.service.search({ query: "N" })).rejects.toMatchObject({ code: "scope_changed" });
  });

  test("edits mounted Markdown through its file version and warns about Obsidian without blocking", async () => {
    const f = fixture();
    let snapshot: NoteFileSnapshot = { mountId: "vault", path: "research/CicN.md", name: "CicN.md", kind: "file", text: "# CicN", version: "one" };
    const files: NoteFileService = {
      listMounts: vi.fn(async () => [{ id: "vault", name: "Vault", kind: "directory", location: "Vault" }]),
      listEntries: vi.fn(async () => [{ ...snapshot }]),
      readFile: vi.fn(async () => ({ ...snapshot })),
      writeFile: vi.fn(async (change) => {
        expect(change.expectedVersion).toBe(snapshot.version);
        snapshot = { ...snapshot, text: change.text, version: "two" };
        return snapshot;
      }),
      editingStatus: vi.fn(async () => ({ available: true, open: true, editing: true })),
      chooseFile: vi.fn(), chooseFolder: vi.fn(), createDirectory: vi.fn(), pickFiles: vi.fn(),
    };
    const service = createWorkspaceAgentAssetService({ repository: f.repository, files, active: () => true });
    const [asset] = await service.search({ query: "Cic" });
    expect(files.readFile).not.toHaveBeenCalled();
    const read = await service.read(asset.path);
    const saved = await service.write(asset.path, { expectedRevision: read.asset.revision!, mode: "append", text: "\n\nSummary" });
    expect(saved).toMatchObject({ changed: true, asset: { revision: "two" }, warnings: [expect.stringContaining("Obsidian")] });
    expect(snapshot.text).toBe("# CicN\n\nSummary");
    await expect(service.write(asset.path, { expectedRevision: "one", text: "stale" })).rejects.toMatchObject({ code: "revision_conflict" });
    expect(files.writeFile).toHaveBeenCalledTimes(1);
    const projected = await f.repository.projectLegacy("note-file-vault-research/CicN.md", { kind: "content.note", title: "CicN.md", content: { schema: "liteasy.note/v1", payload: { text: snapshot.text, origin: "external" } } });
    await f.repository.setObjectFileBinding(projected.objectId, { mountId: "vault", path: snapshot.path, version: snapshot.version });
    const projection = await service.stat(liteasyPath(f.scopeId, { kind: "object", ref: refOf(projected) }));
    expect(projection.capabilities).not.toContain("write");
    expect(projection.summary).toContain(asset.path);
  });

  test("new asset adapters inherit search, range reads and permission checks", async () => {
    const asset = { path: "liteasy://datasets/measurements?scope=device", title: "Measurements", kind: "dataset", revision: "one", capabilities: ["search", "read"] as const };
    const adapter: AgentAssetAdapter = { id: "dataset", accepts: (path) => new URL(path).hostname === "datasets",
      search: async () => [{ ...asset, capabilities: [...asset.capabilities] }], stat: async () => ({ ...asset, capabilities: [...asset.capabilities] }),
      read: async (_path, options) => readAgentAssetText({ ...asset, capabilities: [...asset.capabilities] }, "a,b\n1,2", options) };
    const service = createAgentAssetService({ scopeId: "device", active: () => true });
    const unregister = service.registerAdapter(adapter);
    expect((await service.search({ query: "measurements" }))[0].kind).toBe("dataset");
    expect((await service.read(asset.path, { maxCharacters: 3 })).text).toBe("a,b");
    await expect(service.write(asset.path, { text: "x", expectedRevision: "one" })).rejects.toMatchObject({ code: "read_only" });
    unregister();
    await expect(service.read(asset.path)).rejects.toMatchObject({ code: "unavailable" });
  });
});
