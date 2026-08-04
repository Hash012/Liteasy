import { invoke } from "@tauri-apps/api/core";
import type { LocalLibraryImportResult, LocalLibrarySnapshot } from "./localLibrary.types";
import { resolveLocalAccountKey } from "./localAccountKey";

export type MoveLocalLibraryResourceInput = {
  sourcePath: string;
  targetPath: string;
};

export type MoveLocalLibraryResource = (
  input: MoveLocalLibraryResourceInput
) => Promise<void>;

export const moveLocalLibraryResource: MoveLocalLibraryResource = (input) =>
  invoke<void>("move_local_library_resource", {
    accountKey: resolveLocalAccountKey(),
    sourcePath: input.sourcePath,
    targetPath: input.targetPath
  });

export type PersistDroppedPdfFilesInput = {
  files: File[];
  onDuplicate?: (result: LocalLibraryImportResult) => boolean | Promise<boolean>;
  targetFolderPath?: string;
};

export type PersistDroppedPdfFiles = (
  input: PersistDroppedPdfFilesInput
) => Promise<LocalLibrarySnapshot>;

export const persistDroppedPdfFiles: PersistDroppedPdfFiles = async ({
  files,
  onDuplicate,
  targetFolderPath
}) => {
  const payload = await Promise.all(files.map(async (file) => ({
    bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
    name: file.name
  })));

  const accountKey = resolveLocalAccountKey();
  const result = await invoke<LocalLibraryImportResult>("import_local_library_pdfs", {
    accountKey,
    duplicateAction: undefined,
    files: payload,
    targetFolderPath
  });
  if (result.status !== "duplicate") return result.snapshot;
  const saveCopy = onDuplicate
    ? await onDuplicate(result)
    : typeof window !== "undefined" && window.confirm(
        "当前内容已存在。选择“确定”另存为独立副本，选择“取消”停止本次导入。"
      );
  if (!saveCopy) return result.snapshot;
  const saved = await invoke<LocalLibraryImportResult>("import_local_library_pdfs", {
    accountKey,
    duplicateAction: "save_copy",
    files: payload,
    targetFolderPath
  });
  return saved.snapshot;
};

/** Moves the library — papers, artifacts and index together — to a new root. */
export const setLocalLibraryRoot = (nextRootPath: string): Promise<LocalLibrarySnapshot> =>
  invoke<LocalLibrarySnapshot>("set_local_library_root", {
    accountKey: resolveLocalAccountKey(),
    nextRootPath
  });

export const openLocalLibraryInFileManager = (): Promise<void> =>
  invoke<void>("open_local_library_in_file_manager", {
    accountKey: resolveLocalAccountKey()
  });

export type AddMetadataOnlyLibraryEntryInput = {
  doi?: string;
  externalUrl?: string;
  sourceId?: string;
  title: string;
};

/** Records a paper that can be listed and cited but never opened — what a non-open-access
 *  result becomes when the user keeps it. */
export const addMetadataOnlyLibraryEntry = (
  input: AddMetadataOnlyLibraryEntryInput
): Promise<LocalLibrarySnapshot> =>
  invoke<LocalLibrarySnapshot>("add_metadata_only_library_entry", {
    accountKey: resolveLocalAccountKey(),
    doi: input.doi,
    externalUrl: input.externalUrl,
    sourceId: input.sourceId,
    title: input.title
  });

export type ReadLocalLibraryPdf = (sourcePath: string) => Promise<Uint8Array>;

export const readLocalLibraryPdf: ReadLocalLibraryPdf = async (sourcePath) => {
  const bytes = await invoke<number[]>("read_local_library_pdf", {
    accountKey: resolveLocalAccountKey(),
    sourcePath
  });
  return new Uint8Array(bytes);
};
