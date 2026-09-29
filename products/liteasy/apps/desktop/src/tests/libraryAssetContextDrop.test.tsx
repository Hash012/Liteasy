import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { LibraryPane, type LibraryPaperChildItem } from "../app/features/library/LibraryPane";
import { useObjectWorkbenchController } from "../app/controllers/useObjectWorkbenchController";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createPaperProjectRepository } from "../app/features/paper-projects/paperProjectRepository";
import { createReadingLibraryRepository } from "../app/features/reading-library/readingLibraryRepository";
import { stageImage } from "../app/features/objects/objectAssets";
import { liteasyPath } from "../app/features/resource-filesystem/liteasyPath";
import { hasResourceContextTransfer, readContextPaper } from "../app/features/object-transfer/contextTransfer";
import { writeAssetContextTransfer } from "../app/features/object-transfer/assetContextTransfer";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
function transfer() {
  const values = new Map<string, string>();
  return { getData: (type: string) => values.get(type) ?? "", setData: (type: string, value: string) => values.set(type, value),
    get types() { return [...values.keys()]; }, effectAllowed: "none" } as unknown as DataTransfer;
}

test("library note, board, extracted text/images and ebook rows drag through the real context service", async () => {
  const scopeId = `user:${crypto.randomUUID()}`;
  const paper = { id: "cicada", title: "Cicada", sourcePath: "/library/Research/cicada.pdf" };
  const { result } = renderHook(() => useObjectWorkbenchController({ scopeId, getApi: () => { throw new Error("No model expected"); },
    getPapers: () => [paper], getSettings: () => createSettingsStore().getState(), openEvidence: vi.fn() }));
  const storage = createObjectStorage(scopeId, () => scopeId);
  const projects = createPaperProjectRepository(storage, scopeId);
  const project = await projects.ensurePaperProject({ paperId: paper.id, title: paper.title });
  const note = await projects.createNote(project.projectId, "# CicN\n\nActual saved Markdown", "CicN");
  const board = await projects.createBoard(project.projectId, "Cicada Board");
  await projects.registerSource(project.projectId, { assetId: "text:page:1", kind: "text", paperId: paper.id,
    title: "Cicada page 1", page: 1, text: "Optimistic concurrency control in transactions." });
  const image = await stageImage(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]), "image/png");
  await projects.registerSource(project.projectId, { assetId: "image:figure1", kind: "image", paperId: paper.id,
    title: "Cicada architecture", page: 1, text: "An architecture figure", assets: [image] });
  const imported = await createReadingLibraryRepository(storage, scopeId).importFile("Transactions.epub", new TextEncoder().encode("ebook-source"), {
    format: "epub", title: "Transactions Handbook", authors: ["Researcher"], resources: [], toc: [], warnings: [],
    chapters: [{ id: "chapter-1", title: "Transactions", content: "A serializable database", plainText: "A serializable database", format: "text" }],
  });
  const children: LibraryPaperChildItem[] = [
    { id: note.assetId, kind: "note", label: "CicN", objectId: note.ref!.objectId },
    { id: board.assetId, kind: "board", label: "Cicada Board", objectId: board.ref!.objectId },
    { id: "text", kind: "extracted_text", label: "提取文本" },
    { id: "figures", kind: "figures", label: "插图" },
    { id: "multimodal", kind: "multimodal", label: "图文版" },
  ];
  render(<FluentProvider theme={webLightTheme}><LibraryPane contextScopeId={scopeId} accountSessionAvailable={false}
    canOpenOrganizationWorkspace={false} cloudEndpoint="" importJobs={{}} papers={[paper]} paperChildren={{ [paper.id]: children }}
    localLibrarySnapshot={{ rootPath: "/library", libraryId: "library", revision: 1, trashEntries: [],
      folders: [{ name: "Research", path: "/library/Research", parentPath: null }],
      entries: [{ id: paper.id, title: paper.title, path: paper.sourcePath, relativePath: "Research/cicada.pdf", contentHash: "hash" }] }}
    recommendationItems={[]} recommendationMessage="" recommendationPending={false} recommendationStatus="ready"
    onClearRecommendations={vi.fn()} onDismissRecommendation={vi.fn()} onOpenOrganizationWorkspace={vi.fn()}
    onReturnToLocalWorkspace={vi.fn()} onToggleLock={vi.fn()} onToggleSelection={vi.fn()}
    selectedPaperIds={[]} selectionLocked={false} workspaceLabel="本地文献库" workspaceSourceType="local_library"
    fileLibrary={{ entries: [{ ...imported.entry, liteasyPath: liteasyPath(scopeId, { kind: "object", ref: imported.entry.ref, followLatest: true }) }],
      pending: false, message: "", onImport: vi.fn(), onInspect: vi.fn(), onOpen: vi.fn() }}
  /></FluentProvider>);
  fireEvent.click(screen.getByRole("button", { name: "展开Research" }));
  const paperRow = screen.getByRole("button", { name: "Cicada", exact: true }).closest(".library-paper-row")!;
  expect(paperRow).toHaveStyle({ paddingInlineStart: "24px" });
  fireEvent.click(screen.getByRole("button", { name: "展开 Cicada 的 5 个附件" }));
  const expected = ["Actual saved Markdown", "白板结构", "Optimistic concurrency control", "An architecture figure", "Optimistic concurrency control", "A serializable database"];
  for (const [index, label] of [...children.map((child) => `打开论文文件：${child.label}`), "选择文件 Transactions Handbook"].entries()) {
    const data = transfer();
    const row = screen.getByRole("button", { name: label, exact: true });
    expect(row).toHaveAttribute("draggable", "true");
    fireEvent.dragStart(row, { dataTransfer: data });
    expect(hasResourceContextTransfer(data)).toBe(true);
    expect(readContextPaper(data, [paper])).toBeNull();
    let attachments: Awaited<ReturnType<NonNullable<typeof result.current.port.receiveContextDrop>>> = [];
    await act(async () => { attachments = await result.current.port.receiveContextDrop!(data); });
    expect(attachments).toHaveLength(1);
    const reads = await Promise.all(attachments[0].refs.map((ref) => result.current.agentAssets.read(liteasyPath(scopeId, { kind: "object", ref }))));
    expect(reads.map((read) => read.text).join("\n")).toContain(expected[index]);
    if (index === 3 || index === 4) {
      const imageInputs = await Promise.all(attachments[0].refs.map((ref) => result.current.agentAssets.resolveImages(liteasyPath(scopeId, { kind: "object", ref }))));
      expect(imageInputs.flat()).toHaveLength(1);
    }
  }
  expect(result.current.visible).toBe(false);
  expect(result.current.placements).toHaveLength(0);
});

test("a long extracted-paper collection uses one context ref and reads every page through bounded chunks", async () => {
  const scopeId = crypto.randomUUID(), paper = { id: "long-paper", title: "Long methods paper" };
  const { result } = renderHook(() => useObjectWorkbenchController({ scopeId, getApi: () => { throw new Error("No model expected"); },
    getPapers: () => [paper], getSettings: () => createSettingsStore().getState(), openEvidence: vi.fn() }));
  const projects = createPaperProjectRepository(createObjectStorage(scopeId, () => scopeId), scopeId);
  const project = await projects.ensurePaperProject({ paperId: paper.id, title: paper.title });
  for (let page = 1; page <= 51; page += 1) await projects.registerSource(project.projectId, { assetId: `page:${page}`, kind: "text",
    paperId: paper.id, title: `Method page ${page}`, page, text: `EVIDENCE-PAGE-${page} ${"Detailed research evidence. ".repeat(10)}` });
  const data = transfer();
  writeAssetContextTransfer(data, scopeId, { kind: "paper-resource", paperId: paper.id, resourceKind: "extracted_text" }, paper.title);
  const [attachment] = await result.current.port.receiveContextDrop!(data);
  expect(attachment.refs).toHaveLength(1);
  const source = await result.current.repository.get(attachment.ref);
  expect(source.provenance.sourceRefs).toHaveLength(51);
  const path = liteasyPath(scopeId, { kind: "object", ref: attachment.ref });
  const chunks: string[] = [];
  let offset = 0;
  do {
    const read = await result.current.agentAssets.read(path, { offset, maxCharacters: 1000 });
    expect(read.text.length).toBeLessThanOrEqual(1000);
    chunks.push(read.text);
    if (read.nextOffset === undefined) break;
    offset = read.nextOffset;
  } while (chunks.length < 100);
  for (let page = 1; page <= 51; page += 1) expect(chunks.join("")).toContain(`EVIDENCE-PAGE-${page} `);
  expect(chunks.join("")).toContain("来源：[《Method page 51》](liteasy://objects/");
  expect((await result.current.agentAssets.stat(path)).capabilities).not.toContain("write");
});

test("asset drag rejects another account before resolving an object or paper collection", async () => {
  const scopeId = crypto.randomUUID();
  const { result } = renderHook(() => useObjectWorkbenchController({ scopeId, getApi: () => { throw new Error("No model expected"); },
    getPapers: () => [], getSettings: () => createSettingsStore().getState(), openEvidence: vi.fn() }));
  const data = transfer();
  writeAssetContextTransfer(data, "another-account", { kind: "paper-resource", paperId: "cicada", resourceKind: "figures" }, "Figures");
  await expect(result.current.port.receiveContextDrop!(data)).rejects.toThrow("其他账号");
  writeAssetContextTransfer(data, scopeId, { kind: "path", path: "liteasy://objects/unknown?scope=another-account" }, "Note");
  await expect(result.current.port.receiveContextDrop!(data)).rejects.toThrow("账号");
});

test("an oversized image group retains every source while asking for individual image reads", async () => {
  const scopeId = crypto.randomUUID(), paper = { id: "illustrated-paper", title: "Illustrated research" };
  const { result } = renderHook(() => useObjectWorkbenchController({ scopeId, getApi: () => { throw new Error("No model expected"); },
    getPapers: () => [paper], getSettings: () => createSettingsStore().getState(), openEvidence: vi.fn() }));
  const projects = createPaperProjectRepository(createObjectStorage(scopeId, () => scopeId), scopeId);
  const project = await projects.ensurePaperProject({ paperId: paper.id, title: paper.title });
  for (let page = 1; page <= 13; page += 1) {
    const image = await stageImage(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, page, 2, 3, 4]), "image/png");
    await projects.registerSource(project.projectId, { assetId: `image:${page}`, kind: "image", paperId: paper.id,
      title: `Research figure ${page}`, page, text: `Figure evidence ${page}`, assets: [image] });
  }
  const readBinary = vi.spyOn(result.current.repository, "readAsset");
  const data = transfer();
  writeAssetContextTransfer(data, scopeId, { kind: "paper-resource", paperId: paper.id, resourceKind: "figures" }, paper.title);
  const [attachment] = await result.current.port.receiveContextDrop!(data);
  expect(attachment.refs).toHaveLength(1);
  const path = liteasyPath(scopeId, { kind: "object", ref: attachment.ref });
  const read = await result.current.agentAssets.read(path);
  expect(read.text).toContain("未加载图片像素");
  expect(read.text).toContain("Figure evidence 13");
  expect(await result.current.agentAssets.resolveImages(path)).toEqual([]);
  expect(readBinary).not.toHaveBeenCalled();
  const [lastImage] = await result.current.agentAssets.search({ query: "Research figure 13" });
  expect(await result.current.agentAssets.resolveImages(lastImage.path)).toHaveLength(1);
});

test("rejects oversized resource snapshots explicitly instead of truncating later pages", async () => {
  const scopeId = crypto.randomUUID(), paper = { id: "huge-paper", title: "Huge paper" };
  const { result } = renderHook(() => useObjectWorkbenchController({ scopeId, getApi: () => { throw new Error("No model expected"); },
    getPapers: () => [paper], getSettings: () => createSettingsStore().getState(), openEvidence: vi.fn() }));
  const projects = createPaperProjectRepository(createObjectStorage(scopeId, () => scopeId), scopeId);
  const project = await projects.ensurePaperProject({ paperId: paper.id, title: paper.title });
  for (let page = 1; page <= 2; page += 1) await projects.registerSource(project.projectId, { assetId: `huge-text-${page}`, kind: "text",
    paperId: paper.id, title: `Huge source page ${page}`, page, text: "a".repeat(4 * 1024 * 1024) });
  const data = transfer();
  writeAssetContextTransfer(data, scopeId, { kind: "paper-resource", paperId: paper.id, resourceKind: "extracted_text" }, paper.title);
  await expect(result.current.port.receiveContextDrop!(data)).rejects.toThrow("尚未省略或截断任何原文");
  expect(await result.current.agentAssets.search({ query: "Huge paper · 提取文本" })).toEqual([]);
});
