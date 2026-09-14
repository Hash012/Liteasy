import {
  MAX_NOTE_FILE_BYTES,
  noteFileVersion,
  validateNotePath,
} from "./noteFileService";
import type {
  NoteFileMount,
  NoteFileEntry,
  NoteFileService,
  NoteFileSnapshot,
} from "./noteFileService";

type Handle = FileSystemHandle & {
  queryPermission?(options: { mode: string }): Promise<string>;
};
type Directory = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<Handle>;
};
type SavedMount = {
  key: string;
  scope: string;
  mount: NoteFileMount;
  handle: Handle;
};
type PickerWindow = Window & {
  showDirectoryPicker?: (options: { mode: string }) => Promise<Directory>;
  showOpenFilePicker?: (options: unknown) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
};
const pickers = () => window as PickerWindow;
const cancelled = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";
const conflict = () =>
  new Error("文件已在其他应用中修改，请重新打开后再保存；本次修改尚未写入。");
const writeQueues = new Map<string, Promise<unknown>>();
export function createBrowserNoteFiles(
  scope: string,
  check: () => void,
): NoteFileService {
  let pendingDb: Promise<IDBDatabase> | undefined;
  const db = () =>
    (pendingDb ??= new Promise((resolve, reject) => {
      const request = indexedDB.open("liteasy.note-files.v1", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("mounts", { keyPath: "key" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("文件夹索引无法打开，请关闭其他旧版本窗口后重试。"));
    }));
  async function rows(): Promise<SavedMount[]> {
    const database = await db();
    check();
    return new Promise((resolve, reject) => {
      const request = database
        .transaction("mounts")
        .objectStore("mounts")
        .getAll();
      request.onsuccess = () =>
        resolve(
          (request.result as SavedMount[]).filter((row) => row.scope === scope),
        );
      request.onerror = () => reject(request.error);
    });
  }
  async function saveHandle(handle: Handle): Promise<SavedMount> {
    const existing = await rows();
    check();
    for (const row of existing)
      if (await row.handle.isSameEntry(handle)) return row;
    const id = crypto.randomUUID();
    const row: SavedMount = {
      key: `${scope}:${id}`,
      scope,
      handle,
      mount: {
        id,
        name: handle.name,
        location: handle.name,
        kind: handle.kind,
      },
    };
    const database = await db();
    check();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("mounts", "readwrite");
      tx.objectStore("mounts").put(row);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
    return row;
  }
  async function grant(id: string, write = false) {
    const row = (await rows()).find((item) => item.mount.id === id);
    check();
    if (!row) throw new Error("找不到已连接的文件夹，请重新连接。");
    if (
      row.handle.queryPermission &&
      (await row.handle.queryPermission({
        mode: write ? "readwrite" : "read",
      })) !== "granted"
    )
      throw new Error(
        "文件访问权限已过期，请通过连接文件夹按钮重新选择原文件夹。",
      );
    return row;
  }
  async function fileHandle(row: SavedMount, path: string, create = false) {
    validateNotePath(path);
    if (row.handle.kind === "file") {
      if (path !== row.handle.name)
        throw new Error("请选择此文件所在的 Vault 文件夹，以读取其中的引用。");
      return row.handle as FileSystemFileHandle;
    }
    const parts = path.split("/");
    const name = parts.pop()!;
    let directory = row.handle as FileSystemDirectoryHandle;
    for (const part of parts)
      directory = await directory.getDirectoryHandle(part);
    check();
    return directory.getFileHandle(name, { create });
  }
  async function read(
    row: SavedMount,
    path: string,
  ): Promise<NoteFileSnapshot> {
    const file = await (await fileHandle(row, path)).getFile();
    if (file.size > MAX_NOTE_FILE_BYTES)
      throw new Error("单个笔记文件不能超过 8 MB。");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
    check();
    return {
      mountId: row.mount.id,
      path,
      name: path.split("/").pop()!,
      kind: "file",
      text,
      version: await noteFileVersion(text),
    };
  }
  return {
    listMounts: async () => (await rows()).map((row) => row.mount),
    chooseFolder: async () => {
      if (!pickers().showDirectoryPicker)
        throw new Error(
          "此浏览器无法连接磁盘文件夹，请在桌面应用中连接 Vault；也可使用导入文件。",
        );
      try {
        const handle = await pickers().showDirectoryPicker!({
          mode: "readwrite",
        });
        check();
        return (await saveHandle(handle)).mount;
      } catch (error) {
        if (cancelled(error)) return null;
        throw error;
      }
    },
    listEntries: async (id) => {
      const row = await grant(id);
      const entries: NoteFileEntry[] = [];
      if (row.handle.kind === "file")
        return [
          {
            mountId: id,
            path: row.handle.name,
            name: row.handle.name,
            kind: "file",
          },
        ];
      async function walk(directory: Directory, parent: string, depth: number) {
        if (depth > 64)
          throw new Error("文件夹层级超过 64 层，请连接较小的子目录。");
        for await (const child of directory.values()) {
          check();
          if (child.name.startsWith(".")) continue;
          const path = parent + child.name;
          if (child.kind === "file" && !/\.(md|markdown|canvas)$/i.test(path))
            continue;
          if (entries.length >= 10000)
            throw new Error("文件夹超过 10000 个条目，请连接较小的子目录。");
          entries.push({
            mountId: id,
            path,
            name: child.name,
            kind: child.kind,
          });
          if (child.kind === "directory")
            await walk(child as Directory, path + "/", depth + 1);
        }
      }
      await walk(row.handle as Directory, "", 0);
      return entries.sort((a, b) => a.path.localeCompare(b.path));
    },
    readFile: async (id, path) => read(await grant(id), path),
    writeFile: async (input) => {
      const key = `${scope}:${input.mountId}:${input.path}`;
      const run = async () => {
        const row = await grant(input.mountId, true);
        let before: NoteFileSnapshot | undefined;
        try {
          before = await read(row, input.path);
        } catch (error) {
          if (!(
            error instanceof DOMException && error.name === "NotFoundError"
          ))
            throw error;
        }
        if ((before?.version ?? null) !== input.expectedVersion)
          throw conflict();
        const handle = await fileHandle(row, input.path, true);
        check();
        const writable = await handle.createWritable();
        try {
          // Recheck after the browser has acquired its writer, before replacing content.
          const observed = await read(row, input.path);
          if (
            before ? observed.version !== before.version : observed.text !== ""
          )
            throw conflict();
          check();
          await writable.write(input.text);
          check();
          await writable.close();
        } catch (error) {
          await writable.abort().catch(() => {});
          throw error;
        }
        return read(row, input.path);
      };
      const pending = (writeQueues.get(key) ?? Promise.resolve())
        .catch(() => {})
        .then(run);
      writeQueues.set(key, pending);
      try {
        return await pending;
      } finally {
        if (writeQueues.get(key) === pending) writeQueues.delete(key);
      }
    },
    createDirectory: async (id, path) => {
      const row = await grant(id, true);
      validateNotePath(path, false);
      if (row.handle.kind !== "directory") throw new Error("请先连接文件夹。");
      let directory = row.handle as FileSystemDirectoryHandle;
      const parts = path.split("/");
      for (const part of parts) {
        check();
        directory = await directory.getDirectoryHandle(part, { create: true });
      }
    },
    pickFiles: () =>
      new Promise((resolve, reject) => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.accept = ".md,.markdown";
        input.addEventListener("cancel", () => resolve([]), { once: true });
        input.onchange = async () => {
          try {
            const result = await Promise.all(
              Array.from(input.files ?? []).map(async (file) => {
                validateNotePath(file.name);
                if (file.size > MAX_NOTE_FILE_BYTES)
                  throw new Error("单个笔记文件不能超过 8 MB。");
                return {
                  name: file.name,
                  path: file.webkitRelativePath || file.name,
                  text: new TextDecoder("utf-8", { fatal: true }).decode(
                    await file.arrayBuffer(),
                  ),
                };
              }),
            );
            check();
            resolve(result);
          } catch (error) {
            reject(error);
          }
        };
        input.click();
      }),
    chooseFile: async (input) => {
      const options = {
        mode: "readwrite",
        suggestedName: input.suggestedName,
        types: [
          {
            description: input.extension === "canvas" ? "Canvas" : "Markdown",
            accept: { "text/plain": [`.${input.extension}`] },
          },
        ],
      };
      if (
        !(input.mode === "save"
          ? pickers().showSaveFilePicker
          : pickers().showOpenFilePicker)
      )
        throw new Error("此浏览器无法选择存储文件，请使用桌面应用。");
      try {
        const selection =
          input.mode === "save"
            ? await pickers().showSaveFilePicker!(options)
            : await pickers().showOpenFilePicker!(options);
        const handle = Array.isArray(selection) ? selection[0] : selection;
        check();
        if (!handle) return null;
        validateNotePath(handle.name);
        for (const row of await rows())
          if (row.handle.kind === "directory") {
            const path = await (
              row.handle as FileSystemDirectoryHandle
            ).resolve(handle);
            if (path?.length) return read(row, path.join("/"));
          }
        return read(await saveHandle(handle), handle.name);
      } catch (error) {
        if (cancelled(error)) return null;
        throw error;
      }
    },
  };
}
