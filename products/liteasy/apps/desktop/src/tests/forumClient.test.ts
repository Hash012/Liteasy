import { describe, expect, test, vi } from "vitest";
import { createForumClient } from "../app/features/forum/forumClient";
import type { ForumContext, ForumPaperIdentity } from "../app/features/forum/forum.types";

const identity: ForumPaperIdentity = {
  id: "doi:10.1000/reliable",
  kind: "doi",
  source: "metadata",
  value: "10.1000/reliable"
};

function context(): ForumContext {
  return {
    targets: [{
      anchorHash: "sha256:source",
      excerpt: "一段选文",
      kind: "source_passage",
      literature: { literatureId: "lit_01J00000000000000000000000" },
      page: 7,
      rects: []
    }]
  };
}

describe("forum client", () => {
  test("creates an annotation handoff without a topic or server work mapping", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ expiresAt: "2026-08-07T01:05:00.000Z", handoffId: "handoff-1" }),
      ok: true,
      status: 201
    }));
    const client = createForumClient({ apiBaseUrl: "http://forum.test", fetchImpl: fetchMock as unknown as typeof fetch, sessionId: "intuecho-token" });

    await client.createDraftHandoff(context());

    expect(fetchMock).toHaveBeenCalledWith("http://forum.test/v1/integrations/desktop/annotation-handoffs", expect.objectContaining({
      body: JSON.stringify({ ...context(), body: "", tags: [], shareToPlaza: true, visibility: "public" }),
      headers: expect.objectContaining({ Authorization: "Bearer intuecho-token" }),
      method: "POST"
    }));
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).not.toHaveProperty("topicId");
    expect(body).not.toHaveProperty("workId");
    expect(body).not.toHaveProperty("sourcePath");
  });

  test("loads a public contextual feed by stable literature identity", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ annotations: [] }),
      ok: true,
      status: 200
    }));
    const client = createForumClient({ apiBaseUrl: "http://forum.test", fetchImpl: fetchMock as unknown as typeof fetch, sessionId: "desktop-token" });

    await client.feed({ literatureId: "lit_01J00000000000000000000000" });

    expect(fetchMock).toHaveBeenCalledWith("http://forum.test/v1/plaza?limit=3&literatureId=lit_01J00000000000000000000000&sort=recommended", expect.objectContaining({ headers: {} }));
  });

  test("includes annotation text in the one-time handoff", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ expiresAt: "2026-08-07T01:05:00.000Z", handoffId: "handoff-1" }),
      ok: true,
      status: 201
    }));
    const client = createForumClient({ apiBaseUrl: "http://forum.test", fetchImpl: fetchMock as unknown as typeof fetch, sessionId: "intuecho-token" });

    await client.createDraftHandoff(context(), { body: "我的批注", tags: ["证据"] });

    expect(fetchMock).toHaveBeenCalledWith("http://forum.test/v1/integrations/desktop/annotation-handoffs", expect.objectContaining({
      body: JSON.stringify({ ...context(), body: "我的批注", tags: ["证据"], shareToPlaza: true, visibility: "public" }),
      method: "POST"
    }));
  });

  test("rejects handoff creation without a Liteasy desktop session", async () => {
    const client = createForumClient({ apiBaseUrl: "http://forum.test", fetchImpl: vi.fn() as unknown as typeof fetch });
    await expect(client.createDraftHandoff(context())).rejects.toThrow("请先登录 Liteasy");
  });
});
