import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  createNoteFileService,
  noteFileVersion,
  subscribeNoteFiles,
  validateNotePath,
} from "../app/features/note-files/noteFileService";

const native = vi.hoisted(() => ({ active: true, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => native.active,
  invoke: native.invoke,
}));
beforeEach(() => {
  native.active = true;
  native.invoke.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

test("native file changes use scope-bound grants, expected hashes, and commit-only notifications", async () => {
  const changed = vi.fn();
  const unsubscribe = subscribeNoteFiles("scope", changed);
  const service = createNoteFileService("scope", () => "scope");
  native.invoke.mockResolvedValueOnce({
    mountId: "vault",
    path: "论文.md",
    text: "正文",
    version: "next",
  });
  await service.writeFile({
    mountId: "vault",
    path: "论文.md",
    text: "正文",
    expectedVersion: "before",
  });
  expect(native.invoke).toHaveBeenCalledWith("note_files_dispatch", {
    scope: "scope",
    request: {
      action: "writeFile",
      mountId: "vault",
      path: "论文.md",
      text: "正文",
      expectedVersion: "before",
    },
  });
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledWith({ kind: "file", entry: {
    mountId: "vault", path: "论文.md", name: "论文.md", kind: "file"
  } });
  expect(JSON.stringify(changed.mock.calls[0][0])).not.toContain("正文");
  native.invoke.mockRejectedValueOnce("文件已在其他应用中修改");
  await expect(
    service.writeFile({
      mountId: "vault",
      path: "论文.md",
      text: "另一版",
      expectedVersion: "before",
    }),
  ).rejects.toThrow("其他应用");
  expect(changed).toHaveBeenCalledTimes(1);
  unsubscribe();
});

test("a pending file result cannot cross account changes", async () => {
  let current = "a";
  let resolve!: (value: unknown) => void;
  native.invoke.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const service = createNoteFileService("a", () => current);
  const result = service.readFile("vault", "note.md");
  current = "b";
  resolve({ text: "account a" });
  await expect(result).rejects.toThrow("账号已切换");
  await expect(service.listMounts()).rejects.toThrow("账号已切换");
  expect(native.invoke).toHaveBeenCalledTimes(1);
});

test("file paths reject escapes and unsupported writes before reaching the host", () => {
  const service = createNoteFileService("scope", () => "scope");
  for (const path of [
    "../secret.md",
    "/etc/config.md",
    "a/../x.md",
    "a\\b.md",
    "C:/x.md",
    "note.exe",
    "a//b.md",
  ]) {
    expect(() =>
      service.writeFile({
        mountId: "vault",
        path,
        text: "bad",
        expectedVersion: null,
      }),
    ).toThrow();
  }
  expect(native.invoke).not.toHaveBeenCalled();
  expect(() => validateNotePath("研究/方法.canvas")).not.toThrow();
});

test("UTF-8 content hashes are stable and detect edits including review text", async () => {
  expect(await noteFileVersion("abc")).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  expect(await noteFileVersion("原文\n\n## AI review\n\n补充证据")).not.toBe(
    await noteFileVersion("原文"),
  );
});

test("browser imports remain available without the folder access API", async () => {
  native.active = false;
  // Separate service avoids inventing a writable folder when the browser cannot grant one.
  const scope = `browser-${crypto.randomUUID()}`;
  const current = createNoteFileService(scope, () => scope);
  expect(await current.listMounts()).toEqual([]);
  await expect(current.chooseFolder()).rejects.toThrow("导入文件");
});

test("browser new-note race preserves a file another application creates during the drop", async () => {
  native.active = false;
  // Browser handle objects are structured-cloneable; this test adapter preserves
  // their fake methods while exercising the real IndexedDB grant and writer flow.
  vi.stubGlobal("structuredClone", (value: unknown) => value);
  const scope = `race-${crypto.randomUUID()}`;
  let text: string | undefined;
  const write = vi.fn(async (next: string) => {
    text = next;
  });
  const abort = vi.fn(async () => {});
  const file = {
    kind: "file",
    name: "note.md",
    getFile: async () => ({
      size: new TextEncoder().encode(text!).length,
      arrayBuffer: async () => new TextEncoder().encode(text!).buffer,
    }),
    createWritable: async () => ({ write, close: async () => {}, abort }),
  };
  const directory = {
    kind: "directory",
    name: "Vault",
    queryPermission: async () => "granted",
    isSameEntry: async (other: unknown) => other === directory,
    getFileHandle: async (_path: string, options?: { create?: boolean }) => {
      if (text === undefined && !options?.create)
        throw new DOMException("missing", "NotFoundError");
      // An external writer wins after Liteasy observed absence.
      if (text === undefined) text = "Obsidian 刚保存的内容";
      return file;
    },
  };
  Object.defineProperty(window, "showDirectoryPicker", {
    configurable: true,
    value: async () => directory,
  });
  try {
    const service = createNoteFileService(scope, () => scope);
    const mount = await service.chooseFolder();
    await expect(
      service.writeFile({
        mountId: mount!.id,
        path: "note.md",
        text: "拖入的内容",
        expectedVersion: null,
      }),
    ).rejects.toThrow("其他应用");
    expect(text).toBe("Obsidian 刚保存的内容");
    expect(write).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalled();
    expect(
      await createNoteFileService(scope, () => scope).listMounts(),
    ).toEqual([mount]);
  } finally {
    Reflect.deleteProperty(window, "showDirectoryPicker");
  }
});
