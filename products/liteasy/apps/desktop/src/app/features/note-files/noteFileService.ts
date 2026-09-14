import { invoke, isTauri } from "@tauri-apps/api/core";
import { createBrowserNoteFiles } from "./browserNoteFiles";

export type NoteFileMount = {
  id: string;
  name: string;
  location: string;
  kind: "directory" | "file";
};
export type NoteFileEntry = {
  mountId: string;
  path: string;
  name: string;
  kind: "file" | "directory";
};
export type NoteFileSnapshot = NoteFileEntry & {
  text: string;
  version: string | null;
};
export type NoteFileWrite = {
  mountId: string;
  path: string;
  text: string;
  expectedVersion: string | null;
};
export type NoteFileChoice = {
  mode: "open" | "save";
  extension: "canvas" | "md";
  suggestedName?: string;
};
export type ImportedNoteFile = { name: string; path: string; text: string };
export interface NoteFileService {
  listMounts(): Promise<NoteFileMount[]>;
  chooseFolder(): Promise<NoteFileMount | null>;
  listEntries(mountId: string): Promise<NoteFileEntry[]>;
  readFile(mountId: string, path: string): Promise<NoteFileSnapshot>;
  writeFile(input: NoteFileWrite): Promise<NoteFileSnapshot>;
  createDirectory(mountId: string, path: string): Promise<void>;
  pickFiles(): Promise<ImportedNoteFile[]>;
  chooseFile(input: NoteFileChoice): Promise<NoteFileSnapshot | null>;
}
export const MAX_NOTE_FILE_BYTES = 8 * 1024 * 1024;
export function validateNotePath(path: string, file = true) {
  if (
    !path ||
    path.length > 2048 ||
    /[\\\x00-\x1f:*?"<>|]/.test(path) ||
    path
      .split("/")
      .some(
        (part) => !part || part === "." || part === ".." || /[. ]$/.test(part),
      )
  )
    throw new Error("文件路径无效，请使用所选文件夹内的相对路径。");
  if (file && !/\.(md|markdown|canvas)$/i.test(path))
    throw new Error("仅支持 Markdown 和 Canvas 文件。");
}
export async function noteFileVersion(text: string) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_NOTE_FILE_BYTES)
    throw new Error("单个笔记文件不能超过 8 MB。");
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
export type NoteFileChange =
  | { kind: "file"; entry: NoteFileEntry }
  | { kind: "mount"; mount: NoteFileMount }
  | { kind: "directory"; mountId: string; path: string };

const listeners = new Map<string, Set<(change: NoteFileChange) => void>>();
export function subscribeNoteFiles(scope: string, listener: (change: NoteFileChange) => void) {
  const group = listeners.get(scope) ?? new Set();
  group.add(listener);
  listeners.set(scope, group);
  return () => {
    group.delete(listener);
    if (!group.size) listeners.delete(scope);
  };
}
export function createNoteFileService(
  scope: string,
  currentScope: () => string,
): NoteFileService {
  const check = () => {
    if (scope !== currentScope())
      throw new Error("账号已切换，请重新打开笔记。");
  };
  const changed = (change: NoteFileChange) => {
    for (const listener of listeners.get(scope) ?? []) listener(change);
  };
  const fileChanged = (snapshot: NoteFileSnapshot) => changed({ kind: "file", entry: {
    mountId: snapshot.mountId, path: snapshot.path,
    name: snapshot.name ?? snapshot.path.split("/").at(-1)!, kind: "file",
  } });
  const call = async <T>(action: string, args = {}): Promise<T> => {
    check();
    try {
      const result = await invoke<T>("note_files_dispatch", {
        scope,
        request: { action, ...args },
      });
      check();
      return result;
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  };
  const backend: NoteFileService = isTauri()
    ? {
        listMounts: () => call("listMounts"),
        chooseFolder: () => call("chooseFolder"),
        listEntries: (mountId) => call("listEntries", { mountId }),
        readFile: (mountId, path) => call("readFile", { mountId, path }),
        writeFile: (input) => call("writeFile", input),
        createDirectory: (mountId, path) =>
          call("createDirectory", { mountId, path }),
        pickFiles: () => call("pickFiles"),
        chooseFile: (input) => call("chooseFile", input),
      }
    : createBrowserNoteFiles(scope, check);
  const wrap = async <T>(operation: () => Promise<T>) => {
    check();
    const result = await operation();
    check();
    return result;
  };
  return {
    listMounts: () => wrap(() => backend.listMounts()),
    chooseFolder: async () => {
      const mount = await wrap(() => backend.chooseFolder());
      check();
      if (mount) changed({ kind: "mount", mount });
      return mount;
    },
    listEntries: (id) => wrap(() => backend.listEntries(id)),
    readFile: (id, path) => {
      validateNotePath(path);
      return wrap(() => backend.readFile(id, path));
    },
    writeFile: (input) => {
      validateNotePath(input.path);
      return wrap(async () => {
        await noteFileVersion(input.text);
        return backend.writeFile(input);
      }).then((snapshot) => { check(); fileChanged(snapshot); return snapshot; });
    },
    createDirectory: (id, path) => {
      validateNotePath(path, false);
      return wrap(() => backend.createDirectory(id, path)).then(() => {
        check(); changed({ kind: "directory", mountId: id, path });
      });
    },
    pickFiles: () => wrap(() => backend.pickFiles()),
    chooseFile: async (input) => {
      const file = await wrap(() => backend.chooseFile(input));
      check();
      if (file) fileChanged(file);
      return file;
    },
  };
}
