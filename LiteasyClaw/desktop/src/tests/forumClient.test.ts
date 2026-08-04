import { describe, expect, test, vi } from "vitest";
import { createForumClient } from "../app/features/forum/forumClient";

describe("forum client", () => {
  test("creates a contextual draft without leaking local-only fields", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ draftId: "draft-1" }),
      ok: true,
      status: 201
    }));
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const client = createForumClient({ apiBaseUrl: "http://forum.test", fetchImpl });

    await client.createContextualDraft({
      citationEnabled: true,
      excerpt: "一段选文",
      language: "zh-CN",
      page: 7,
      topicId: "rag-reliability"
    });

    expect(fetchMock).toHaveBeenCalledWith("http://forum.test/v1/drafts/contextual", expect.objectContaining({
      body: JSON.stringify({ citationEnabled: true, excerpt: "一段选文", language: "zh-CN", page: 7, topicId: "rag-reliability" }),
      method: "POST"
    }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1] && (fetchMock.mock.calls[0][1] as RequestInit).body))).not.toHaveProperty("sourcePath");
  });

  test("loads contextual feed with a stable query", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ posts: [] }),
      ok: true,
      status: 200
    }));
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const client = createForumClient({ apiBaseUrl: "http://forum.test", fetchImpl });

    await client.feed({ anchorHash: "anchor-1", workId: "work-1" });

    expect(fetchMock).toHaveBeenCalledWith("http://forum.test/v1/contextual-feed?workId=work-1&anchorHash=anchor-1", expect.anything());
  });

  test("saves annotation text into the created draft", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ draftId: "draft-1" }), ok: true, status: 201 })
      .mockResolvedValueOnce({ json: async () => ({ draftId: "draft-1", ok: true, updatedAt: "now" }), ok: true, status: 200 });
    const client = createForumClient({ apiBaseUrl: "http://forum.test", fetchImpl: fetchMock as unknown as typeof fetch });

    await client.updateDraft("draft-1", { body: "我的批注", citationEnabled: true });

    expect(fetchMock).toHaveBeenCalledWith("http://forum.test/v1/drafts/draft-1", expect.objectContaining({
      body: JSON.stringify({ body: "我的批注", citationEnabled: true, tags: [] }),
      method: "PUT"
    }));
  });
});
