import "fake-indexeddb/auto";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { StudioCardPreview } from "../app/features/workflow-studio/StudioCardPreview";
import { studioTutorialFiles } from "../app/features/workflow-studio/studioTutorial";
import { editStudioFiles, parseStudioFile, travelStudioHistory } from "../app/features/workflow-studio/studioEditing";
import { buildExtensionPackage, validateExtensionPackage, type BoardTemplate } from "../app/features/extensions/extensionPackage";
import { createExtensionDraftStore } from "../app/features/workflow-studio/extensionDraftStore";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { VisualAssetContext } from "../app/features/visual-blocks/AssetImage";
import { ComponentTreeView } from "../app/features/visual-blocks/ComponentTreeView";
import { VisualPreviewContext } from "../app/features/visual-blocks/visualPreviewContext";
import type { AgentAssetService } from "../app/features/resource-filesystem/agentAssetService";

test("offline four-card demo uses real Markdown, table and untrusted-reference placeholders", async () => {
  const files = await studioTutorialFiles();
  const pkg = await validateExtensionPackage(await buildExtensionPackage(files));
  expect(pkg.templates[0].cards).toHaveLength(4);
  render(<>{pkg.templates[0].cards.map((card) => <StudioCardPreview key={card.id} card={card} blocks={pkg.blocks} />)}</>);
  expect(screen.getByRole("heading", { name: "演示数据：研究问题" })).toBeInTheDocument();
  expect(screen.getByRole("table")).toHaveTextContent("方法 A");
  expect(screen.getByText(/预览未授权读取此资源/)).toBeInTheDocument();
});
test("preview cannot inherit remote images, resource reading, editing or navigation", () => {
  const read = vi.fn(), resolveImages = vi.fn(), search = vi.fn(), write = vi.fn();
  const assets = { read, resolveImages, search, write } as unknown as AgentAssetService;
  const card: BoardTemplate["cards"][number] = { id: "test", title: "Test", type: { id: "liteasy/MediaBlock", version: "1.0.0" }, data: { text: "![tracker](https://example.invalid/pixel.png) [link](https://example.invalid/) [private](liteasy://private/resource)", image: "liteasy://private/image" }, position: { x: 0, y: 0 }, size: { width: 320, height: 200 } };
  render(<VisualAssetContext.Provider value={assets}><StudioCardPreview card={card} /><VisualPreviewContext.Provider value={true}><ComponentTreeView tree={{ component: "MarkdownEditor", props: { path: "liteasy://private/note" } }} data={{}} /><ComponentTreeView tree={{ component: "ResourcePicker" }} data={{}} /></VisualPreviewContext.Provider></VisualAssetContext.Provider>);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "读取笔记" })).not.toBeInTheDocument();
  expect(read).not.toHaveBeenCalled(); expect(resolveImages).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled();
});
test("missing types remain explicit and preserve editable original data", () => {
  render(<StudioCardPreview card={{ id: "missing", title: "Missing", type: { id: "plugin.missing/Type", version: "1.0.0" }, data: { text: "保留内容" }, position: { x: 0, y: 0 }, size: { width: 320, height: 200 } }} />);
  expect(screen.getByRole("status")).toHaveTextContent("缺少组件版本");
  expect(screen.getByRole("status")).toHaveTextContent("原始内容仍保留");
});
test("canonical edit, move, delete, undo, redo and reload use the same draft storage", async () => {
  const files = await studioTutorialFiles(), path = "templates/comparison.json";
  const scope = crypto.randomUUID(), storage = createObjectStorage(scope, () => scope), drafts = createExtensionDraftStore(storage);
  const draft = await drafts.create("Demo", files);
  const board = parseStudioFile(path, files[path]) as BoardTemplate;
  const edited = { ...board, cards: board.cards.map((card, index) => index ? card : { ...card, data: { ...card.data, text: "持久化新正文" }, position: { x: 123, y: 456 } }) };
  let state = editStudioFiles({ files, past: [], future: [] }, { ...files, [path]: JSON.stringify(edited) });
  state = editStudioFiles(state, { ...state.files, [path]: JSON.stringify({ ...edited, cards: edited.cards.slice(0, 3) }) });
  state = travelStudioHistory(state, "undo");
  expect((parseStudioFile(path, state.files[path]) as BoardTemplate).cards).toHaveLength(4);
  state = travelStudioHistory(state, "redo");
  await drafts.patch(draft.id, draft.revision, [{ path, text: state.files[path] }], "user");
  const reloaded = createExtensionDraftStore(storage);
  const saved = parseStudioFile(path, (await reloaded.get(draft.id)).files[path]) as BoardTemplate;
  expect(saved.cards).toHaveLength(3); expect(saved.cards[0].position).toEqual({ x: 123, y: 456 }); expect(saved.cards[0].data.text).toBe("持久化新正文");
});

test("a derived type can reference another project type during source editing", () => {
  const child = { id: "plugin.demo/Child", version: "1.0.0", title: "Child", base: { id: "plugin.demo/Parent", version: "1.0.0" }, dataSchema: { type: "object", properties: {}, additionalProperties: false }, defaults: {} };
  expect(parseStudioFile("blocks/child.json", JSON.stringify(child))).toEqual(child);
});
