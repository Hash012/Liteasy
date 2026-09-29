import { DEFAULT_NOTES_FOLDERS, NOTES_ROOT, type NotesFolder } from "./notes.types";

/** Old imports may contain orphaned folders; never let corrupt ancestry loop the UI. */
export function notesAncestors(folderId: string, folders: NotesFolder[] | Map<string, NotesFolder>): NotesFolder[] {
  const byId = folders instanceof Map ? folders : new Map(folders.map((folder) => [folder.folderId, folder]));
  const visited = new Set<string>();
  const result: NotesFolder[] = [];
  let folder = byId.get(folderId);
  while (folder && !visited.has(folder.folderId)) {
    visited.add(folder.folderId);
    result.unshift(folder);
    folder = byId.get(folder.parentId);
  }
  return result;
}

export function notesFolderPath(folderId: string, folders: NotesFolder[] | Map<string, NotesFolder>) {
  return notesAncestors(folderId, folders).map((folder) => folder.name).join("/");
}

export function notesFolderChildren(parentId: string, folders: NotesFolder[]) {
  const ids = new Set(folders.map((folder) => folder.folderId));
  const order = new Map(DEFAULT_NOTES_FOLDERS.map((folder, index) => [folder.folderId, index]));
  return folders.filter((folder) => folder.parentId === parentId ||
    (parentId === NOTES_ROOT && !ids.has(folder.parentId) && folder.parentId !== NOTES_ROOT))
    .sort((a, b) => (order.get(a.folderId) ?? Infinity) - (order.get(b.folderId) ?? Infinity) || a.name.localeCompare(b.name));
}

/** Build once for a Vault; rendering each row must not scan all directories. */
export function notesTreeIndex(folders: NotesFolder[]) {
  const byId = new Map(folders.map((folder) => [folder.folderId, folder]));
  const children = new Map<string, NotesFolder[]>();
  const order = new Map(DEFAULT_NOTES_FOLDERS.map((folder, index) => [folder.folderId, index]));
  for (const folder of folders) {
    const parent = byId.has(folder.parentId) ? folder.parentId : NOTES_ROOT;
    const siblings = children.get(parent) ?? [];
    siblings.push(folder);
    children.set(parent, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) =>
    (order.get(a.folderId) ?? Infinity) - (order.get(b.folderId) ?? Infinity) || a.name.localeCompare(b.name));
  return { byId, children };
}
