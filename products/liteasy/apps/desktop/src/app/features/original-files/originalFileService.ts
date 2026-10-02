import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { contentPaperId } from "../library/cachedReaderPapers";
import type { Paper } from "../workspace/workspace.types";

/** An exact-file, read-only grant issued by the native chooser or OS handoff. */
export type OriginalFileDescriptor = {
  id: string;
  path: string;
  fileName: string;
  format: "pdf" | "epub";
  sizeBytes: number;
  modifiedUnixMs: number;
};
export type OriginalFileBatch = {
  files: OriginalFileDescriptor[];
  errors: { code: string; message: string }[];
};
export type OriginalFileService = {
  choose(): Promise<OriginalFileDescriptor | null>;
  read(file: OriginalFileDescriptor): Promise<Uint8Array>;
  release(file: OriginalFileDescriptor): Promise<void>;
  drain(): Promise<OriginalFileBatch>;
  subscribe(wake: () => void): Promise<() => void>;
};
type OriginalFileInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export function isOriginalFileOpenAvailable() {
  return typeof window !== "undefined" &&
    typeof (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === "function";
}

export function createOriginalFileService(
  scope: string,
  currentScope: () => string,
  nativeInvoke: OriginalFileInvoke = invoke
): OriginalFileService {
  const check = () => {
    if (scope !== currentScope()) throw new Error("账号已切换，请重新打开文件。");
  };
  const release = (file: OriginalFileDescriptor) => nativeInvoke<void>("release_native_open_file", { scope, id: file.id });
  async function call<T>(command: string, args: Record<string, unknown> = {}, discard?: (result: T) => Promise<unknown>) {
    check();
    const result = await nativeInvoke<T>(command, { scope, ...args });
    try { check(); }
    catch (error) { await discard?.(result); throw error; }
    return result;
  }
  return {
    choose: () => call<OriginalFileDescriptor | null>("choose_native_open_file", {}, async (file) => { if (file) await release(file); }),
    read: async (file) => new Uint8Array(await call<ArrayBuffer>("read_native_open_file", { id: file.id })),
    // Releasing an old account's handle returns no data and must still work after a scope switch.
    release,
    drain: () => call<OriginalFileBatch>("drain_native_open_requests", {}, (batch) => Promise.allSettled(batch.files.map(release))),
    subscribe: (wake) => listen("native-open-files-available", () => {
      if (scope === currentScope()) wake();
    })
  };
}

export async function originalFileContentHash(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice())),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type OriginalReaderPaper = Paper & { originalFile: OriginalFileDescriptor };

/** The grant ID is temporary; content identity and original path survive reopening. */
export async function buildOriginalReaderPaper(file: OriginalFileDescriptor, bytes: Uint8Array): Promise<OriginalReaderPaper> {
  if (file.format !== "pdf" || !String.fromCharCode(...bytes.subarray(0, 1024)).includes("%PDF-")) {
    throw new Error("此文件不是有效的 PDF 文档。");
  }
  const contentHash = await originalFileContentHash(bytes);
  return {
    id: contentPaperId(contentHash), contentHash, sourcePath: file.path,
    title: file.fileName.replace(/\.pdf$/i, "") || file.fileName, originalFile: file
  };
}
