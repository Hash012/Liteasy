import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { expect, test, vi } from "vitest";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createTrialStorage, clearTrialStorage } from "../app/features/workflow-studio/trialStorage";
import { trialExtension } from "../app/features/workflow-studio/extensionTrial";
import { createExtensionDraftStore } from "../app/features/workflow-studio/extensionDraftStore";
import { paperLensPackage } from "../app/features/extensions/paperLensPackage";
import { buildExtensionPackage, compileExtensionWorkflow, validateExtensionPackage } from "../app/features/extensions/extensionPackage";
import { createWorkspaceAgentAssetService } from "../app/features/resource-filesystem/workspaceAgentAssetService";
import { liteasyPath } from "../app/features/resource-filesystem/liteasyPath";
import { stageImage } from "../app/features/objects/objectAssets";
import { refOf } from "../app/features/objects/object.types";
import type { NoteFileService } from "../app/features/note-files/noteFileService";
vi.stubGlobal("crypto", webcrypto);
function setup() { const scope = crypto.randomUUID(); const storage = createObjectStorage(scope, () => scope); return { scope, storage, repository: createObjectRepository(storage, scope) }; }
test("personal namespace trials use the account storage without exposing or changing user records", async () => {
  const { scope, storage } = setup();
  const key = "head/user-note"; await storage.commit([{ key, expected: null, row: { key, version: "original", value: "private user content" } }]);
  const sandbox = createTrialStorage(storage, "trial-test");
  await sandbox.commit([{ key, expected: null, row: { key, version: "fixture", value: "fixture copy" } }]);
  expect((await sandbox.list("head/"))[0].value).toBe("fixture copy");
  expect((await storage.get(key))?.value).toBe("private user content");
  await clearTrialStorage(sandbox);
  const files = Object.fromEntries(Object.entries((await paperLensPackage()).files).map(([path, value]) => [path, value.replaceAll("plugin.paper-lens", "plugin.personal-trial")]));
  const draft = await createExtensionDraftStore(storage).create("Personal", files);
  const report = await trialExtension(draft, () => true, scope);
  expect(report.cases.map((item) => item.error)).toEqual([undefined, undefined, undefined]);
  expect(report.passed).toBe(true);
  expect(await storage.list("extension-trial-data/")).toEqual([]);
  expect((await storage.get(key))?.version).toBe("original");
});
test("derived media cards and authorized image files expose actual images without reading binary as Markdown", async () => {
  const { scope, repository } = setup();
  const bytes = new Uint8Array(24); bytes.set([137,80,78,71,13,10,26,10]);
  const staged = await stageImage(bytes, "image/png"), image = await repository.createImage(staged, "Figure");
  const source = liteasyPath(scope, { kind: "object", ref: refOf(image) });
  const block = await repository.createStructuredBlock({ title: "图证卡", text: "证据说明", block: { schema: "liteasy.visual-block/v1", type: { id: "liteasy/MediaBlock", version: "1.0.0" }, data: { text: "证据说明", image: source } }, operationId: "media-test" });
  const readFile = vi.fn();
  const files = { listMounts: async () => [{ id: "vault", name: "Vault" }], listEntries: async () => [{ mountId: "vault", path: "证据.png", name: "证据.png", kind: "file" }], readImage: async () => staged, readFile } as unknown as NoteFileService;
  const assets = createWorkspaceAgentAssetService({ repository, files, active: () => true });
  expect((await assets.resolveImages(liteasyPath(scope, { kind: "object", ref: refOf(block) })))[0].base64).toBe(staged.base64);
  const results = await assets.search({ query: "证据.png" }); expect(results[0].kind).toBe("image");
  expect((await assets.read(results[0].path)).text).toContain("证据.png");
  expect((await assets.resolveImages(results[0].path))[0].base64).toBe(staged.base64);
  expect(readFile).not.toHaveBeenCalled();
  expect((await assets.stat(results[0].path)).capabilities).not.toContain("write");
});
test("declared operators expand into a pinned plan and cannot hide undeclared write capabilities", async () => {
  const files = { ...(await paperLensPackage()).files }, manifest = JSON.parse(files["liteasy.extension.json"]);
  const child = JSON.parse(files["workflows/compare.json"] ?? files[manifest.contributes.workflows[0].path]);
  manifest.contributes.operators = [{ id: "analyze", path: "operators/analyze.json" }];
  files["operators/analyze.json"] = JSON.stringify(child);
  const parent = { ...child, nodes: [{ id: "sub", title: "子操作", operation: { id: `${manifest.id}/analyze`, version: child.version }, input: { value: { source: "input", path: "" } } }], edges: [], output: { source: "node", nodeId: "sub", path: "" } };
  files[manifest.contributes.workflows[0].path] = JSON.stringify(parent);
  files["liteasy.extension.json"] = JSON.stringify(manifest);
  const pkg = await validateExtensionPackage(await buildExtensionPackage(files));
  const compiled = compileExtensionWorkflow(pkg, manifest.contributes.workflows[0].path);
  expect(compiled.capabilities).toContain("resources.create");
  expect(compiled.definition.nodes.some((node) => node.operation.id === "boards.compose")).toBe(true);
  manifest.permissions = manifest.permissions.filter((item: { capability: string }) => item.capability !== "resources.create");
  files["liteasy.extension.json"] = JSON.stringify(manifest);
  await expect(validateExtensionPackage(await buildExtensionPackage(files))).rejects.toThrow("能力声明");
});

test("portable Canvas contains real attachments and retains structured data unless the external text changes", async () => {
  const { repository } = setup();
  const bytes = new Uint8Array(24); bytes.set([137,80,78,71,13,10,26,10]);
  const image = await repository.createImage(await stageImage(bytes, "image/png"), "image");
  let board = await repository.create({ title: "带图比较", kind: "workspace.board", content: { schema: "liteasy.board/v1", payload: { description: "" } } });
  const data = { text: "$E=mc^2$", image: liteasyPath(repository.scopeId, { kind: "object", ref: refOf(image) }) };
  const { projectBlockText } = await import("../app/features/visual-blocks/blockRegistry");
  await repository.createStructuredBlock({ title: "证据", text: projectBlockText(data), boardRef: refOf(board), block: { schema: "liteasy.visual-block/v1", type: { id: "liteasy/MediaBlock", version: "1.0.0" }, data }, operationId: "archive" });
  board = await repository.resolveLatest(board.objectId);
  const { createCanvasArchive } = await import("../app/features/boards/canvasArchive");
  const blob = await createCanvasArchive(board, repository, createWorkspaceAgentAssetService({ repository, active: () => true }));
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
  const { unzipSync, strFromU8 } = await import("fflate"); const files = unzipSync(new Uint8Array(buffer));
  expect(Object.keys(files).filter((path) => path.startsWith("attachments/"))).toHaveLength(1);
  const { parseCanvasFile, prepareCanvasImport } = await import("../app/features/boards/boardFileFormat");
  const document = parseCanvasFile(strFromU8(files["board.canvas"]));
  const imported = await prepareCanvasImport({ document, repository, file: { mountId: "vault", path: "board.canvas", name: "board.canvas", version: null, text: "" }, readFile: vi.fn() });
  expect(imported.nodes[0].structured?.data.image).toMatch(/^attachments\//);
  expect(imported.nodes[0].attachmentBase).toEqual({ mountId: "vault", path: "board.canvas" });
  document.nodes[0].text += "\n外部改动";
  const edited = await prepareCanvasImport({ document, repository, file: { mountId: "vault", path: "board.canvas", name: "board.canvas", version: null, text: "" }, readFile: vi.fn() });
  expect(edited.nodes[0].structured).toBeUndefined();
  expect(edited.nodes[0].draft?.content.payload).toHaveProperty("text", expect.stringContaining("外部改动"));
});

test("embedded exact dependencies are verified, and mismatched digests do not install", async () => {
  const dependency = await validateExtensionPackage(await paperLensPackage());
  const files = {
    "liteasy.extension.json": JSON.stringify({ apiVersion: "liteasy.extension/v2", id: "plugin.dependent", name: "Dependent", version: "1.0.0", engines: { extensionApi: "2.0.0" }, dependencies: [{ id: dependency.manifest.id, version: dependency.manifest.version, digest: dependency.digest, path: "dependencies/paper.json" }], contributes: {} }),
    "dependencies/paper.json": JSON.stringify(dependency.bundle),
  };
  const parent = await validateExtensionPackage(await buildExtensionPackage(files));
  expect(parent.blocks).toEqual(dependency.blocks);
  const manifest = JSON.parse(files["liteasy.extension.json"]); manifest.dependencies[0].digest = "0".repeat(64); files["liteasy.extension.json"] = JSON.stringify(manifest);
  await expect(validateExtensionPackage(await buildExtensionPackage(files))).rejects.toThrow("摘要不符");
});

test("settings migration previews incompatible fields and atomically retains the prior record", async () => {
  const { storage } = setup();
  const { createExtensionWorkspaceStore } = await import("../app/features/extensions/extensionWorkspaceStore");
  const workspace = createExtensionWorkspaceStore(storage);
  const before = { type: "object" as const, additionalProperties: false as const, properties: { oldName: { type: "string" as const } } };
  await workspace.saveConfiguration("plugin.settings", "group", before, "profile", { oldName: "preserved" }, null);
  const next = { type: "object" as const, additionalProperties: false as const, properties: { interval: { type: "integer" as const, minimum: 1, default: 7 } } };
  const preview = await workspace.previewMigration("plugin.settings", "group", next, "profile");
  expect(preview.dropped).toEqual(["oldName"]);
  await workspace.saveConfiguration("plugin.settings", "group", next, "profile", preview.values, preview.revision);
  expect((await workspace.readConfiguration("plugin.settings", "group", next)).effective).toEqual({ interval: 7 });
  expect((await storage.list("extension-config-history/"))[0].value).toMatchObject({ values: { oldName: "preserved" } });
});

test("a contributed Markdown editor uses real revision writes and keeps a draft after a conflicting external edit", async () => {
  const { render, screen, fireEvent, waitFor } = await import("@testing-library/react");
  const { VisualAssetContext } = await import("../app/features/visual-blocks/AssetImage");
  const { ComponentTreeView } = await import("../app/features/visual-blocks/ComponentTreeView");
  const { repository, scope } = setup();
  const note = await repository.create({ title: "Editable", kind: "content.note", content: { schema: "liteasy.note/v1", payload: { text: "source", origin: "user" } } });
  const path = liteasyPath(scope, { kind: "object", ref: refOf(note), followLatest: true });
  const assets = createWorkspaceAgentAssetService({ repository, active: () => true });
  const ui = () => <VisualAssetContext.Provider value={assets}><ComponentTreeView tree={{ component: "MarkdownEditor", props: { path } }} data={{}} /></VisualAssetContext.Provider>;
  const view = render(ui());
  fireEvent.click(screen.getByRole("button", { name: "读取笔记" }));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "扩展中的 Markdown 笔记" })).toHaveValue("source"));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "my draft" } });
  await repository.editNote(refOf(note), "external change");
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("草稿仍保留"));
  view.unmount(); render(ui());
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("my draft"));
  fireEvent.click(screen.getByRole("button", { name: "读取笔记" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("源文已变化"));
  expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
  expect((await repository.resolveLatest(note.objectId)).content.payload).toHaveProperty("text", "external change");
});


test("editor working copies survive module restart and do not evict earlier unsaved files", async () => {
  const { visualEditorDrafts } = await import("../app/features/visual-blocks/visualEditorDrafts");
  const scope = crypto.randomUUID();
  const paths = Array.from({ length: 40 }, (_, index) => `liteasy://objects/draft-${index}?scope=${scope}`);
  paths.forEach((path, index) => visualEditorDrafts.save(path, { revision: `v${index}`, text: `unsaved ${index}` }));
  expect(visualEditorDrafts.get(paths[0])?.text).toBe("unsaved 0");
  expect(JSON.parse(localStorage.getItem(`liteasy.visual-editor-draft.v1:${paths[0]}`)!).text).toBe("unsaved 0");
  expect(visualEditorDrafts.get(paths[0].replace(scope, "another-user"))).toBeUndefined();
  paths.forEach((path) => visualEditorDrafts.remove(path));
});
