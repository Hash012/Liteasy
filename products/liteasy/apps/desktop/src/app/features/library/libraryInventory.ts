import type { ObjectRef } from "../objects/object.types";
import type { PaperResourceKind } from "../import/paperResource.types";

export type LibraryPaperChildItem = {
  id: string;
  kind: "artifact" | "note" | "board" | PaperResourceKind;
  objectId?: string;
  ref?: ObjectRef;
  canonicalKey?: string;
  label: string;
  meta?: string;
};
export type LibraryInventory = {
  state: "unknown" | "loading" | "ready" | "error";
  items: LibraryPaperChildItem[];
  inventoryRevision?: string;
  summary?: string;
  extraction: "unknown" | "not_extracted" | "loading" | "ready" | "error";
};
export function deduplicateLibraryChildren(items: LibraryPaperChildItem[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = item.ref ? JSON.stringify([item.ref.objectId, item.ref.revision]) : item.canonicalKey ?? `${item.kind}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export const libraryChildGroup = (kind: LibraryPaperChildItem["kind"]) =>
  kind === "artifact" ? "生成结果" : kind === "note" || kind === "board" ? "笔记与白板" : "提取视图";
export function inventoryLabel(inventory: LibraryInventory) {
  if (inventory.state === "ready") return `${inventory.items.length} 项关联内容`;
  return inventory.state === "error" ? "关联内容读取失败" : inventory.state === "loading" ? "关联内容加载中" : "关联内容尚未查询";
}
