import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import {
  createObjectRepository,
  type ObjectDraft,
} from "../app/features/objects/objectRepository";
import {
  objectText,
  parseObject,
  refOf,
  objectLink,
  parseObjectLink,
  type ObjectAnchor,
} from "../app/features/objects/object.types";
import { resolveObjectAnchor } from "../app/features/objects/objectAnchors";
import {
  resolveContextSnapshot,
  redactDiagnostic,
} from "../app/features/context/objectContext";
import {
  createCaptureTickets,
  makeObjectTransfer,
  readObjectTransfer,
  writeObjectTransfer,
} from "../app/features/object-transfer/objectTransfer";
import { createObjectResolver } from "../app/features/objects/objectResolver";
import { stageImage } from "../app/features/objects/objectAssets";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});
function fixture() {
  let scope = crypto.randomUUID();
  const original = scope;
  const storage = createObjectStorage(scope, () => scope);
  return {
    storage,
    repository: createObjectRepository(storage, scope),
    scope,
    switchAccount: () => {
      scope = crypto.randomUUID();
      return createObjectRepository(
        createObjectStorage(scope, () => scope),
        scope,
      );
    },
    reopen: () =>
      createObjectRepository(
        createObjectStorage(original, () => scope),
        original,
      ),
  };
}
const note = (text = "原始笔记"): ObjectDraft => ({
  kind: "content.note",
  title: text,
  content: { schema: "liteasy.note/v1", payload: { text, origin: "user" } },
});
const boardDraft: ObjectDraft = {
  kind: "workspace.board",
  title: "研究白板",
  content: { schema: "liteasy.board/v1", payload: { description: "" } },
};

test("resize and note edits persist atomically while preserving frozen placements", async () => {
  const { repository, reopen } = fixture();
  const source = await repository.create(note());
  const board = await repository.create(boardDraft);
  const [boardRef] = await repository.applyBoardPatch({
    boardRef: refOf(board),
    operationId: "place",
    add: [refOf(source), refOf(source)],
  });
  const [p, other] = await repository.listPlacements(board.objectId);
  const [resizedBoard] = await repository.applyBoardPatch({
    boardRef,
    operationId: "resize",
    resize: [
      {
        placementId: p.placementId,
        revision: p.revision,
        position: { x: 20, y: 30 },
        size: { width: 400, height: 310 },
      },
    ],
  });
  const resized = (await reopen().listPlacements(board.objectId)).find(
    (item) => item.placementId === p.placementId,
  )!;
  expect(resized).toMatchObject({
    position: { x: 20, y: 30 },
    size: { width: 400, height: 310 },
  });
  await expect(
    repository.editPlacement({
      boardRef: resizedBoard,
      placement: p,
      text: "丢失修改",
      operationId: "stale",
    }),
  ).rejects.toMatchObject({ code: "revision_conflict" });
  expect(objectText(await repository.resolveLatest(source.objectId))).toBe(
    "原始笔记",
  );
  const [edited] = await repository.editPlacement({
    boardRef: resizedBoard,
    placement: resized,
    text: "新笔记正文",
    operationId: "edit",
  });
  expect(edited.objectId).toBe(source.objectId);
  expect(objectText(await reopen().get(edited))).toBe("新笔记正文");
  const saved = await reopen().listPlacements(board.objectId);
  expect(saved.find((item) => item.placementId === p.placementId)?.ref).toEqual(
    edited,
  );
  expect(
    saved.find((item) => item.placementId === other.placementId)?.ref,
  ).toEqual(refOf(source));
  expect(objectText(await repository.get(refOf(source)))).toBe("原始笔记");
});

test("editing a fragment creates a derived note and moves membership without changing the source", async () => {
  const { repository } = fixture();
  const source = await repository.create(note("文献原文"));
  const fragment = await repository.create({
    kind: "content.fragment",
    title: "摘录",
    sourceRefs: [refOf(source)],
    content: {
      schema: "liteasy.fragment/v1",
      payload: {
        text: "原文",
        partial: false,
        anchors: [
          {
            type: "text",
            sourceRef: refOf(source),
            blockId: "body",
            quote: { exact: "原文", prefix: "", suffix: "" },
          },
        ],
      },
    },
  });
  const board = await repository.create(boardDraft);
  const [boardRef] = await repository.applyBoardPatch({
    boardRef: refOf(board),
    operationId: "place",
    add: [refOf(fragment)],
  });
  const [placement] = await repository.listPlacements(board.objectId);
  const [edited] = await repository.editPlacement({
    boardRef,
    placement,
    text: "我对摘录的理解",
    operationId: "edit",
  });
  expect(edited.objectId).not.toBe(fragment.objectId);
  expect((await repository.get(edited)).provenance.derivedFrom).toEqual([
    refOf(fragment),
  ]);
  expect(objectText(await repository.get(refOf(fragment)))).toBe("原文");
  expect(
    await repository.listRelations(refOf(fragment), { predicate: "member_of" }),
  ).toHaveLength(0);
  expect(
    await repository.listRelations(edited, { predicate: "derived_from" }),
  ).toHaveLength(1);
});

test("saved annotations retain identity on repeated capture and roll back projection on board conflict", async () => {
  const { repository } = fixture();
  const board = await repository.create(boardDraft);
  const first = {
    operationId: "annotation-first",
    legacyKey: "annotation-stable",
    draft: note("批注"),
    boardRef: refOf(board),
  };
  const [ref] = await repository.captureFragment(first);
  const [same] = await repository.captureFragment({
    ...first,
    operationId: "annotation-second",
    boardRef: refOf(await repository.resolveLatest(board.objectId)),
  });
  expect(same).toEqual(ref);
  expect(await repository.listPlacements(board.objectId)).toHaveLength(2);
  await expect(
    repository.captureFragment({
      ...first,
      operationId: "annotation-conflict",
      draft: note("修订批注"),
    }),
  ).rejects.toMatchObject({ code: "revision_conflict" });
  expect(objectText(await repository.resolveLatest(ref.objectId))).toBe("批注");
  const [edited] = await repository.captureFragment({
    ...first,
    operationId: "annotation-third",
    draft: note("修订批注"),
    boardRef: refOf(await repository.resolveLatest(board.objectId)),
  });
  expect(edited.objectId).toBe(ref.objectId);
  expect(edited.revision).not.toBe(ref.revision);
  expect(objectText(await repository.get(ref))).toBe("批注");
});

test("placements reuse content; removing a card preserves source; independent copies preserve history", async () => {
  const f = fixture();
  const source = await f.repository.create(note());
  const board = await f.repository.create(boardDraft);
  const [board2] = await f.repository.applyBoardPatch({
    boardRef: refOf(board),
    operationId: "place",
    add: [refOf(source), refOf(source)],
  });
  const placements = await f.repository.listPlacements(board.objectId);
  expect(placements).toHaveLength(2);
  expect(placements[0].ref).toEqual(placements[1].ref);
  await f.repository.applyBoardPatch({
    boardRef: board2,
    operationId: "remove",
    remove: [placements[0].placementId],
  });
  expect(await f.reopen().listPlacements(board.objectId)).toHaveLength(1);
  expect(objectText(await f.reopen().get(refOf(source)))).toBe("原始笔记");
  const copy = await f.repository.copy(refOf(source));
  await f.repository.editNote(refOf(copy), "副本修改");
  expect(objectText(await f.repository.get(refOf(source)))).toBe("原始笔记");
  expect(
    await f.repository.listRelations(refOf(source), {
      predicate: "derived_from",
    }),
  ).toHaveLength(1);
  expect(
    await f.repository.listRelations(refOf(source), { predicate: "member_of" }),
  ).toHaveLength(1);
  const [last] = await f.repository.listPlacements(board.objectId);
  await f.repository.applyBoardPatch({
    boardRef: refOf(await f.repository.resolveLatest(board.objectId)),
    operationId: "remove-last",
    remove: [last.placementId],
  });
  expect(
    await f.repository.listRelations(refOf(source), { predicate: "member_of" }),
  ).toHaveLength(0);
});

test("CAS conflict rolls back fragment and placement; transfer retry does not duplicate", async () => {
  const { repository } = fixture();
  const source = await repository.create(note("原文"));
  const board = await repository.create(boardDraft);
  const draft: ObjectDraft & { kind: "content.fragment" } = {
    kind: "content.fragment",
    title: "摘录",
    sourceRefs: [refOf(source)],
    content: {
      schema: "liteasy.fragment/v1",
      payload: {
        text: "原文",
        partial: false,
        anchors: [
          {
            type: "text",
            sourceRef: refOf(source),
            blockId: "body",
            quote: { exact: "原文", prefix: "", suffix: "" },
          },
        ],
      },
    },
  };
  const input = { boardRef: refOf(board), operationId: "capture", draft };
  const refs = await repository.captureFragment(input);
  expect(
    await repository.captureFragment({
      ...input,
      boardRef: refOf(await repository.resolveLatest(board.objectId)),
    }),
  ).toEqual(refs);
  expect(await repository.listPlacements(board.objectId)).toHaveLength(1);
  await expect(
    repository.captureFragment({ ...input, operationId: "late" }),
  ).rejects.toMatchObject({ code: "revision_conflict" });
  expect(
    (await repository.search()).objects.filter(
      (o) => o.kind === "content.fragment",
    ),
  ).toHaveLength(1);
});

test("concurrent writers preserve the winner; storage failure never reports success", async () => {
  const f = fixture();
  const source = await f.repository.create(note());
  const results = await Promise.allSettled([
    f.repository.editNote(refOf(source), "one"),
    f.repository.editNote(refOf(source), "two"),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await f.repository.history(source.objectId)).toHaveLength(2);
  const broken = createObjectRepository(
    {
      ...f.storage,
      commit: async () => {
        throw new Error("disk full");
      },
    },
    f.scope,
  );
  await expect(broken.create(note("未保存"))).rejects.toThrow("disk full");
  expect(
    (await f.reopen().search()).objects.some((o) => o.title === "未保存"),
  ).toBe(false);
});

test("account changes reject stale repositories and other-account links", async () => {
  const f = fixture();
  const source = await f.repository.create(note());
  const other = f.switchAccount();
  await expect(f.repository.get(refOf(source))).rejects.toMatchObject({
    code: "object_forbidden",
  });
  await expect(f.repository.create(note("迟到"))).rejects.toMatchObject({
    code: "object_forbidden",
  });
  await expect(other.get(refOf(source))).rejects.toMatchObject({
    code: "object_not_found",
  });
  expect((await other.search()).objects).toHaveLength(0);
});

test("snapshots preserve versions and derived trust; explicit overflow fails; diagnostics are redacted and transient", async () => {
  const { repository } = fixture();
  const message = await repository.create({
    kind: "conversation.message",
    title: "回答",
    content: {
      schema: "liteasy.message/v1",
      payload: {
        messageId: "stable",
        blockId: "body",
        text: "推论仍需验证",
        partial: true,
      },
    },
  });
  const [fragment] = await repository.captureFragment({
    operationId: "fragment",
    draft: {
      kind: "content.fragment",
      title: "回答摘录",
      sourceRefs: [refOf(message)],
      content: {
        schema: "liteasy.fragment/v1",
        payload: {
          text: "推论仍需验证",
          partial: true,
          anchors: [
            {
              type: "text",
              sourceRef: refOf(message),
              blockId: "body",
              quote: { exact: "推论仍需验证", prefix: "", suffix: "" },
            },
          ],
        },
      },
    },
  });
  const snapshot = await resolveContextSnapshot({
    repository,
    refs: [fragment, fragment],
    purpose: "解释",
  });
  expect(snapshot.entries).toHaveLength(1);
  expect(snapshot.entries[0].trustLabel).toBe("derived");
  expect(await repository.getSnapshot(snapshot.snapshotId)).toEqual(snapshot);
  await expect(
    resolveContextSnapshot({
      repository,
      refs: [fragment],
      purpose: "解释",
      budget: 1,
    }),
  ).rejects.toMatchObject({ code: "context_budget_exceeded" });
  const temporary = await resolveContextSnapshot({
    repository,
    refs: [
      {
        type: "diagnostic",
        code: "network",
        stage: "download",
        message:
          "Authorization: Bearer secret-value https://host/file?token=secret",
      },
    ],
    purpose: "解释",
  });
  expect(temporary.entries[0].text).not.toContain("secret");
  expect(await repository.getSnapshot(temporary.snapshotId)).toBeUndefined();
});

test("anchors report ambiguous, unresolved and changed versions without guessing", () => {
  const ref = { objectId: "paper", revision: "v1" };
  const anchor: ObjectAnchor = {
    type: "pdf",
    sourceRef: ref,
    documentHash: "hash1",
    page: 3,
    quote: { exact: "same quote", prefix: "", suffix: "" },
    rects: [],
    extractor: "pdf/v1",
    normalization: "text/v1",
    precision: "exact",
  };
  const source = {
    ref,
    text: "same quote and same quote",
    documentHash: "hash1",
    page: 3,
  };
  expect(resolveObjectAnchor(anchor, source).status).toBe("ambiguous");
  expect(
    resolveObjectAnchor(anchor, { ...source, documentHash: "hash2" }).status,
  ).toBe("version_changed");
  expect(
    resolveObjectAnchor({ ...anchor, range: { start: 0, end: 10 } }, source)
      .status,
  ).toBe("resolved");
  expect(
    resolveObjectAnchor({ ...anchor, precision: "page" }, source).status,
  ).toBe("unresolved");
});

test("migration is atomic and retryable; visual lines do not become evidence", async () => {
  const f = fixture();
  const input = {
    key: "old-board",
    snapshot: { nodes: 2 },
    title: "旧白板",
    paperId: "paper",
    nodes: [
      {
        legacyId: "a",
        draft: note("A"),
        position: { x: 0, y: 0 },
        size: { width: 200, height: 160 },
      },
      {
        legacyId: "b",
        draft: note("B"),
        position: { x: 240, y: 0 },
        size: { width: 200, height: 160 },
      },
    ],
    edges: [
      { id: "line", sourceNodeId: "a", targetNodeId: "b", kind: "association" },
    ],
  };
  const broken = createObjectRepository(
    {
      ...f.storage,
      commit: async () => {
        throw new Error("full");
      },
    },
    f.scope,
  );
  await expect(broken.migrateBoard(input)).rejects.toThrow("full");
  expect((await f.repository.search()).objects).toHaveLength(0);
  const board = await f.repository.migrateBoard(input);
  expect((await f.reopen().migrateBoard(input)).objectId).toBe(board.objectId);
  expect(await f.repository.listPlacements(board.objectId)).toHaveLength(2);
  expect(await f.repository.listEdges(board.objectId)).toHaveLength(1);
  expect(
    await f.repository.listRelations(refOf(board), { predicate: "references" }),
  ).toHaveLength(0);
  expect(
    await f.repository.listRelations(refOf(board), { predicate: "member_of" }),
  ).toHaveLength(2);
});

test("schema validators reject arbitrary payloads and unknown schemas remain read-only", async () => {
  const f = fixture();
  const object = await f.repository.create(note());
  expect(() =>
    parseObject({
      ...object,
      content: {
        schema: "liteasy.note/v1",
        payload: { text: 12, origin: "user" },
      },
    }),
  ).toThrow();
  const unknown = {
    ...object,
    kind: "future.chart",
    content: {
      schema: "future.chart/v2",
      payload: { text: "<script>bad()</script>" },
    },
  };
  const storage = {
    ...f.storage,
    get: async (key: string) => ({ key, version: "v1", value: unknown }),
  };
  expect(
    await createObjectResolver(createObjectRepository(storage, f.scope)).open(
      objectLink(refOf(object)),
    ),
  ).toMatchObject({
    state: "unsupported",
    title: object.title,
    text: "<script>bad()</script>",
  });
});

test("semantic transfer carries no authority; duplicate capture tickets commit once", async () => {
  const data = new Map<string, string>();
  const transfer = makeObjectTransfer(
    [{ objectId: "id", revision: "rev" }],
    "正文",
  );
  writeObjectTransfer(
    {
      setData: (type, value) => {
        data.set(type, value);
      },
    },
    transfer,
  );
  expect(data.get("text/plain")).toContain("liteasy://objects/id?revision=rev");
  expect(
    readObjectTransfer({ getData: (type) => data.get(type) ?? "" }),
  ).toEqual(transfer);
  const tickets = createCaptureTickets();
  const capture = vi.fn(async () => transfer.refs);
  const id = tickets.register(capture);
  await Promise.all([tickets.consume(id), tickets.consume(id)]);
  expect(capture).toHaveBeenCalledTimes(1);
  tickets.clear();
  await expect(tickets.consume(id)).rejects.toThrow("失效");
  expect(parseObjectLink("file:///private/document.pdf")).toBeNull();
});

test("diagnostics remove query credentials and assets reject disguised executable content", async () => {
  expect(
    redactDiagnostic(
      'api_key="top secret" https://user:pass@host/file?token=abc#token',
    ),
  ).not.toMatch(/top secret|user:pass|token=abc/);
  await expect(
    stageImage(new TextEncoder().encode("<svg onload='bad()'/>"), "image/png"),
  ).rejects.toThrow("格式");
});

test("chat history stays scoped and rejects pending writes after switching accounts", async () => {
  const { createScopedAssistantHistoryPersistence } =
    await import("../app/features/assistant/assistantHistoryPersistence");
  let account = `user:${crypto.randomUUID()}`;
  const a = createScopedAssistantHistoryPersistence(account, () => account);
  await a.load();
  const snapshot = {
    version: "liteasy.assistant-history/v1" as const,
    activeSessionId: "session-a",
    sessions: [
      {
        id: "session-a",
        title: "Private A",
        mode: "qa" as const,
        messages: [
          {
            id: "message-a",
            role: "assistant" as const,
            content: "Account A content",
          },
        ],
      },
    ],
    draft: { input: "", tokens: [], readerContexts: [] },
  };
  await a.save(snapshot);
  account = `user:${crypto.randomUUID()}`;
  const b = createScopedAssistantHistoryPersistence(account, () => account);
  expect(await b.load()).toBeNull();
  await expect(a.save(snapshot)).rejects.toMatchObject({
    code: "object_forbidden",
  });
});
