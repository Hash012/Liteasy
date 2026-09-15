import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { refOf, objectText } from "../app/features/objects/object.types";
import {
  parseCanvasFile,
  prepareCanvasImport,
  serializeCanvasFile,
  connectionPoint,
} from "../app/features/boards/boardFileFormat";
import { stageImage } from "../app/features/objects/objectAssets";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});
const raw = {
  custom: { retained: true },
  nodes: [
    {
      id: "a",
      type: "text",
      x: -300,
      y: -40,
      width: 240,
      height: 120,
      text: "用户笔记\n\n## AI review\n可编辑的评审",
      color: "2",
    },
    {
      id: "b",
      type: "text",
      x: 20,
      y: 100,
      width: 240,
      height: 120,
      text: "另一条笔记",
    },
  ],
  edges: [
    {
      id: "link",
      fromNode: "a",
      toNode: "b",
      fromSide: "right",
      toSide: "left",
      label: "知识关联",
      color: "3",
    },
  ],
};
async function fixture(document = parseCanvasFile(JSON.stringify(raw))) {
  const scope = crypto.randomUUID();
  const storage = createObjectStorage(scope, () => scope);
  const repository = createObjectRepository(storage, scope);
  const file = {
    mountId: "vault",
    name: "研究.canvas",
    path: "研究.canvas",
    text: JSON.stringify(document),
    version: "original",
  };
  const prepared = await prepareCanvasImport({
    document,
    repository,
    file,
    readFile: vi.fn(),
  });
  const board = await repository.importBoardFile({
    title: "研究",
    ...prepared,
    operationId: crypto.randomUUID(),
  });
  return {
    scope,
    storage,
    repository,
    board,
    file,
    document,
    reopen: () =>
      createObjectRepository(
        createObjectStorage(scope, () => scope),
        scope,
      ),
  };
}
test("Canvas import persists cards and knowledge links atomically and roundtrips endpoints, negative coordinates and extension fields", async () => {
  const f = await fixture();
  const repository = f.reopen();
  const placements = await repository.listPlacements(f.board.objectId);
  expect(placements.find((p) => p.placementId === "a")?.position).toEqual({
    x: 0,
    y: 0,
  });
  const edges = await repository.listEdges(f.board.objectId);
  expect(edges).toEqual([
    expect.objectContaining({
      fromSide: "right",
      toSide: "left",
      label: "知识关联",
    }),
  ]);
  const relations = await repository.listBoardRelations(f.board.objectId);
  expect(relations).toEqual([
    expect.objectContaining({
      predicate: "related_to",
      reviewStatus: "accepted",
    }),
  ]);
  const text = await serializeCanvasFile({
    board: f.board,
    repository,
    placements,
    edges,
    binding: {
      ...f.file,
      savedRevision: f.board.revision,
      document: f.document,
    },
  });
  const saved = JSON.parse(text);
  expect(saved.custom).toEqual(raw.custom);
  expect(saved.nodes[0]).toMatchObject(raw.nodes[0]);
  expect(saved.edges[0]).toMatchObject(raw.edges[0]);
  expect(saved.nodes[0].text).toContain("AI review");
});
test("drag-created connections check current placement versions and remove their knowledge link with a card", async () => {
  const f = await fixture(
    parseCanvasFile(JSON.stringify({ ...raw, edges: [] })),
  );
  const [a, b] = await f.repository.listPlacements(f.board.objectId);
  const input = {
    boardRef: refOf(f.board),
    from: {
      placementId: a.placementId,
      revision: a.revision,
      side: "top" as const,
    },
    to: {
      placementId: b.placementId,
      revision: b.revision,
      side: "bottom" as const,
    },
    operationId: "connect",
  };
  await expect(
    f.repository.connectPlacements({
      ...input,
      from: { ...input.from, revision: "stale" },
    }),
  ).rejects.toMatchObject({ code: "revision_conflict" });
  expect(await f.repository.listEdges(f.board.objectId)).toEqual([]);
  const [next] = await f.repository.connectPlacements(input);
  await f.repository.connectPlacements(input);
  expect(await f.reopen().listEdges(f.board.objectId)).toHaveLength(1);
  expect(await f.reopen().listBoardRelations(f.board.objectId)).toHaveLength(1);
  await f.repository.applyBoardPatch({
    boardRef: next,
    remove: [a.placementId],
    operationId: "remove-card",
  });
  expect(await f.reopen().listEdges(f.board.objectId)).toEqual([]);
  expect(await f.reopen().listBoardRelations(f.board.objectId)).toEqual([]);
  expect(await f.repository.get(a.ref)).toBeDefined();
});
test("invalid imported edge rolls back every card and object", async () => {
  const f = await fixture();
  const before = (await f.repository.search()).objects.length;
  await expect(
    f.repository.importBoardFile({
      title: "Invalid",
      operationId: "invalid",
      nodes: [
        {
          id: "x",
          position: { x: 0, y: 0 },
          size: { width: 240, height: 120 },
          draft: {
            title: "not saved",
            kind: "content.note",
            content: {
              schema: "liteasy.note/v1",
              payload: { text: "not saved", origin: "user" },
            },
          },
        },
      ],
      edges: [{ edgeId: "bad", from: "x", to: "missing", kind: "related_to" }],
    }),
  ).rejects.toMatchObject({ code: "unsupported_schema" });
  expect((await f.repository.search()).objects).toHaveLength(before);
});
test("external file cards read Markdown first and share its stable Notes projection", async () => {
  const f = await fixture();
  const document = parseCanvasFile(
    JSON.stringify({
      nodes: [
        {
          id: "file",
          type: "file",
          file: "papers/review.md",
          x: 0,
          y: 0,
          width: 240,
          height: 120,
        },
      ],
    }),
  );
  const readFile = vi.fn().mockResolvedValue({
    mountId: "vault",
    path: "papers/review.md",
    name: "review.md",
    text: "# 笔记\n\nAI review 正文",
    version: "md-v1",
  });
  const prepared = await prepareCanvasImport({
    document,
    repository: f.repository,
    file: f.file,
    readFile,
  });
  expect(readFile).toHaveBeenCalledWith("vault", "papers/review.md");
  const ref = prepared.nodes[0].ref!;
  expect(objectText(await f.repository.get(ref))).toContain("AI review 正文");
  const board = await f.repository.importBoardFile({
    title: "Files",
    ...prepared,
    operationId: "file-board",
  });
  const common = {
    board,
    repository: f.repository,
    placements: await f.repository.listPlacements(board.objectId),
    edges: [],
  };
  expect(
    JSON.parse(
      await serializeCanvasFile({ ...common, destinationMountId: "vault" }),
    ).nodes[0],
  ).toMatchObject({ type: "file", file: "papers/review.md" });
  expect(JSON.parse(await serializeCanvasFile(common)).nodes[0]).toMatchObject({
    type: "text",
    text: "# 笔记\n\nAI review 正文",
  });
  const before = (await f.repository.search()).objects.length;
  await expect(
    prepareCanvasImport({
      document,
      repository: f.repository,
      file: f.file,
      readFile: vi.fn().mockRejectedValue(new Error("请选择 Vault 文件夹")),
    }),
  ).rejects.toThrow("Vault");
  expect((await f.repository.search()).objects).toHaveLength(before);
});
test("portable text edits supersede a stale embedded Liteasy reference", async () => {
  const f = await fixture();
  const [placement] = await f.repository.listPlacements(f.board.objectId);
  const source = await f.repository.get(placement.ref);
  const document = parseCanvasFile(
    JSON.stringify({
      nodes: [
        {
          ...raw.nodes[0],
          x: 0,
          y: 0,
          text: "在 Obsidian 更新了正文",
          liteasy: { ref: refOf(source) },
        },
      ],
    }),
  );
  const prepared = await prepareCanvasImport({
    document,
    repository: f.repository,
    file: f.file,
    readFile: vi.fn(),
  });
  expect(prepared.nodes[0].ref).toBeUndefined();
  expect(prepared.nodes[0].draft?.content.payload).toMatchObject({
    text: "在 Obsidian 更新了正文",
  });
  expect(objectText(await f.repository.get(placement.ref))).not.toBe(
    "在 Obsidian 更新了正文",
  );
});
test("unsupported Canvas group or media cards are rejected before mutating the source", () => {
  for (const node of [
    { ...raw.nodes[0], type: "group" },
    { ...raw.nodes[0], type: "file", file: "image.png" },
  ])
    expect(() => parseCanvasFile(JSON.stringify({ nodes: [node] }))).toThrow(
      "原文件未修改",
    );
  expect(
    connectionPoint(
      { position: { x: 20, y: 30 }, size: { width: 100, height: 80 } },
      "left",
    ),
  ).toEqual({ x: 20, y: 70 });
});
test("portable Canvas embeds local annotation images instead of exporting broken attachment identifiers", async () => {
  const f = await fixture();
  const asset = await stageImage(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
    "image/png",
  );
  const image = await f.repository.createImage(
    asset,
    `![涂鸦](attachment:${asset.assetId})`,
  );
  const [boardRef] = await f.repository.applyBoardPatch({
    boardRef: refOf(f.board),
    operationId: "image",
    add: [refOf(image)],
  });
  const text = await serializeCanvasFile({
    board: await f.repository.get(boardRef),
    repository: f.repository,
    placements: await f.repository.listPlacements(f.board.objectId),
    edges: await f.repository.listEdges(f.board.objectId),
  });
  expect(text).toContain(`data:image/png;base64,${asset.base64}`);
  expect(
    JSON.parse(text)
      .nodes.map((node: { text: string }) => node.text)
      .join("\n"),
  ).not.toContain("attachment:");
});
test("editing a linked card updates its knowledge endpoint while preserving historical content", async () => {
  const f = await fixture();
  const [placement] = await f.repository.listPlacements(f.board.objectId);
  const [edited] = await f.repository.editPlacement({
    boardRef: refOf(f.board),
    placement,
    text: "更新后内容",
    operationId: "edit-linked",
  });
  const [relation] = await f.reopen().listBoardRelations(f.board.objectId);
  expect(relation.from).toEqual(edited);
  expect(objectText(await f.repository.get(placement.ref))).toContain(
    "用户笔记",
  );
});

test("repeated references to one Markdown file share a single read and projection", async () => {
  const f = await fixture();
  const document = parseCanvasFile(
    JSON.stringify({
      nodes: ["one", "two"].map((id) => ({
        id,
        type: "file",
        file: "same.md",
        x: 0,
        y: 0,
        width: 240,
        height: 120,
      })),
    }),
  );
  const readFile = vi.fn().mockResolvedValue({
    ...f.file,
    name: "same.md",
    path: "same.md",
    text: "one shared note",
  });
  const prepared = await prepareCanvasImport({
    document,
    repository: f.repository,
    file: f.file,
    readFile,
  });
  expect(readFile).toHaveBeenCalledOnce();
  expect(prepared.nodes[0].ref).toEqual(prepared.nodes[1].ref);
  const board = await f.repository.importBoardFile({
    title: "Shared",
    ...prepared,
    operationId: "shared-file",
  });
  expect(await f.repository.listPlacements(board.objectId)).toHaveLength(2);
});

test("editing an external note card before first save exports the edited text without overwriting its source file", async () => {
  const f = await fixture();
  const document = parseCanvasFile(
    JSON.stringify({
      nodes: [
        {
          id: "file",
          type: "file",
          file: "source.md",
          x: 0,
          y: 0,
          width: 240,
          height: 120,
        },
      ],
    }),
  );
  const prepared = await prepareCanvasImport({
    document,
    repository: f.repository,
    file: f.file,
    readFile: vi
      .fn()
      .mockResolvedValue({
        ...f.file,
        path: "source.md",
        name: "source.md",
        text: "磁盘原文",
      }),
  });
  const board = await f.repository.importBoardFile({
    title: "Note",
    ...prepared,
    operationId: "external-edit",
  });
  const [placement] = await f.repository.listPlacements(board.objectId);
  await f.repository.editPlacement({
    boardRef: refOf(board),
    placement,
    text: "卡片独立修改",
    operationId: "edited-external",
  });
  const text = await serializeCanvasFile({
    board: await f.repository.resolveLatest(board.objectId),
    repository: f.repository,
    placements: await f.repository.listPlacements(board.objectId),
    edges: [],
    destinationMountId: "vault",
  });
  expect(JSON.parse(text).nodes[0]).toMatchObject({
    type: "text",
    text: "卡片独立修改",
  });
  expect(objectText(await f.repository.get(placement.ref))).toBe("磁盘原文");
});
