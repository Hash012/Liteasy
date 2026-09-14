import { z } from "zod";
import { objectRefSchema } from "../objects/object.types";
import type {
  ObjectStorage,
  StorageChange,
  StorageRow,
} from "../objects/objectStorage";
import {
  DEFAULT_NOTES_FOLDERS,
  NOTES_ROOT,
  notesTargetKey,
  type NotesFolder,
  type NotesReference,
  type NotesTarget,
} from "./notes.types";

const targetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("object"),
    ref: objectRefSchema,
    followLatest: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("pdf-annotation"),
    paperId: z.string().min(1),
    annotationId: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("artifact-annotation"),
    artifactId: z.string().min(1),
    annotationId: z.string().min(1),
  }),
]);
const folderSchema = z.strictObject({
  folderId: z.string().min(1),
  parentId: z.string().min(1),
  name: z.string().min(1),
});
const entrySchema = z.strictObject({
  entryId: z.string().min(1),
  folderId: z.string().min(1),
  target: targetSchema,
  createdAt: z.iso.datetime(),
});
export function createNotesRepository(storage: ObjectStorage) {
  const change = (
    key: string,
    value: unknown,
    old?: StorageRow | null,
  ): StorageChange => ({
    key,
    expected: old?.version ?? null,
    row: { key, version: crypto.randomUUID(), value },
  });
  const rows = async (prefix: string) => {
    const result: StorageRow[] = [];
    let cursor = "";
    do {
      const batch = await storage.list(prefix, cursor, 1000);
      result.push(...batch);
      cursor = batch.length === 1000 ? batch.at(-1)!.key : "";
    } while (cursor);
    return result;
  };
  const listFolders = async (): Promise<NotesFolder[]> => [
    ...DEFAULT_NOTES_FOLDERS,
    ...(await rows("notes/folder/")).map((row) =>
      folderSchema.parse(row.value),
    ),
  ];
  const listReferences = async (): Promise<NotesReference[]> =>
    (await rows("notes/reference/")).map((row) => entrySchema.parse(row.value));
  const requireFolder = async (folderId: string) => {
    if (
      folderId === NOTES_ROOT ||
      (await listFolders()).some((folder) => folder.folderId === folderId)
    )
      return;
    throw new Error("目录已不存在，请刷新后重试。");
  };
  const protectFolder = async (folderId: string): Promise<StorageChange[]> => {
    if (
      folderId === NOTES_ROOT ||
      DEFAULT_NOTES_FOLDERS.some((folder) => folder.folderId === folderId)
    )
      return [];
    const key = `notes/folder/${folderId}`;
    const row = await storage.get(key);
    if (!row) throw new Error("目录已不存在，请刷新后重试。");
    return [change(key, row.value, row)];
  };
  const nameKey = (parentId: string, name: string) =>
    `notes/folder-name/${encodeURIComponent(parentId)}/${encodeURIComponent(name)}`;
  return {
    listFolders,
    listReferences,
    async createFolder(parentId: string, rawName: string) {
      await requireFolder(parentId);
      const name = rawName.trim();
      if (
        !name ||
        name.length > 120 ||
        /[\\/\u0000-\u001f]/.test(name) ||
        name === "." ||
        name === ".."
      )
        throw new Error("请输入不含斜线的目录名（最多 120 字）。");
      if (
        (await listFolders()).some(
          (folder) => folder.parentId === parentId && folder.name === name,
        )
      )
        throw new Error("此位置已有同名目录。");
      const folder = { folderId: crypto.randomUUID(), parentId, name };
      const claim = nameKey(parentId, name);
      try {
        await storage.commit([
          change(`notes/folder/${folder.folderId}`, folder),
          change(claim, { folderId: folder.folderId }),
          ...(await protectFolder(parentId)),
        ]);
      } catch (error) {
        if (await storage.get(claim)) throw new Error("此位置已有同名目录。");
        throw error;
      }
      return folder;
    },
    async removeFolder(folderId: string) {
      const folder = (await listFolders()).find(
        (item) => item.folderId === folderId,
      );
      if (!folder || folder.system) throw new Error("默认目录不能删除。");
      const key = `notes/folder/${folderId}`;
      const old = await storage.get(key);
      if (
        (await listFolders()).some((item) => item.parentId === folderId) ||
        (await listReferences()).some((item) => item.folderId === folderId)
      )
        throw new Error("请先移除该目录中的引用和子目录。");
      const claimKey = nameKey(folder.parentId, folder.name);
      const claim = await storage.get(claimKey);
      if (old)
        await storage.commit([
          { key, expected: old.version, row: null },
          ...(claim
            ? [{ key: claimKey, expected: claim.version, row: null }]
            : []),
        ]);
    },
    async collect(target: NotesTarget, folderId: string) {
      targetSchema.parse(target);
      await requireFolder(folderId);
      const key = `notes/reference/${encodeURIComponent(folderId)}/${encodeURIComponent(notesTargetKey(target))}`;
      const old = await storage.get(key);
      if (old) return entrySchema.parse(old.value);
      const entry = {
        entryId: key,
        folderId,
        target,
        createdAt: new Date().toISOString(),
      };
      try {
        await storage.commit([
          change(key, entry),
          ...(await protectFolder(folderId)),
        ]);
      } catch (error) {
        // Two concurrent drops of the same reference are one directory entry.
        const raced = await storage.get(key);
        if (raced) return entrySchema.parse(raced.value);
        throw error;
      }
      return entry;
    },
    async removeReference(entryId: string) {
      if (!entryId.startsWith("notes/reference/"))
        throw new Error("引用标识无效。");
      const old = await storage.get(entryId);
      if (old)
        await storage.commit([
          { key: entryId, expected: old.version, row: null },
        ]);
    },
  };
}
