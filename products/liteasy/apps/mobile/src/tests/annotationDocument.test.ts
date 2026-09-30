import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { normalizePdfAnnotationPrivateState } from "@liteasy/reading-core/pdfAnnotations";
import { AnnotationDocument } from "../app/features/annotations/annotationDocument";
import { BrowserLibraryRepository } from "../app/features/library/browserLibraryRepository";
import { pagePoint } from "../app/features/annotations/annotationGeometry";

beforeAll(() => Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true }));
async function setup() {
  const repo = new BrowserLibraryRepository(crypto.randomUUID());
  const item = await repo.importResource("local", { title: "论文", filename: "paper.pdf", bytes: new TextEncoder().encode("%PDF-1.7") });
  const annotations = new AnnotationDocument(repo, "local", item); await annotations.load();
  return { repo, item, annotations };
}
const note = { kind: "note" as const, page: 1, text: "要点", rects: [{ left: 12, top: 20, width: 25, height: 10 }] };

describe("durable PDF annotation editing", () => {
  it("serializes concurrent edits, preserves desktop compatibility, and persists undo/redo", async () => {
    const { repo, item, annotations } = await setup();
    await Promise.all([annotations.add(note), annotations.add({ ...note, text: "第二条", page: 2 })]);
    expect(annotations.snapshot.annotations).toHaveLength(2);
    expect(normalizePdfAnnotationPrivateState(annotations.snapshot)?.annotations).toHaveLength(2);
    const id = annotations.snapshot.annotations[1].id;
    await annotations.edit(id, "修改后的文字");
    await annotations.undo();
    expect(annotations.snapshot.annotations.find((value) => value.id === id)?.text).toBe("第二条");
    await annotations.redo();
    const revision = annotations.snapshot.annotations.find((value) => value.id === id)!.revision;
    await annotations.remove(id); await annotations.undo();
    expect(annotations.snapshot.annotations.find((value) => value.id === id)!.revision).toBeGreaterThan(revision);
    const reopened = new AnnotationDocument(repo, "local", item); await reopened.load();
    expect(reopened.snapshot).toEqual(annotations.snapshot);
    const other = new AnnotationDocument(repo, "another-user", item); await other.load(); expect(other.snapshot.annotations).toEqual([]);
  });

  it("keeps the previous saved state and history when storage fails", async () => {
    const { repo, annotations } = await setup();
    await annotations.add(note);
    const write = vi.spyOn(repo, "writeRecord").mockRejectedValueOnce(new Error("quota exceeded"));
    await expect(annotations.remove(annotations.snapshot.annotations[0].id)).rejects.toThrow("quota");
    expect(annotations.snapshot.annotations).toHaveLength(1);
    await annotations.undo(); expect(annotations.snapshot.annotations).toHaveLength(0);
    write.mockRestore();
  });

  it("preserves unsupported or mismatched snapshots without enabling editing", async () => {
    const { repo, item, annotations } = await setup();
    const future = { version: 99, annotations: [{ valuable: "future data" }] };
    await repo.writeRecord("local", annotations.key, future);
    await expect(annotations.load()).rejects.toThrow("原记录已保留");
    await expect(annotations.add(note)).rejects.toThrow("未覆盖原记录");
    expect(await repo.readRecord("local", annotations.key)).toEqual(future);
    await repo.writeRecord("local", annotations.key, { ...annotations.snapshot, contentHash: "different" });
    await expect(new AnnotationDocument(repo, "local", item).load()).rejects.toThrow("另一份文档");
  });

  it("maps gestures to the same page coordinates after zoom and clamps page edges", () => {
    expect(pagePoint(50, 100, { left: 0, top: 0, width: 100, height: 200 })).toEqual({ x: 50, y: 50 });
    expect(pagePoint(210, 420, { left: 10, top: 20, width: 400, height: 800 })).toEqual({ x: 50, y: 50 });
    expect(pagePoint(-2, 500, { left: 0, top: 0, width: 100, height: 200 })).toEqual({ x: 0, y: 100 });
  });
});
