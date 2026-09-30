import { normalizePdfAnnotationPrivateState, normalizePdfAnnotations, revisePdfAnnotation, type PdfAnnotationV2, type PdfAnnotationPrivateState } from "@liteasy/reading-core/pdfAnnotations";
import { resolvePaperIdentity } from "@liteasy/reading-core/paperIdentity";
import type { LibraryItem, LibraryRepository } from "../library/library.types";

export type AnnotationSnapshot = PdfAnnotationPrivateState & { documentId: string; contentHash: string };
type HistoryEntry = { before?: PdfAnnotationV2; after?: PdfAnnotationV2 };
export type AnnotationInput = Pick<PdfAnnotationV2, "kind" | "page" | "rects"> & Partial<Pick<PdfAnnotationV2, "excerpt" | "text" | "note" | "color" | "ink" | "inkStrokes">>;

export class AnnotationDocument {
  snapshot: AnnotationSnapshot;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private queue = Promise.resolve();
  private loaded = false;
  private revisions = new Map<string, number>();
  constructor(private repository: LibraryRepository, private scope: string, private item: LibraryItem) {
    this.snapshot = { version: 2, autoPublic: false, annotations: [], documentId: item.id, contentHash: item.contentHash };
  }
  get key() { return `annotations:${this.item.id}`; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  async load() {
    this.loaded = false;
    const raw = await this.repository.readRecord<AnnotationSnapshot>(this.scope, this.key);
    if (raw == null) { this.loaded = true; return; }
    const normalized = normalizePdfAnnotationPrivateState(raw, resolvePaperIdentity(this.item));
    if (!normalized || normalized.annotations.length !== raw.annotations.length) throw new Error("批注格式不受支持或已损坏；原记录已保留，请先在兼容版本中恢复。");
    if ((raw.contentHash && raw.contentHash !== this.item.contentHash) || (raw.documentId && raw.documentId !== this.item.id)) throw new Error("批注属于另一份文档，已保留原数据并停止编辑。");
    this.snapshot = { ...raw, ...normalized, documentId: this.item.id, contentHash: this.item.contentHash };
    this.snapshot.annotations.forEach((value) => this.revisions.set(value.id, value.revision));
    this.loaded = true;
  }
  private serialize(action: () => Promise<void>) {
    const next = this.queue.catch(() => {}).then(action); this.queue = next; return next;
  }
  private async persist(id: string, target?: PdfAnnotationV2) {
    if (!this.loaded) throw new Error("批注尚未完整载入，未覆盖原记录。");
    const current = this.snapshot.annotations.find((value) => value.id === id);
    const revision = Math.max(this.revisions.get(id) ?? 0, current?.revision ?? 0, target?.revision ?? 0) + 1;
    const next = target ? { ...target, revision, updatedAt: new Date().toISOString() } : undefined;
    if (next && normalizePdfAnnotations([next]).length !== 1) throw new Error("批注内容无效，未保存。");
    const annotations = this.snapshot.annotations.filter((value) => value.id !== id);
    if (next) annotations.push(next);
    const snapshot = { ...this.snapshot, annotations };
    await this.repository.writeRecord(this.scope, this.key, snapshot);
    this.snapshot = snapshot; this.revisions.set(id, revision);
  }
  add(input: AnnotationInput) {
    return this.serialize(async () => {
      const date = new Date().toISOString();
      const after: PdfAnnotationV2 = { id: crypto.randomUUID(), createdAt: date, updatedAt: date, revision: 0,
        excerpt: "", text: "", color: "yellow", paperIdentity: resolvePaperIdentity(this.item),
        publication: { desiredVisibility: "private", state: "not_published" }, ...input };
      await this.persist(after.id, after);
      this.undoStack.push({ after }); this.undoStack = this.undoStack.slice(-30); this.redoStack = [];
    });
  }
  edit(id: string, text: string) {
    return this.serialize(async () => {
      const before = this.snapshot.annotations.find((value) => value.id === id);
      if (!before) throw new Error("批注不存在。");
      const after = revisePdfAnnotation(before, { text, note: text, updatedAt: new Date().toISOString() });
      await this.persist(id, after); this.undoStack.push({ before, after }); this.undoStack = this.undoStack.slice(-30); this.redoStack = [];
    });
  }
  remove(id: string) {
    return this.serialize(async () => {
      const before = this.snapshot.annotations.find((value) => value.id === id);
      if (!before) return;
      await this.persist(id); this.undoStack.push({ before }); this.undoStack = this.undoStack.slice(-30); this.redoStack = [];
    });
  }
  undo() {
    return this.serialize(async () => {
      const entry = this.undoStack.at(-1); if (!entry) return;
      await this.persist((entry.after ?? entry.before)!.id, entry.before);
      this.undoStack.pop(); this.redoStack.push(entry);
    });
  }
  redo() {
    return this.serialize(async () => {
      const entry = this.redoStack.at(-1); if (!entry) return;
      await this.persist((entry.after ?? entry.before)!.id, entry.after);
      this.redoStack.pop(); this.undoStack.push(entry);
    });
  }
}
