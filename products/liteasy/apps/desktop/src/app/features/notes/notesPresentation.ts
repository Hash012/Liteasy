import type { NotesItem } from "./notes.types";
export type NotesSort = "updated" | "page" | "title";
export function sortNotes(items: NotesItem[], sort: NotesSort) {
  const page = (item: NotesItem) => item.page ?? item.annotation?.page ?? item.paperAnchors?.[0]?.locator.page ?? Infinity;
  return [...items].sort((a, b) => (sort === "title" ? a.title.localeCompare(b.title) : sort === "page" ? (page(a) === page(b) ? 0 : page(a) - page(b)) : b.updatedAt.localeCompare(a.updatedAt)) || a.key.localeCompare(b.key));
}
export function groupNotes(items: NotesItem[]) {
  const groups = new Map<string, { id: string; title: string; label?: string; items: NotesItem[] }>();
  for (const item of items) {
    const anchors = item.paperAnchors ?? item.object?.paperAnchors ?? [];
    const paper = item.paperIdentity ?? (item.paper ? { id: item.paper.id, title: item.paper.title } : undefined);
    const paperIds = paper ? [paper.id] : item.target.kind === "pdf-annotation" ? [item.target.paperId] : [...new Set(anchors.map(anchor => anchor.source.paperId))].sort();
    const id = paperIds.length ? `papers:${JSON.stringify(paperIds)}` : `folder:${item.defaultFolderId}`;
    const title = paper?.title ?? (paperIds.length > 1 ? "多篇论文" : paperIds.length ? anchors[0]?.presentation.title ?? "论文笔记" :
      item.defaultFolderId === "default/artifact" ? "产物笔记" : item.defaultFolderId === "default/board" ? "白板" : item.defaultFolderId === "extern" ? "外部笔记" : "个人笔记");
    if (!groups.has(id)) groups.set(id, { id, title, ...(paper || (paperIds.length === 1 && anchors[0]) ? {} : { label: title }), items: [] });
    groups.get(id)!.items.push(item);
  }
  return [...groups.values()];
}
