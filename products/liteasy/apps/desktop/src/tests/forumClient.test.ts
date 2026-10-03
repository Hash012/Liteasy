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
    visibility: "private",
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
      body: expect.any(String),
      headers: expect.objectContaining({ Authorization: "Bearer intuecho-token" }),
      method: "POST"
    }));
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).not.toHaveProperty("topicId");
    expect(body).not.toHaveProperty("workId");
    expect(body).not.toHaveProperty("sourcePath");
    expect(body).toEqual({ ...context(), body: "", tags: [], shareToPlaza: false });
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
      body: expect.any(String),
      method: "POST"
    }));
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ ...context(), body: "我的批注", tags: ["证据"], shareToPlaza: false });
  });

  test("rejects handoff creation without a Liteasy desktop session", async () => {
    const client = createForumClient({ apiBaseUrl: "http://forum.test", fetchImpl: vi.fn() as unknown as typeof fetch });
    await expect(client.createDraftHandoff(context())).rejects.toThrow("请先登录 Liteasy");
  });

  test("does not upload an older draft without an explicit audience", async () => {
    const fetchMock = vi.fn();
    const client = createForumClient({ fetchImpl: fetchMock, sessionId: "synthetic-session" });
    await expect(client.createDraftHandoff({ ...context(), visibility: undefined })).rejects.toThrow("选择");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("projects only approved handoff fields, including nested evidence", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ handoffId: "synthetic-handoff" }) }));
    const client = createForumClient({ fetchImpl: fetchMock as unknown as typeof fetch, sessionId: "synthetic-session" });
    const draft = { ...context(), localPath: "D:\\private\\paper.pdf", apiKey: "synthetic-secret", targets: [{
      ...context().targets[0], privateUrl: "https://private.test/signed", literature: { literatureId: "lit_01J00000000000000000000000", filePath: "private-file" },
      rects: [{ left: 0.1, top: 0.2, width: 0.3, height: 0.4, localSecret: "synthetic-secret" }]
    }] } as ForumContext;
    await client.createDraftHandoff(draft);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ ...context(), body: "", tags: [], shareToPlaza: false,
      targets: [{ ...context().targets[0], rects: [{ left: 0.1, top: 0.2, width: 0.3, height: 0.4 }] }]
    });
    expect(JSON.stringify(body)).not.toMatch(/synthetic-secret|private-file|private\.test/);
  });
});
