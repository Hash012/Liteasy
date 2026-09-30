import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { BrowserLibraryRepository } from "../app/features/library/browserLibraryRepository";

beforeAll(() => Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true }));

describe("offline library", () => {
  it("commits attachments and metadata together and reopens without a network", async () => {
    const name = crypto.randomUUID();
    const repo = new BrowserLibraryRepository(name);
    const bytes = new TextEncoder().encode("%PDF-1.7\nfixture");
    const item = await repo.importResource("local", { title: "论文", filename: "paper.pdf", mimeType: "application/pdf", bytes });
    const reopened = new BrowserLibraryRepository(name);
    expect((await reopened.list("local"))[0].contentHash).toHaveLength(64);
    expect(Array.from(await reopened.readBytes("local", item.id))).toEqual(Array.from(bytes));
    expect(await reopened.list("other-account")).toEqual([]);
    await expect(reopened.readBytes("other-account", item.id)).rejects.toThrow("尚未下载");
  });

  it("deduplicates concurrent imports without replacing the user's classification", async () => {
    const repo = new BrowserLibraryRepository(crypto.randomUUID());
    const input = { title: "网址", sourceUrl: "https://example.org/paper" };
    const [first, second] = await Promise.all([repo.importResource("local", input), repo.importResource("local", input)]);
    expect(first.id).toBe(second.id);
    await repo.update("local", { ...first, collection: "项目 A", note: "保留这条备注" });
    const duplicate = await repo.importResource("local", { ...input, collection: "收件箱" });
    expect(duplicate.collection).toBe("项目 A");
    expect(duplicate.note).toBe("保留这条备注");
    expect(await repo.list("local")).toHaveLength(1);
  });

  it("rejects stale edits and restores deleted entries without duplicating attachments", async () => {
    const repo = new BrowserLibraryRepository(crypto.randomUUID());
    const input = { title: "笔记", text: "今天的想法" };
    const item = await repo.importResource("local", input);
    await repo.update("local", { ...item, deletedAt: new Date().toISOString() });
    await expect(repo.update("local", { ...item, title: "旧窗口修改" })).rejects.toThrow("其他窗口");
    const restored = await repo.importResource("local", input);
    expect(restored.deletedAt).toBeUndefined();
    expect(restored.id).toBe(item.id);
  });

  it("rejects disguised PDFs and unsafe links before publishing an item", async () => {
    const repo = new BrowserLibraryRepository(crypto.randomUUID());
    await expect(repo.importResource("local", { title: "假 PDF", filename: "paper.pdf", bytes: new TextEncoder().encode("<html>login</html>") })).rejects.toThrow("PDF");
    await expect(repo.importResource("local", { title: "链接", sourceUrl: "javascript:alert(1)" })).rejects.toThrow("HTTP");
    expect(await repo.list("local")).toEqual([]);
  });
});
