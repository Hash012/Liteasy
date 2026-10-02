import { invoke, isTauri } from "@tauri-apps/api/core";

export type ArchiveManifest = {
  format: string; version: number;
  documents: { id: string; title: string; source: string; annotations: string; note: string }[];
  notes: { id: string; title: string; path: string; documentIds: string[] }[];
  relations: { from: string; to: string; kind: string; page: number | null; quote: string | null }[];
  files: { path: string; size: number; sha256: string }[];
  exclusions: string[];
};
export type ArchiveCatalogEntry = { id: string; title: string; available: boolean };
export type ArchivePreview = { planId: string; operation: string; targetPath: string; manifest: ArchiveManifest; totalBytes: number };
export type ArchiveReceipt = { receiptId: string; status: string; path: string; manifestHash: string; fileCount: number; manifest: ArchiveManifest };
export type LocalArchiveService = {
  catalog(): Promise<ArchiveCatalogEntry[]>;
  prepareExport(documentIds: string[]): Promise<ArchivePreview | null>;
  prepareRestore(): Promise<ArchivePreview | null>;
  commit(planId: string): Promise<ArchiveReceipt>;
  cancel(planId: string): Promise<void>;
  openDocument(receiptId: string, documentId: string): Promise<void>;
  reveal(receiptId: string): Promise<void>;
  readNote(receiptId: string, noteId: string): Promise<string>;
};
type NativeInvoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;
export const isLocalArchiveAvailable = isTauri;

export function createLocalArchiveService(scope: string, currentScope: () => string, nativeInvoke: NativeInvoke = invoke): LocalArchiveService {
  const check = () => { if (currentScope() !== scope) throw new Error("账号已切换，请重新预览归档。"); };
  const cancel = async (planId: string) => { await nativeInvoke("local_archive_cancel", { scope, planId }); };
  const call = async <T>(command: string, args: Record<string, unknown> = {}, discard?: (value: T) => Promise<void>): Promise<T> => {
    check(); const value = await nativeInvoke(command, { scope, ...args }) as T;
    try { check(); } catch (error) { await discard?.(value); throw error; }
    return value;
  };
  const discard = async (preview: ArchivePreview | null) => { if (preview) await cancel(preview.planId); };
  return {
    catalog: () => call("local_archive_catalog"),
    prepareExport: (documentIds) => call("local_archive_prepare_export", { documentIds }, discard),
    prepareRestore: () => call("local_archive_prepare_restore", {}, discard),
    commit: (planId) => call("local_archive_commit", { planId }), cancel,
    openDocument: (receiptId, documentId) => call("local_archive_open_restored", { receiptId, documentId }),
    reveal: (receiptId) => call("local_archive_reveal", { receiptId }),
    readNote: (receiptId, noteId) => call("local_archive_read_note", { receiptId, noteId })
  };
}
