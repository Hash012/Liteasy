import type { DockItemId } from "../features/dock/dock.types";
import type { PaperResourceKind } from "../features/import/paperResource.types";
import type { NotesItem } from "../features/notes/notes.types";
import type { ReadingCatalogEntry } from "../features/library/readingCatalog.types";
import type { RecommendationItem } from "../features/recommendations/recommendation.types";
import type { WorkspacePageTarget } from "../features/workspace/pageHistory";

/** Resolve history against the current library; never keep document bodies in navigation state. */
export function createWorkspacePageRestorer(input: {
  openAsset(path: string): unknown;
  recommendations: RecommendationItem[];
  openRecommendation(item: RecommendationItem): unknown;
  notes: NotesItem[];
  selectNote(item: NotesItem): void;
  readingEntries: ReadingCatalogEntry[];
  openReading(entry: ReadingCatalogEntry): unknown;
  hasPaper(id: string): boolean;
  hasPaperResource(id: string, kind: PaperResourceKind): boolean;
  openPaper(id: string): void;
  openPaperResource(id: string, kind: PaperResourceKind): void;
  openDock(item: DockItemId): void;
}) {
  return async (target: WorkspacePageTarget) => {
    if (target.kind === "resource") { await input.openAsset(target.path); return; }
    if (target.kind === "recommendation") {
      const item = input.recommendations.find((item) => item.id === target.id);
      if (!item) throw new Error("这条推荐已不在列表中，请重新检索。");
      await input.openRecommendation(item);
      input.openDock("recommendation-reader");
      return;
    }
    if (target.kind === "note-selection") {
      const item = input.notes.find((item) => item.key === target.key);
      if (!item) throw new Error("笔记已不在列表中，请刷新笔记后重试。");
      input.selectNote(item); input.openDock("notes"); return;
    }
    if (target.kind === "paper") {
      if (!input.hasPaper(target.id)) throw new Error("论文已移出当前文献库。");
      input.openPaper(target.id); return;
    }
    if (target.kind === "paper-resource") {
      if (!input.hasPaperResource(target.paperId, target.resourceKind)) throw new Error("论文提取内容已不可用，请从文献库重新解析。");
      input.openPaperResource(target.paperId, target.resourceKind); return;
    }
    if (target.kind === "reading") {
      const entry = input.readingEntries.find((item) => item.id === target.id);
      if (!entry) throw new Error("文件已移出文献库。");
      await input.openReading(entry); return;
    }
    input.openDock(target.itemId);
  };
}
