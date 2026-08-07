import { invoke } from "@tauri-apps/api/core";
import type {
  DuplicateLocalPdf,
  LocalLibraryImportResult,
  LocalLibrarySnapshot,
  ZoteroPdfDirectoryImportResult
} from "./localLibrary.types";

export type MoveLocalLibraryResourceInput = {
  sourcePath: string;
  targetPath: string;
};

export type MoveLocalLibraryResource = (
  input: MoveLocalLibraryResourceInput
) => Promise<void>;

export const moveLocalLibraryResource: MoveLocalLibraryResource = (input) =>
  invoke<void>("move_local_library_resource", {
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

export type PersistPdfByteStreamInput = {
  fileName: string;
  onDuplicate?: PersistDroppedPdfFilesInput["onDuplicate"];
  stream: ReadableStream<Uint8Array>;
  targetFolderPath?: string;
};

function readBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("无法读取所选文件。"));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
}

export const persistDroppedPdfFiles: PersistDroppedPdfFiles = async ({
  files,
  onDuplicate,
  targetFolderPath
}) => {
  if (files.length === 0) throw new Error("没有可导入的 PDF 文件。");
  let snapshot: LocalLibrarySnapshot | undefined;
  for (const file of files) {
    const staged = await stagePdfImport(file, targetFolderPath);
    let result = staged.result;
    if (result.status === "duplicate") {
      const saveCopy = onDuplicate
        ? await onDuplicate(result)
        : typeof window !== "undefined" && window.confirm(
            "当前内容已存在。选择“确定”另存为独立副本，选择“取消”停止本次导入。"
          );
      result = await finishStagedPdfImport(staged.importId, saveCopy ? "save_copy" : "cancel");
    }
    snapshot = result.snapshot;
  }
  if (!snapshot) throw new Error("PDF 导入没有产生本地库快照。");
  return snapshot;
};

const importChunkBytes = 512 * 1024;

function nextImportId() {
  return globalThis.crypto?.randomUUID?.() ??
    `import-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function finishStagedPdfImport(
  importId: string,
  duplicateAction?: "cancel" | "save_copy"
) {
  return invoke<LocalLibraryImportResult>("finish_local_library_pdf_import", {
    duplicateAction,
    importId
  });
}

async function stagePdfImport(file: File, targetFolderPath?: string) {
  const importId = nextImportId();
  let started = false;
  try {
    await invoke<void>("begin_local_library_pdf_import", {
      importId,
      name: file.name,
      targetFolderPath
    });
    started = true;
    for (let offset = 0; offset < file.size; offset += importChunkBytes) {
      const chunk = new Uint8Array(await readBlobArrayBuffer(
        file.slice(offset, Math.min(file.size, offset + importChunkBytes))
      ));
      await invoke<void>("append_local_library_pdf_import", {
        bytes: Array.from(chunk),
        importId
      });
    }
    return { importId, result: await finishStagedPdfImport(importId) };
  } catch (error) {
    if (started) {
      await invoke<void>("cancel_local_library_pdf_import", { importId }).catch(() => undefined);
    }
    throw error;
  }
}

export async function persistPdfByteStream({
  fileName,
  onDuplicate,
  stream,
  targetFolderPath
}: PersistPdfByteStreamInput): Promise<LocalLibrarySnapshot> {
  const importId = nextImportId();
  let started = false;
  const reader = stream.getReader();
  try {
    await invoke<void>("begin_local_library_pdf_import", {
      importId,
      name: fileName,
      targetFolderPath
    });
    started = true;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      for (let offset = 0; offset < value.byteLength; offset += importChunkBytes) {
        const chunk = value.subarray(offset, Math.min(value.byteLength, offset + importChunkBytes));
        await invoke<void>("append_local_library_pdf_import", {
          bytes: Array.from(chunk),
          importId
        });
      }
    }
    let result = await finishStagedPdfImport(importId);
    if (result.status === "duplicate") {
      const saveCopy = onDuplicate
        ? await onDuplicate(result)
        : typeof window !== "undefined" && window.confirm(
            "当前内容已存在。选择“确定”另存为独立副本，选择“取消”停止本次导入。"
          );
      result = await finishStagedPdfImport(importId, saveCopy ? "save_copy" : "cancel");
    }
    return result.snapshot;
  } catch (error) {
    if (started) {
      await invoke<void>("cancel_local_library_pdf_import", { importId }).catch(() => undefined);
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** Moves the library — papers, artifacts and index together — to a new root. */
export const setLocalLibraryRoot = (nextRootPath: string): Promise<LocalLibrarySnapshot> =>
  invoke<LocalLibrarySnapshot>("set_local_library_root", {
    nextRootPath
  });

export const selectLegacyLocalLibraryRoot = (
  legacyRootPath: string
): Promise<LocalLibrarySnapshot> =>
  invoke<LocalLibrarySnapshot>("select_legacy_local_library_root", {
    legacyRootPath
  });

export const openLocalLibraryInFileManager = (): Promise<void> =>
  invoke<void>("open_local_library_in_file_manager");

export const backupLocalLibrary = (destinationDirectory: string): Promise<string> =>
  invoke<string>("backup_local_library", { destinationDirectory });

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
    doi: input.doi,
    externalUrl: input.externalUrl,
    sourceId: input.sourceId,
    title: input.title
  });

export type ReadLocalLibraryPdf = (sourcePath: string) => Promise<Uint8Array>;

export const readLocalLibraryPdf: ReadLocalLibraryPdf = async (sourcePath) => {
  const bytes = await invoke<number[]>("read_local_library_pdf", {
    sourcePath
  });
  return new Uint8Array(bytes);
};

const localPdfReadChunkBytes = 512 * 1024;

export async function createLocalLibraryPdfStream(sourcePath: string) {
  const { byteLength } = await invoke<{ byteLength: number }>("local_library_pdf_info", {
    sourcePath
  });
  let offset = 0;
  return {
    byteLength,
    stream: new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (offset >= byteLength) {
          controller.close();
          return;
        }
        try {
          const bytes = await invoke<number[]>("read_local_library_pdf_chunk", {
            length: Math.min(localPdfReadChunkBytes, byteLength - offset),
            offset,
            sourcePath
          });
          if (bytes.length === 0) {
            controller.error(new Error("PDF 在上传期间被截断。"));
            return;
          }
          offset += bytes.length;
          controller.enqueue(Uint8Array.from(bytes));
        } catch (error) {
          controller.error(error);
        }
      }
    })
  };
}

export const createLocalLibraryFolder = (
  name: string,
  parentPath?: string
): Promise<LocalLibrarySnapshot> =>
  invoke<LocalLibrarySnapshot>("create_local_library_folder", { name, parentPath });

function zoteroRelativeParts(file: File) {
  const relativePath = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
  const parts = relativePath.split("/").filter(Boolean);
  const nested = parts.length > 1 ? parts.slice(1) : parts;
  if (
    nested.length === 0 ||
    nested.some((part) => part === "." || part === ".." || part === ".liteasy" || part.includes("\0"))
  ) {
    throw new Error(`Zotero 导出目录包含无效路径：${relativePath}`);
  }
  return nested;
}

async function confirmZoteroDuplicates(
  duplicates: DuplicateLocalPdf[],
  snapshot: LocalLibrarySnapshot,
  onDuplicate?: PersistDroppedPdfFilesInput["onDuplicate"]
) {
  const result: LocalLibraryImportResult = {
    duplicates,
    snapshot,
    status: "duplicate"
  };
  return onDuplicate
    ? onDuplicate(result)
    : typeof window !== "undefined" && window.confirm(
        `发现 ${duplicates.length} 个重复 PDF。选择“确定”另存为独立副本，选择“取消”停止本次导入。`
      );
}

export async function persistZoteroPdfDirectory(input: {
  files: File[];
  onDuplicate?: PersistDroppedPdfFilesInput["onDuplicate"];
  snapshot: LocalLibrarySnapshot;
}): Promise<ZoteroPdfDirectoryImportResult> {
  const pdfFiles = input.files
    .filter((file) => file.name.toLocaleLowerCase().endsWith(".pdf"))
    .sort((left, right) => (
      (left.webkitRelativePath || left.name).localeCompare(right.webkitRelativePath || right.name)
    ));
  if (pdfFiles.length === 0) {
    throw new Error("所选 Zotero 导出目录中没有 PDF。第一阶段不会读取 JSON、BibTeX 或 RIS。");
  }
  for (const file of pdfFiles) zoteroRelativeParts(file);

  let snapshot = input.snapshot;
  let duplicateCount = 0;
  let importedCount = 0;
  const folderPaths = new Map<string, string>([["", input.snapshot.rootPath]]);
  for (const file of pdfFiles) {
    const parts = zoteroRelativeParts(file);
    const relativeFolder = parts.slice(0, -1).join("/");
    let targetFolderPath = folderPaths.get(relativeFolder);
    if (!targetFolderPath) {
      targetFolderPath = await invoke<string>("ensure_local_library_relative_folder", {
        relativePath: relativeFolder
      });
      folderPaths.set(relativeFolder, targetFolderPath);
    }
    const importFile = new File([file], parts[parts.length - 1] ?? file.name, {
      type: file.type
    });
    const staged = await stagePdfImport(importFile, targetFolderPath);
    let result = staged.result;
    if (result.status === "duplicate") {
      duplicateCount += result.duplicates.length;
      const saveCopy = await confirmZoteroDuplicates(result.duplicates, result.snapshot, input.onDuplicate);
      if (!saveCopy) {
        result = await finishStagedPdfImport(staged.importId, "cancel");
        return {
          duplicateCount,
          importedCount,
          snapshot: result.snapshot,
          status: "cancelled"
        };
      }
      result = await finishStagedPdfImport(staged.importId, "save_copy");
    }
    snapshot = result.snapshot;
    if (result.status === "imported") importedCount += 1;
  }

  return {
    duplicateCount,
    importedCount,
    snapshot,
    status: "imported"
  };
}

export const trashLocalLibraryResource = (sourcePath: string): Promise<LocalLibrarySnapshot> =>
  invoke<LocalLibrarySnapshot>("trash_local_library_resource", { sourcePath });

export const trashLocalMetadataEntry = (documentId: string): Promise<LocalLibrarySnapshot> =>
  invoke<LocalLibrarySnapshot>("trash_local_metadata_entry", { documentId });

export const restoreLocalLibraryTrashItem = (trashId: string): Promise<LocalLibrarySnapshot> =>
  invoke<LocalLibrarySnapshot>("restore_local_library_trash_item", { trashId });

export const purgeLocalLibraryTrashItem = (trashId: string): Promise<LocalLibrarySnapshot> =>
  invoke<LocalLibrarySnapshot>("purge_local_library_trash_item", { trashId });

export const emptyLocalLibraryTrash = (): Promise<LocalLibrarySnapshot> =>
  invoke<LocalLibrarySnapshot>("empty_local_library_trash");

export const listLegacyLocalLibraryRoots = (): Promise<string[]> =>
  invoke<string[]>("list_legacy_local_library_roots");
