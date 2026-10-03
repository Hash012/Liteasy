import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import { createLocalAssetMcp } from "../app/features/local-mcp/localAssetMcp";
import { localMcpCodexConfig } from "../app/features/local-mcp/localMcpContext";
import { createWorkspaceAgentAssetService } from "../app/features/resource-filesystem/workspaceAgentAssetService";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createPaperProjectRepository } from "../app/features/paper-projects/paperProjectRepository";
import { createReadingLibraryRepository } from "../app/features/reading-library/readingLibraryRepository";
import { liteasyPath } from "../app/features/resource-filesystem/liteasyPath";
import { refOf, objectText } from "../app/features/objects/object.types";
import type { NoteFileService } from "../app/features/note-files/noteFileService";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
function setup(files?: NoteFileService) {
  const scopeId = crypto.randomUUID();
  let active = true;
  const storage = createObjectStorage(scopeId, () => active ? scopeId : "other");
  const repository = createObjectRepository(storage, scopeId);
  const projects = createPaperProjectRepository(storage, scopeId);
  const paper = { id: "cicada", title: "Cicada: Dependably Fast Multi-Core In-Memory Transactions" };
  const assets = createWorkspaceAgentAssetService({ repository, projects, files, active: () => active, getPapers: () => [paper] });
  const mcp = createLocalAssetMcp(assets);
  const rpc = async (method: string, params = {}, writable = true) => JSON.parse((await mcp.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), { writable }))!);
  const call = async (name: string, args = {}, writable = true) => (await rpc("tools/call", { name, arguments: args }, writable)).result;
  return { scopeId, storage, repository, projects, paper, assets, mcp, rpc, call, deactivate() { active = false; } };
}

test("negotiates MCP, lists bounded tools with write annotations, and never runs notifications", async () => {
  const f = setup();
  expect((await f.rpc("initialize", { protocolVersion: "2024-11-05" })).result).toMatchObject({ protocolVersion: "2024-11-05", capabilities: { tools: {} }, instructions: expect.stringContaining("expectedRevision") });
  expect((await f.rpc("tools/list")).result.tools.find((tool: { name: string }) => tool.name === "liteasy_write").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  expect((await f.rpc("tools/list", {}, false)).result.tools.map((tool: { name: string }) => tool.name)).not.toContain("liteasy_write");
  expect(await f.mcp.handleLine(JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: "liteasy_create", arguments: { kind: "note", title: "Ignored", operationId: "never" } } }), { writable: true })).toBeNull();
  expect(await f.assets.search({ query: "Ignored" })).toEqual([]);
  expect(JSON.parse((await f.mcp.handleLine("bad", { writable: false }))!).error.code).toBe(-32700);
  expect(JSON.parse((await f.mcp.handleLine('{"jsonrpc":"2.0","id":{},"method":"ping"}', { writable: false }))!).error.code).toBe(-32600);
  expect((await f.rpc("unknown")).error.code).toBe(-32601);
  expect((await f.call("__proto__")).isError).toBe(true);
});

test("Codex can search, create a paper note, read, append and see the real persisted result with history", async () => {
  const f = setup();
  const search = await f.call("liteasy_search", { query: "Cicada" });
  const paperPath = search.structuredContent.result[0].path;
  const created = await f.call("liteasy_create", { kind: "note", title: "CicN", text: "# CicN\n", paperPath, operationId: "analysis-1" });
  const path = created.structuredContent.result.path;
  const read = (await f.call("liteasy_read", { path })).structuredContent.result;
  const written = await f.call("liteasy_write", { path, mode: "append", text: "\nLow contention.\n", expectedRevision: read.asset.revision });
  expect(written.isError).toBeUndefined();
  expect(written.structuredContent.result.changed).toBe(true);
  expect((await f.assets.read(path)).text).toBe("# CicN\n\nLow contention.\n");
  const project = (await f.projects.listProjects())[0];
  expect((await f.projects.listAssets(project.projectId))[0].ref!.revision).toBe(written.structuredContent.result.asset.revision);
  const repeated = await f.call("liteasy_create", { kind: "note", title: "CicN", text: "# CicN\n", paperPath, operationId: "analysis-1" });
  expect(repeated.structuredContent.result.path).toBe(path);
  expect(await f.assets.search({ query: "CicN" })).toHaveLength(1);
  expect((await f.projects.listAssets(project.projectId))[0].ref!.revision).toBe(written.structuredContent.result.asset.revision);
  expect((await f.assets.read(path)).text).toContain("Low contention");
});

test("read-only policy, stale revisions, invalid arguments and account changes cannot write", async () => {
  const f = setup();
  const note = await f.repository.create({ kind: "content.note", title: "CicN", content: { schema: "liteasy.note/v1", payload: { text: "Original", origin: "user" } } });
  const path = liteasyPath(f.scopeId, { kind: "object", ref: refOf(note), followLatest: true });
  const args = { path, mode: "replace", text: "MCP", expectedRevision: note.revision };
  expect((await f.call("liteasy_write", args, false)).structuredContent.error.code).toBe("read_only");
  await f.repository.editNote(refOf(note), "User edit");
  expect((await f.call("liteasy_write", args)).structuredContent.error.code).toBe("revision_conflict");
  expect((await f.call("liteasy_write", { ...args, unexpected: true })).structuredContent.error.code).toBe("invalid_request");
  expect((await f.call("liteasy_read", { path: path.replace(encodeURIComponent(f.scopeId), "other") })).structuredContent.error.code).toBe("invalid_path");
  expect(objectText(await f.repository.resolveLatest(note.objectId))).toBe("User edit");
  f.deactivate();
  expect((await f.call("liteasy_read", { path })).structuredContent.error.code).toBe("scope_changed");
});

test("creates and modifies real internal board cards through JSON Canvas with revision protection", async () => {
  const f = setup();
  const board = (await f.call("liteasy_create", { kind: "board", title: "Research map", operationId: "board-1" })).structuredContent.result;
  const read = (await f.call("liteasy_read", { path: board.path })).structuredContent.result;
  const canvas = { nodes: [{ id: "claim", type: "text", text: "Research question", x: 0, y: 0, width: 300, height: 150 }], edges: [] };
  expect((await f.call("liteasy_write", { path: board.path, mode: "replace", text: JSON.stringify(canvas), expectedRevision: read.asset.revision })).isError).toBeUndefined();
  const saved = JSON.parse((await f.assets.read(board.path)).text);
  expect(saved.nodes[0]).toMatchObject({ text: "Research question", x: 0, width: 300 });
  expect((await f.call("liteasy_write", { path: board.path, mode: "replace", text: "invalid", expectedRevision: (await f.assets.stat(board.path)).revision })).isError).toBe(true);
  expect(JSON.parse((await f.assets.read(board.path)).text).nodes).toHaveLength(1);
});

test("electronic books use the unified object interface; reads paginate and original sources remain intact", async () => {
  const f = setup();
  const library = createReadingLibraryRepository(f.storage, f.scopeId);
  await library.importFile("book.epub", new Uint8Array([1, 2, 3]), { title: "An electronic book", authors: [], format: "epub",
    chapters: [{ id: "1", title: "Chapter", plainText: "A long paragraph about memory.", content: "Text", format: "text" }], toc: [], resources: [], warnings: [] });
  const found = (await f.call("liteasy_search", { query: "electronic" })).structuredContent.result[0];
  expect(found.kind).toBe("source.document");
  const read = (await f.call("liteasy_read", { path: found.path, maxCharacters: 5 })).structuredContent.result;
  expect(read).toMatchObject({ text: "Chapt", truncated: true, nextOffset: 5 });
  expect((await f.call("liteasy_read", { path: found.path, offset: read.nextOffset })).structuredContent.result.text).toContain("memory");
  expect((await f.call("liteasy_write", { path: found.path, expectedRevision: read.asset.revision, mode: "replace", text: "Changed" })).structuredContent.error.code).toBe("read_only");
});

test("mounted Canvas edits validate structure and use the file service's compare-and-swap", async () => {
  let file = { mountId: "vault", path: "research.canvas", name: "research.canvas", kind: "file" as const, version: "v1", text: '{"nodes":[],"edges":[]}' };
  const writeFile = vi.fn(async (input) => { expect(input.expectedVersion).toBe(file.version); file = { ...file, version: "v2", text: input.text }; return file; });
  const f = setup({ listMounts: async () => [{ id: "vault", name: "Vault", kind: "directory", location: "" }], listEntries: async () => [file], readFile: async () => file, writeFile } as unknown as NoteFileService);
  const found = (await f.assets.search({ query: "research" }))[0];
  expect((await f.call("liteasy_write", { path: found.path, expectedRevision: "v1", mode: "replace", text: "bad" })).isError).toBe(true);
  expect(writeFile).not.toHaveBeenCalled();
  const text = JSON.stringify({ nodes: [{ id: "x", type: "text", text: "New card", x: 0, y: 0, width: 100, height: 100 }], edges: [] });
  expect((await f.call("liteasy_write", { path: found.path, expectedRevision: "v1", mode: "replace", text })).isError).toBeUndefined();
  expect(file.text).toBe(text);
});

test("Windows config safely quotes paths, including spaces and non-ASCII names", () => {
  const config = localMcpCodexConfig({ enabled: true, writable: true, executable: 'D:\\研究 tools\\Liteasy.exe', connectionFile: 'C:\\Users\\研究\\connection.json' });
  expect(config).toContain('command = "D:\\\\研究 tools\\\\Liteasy.exe"');
  expect(config).toContain('args = ["--local-mcp",');
  expect(config).not.toContain("token");
});


test("MCP refuses organization-derived bodies, images and attached creation while local reads remain available", async () => {
  const f = setup();
  const note = await f.repository.create({ kind: "content.note", title: "Organization reference", sourceReferences: [{ scopeType: "organization", scopeId: "group", paperId: "source", revision: 3 }], content: { schema: "liteasy.note/v1", payload: { text: "SYNTHETIC_PRIVATE_BODY", origin: "derived" } } });
  const path = liteasyPath(f.scopeId, { kind: "object", ref: refOf(note) });
  expect((await f.assets.read(path)).text).toBe("SYNTHETIC_PRIVATE_BODY");
  for (const name of ["liteasy_read", "liteasy_stat", "liteasy_read_image"]) {
    const result = await f.call(name, { path });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE_BODY");
    expect(result.structuredContent.error.message).toContain("属于组织");
  }
  expect((await f.call("liteasy_search", { query: "Organization reference" })).structuredContent.result).toEqual([]);
});

test("a mounted community note retains the organization boundary while ordinary local Markdown stays readable", async () => {
  const file = { mountId: "vault", path: "reflection.md", name: "reflection.md", kind: "file" as const, version: "v1", text: '---\nsourceNamespace: intuecho.annotation\nsourceId: "annotation"\nrevision: 2\norganizationId: "group"\nsourcePolicy: organization-bound\n---\nMy reflection' };
  const f = setup({ listMounts: async () => [{ id: "vault", name: "Vault", kind: "directory", location: "" }], listEntries: async () => [file], readFile: async () => file } as unknown as NoteFileService);
  const path = (await f.assets.search({ query: "reflection" }))[0].path;
  expect((await f.assets.read(path)).text).toContain("My reflection");
  expect((await f.call("liteasy_read", { path })).structuredContent.error.message).toContain("属于组织");
  file.text = "My own local note, without a community source";
  expect((await f.call("liteasy_read", { path })).structuredContent.result.text).toBe(file.text);
});

test("mounted-file writes cannot remove or downgrade source metadata and malformed metadata fails closed", async () => {
  let file = { mountId: "vault", path: "reflection.md", name: "reflection.md", kind: "file" as const, version: "v1", text: '---\nsourceNamespace: intuecho.annotation\nsourceId: "annotation"\nrevision: 2\norganizationId: "group"\nsourcePolicy: organization-bound\n---\nMy reflection' };
  const writeFile = vi.fn(async (input) => { file = { ...file, version: `v${Number(file.version.slice(1)) + 1}`, text: input.text }; return file; });
  const f = setup({ listMounts: async () => [{ id: "vault", name: "Vault", kind: "directory", location: "" }], listEntries: async () => [file], readFile: async () => file, writeFile } as unknown as NoteFileService);
  const path = (await f.assets.search({ query: "reflection" }))[0].path;
  for (const text of ["Body without provenance", file.text.replace('organizationId: "group"', 'organizationId: "other"'), file.text.replace("revision: 2", "revision: 3")]) {
    await expect(f.assets.write(path, { expectedRevision: file.version, mode: "replace", text })).rejects.toThrow("来源");
  }
  expect(writeFile).not.toHaveBeenCalled();
  await f.assets.write(path, { expectedRevision: file.version, mode: "append", text: "\nAdditional personal reflection" });
  expect((await f.call("liteasy_read", { path })).isError).toBe(true);
  file.text = file.text.replace("sourcePolicy: organization-bound", "sourcePolicy: malformed");
  expect((await f.assets.stat(path)).sourceResolution).toBe("unavailable");
  await expect(f.assets.write(path, { expectedRevision: file.version, mode: "replace", text: "Remove malformed source" })).rejects.toThrow("来源");
  expect((await f.call("liteasy_read", { path })).isError).toBe(true);
});

test("ordinary mounted Markdown still supports explicit revision-checked MCP edits", async () => {
  let file = { mountId: "vault", path: "local.md", name: "local.md", kind: "file" as const, version: "v1", text: "My independent local note" };
  const f = setup({ listMounts: async () => [{ id: "vault", name: "Vault", kind: "directory", location: "" }], listEntries: async () => [file], readFile: async () => file, writeFile: async (input: { text: string }) => (file = { ...file, text: input.text, version: "v2" }) } as unknown as NoteFileService);
  const path = (await f.assets.search({ query: "local" }))[0].path;
  expect((await f.call("liteasy_write", { path, expectedRevision: "v1", mode: "append", text: "\nMy additional reflection" })).isError).toBeUndefined();
  expect((await f.call("liteasy_read", { path })).structuredContent.result.text).toBe("My independent local note\nMy additional reflection");
});
