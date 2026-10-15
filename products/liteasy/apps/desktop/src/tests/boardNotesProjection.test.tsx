import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { refOf } from "../app/features/objects/object.types";
import { createNotesRepository } from "../app/features/notes/notesRepository";
import { useNotesController } from "../app/controllers/useNotesController";
import { deriveContentTitle } from "../app/features/markdown/contentTitle";

test("two boards aggregate shared placements and keep explicit member references and pinned revisions", async () => {
  const scopeId = crypto.randomUUID(), storage = createObjectStorage(scopeId, () => scopeId), repository = createObjectRepository(storage, scopeId);
  const notes = createNotesRepository(storage), members = [];
  for (let i = 0; i < 20; i++) members.push(await repository.create({ kind: "content.note", title: `note ${i}`, content: { schema: "liteasy.note/v1", payload: { text: `body ${i}`, origin: "user" } } }));
  const boards = [];
  for (let i = 0; i < 2; i++) {
    const board = await repository.create({ kind: "workspace.board", title: "同名白板", content: { schema: "liteasy.board/v1", payload: { description: "" } } });
    await repository.applyBoardPatch({ boardRef: refOf(board), operationId: crypto.randomUUID(), add: members.map(refOf) });
    boards.push(await repository.resolveLatest(board.objectId));
  }
  const folder = await notes.createFolder("root", "收藏");
  await notes.collect({ kind: "object", ref: refOf(members[0]) }, folder.folderId);
  const before = JSON.stringify((await repository.search("")).objects);
  const openObject = vi.fn();
  const hook = renderHook(() => useNotesController({ scopeId, repository, visible: true, getPapers: () => [], onOpen() {}, openObject, openAnnotation() {} }));
  await waitFor(() => expect(hook.result.current.model.busy).toBe(false));
  act(() => hook.result.current.model.selectFolder("default/board"));
  await waitFor(() => expect(hook.result.current.model.items).toHaveLength(2));
  expect(hook.result.current.model.items.every(item => item.boardMembers?.length === 20)).toBe(true);
  act(() => hook.result.current.model.search('"body 0"'));
  expect(hook.result.current.model.items).toHaveLength(2);
  for (const item of hook.result.current.model.items) {
    expect(item.memberHits).toHaveLength(1);
    hook.result.current.model.openBoardMember!(item, item.memberHits![0].placementId);
    expect(openObject).toHaveBeenLastCalledWith({ ...refOf(item.object!), selectorId: `placement:${item.memberHits![0].placementId}` });
  }
  act(() => { hook.result.current.model.search(""); hook.result.current.model.selectFolder(folder.folderId); });
  expect(hook.result.current.model.items).toHaveLength(1);
  expect(hook.result.current.model.items[0].target).toMatchObject({ ref: refOf(members[0]) });
  expect(JSON.stringify((await repository.search("")).objects)).toBe(before);
  hook.unmount();
});

test.each([
  ["**w.r.t.** `a_b` and [paper](https://example.org)", "w.r.t. a_b and paper"],
  ["# 公式 $x_i$ 中文 😀", "公式 x_i 中文 😀"],
  ["```ts\nconst a_b = 1;\n```", "const a_b = 1;"],
  ["| A | B |\n|---|---|\n|1|2|", "A B 1 2"],
])("derives a safe accessible title from the shared AST without rewriting %s", (body, title) => {
  expect(deriveContentTitle(body)).toMatchObject({ title, titleOrigin: "derived-body", repeatedBodyBlock: { start: 0, end: body.length } });
});
