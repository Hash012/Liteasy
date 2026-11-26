import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { BrowserLibraryRepository } from "../app/features/library/browserLibraryRepository";
import { createIdeaDraft, readIdeaDrafts, saveIdeaDraft } from "../app/features/ideas/ideaDrafts";
import { submitIdea } from "../app/features/ideas/ideaSubmission";
import type { AccountStatus } from "../app/features/account/accountClient";

const account: AccountStatus = { scope: "account:alice", subject: "alice", apiBaseUrl: "https://example.test" };
const who = { schemaVersion: "liteasy.context-api/v1", subject: "alice", actor: "mobile", readScopes: ["*"], writeScopes: ["*"], expiresAt: null, idempotencyWindowSeconds: 604800 };
const receipt = (operationId: string) => ({ schemaVersion: "liteasy.context-api/v1", operationId, entryId: crypto.randomUUID(), revision: 1, scopeKey: "personal", action: "create", committedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 604800_000).toISOString() });
describe("Idea persistence and submission", () => {
  it("keeps a shared link's full content with a bounded title before creating an upload operation", async () => {
    const repository = new BrowserLibraryRepository(`ideas-${crypto.randomUUID()}`);
    const draft = createIdeaDraft(account.scope, { id: "share-link", title: "🧪".repeat(200), text: "", sourceUrl: "https://example.test/paper", state: "ready", receivedAt: new Date().toISOString(), collection: "收件箱", note: "" });
    await saveIdeaDraft(repository, draft);
    const saved = (await readIdeaDrafts(repository, account.scope))[0];
    expect(Array.from(saved.title)).toHaveLength(160);
    expect(saved.bodyMarkdown).toBe("https://example.test/paper");
    expect(saved.shareId).toBe("share-link");
    expect(saved.pending).toBeUndefined();
    await expect(saveIdeaDraft(repository, { ...saved, title: "长".repeat(161) })).rejects.toThrow("160");
    expect((await readIdeaDrafts(repository, account.scope))[0].title).toBe(saved.title);
  });
  it("keeps local drafts across repository restarts and refuses guest upload", async () => {
    const name = `ideas-${crypto.randomUUID()}`;
    const repository = new BrowserLibraryRepository(name);
    const draft = { ...createIdeaDraft("local"), bodyMarkdown: "离线的一句话想法" };
    await saveIdeaDraft(repository, draft);
    const restored = await readIdeaDrafts(new BrowserLibraryRepository(name), "local");
    expect(restored[0].bodyMarkdown).toBe(draft.bodyMarkdown);
    const port = { status: vi.fn(), request: vi.fn() };
    await expect(submitIdea(draft, account, repository, port as never)).rejects.toThrow("明确复制");
    expect(port.request).not.toHaveBeenCalled();
  });
  it("recovers the persisted operation after a lost reply and never uploads a second copy", async () => {
    const repository = new BrowserLibraryRepository(`ideas-${crypto.randomUUID()}`);
    const draft = { ...createIdeaDraft(account.scope), bodyMarkdown: "GPU 压缩态检索假设", sourceUrl: "https://example.test/paper" };
    await saveIdeaDraft(repository, draft);
    let committed: ReturnType<typeof receipt>;
    const port = { status: vi.fn(async () => account), request: vi.fn(async (path: string, _method: string, body: Record<string, unknown>, expectedScope: string) => {
      expect(expectedScope).toBe(account.scope);
      if (path.endsWith("whoami")) return who;
      if (path.endsWith("submit")) { committed = receipt(String(body.operationId)); throw new Error("lost reply"); }
      return committed;
    }) };
    await expect(submitIdea(draft, account, repository, port as never)).rejects.toThrow();
    const pending = (await readIdeaDrafts(repository, account.scope))[0];
    expect(pending.pending?.input.operationId).toBe(committed!.operationId);
    const saved = await submitIdea(draft, account, repository, port as never);
    expect(saved.receipt?.operationId).toBe(committed!.operationId);
    expect(port.request.mock.calls.filter(([path]) => path.endsWith("submit"))).toHaveLength(1);
  });
  it("pauses on account switch before any write and retains the original account draft", async () => {
    const repository = new BrowserLibraryRepository(`ideas-${crypto.randomUUID()}`);
    const draft = { ...createIdeaDraft(account.scope), bodyMarkdown: "账号 A 的想法" }; await saveIdeaDraft(repository, draft);
    let calls = 0;
    const port = { status: vi.fn(async () => ++calls >= 3 ? { ...account, scope: "account:bob", subject: "bob" } : account), request: vi.fn(async () => who) };
    await expect(submitIdea(draft, account, repository, port as never)).rejects.toThrow();
    expect((await readIdeaDrafts(repository, account.scope))[0].bodyMarkdown).toBe("账号 A 的想法");
    expect(port.request.mock.calls).toHaveLength(1);
  });
});
