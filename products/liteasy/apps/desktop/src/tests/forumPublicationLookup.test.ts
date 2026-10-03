import { expect, test, vi } from "vitest";
import { createForumClient } from "../app/features/forum/forumClient";
import type { ForumAnnotationPublicationOperation } from "../app/features/forum/forum.types";
import type { PublicationActorBinding } from "../app/features/forum/publicationActorBinding";
const actor: PublicationActorBinding = { endpoint: "https://community.example.invalid", issuer: "https://id.example.invalid", subject: "owner", scopeType: "user", scopeId: "owner", sessionGeneration: "runtime:1" };
const original: ForumAnnotationPublicationOperation = { operation: "upsert", annotationId: "local", queueKey: "paper:local", revision: 1,
  updatedAt: "2026-10-03T01:00:00.000Z", body: "Private original body", literatureId: "literature-1", sourcePassage: { anchorHash: "source-anchor", excerpt: "Private source excerpt", rects: [] } };
function receipt(query: unknown) { return { ...query as object, status: "matched", receipt: { annotationId: original.annotationId, queueKey: original.queueKey,
  remoteAnnotationId: "remote-1", remoteRevision: 1, state: "published", syncedAt: original.updatedAt } }; }

test("looks up a frozen PDF operation using only identity, version and digest", async () => {
  const fetchImpl = vi.fn(async (_url: string, request: RequestInit) => {
    const input = JSON.parse(String(request.body));
    expect(String(request.body)).not.toContain("Private");
    expect(input.queries[0]).toMatchObject({ annotationId: original.annotationId, queueKey: original.queueKey, revision: 1, updatedAt: original.updatedAt });
    expect(input.queries[0].operationDigest).toMatch(/^[a-f0-9]{64}$/);
    return { ok: true, json: async () => ({ results: [receipt(input.queries[0])] }) } as Response;
  });
  const client = createForumClient({ apiBaseUrl: actor.endpoint, sessionId: "synthetic", getActorBinding: () => actor, fetchImpl: fetchImpl as typeof fetch });
  expect((await client.lookupAnnotationPublications([original], actor)).results[0]).toMatchObject({ state: "published", remoteAnnotationId: "remote-1", sourceRevision: 1 });
  expect(fetchImpl.mock.calls[0][0]).toBe(`${actor.endpoint}/v1/pdf-annotations:lookup`);
});

test.each(["not_found", "conflict", "duplicate", "wrong_digest", "incomplete"])("holds PDF lookup %s without sending a create", async (status) => {
  const fetchImpl = vi.fn(async (_url: string, request: RequestInit) => {
    const query = JSON.parse(String(request.body)).queries[0];
    const matched = receipt(query);
    const results = status === "duplicate" ? [matched, matched] : [status === "wrong_digest" ? { ...matched, operationDigest: "0".repeat(64) }
      : status === "incomplete" ? { ...matched, receipt: { ...matched.receipt, syncedAt: undefined } } : { annotationId: query.annotationId, queueKey: query.queueKey, status }];
    return { ok: true, json: async () => ({ results }) } as Response;
  });
  const client = createForumClient({ apiBaseUrl: actor.endpoint, sessionId: "synthetic", getActorBinding: () => actor, fetchImpl: fetchImpl as typeof fetch });
  expect((await client.lookupAnnotationPublications([original], actor)).results[0]).toMatchObject({ state: "failed", pendingOperation: original });
  expect(fetchImpl).toHaveBeenCalledOnce();
});

test("holds PDF lookup when the verified actor changes while reading", async () => {
  let current = actor;
  const fetchImpl = vi.fn(async (_url: string, request: RequestInit) => {
    current = { ...actor, sessionGeneration: "runtime:2" };
    return { ok: true, json: async () => ({ results: [receipt(JSON.parse(String(request.body)).queries[0])] }) } as Response;
  });
  const client = createForumClient({ apiBaseUrl: actor.endpoint, sessionId: "synthetic", getActorBinding: () => current, fetchImpl: fetchImpl as typeof fetch });
  expect((await client.lookupAnnotationPublications([original], actor)).results[0]).toMatchObject({ state: "failed", pendingOperation: original });
});
