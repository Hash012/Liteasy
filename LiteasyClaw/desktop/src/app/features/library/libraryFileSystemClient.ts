import { invoke } from "@tauri-apps/api/core";

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
