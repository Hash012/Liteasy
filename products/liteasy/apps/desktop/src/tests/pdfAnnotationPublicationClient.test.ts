import { describe, expect, test, vi } from "vitest";
import { createForumClient } from "../app/features/forum/forumClient";
import {
  createRetractOperation,
  createUpsertOperation
} from "../app/features/pdf/pdfAnnotationIntuechoSync";
import type { PdfAnnotationV2 } from "../app/features/pdf/pdfAnnotationStorage";
import type { LiteratureRecord } from "../app/features/paper-identity/literature.types";

const literature: LiteratureRecord = {
  authors: ["Ada Author"],
  identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/publication" }],
  literatureId: "literature-1",
  provenance: {
    confirmedAt: "2026-08-09T01:00:00.000Z",
    mode: "public_registry",
    provider: "crossref"
  },
  title: "Publication Paper",
  year: 2026
};

function annotation(input: Partial<PdfAnnotationV2> = {}): PdfAnnotationV2 {
  return {
    createdAt: "2026-08-09T00:00:00.000Z",
    excerpt: "The selected PDF excerpt.",
    id: "annotation-local-1",
    kind: "note",
    note: "  A reader note.  ",
    page: 4,
    paperIdentity: {
      candidates: [],
      paperId: "paper-1",
      primary: { id: "doi:10.1000/publication", kind: "doi", source: "public_registry", value: "10.1000/publication" },
      title: "Publication Paper"
    },
    publication: { desiredVisibility: "public", state: "pending_create" },
    rects: [{ height: 2, left: 10, top: 12, width: 40 }],
    revision: 3,
    text: "A reader note.",
    updatedAt: "2026-08-09T02:00:00.000Z",
    ...input
  };
}

describe("PDF annotation publication operations", () => {
  test("creates an upsert using the trimmed note and stable paper annotation queue key", () => {
    expect(createUpsertOperation(annotation(), literature)).toEqual({
      annotationId: "annotation-local-1",
      body: "A reader note.",
      literatureId: "literature-1",
      operation: "upsert",
      queueKey: "paper-1:annotation-local-1",
      revision: 3,
      sourcePassage: {
        anchorHash: expect.stringMatching(/^pdf:paper-1:4:[0-9a-f]{8}$/),
        excerpt: "The selected PDF excerpt.",
        page: 4,
        rects: [{ height: 2, left: 10, top: 12, width: 40 }]
      },
      updatedAt: "2026-08-09T02:00:00.000Z"
    });
  });

  test("falls back to the selected excerpt and keeps the queue key after restart", () => {
    const restored = annotation({ note: "", revision: 4 });
    expect(createUpsertOperation(restored, literature)).toMatchObject({
      body: "The selected PDF excerpt.",
      queueKey: "paper-1:annotation-local-1",
      revision: 4
    });
  });

  test("creates a retract for the confirmed remote annotation without changing the queue key", () => {
    expect(createRetractOperation(annotation({
      publication: {
        desiredVisibility: "private",
        remoteAnnotationId: "annotation-remote-1",
        remoteRevision: 7,
        state: "pending_retract"
      },
      revision: 5
    }))).toEqual({
      annotationId: "annotation-local-1",
      operation: "retract",
      queueKey: "paper-1:annotation-local-1",
      remoteAnnotationId: "annotation-remote-1",
      revision: 5,
      updatedAt: "2026-08-09T02:00:00.000Z"
    });
  });
});

describe("PDF annotation publication client", () => {
  test("sends a retract operation without claiming success early", async () => {
    const operation = createRetractOperation(annotation({
      publication: { desiredVisibility: "private", remoteAnnotationId: "annotation-remote-1", state: "pending_retract" }
    }));
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ results: [{
        annotationId: operation.annotationId,
        queueKey: operation.queueKey,
        remoteAnnotationId: "annotation-remote-1",
        remoteRevision: 8,
        state: "retracted",
        syncedAt: "2026-08-09T03:00:00.000Z"
      }] }),
      ok: true,
      status: 200
    }));
    const client = createForumClient({ fetchImpl: fetchMock as unknown as typeof fetch, getSessionId: () => "desktop-session" });

    const result = await client.applyAnnotationPublications([operation]);

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/v1/pdf-annotations:sync"), expect.objectContaining({
      body: JSON.stringify({ operations: [operation] }),
      headers: expect.objectContaining({ Authorization: "Bearer desktop-session", "Content-Type": "application/json" }),
      method: "POST"
    }));
    expect(result.results[0]).toMatchObject({ state: "retracted", remoteRevision: 8 });
    expect(result.results[0]).toMatchObject({ sourceRevision: operation.revision });
  });

  test("fails every duplicate queue-key operation before sending a divergent batch", async () => {
    const first = createUpsertOperation(annotation(), literature);
    const second = { ...first, body: "Divergent body", revision: first.revision + 1 };
    const fetchMock = vi.fn();
    const client = createForumClient({ fetchImpl: fetchMock as unknown as typeof fetch, sessionId: "desktop-session" });

    await expect(client.applyAnnotationPublications([first, second])).resolves.toEqual({
      results: [first, second].map((pendingOperation) => ({
        annotationId: pendingOperation.annotationId,
        code: "DUPLICATE_PUBLICATION_QUEUE_KEY",
        error: "同一批发布请求包含重复的队列键。",
        pendingOperation,
        queueKey: pendingOperation.queueKey,
        state: "failed"
      }))
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([
    ["missing result", { results: [] }],
    ["wrong queue key", { results: [{ annotationId: "annotation-local-1", queueKey: "wrong", remoteAnnotationId: "remote", remoteRevision: 1, state: "published", syncedAt: "2026-08-09T03:00:00.000Z" }] }],
    ["wrong annotation ID", { results: [{ annotationId: "wrong", queueKey: "paper-1:annotation-local-1", remoteAnnotationId: "remote", remoteRevision: 1, state: "published", syncedAt: "2026-08-09T03:00:00.000Z" }] }],
    ["invalid remote revision", { results: [{ annotationId: "annotation-local-1", queueKey: "paper-1:annotation-local-1", remoteAnnotationId: "remote", remoteRevision: 0, state: "published", syncedAt: "2026-08-09T03:00:00.000Z" }] }]
  ])("fails closed for a %s while retaining the pending operation", async (_label, responseBody) => {
    const operation = createUpsertOperation(annotation(), literature);
    const client = createForumClient({
      fetchImpl: vi.fn(async () => ({ json: async () => responseBody, ok: true, status: 200 })) as unknown as typeof fetch,
      sessionId: "desktop-session"
    });

    await expect(client.applyAnnotationPublications([operation])).resolves.toEqual({
      results: [{
        annotationId: operation.annotationId,
        error: "论坛发布响应无法验证，请稍后重试。",
        pendingOperation: operation,
        queueKey: operation.queueKey,
        state: "failed"
      }]
    });
  });

  test("keeps the operation retryable when authentication is unavailable", async () => {
    const operation = createUpsertOperation(annotation(), literature);
    const fetchMock = vi.fn();
    const client = createForumClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    await expect(client.applyAnnotationPublications([operation])).resolves.toEqual({
      results: [{
        annotationId: operation.annotationId,
        error: "请先登录 Liteasy 再打开论坛发布页。",
        pendingOperation: operation,
        queueKey: operation.queueKey,
        state: "failed"
      }]
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects a retract receipt for a different remote annotation", async () => {
    const operation = createRetractOperation(annotation({
      publication: { desiredVisibility: "private", remoteAnnotationId: "annotation-remote-1", state: "pending_retract" }
    }));
    const client = createForumClient({
      fetchImpl: vi.fn(async () => ({
        json: async () => ({ results: [{
          annotationId: operation.annotationId,
          queueKey: operation.queueKey,
          remoteAnnotationId: "annotation-remote-other",
          remoteRevision: 8,
          state: "retracted",
          syncedAt: "2026-08-09T03:00:00.000Z"
        }] }),
        ok: true,
        status: 200
      })) as unknown as typeof fetch,
      sessionId: "desktop-session"
    });

    await expect(client.applyAnnotationPublications([operation])).resolves.toEqual({
      results: [expect.objectContaining({
        pendingOperation: operation,
        state: "failed"
      })]
    });
  });

  test("preserves a valid server failure while retaining its pending operation", async () => {
    const operation = createUpsertOperation(annotation(), literature);
    const client = createForumClient({
      fetchImpl: vi.fn(async () => ({
        json: async () => ({ results: [{
          annotationId: operation.annotationId,
          code: "LITERATURE_NOT_FOUND",
          error: "LITERATURE_NOT_FOUND",
          message: "已确认的文献记录不存在。",
          queueKey: operation.queueKey
        }] }),
        ok: true,
        status: 200
      })) as unknown as typeof fetch,
      sessionId: "desktop-session"
    });

    await expect(client.applyAnnotationPublications([operation])).resolves.toEqual({
      results: [{
        annotationId: operation.annotationId,
        code: "LITERATURE_NOT_FOUND",
        error: "LITERATURE_NOT_FOUND",
        message: "已确认的文献记录不存在。",
        pendingOperation: operation,
        queueKey: operation.queueKey,
        state: "failed"
      }]
    });
  });
});
