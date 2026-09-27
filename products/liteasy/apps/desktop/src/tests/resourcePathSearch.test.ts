import "fake-indexeddb/auto";
import { expect, test, vi } from "vitest";
import { searchResourcePaths } from "../app/features/resource-filesystem/resourcePathSearch";
import { parseLiteasyPath } from "../app/features/resource-filesystem/liteasyPath";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import type { NoteFileService } from "../app/features/note-files/noteFileService";

test("searches titles, papers, generated artifacts and files without reading object or file contents", async () => {
  const scope = crypto.randomUUID();
  const storage = createObjectStorage(scope, () => scope);
  const repository = createObjectRepository(storage, scope);
  const note = await repository.create({ kind: "content.note", title: "方法笔记", content: { schema: "liteasy.note/v1", payload: { text: "private body", origin: "user" } } });
  const get = vi.spyOn(storage, "get");
  const readFile = vi.fn();
  const files = { readFile, listMounts: async () => [{ id: "vault", name: "Vault" }], listEntries: async () => [{ kind: "file", name: "方法.md", path: "目录/方法.md" }] } as unknown as NoteFileService;
  const input = { query: "方法", repository, files, active: () => true,
    getPapers: () => [{ id: "paper", title: "研究方法" }], getArtifacts: async () => [{ artifactId: "deck", title: "方法幻灯片" }] };
  const results = await searchResourcePaths(input);
  expect(results.map((entry) => entry.title)).toEqual(["方法笔记", "研究方法", "方法幻灯片", "方法.md"]);
  expect(parseLiteasyPath(results[0].path, scope)).toMatchObject({ kind: "object", followLatest: true, ref: { objectId: note.objectId } });
  expect(results.every((entry) => new URL(entry.path).searchParams.get("scope") === scope)).toBe(true);
  expect(get).not.toHaveBeenCalled();
  expect(readFile).not.toHaveBeenCalled();
  await expect(searchResourcePaths({ ...input, active: () => false })).rejects.toThrow("账号已切换");
  await expect(searchResourcePaths({ ...input, query: "liteasy://objects/%" })).resolves.toEqual([]);
});
