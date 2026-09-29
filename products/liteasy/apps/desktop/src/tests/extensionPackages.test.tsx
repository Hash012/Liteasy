import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { refOf, objectText } from "../app/features/objects/object.types";
import { createExtensionPackageStore } from "../app/features/extensions/extensionPackageStore";
import { buildExtensionPackage, validateExtensionPackage } from "../app/features/extensions/extensionPackage";
import { paperLensPackage } from "../app/features/extensions/paperLensPackage";
import { createBlockRegistry, projectBlockText } from "../app/features/visual-blocks/blockRegistry";
import { DerivedBlockContent } from "../app/features/visual-blocks/DerivedBlockContent";
import { parseCanvasFile, prepareCanvasImport, serializeCanvasFile } from "../app/features/boards/boardFileFormat";
import { boundedJson, parseDataSchema, validateSchemaValue } from "../app/features/extensions/extensionSchema";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
function fixture() { const scope = crypto.randomUUID(); const storage = createObjectStorage(scope, () => scope); return { scope, storage, repository: createObjectRepository(storage, scope), store: createExtensionPackageStore(storage) }; }

test("a real package survives restart, requires explicit enable, rejects changed immutable versions and can be disabled", async () => {
  const f = fixture(); const bundle = await paperLensPackage();
  await f.store.install(bundle);
  expect((await f.store.active()).packages).toHaveLength(0);
  let [state] = await f.store.list();
  await f.store.enable(state.id, true, state.revision);
  const reopened = createExtensionPackageStore(createObjectStorage(f.scope, () => f.scope));
  const active = await reopened.active();
  expect(active.registry.resolve("plugin.paper-lens/reasoning-card", "1.0.0").templates.map((item) => item.component)).toEqual(["MarkdownView", "Card"]);
  const changed = { ...bundle.files, "new.txt": "modified" };
  [state] = await reopened.list();
  await expect(reopened.install(await buildExtensionPackage(changed), state.revision)).rejects.toThrow("版本");
  await reopened.enable(state.id, false, state.revision);
  expect((await reopened.active()).registry.list()).toHaveLength(5);
  expect((await reopened.get(state.id, state.version)).digest).toBe(active.packages[0].digest);
});

test("tampered bytes, Windows casing collisions, traversal and inherited field replacement are rejected", async () => {
  const original = await paperLensPackage();
  const bad = structuredClone(original); bad.files["blocks/reasoning-card.json"] += " ";
  await expect(validateExtensionPackage(bad)).rejects.toThrow("摘要");
  await expect(validateExtensionPackage(await buildExtensionPackage({ ...original.files, "Blocks/reasoning-card.json": "{}" }))).rejects.toThrow("大小写");
  await expect(buildExtensionPackage({ "../escape.json": "{}" })).rejects.toThrow();
  const files = { ...original.files };
  const block = JSON.parse(files["blocks/reasoning-card.json"]);
  block.dataSchema.properties.text = { type: "number" };
  files["blocks/reasoning-card.json"] = JSON.stringify(block);
  await expect(validateExtensionPackage(await buildExtensionPackage(files))).rejects.toThrow("覆盖基类");
  block.dataSchema.properties = {}; block.base = { id: block.id, version: block.version };
  files["blocks/reasoning-card.json"] = JSON.stringify(block);
  await expect(validateExtensionPackage(await buildExtensionPackage(files))).rejects.toThrow("循环");
});

test("derived content saves actual data, renders inherited math and keeps a readable fallback after disable and Canvas import", async () => {
  const f = fixture(); const pkg = await validateExtensionPackage(await paperLensPackage());
  const registry = createBlockRegistry(pkg.blocks);
  const data = registry.instantiate("plugin.paper-lens/reasoning-card", "1.0.0", { text: "## 核心推理\n\n$x^2$", evidence: "论文第一节" });
  const block = { schema: "liteasy.visual-block/v1" as const, type: { id: "plugin.paper-lens/reasoning-card", version: "1.0.0" }, data };
  const board = await f.repository.importBoardFile({ title: "实际比较板", operationId: "template", edges: [], nodes: [{ id: "reasoning", structured: block, position: { x: 20, y: 30 }, size: { width: 320, height: 400 }, draft: { kind: "content.note", title: "推理", content: { schema: "liteasy.note/v1", payload: { text: projectBlockText(data), origin: "user" } } } }] });
  const placements = await f.repository.listPlacements(board.objectId);
  const object = await f.repository.get(placements[0].ref);
  const { container, rerender } = render(<DerivedBlockContent object={object} repository={f.repository} registry={registry} openPath={vi.fn()} />);
  await waitFor(() => expect(container.querySelector('[data-block-type="plugin.paper-lens/reasoning-card"]')).not.toBeNull());
  expect(screen.getByRole("heading", { name: "核心推理" })).toBeInTheDocument();
  expect(container.querySelector(".katex")).not.toBeNull();
  rerender(<DerivedBlockContent object={object} repository={f.repository} registry={createBlockRegistry()} openPath={vi.fn()} />);
  expect(screen.getByText("此组件版本未启用，显示已保存的内容。")).toBeInTheDocument();
  expect(objectText(object)).toContain("论文第一节");
  const document = parseCanvasFile(await serializeCanvasFile({ board, repository: f.repository, placements, edges: [] }));
  const foreign = fixture();
  const prepared = await prepareCanvasImport({ document, repository: foreign.repository, file: { mountId: "vault", path: "board.canvas", name: "board.canvas", version: null, text: JSON.stringify(document) }, readFile: vi.fn() });
  const imported = await foreign.repository.importBoardFile({ ...prepared, title: "导入", operationId: "import" });
  expect(await foreign.repository.getStructuredBlock((await foreign.repository.listPlacements(imported.objectId))[0].ref)).toEqual(block);
  expect(await f.repository.getStructuredBlock(refOf(object))).toEqual(block);
  document.nodes[0].text = "用户在其他应用修改后的正文";
  const changed = await prepareCanvasImport({ document, repository: foreign.repository, file: { mountId: "vault", path: "changed.canvas", name: "changed.canvas", version: null, text: JSON.stringify(document) }, readFile: vi.fn() });
  const updated = await foreign.repository.importBoardFile({ ...changed, title: "外部修改", operationId: "external" });
  const [externalPlacement] = await foreign.repository.listPlacements(updated.objectId);
  expect(await foreign.repository.getStructuredBlock(externalPlacement.ref)).toBeUndefined();
  expect(objectText(await foreign.repository.get(externalPlacement.ref))).toBe("用户在其他应用修改后的正文");
});

test("schema validation is bounded and rejects undeclared data and executable expressions", () => {
  const schema = parseDataSchema({ type: "object", properties: { count: { type: "integer", minimum: 1, maximum: 3 } }, required: ["count"], additionalProperties: false });
  expect(validateSchemaValue(schema, { count: 2 })).toEqual({ count: 2 });
  expect(() => validateSchemaValue(schema, { count: 4 })).toThrow();
  expect(() => validateSchemaValue(schema, { count: 2, hidden: true })).toThrow();
  expect(() => parseDataSchema({ type: "string", pattern: "(a+)+$" })).toThrow("关键字");
  expect(() => boundedJson(JSON.parse('{"__proto__":{"admin":true}}'))).toThrow("保留字段");
});
