import { displayPath } from "../resource-filesystem/displayPath";

export const libraryFileDragType = "application/x-liteasy-reading-file";
export function normalizedLibraryPath(path: string) {
  return displayPath(path).replace(/\\/g, "/").replace(/\/+$/, "");
}
export function relativeLibraryFolder(root: string | undefined, target?: string) {
  if (!target) return "";
  if (!root) throw new Error("本地文献库尚未加载，请稍后重试。");
  const base = normalizedLibraryPath(root), path = normalizedLibraryPath(target);
  const windows = /^(?:[a-z]:|\/\/)/i.test(base);
  const compare = (value: string) => windows ? value.toLowerCase() : value;
  if (compare(base) === compare(path)) return "";
  if (!compare(path).startsWith(`${compare(base)}/`)) throw new Error("目标目录不在当前本地文献库中。");
  const relative = path.slice(base.length + 1);
  if (relative.split("/").some((part) => !part || part === ".." || part === ".")) throw new Error("目标目录无效。");
  return relative;
}
export function libraryFolderKey(path: string) {
  const normalized = normalizedLibraryPath(path);
  return /^(?:[a-z]:|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized;
}
