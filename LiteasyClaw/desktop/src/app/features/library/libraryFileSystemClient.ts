import { invoke } from "@tauri-apps/api/core";
import type { LocalLibrarySnapshot } from "./localLibrary.types";

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
  targetFolderPath?: string;
};

export type PersistDroppedPdfFiles = (
  input: PersistDroppedPdfFilesInput
) => Promise<LocalLibrarySnapshot>;

export const persistDroppedPdfFiles: PersistDroppedPdfFiles = async ({ files, targetFolderPath }) => {
  const payload = await Promise.all(files.map(async (file) => ({
    bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
    name: file.name
  })));

  return invoke<LocalLibrarySnapshot>("import_local_library_pdfs", {
    files: payload,
    targetFolderPath
  });
};

export type ReadLocalLibraryPdf = (sourcePath: string) => Promise<Uint8Array>;

export const readLocalLibraryPdf: ReadLocalLibraryPdf = async (sourcePath) => {
  const bytes = await invoke<number[]>("read_local_library_pdf", { sourcePath });
  return new Uint8Array(bytes);
};
