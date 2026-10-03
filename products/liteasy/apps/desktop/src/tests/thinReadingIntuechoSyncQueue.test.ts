import { describe, expect, test, vi } from "vitest";
import { createThinReadingFixture } from "./fixtures/thinReadingFixtures";
import {
  addThinReadingAnnotation,
  advanceThinReadingDocument,
  createThinReadingDocument
} from "../app/features/thin-reading/thinReadingProjection";
import {
  THIN_READING_INTUECHO_PENDING_LABEL,
  createHttpIntuechoSyncAdapter,
  createLocalPendingIntuechoSyncAdapter,
  listThinReadingPendingPublicAnnotations as listUnboundAnnotations
} from "../app/features/thin-reading/thinReadingIntuechoSyncQueue";
import type { PublicationActorBinding } from "../app/features/forum/publicationActorBinding";
const actor: PublicationActorBinding = { endpoint: "https://intuecho.example.com", issuer: "https://identity.example.com",
  subject: "synthetic-a", scopeId: "synthetic-a", scopeType: "user", sessionGeneration: "runtime:1" };
function listThinReadingPendingPublicAnnotations(document: Parameters<typeof listUnboundAnnotations>[0]) {
  return listUnboundAnnotations(document).map((item) => ({ ...item, actorBinding: actor }));
}

function createSyncableFixture() {
  const source = createThinReadingFixture();
  return {
    ...source,
    papers: [{
      ...source.papers[0],
      literature: {
        authors: ["Ashish Vaswani"],
        identifiers: [{ kind: "doi" as const, source: "public_registry" as const, value: "10.48550/arxiv.1706.03762" }],
        literatureId: "lit_01J00000000000000000000000",
        provenance: {
          confirmedAt: "2026-08-10T00:00:00.000Z",
          mode: "public_registry" as const,
          provider: "crossref" as const
        },
        revision: 1,
        status: "confirmed" as const,
        title: source.papers[0].title,
        year: 2017
      }
    }]
  };
}

describe("thinReadingIntuechoSyncQueue", () => {
  test("persists the original operation across edits and only resumes a known actor explicitly", async () => {
    const { prepareThinReadingPublications } = await import("../app/features/thin-reading/thinReadingIntuechoSyncQueue");
    const root = createThinReadingDocument({ ...createSyncableFixture(), artifactId: "durable-thin-queue" });
    const added = addThinReadingAnnotation(root, { body: "Original note", excerpt: "evidence", nodeId: root.rootNodeId, visibility: "pending_public" });
    const bound = { ...added, annotations: added.annotations.map((annotation) => ({ ...annotation, publication: { actorBinding: actor } })) };
    const prepared = prepareThinReadingPublications(bound, actor);
    const operation = prepared.annotations[0].publication?.pendingOperation;
    expect(operation).toMatchObject({ body: "Original note", queueKey: `durable-thin-queue:${added.annotations[0].id}` });
    const edited = { ...prepared, annotations: prepared.annotations.map((annotation) => ({ ...annotation, body: "Later edit", updatedAt: "2026-10-03T12:00:00.000Z" })) };
    const newSession = { ...actor, sessionGeneration: "runtime:2" };
    expect(prepareThinReadingPublications(edited, newSession).annotations[0].publication?.actorBinding).toEqual(actor);
    const resumed = prepareThinReadingPublications(edited, newSession, { resumePublication: true });
    expect(resumed.annotations[0].publication).toMatchObject({ actorBinding: newSession, pendingOperation: operation, outcome: "unknown" });
    expect(prepareThinReadingPublications(added, actor, { resumePublication: true }).annotations[0].publication).toBeUndefined();
    const { applyThinReadingAnnotationSyncResults } = await import("../app/features/thin-reading/thinReadingProjection");
    const reconciled = applyThinReadingAnnotationSyncResults(resumed, [{ annotationId: added.annotations[0].id,
      status: "synced", intuechoAnnotationId: "remote-1", syncedAt: "2026-10-03T00:00:00.000Z" }],
      "2026-10-03T00:00:00.000Z", new Map([[added.annotations[0].id, operation!.updatedAt]]));
    expect(reconciled.annotations[0].syncState).toBeUndefined();
    expect(reconciled.annotations[0].publication?.pendingOperation).toBeUndefined();
    expect(listUnboundAnnotations(reconciled)).toHaveLength(1);
    expect(prepareThinReadingPublications(reconciled, newSession).annotations[0].publication?.pendingOperation?.body).toBe("Later edit");
  });

  test("binds only a new explicit publication intent and leaves recovered unbound queue items alone", async () => {
    const { bindThinReadingPublicationIntents } = await import("../app/features/thin-reading/thinReadingIntuechoSyncQueue");
    const root = createThinReadingDocument({ ...createSyncableFixture(), artifactId: "explicit-intent" });
    const next = addThinReadingAnnotation(root, { body: "New explicit note", excerpt: "evidence", nodeId: root.rootNodeId, visibility: "pending_public" });
    expect(bindThinReadingPublicationIntents(root, next, actor).annotations[0].publication?.actorBinding).toEqual(actor);
    expect(bindThinReadingPublicationIntents(next, { ...next }, actor).annotations[0].publication).toBeUndefined();
  });

  test("holds unbound and other-account items without sending a batch", async () => {
    const root = createThinReadingDocument({ ...createSyncableFixture(), artifactId: "actor-bound-queue" });
    const document = addThinReadingAnnotation(root, { body: "Synthetic note", excerpt: "evidence", nodeId: root.rootNodeId, visibility: "pending_public" });
    const transport = vi.fn();
    const adapter = createHttpIntuechoSyncAdapter({ endpoint: actor.endpoint, getActorBinding: () => actor, sessionId: "synthetic-token", transport });
    const unbound = listUnboundAnnotations(document);
    expect((await adapter.syncPendingAnnotations(unbound))[0].status).toBe("failed");
    expect((await adapter.syncPendingAnnotations(unbound.map((item) => ({ ...item,
      actorBinding: { ...actor, subject: "synthetic-b", scopeId: "synthetic-b" }
    }))))[0].status).toBe("failed");
    expect(transport).not.toHaveBeenCalled();
  });

  test("does not apply a late batch receipt after the actor changes", async () => {
    const root = createThinReadingDocument({ ...createSyncableFixture(), artifactId: "late-actor-queue" });
    const document = addThinReadingAnnotation(root, { body: "Synthetic note", excerpt: "evidence", nodeId: root.rootNodeId, visibility: "pending_public" });
    const queue = listThinReadingPendingPublicAnnotations(document);
    let current = actor;
    const adapter = createHttpIntuechoSyncAdapter({ endpoint: actor.endpoint, getActorBinding: () => current, sessionId: "synthetic-token",
      transport: async () => { current = { ...actor, sessionGeneration: "runtime:2" }; return {
        ok: true, status: 200, json: async () => ({ results: queue.map((item) => ({ annotationId: item.annotationId,
          queueKey: item.queueKey, status: "synced", syncedAt: "2026-10-03T00:00:00.000Z", intuechoAnnotationId: "remote-1" })) })
      }; }
    });
    expect((await adapter.syncPendingAnnotations(queue))[0].status).toBe("failed");
  });

  test("rejects conflicting duplicate receipts and keeps confirmed batch items out of retries", async () => {
    const root = createThinReadingDocument({ ...createSyncableFixture(), artifactId: "artifact-sync-receipts" });
    let document = addThinReadingAnnotation(root, {
      body: "第一条合成批注。", excerpt: "first", nodeId: root.rootNodeId, visibility: "pending_public"
    });
    document = addThinReadingAnnotation(document, {
      body: "第二条合成批注。", excerpt: "second", nodeId: root.rootNodeId, visibility: "pending_public"
    });
    const queue = listThinReadingPendingPublicAnnotations(document);
    const receipts = queue.map((item, index) => ({
      annotationId: item.annotationId,
      intuechoAnnotationId: `intuecho-remote-${index}`,
      queueKey: item.queueKey,
      status: "synced",
      syncedAt: "2026-07-28T01:00:00.000Z"
    }));
    const results = await createHttpIntuechoSyncAdapter({
      getActorBinding: () => actor,
      endpoint: "https://intuecho.example.com",
      sessionId: "desktop-token",
      transport: async () => ({
        json: async () => ({ results: [receipts[0], { ...receipts[0], intuechoAnnotationId: "conflicting" }, receipts[1]] }),
        ok: true,
        status: 200
      })
    }).syncPendingAnnotations(queue);

    expect(results).toEqual([
      expect.objectContaining({ annotationId: queue[0].annotationId, status: "failed" }),
      expect.objectContaining({ annotationId: queue[1].annotationId, status: "synced" })
    ]);
    const { applyThinReadingAnnotationSyncResults } = await import("../app/features/thin-reading/thinReadingProjection");
    const persisted = applyThinReadingAnnotationSyncResults(document, results);
    expect(listThinReadingPendingPublicAnnotations(persisted).map((item) => item.queueKey)).toEqual([queue[0].queueKey]);
  });

  test("projects pending public annotations into an artifact-scoped local queue", () => {
    const fixture = createThinReadingFixture();
    const root = createThinReadingDocument({
      ...fixture,
      artifactId: "artifact-sync-a"
    });
    const branched = advanceThinReadingDocument(root, {
      parentNodeId: root.rootNodeId,
      seed: fixture.rootSeed,
      source: { kind: "omitted_section", label: "实验", sectionKey: "experiment" },
      title: "实验"
    });
    const withPrivate = addThinReadingAnnotation(branched, {
      body: "私有批注不进入队列",
      excerpt: "private",
      nodeId: branched.rootNodeId,
      visibility: "private"
    });
    const withPending = addThinReadingAnnotation(withPrivate, {
      body: "公开批注先等待本地同步。",
      createdAt: "2026-07-28T00:00:00.000Z",
      excerpt: "Self-attention",
      nodeId: branched.activeNodeId,
      visibility: "pending_public"
    });

    const queue = listThinReadingPendingPublicAnnotations(withPending);

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      artifactId: "artifact-sync-a",
      body: "公开批注先等待本地同步。",
      excerpt: "Self-attention",
      queueKey: `artifact-sync-a:${withPending.pendingPublicAnnotationIds[0]}`,
      scope: expect.objectContaining({
        kind: "section",
        sectionKey: "experiment"
      }),
      status: "pending_public",
      statusLabel: THIN_READING_INTUECHO_PENDING_LABEL,
      target: expect.objectContaining({
        kind: "node_summary"
      })
    });
    expect(queue[0].hasConfirmedLiterature).toBe(false);
  });

  test("keeps the local adapter in waiting state instead of pretending remote sync succeeded", async () => {
    const root = createThinReadingDocument({
      ...createThinReadingFixture(),
      artifactId: "artifact-sync-pending"
    });
    const document = addThinReadingAnnotation(root, {
      body: "需要公开的批注。",
      excerpt: "attention",
      nodeId: root.rootNodeId,
      visibility: "pending_public"
    });
    const queue = listThinReadingPendingPublicAnnotations(document);
    const adapter = createLocalPendingIntuechoSyncAdapter();

    const results = await adapter.syncPendingAnnotations(queue);

    expect(results).toEqual([
      {
        annotationId: queue[0].annotationId,
        message: THIN_READING_INTUECHO_PENDING_LABEL,
        queueKey: queue[0].queueKey,
        status: "pending_public"
      }
    ]);
  });

  test("retains selected-passage evidence scope for pending public annotations", () => {
    const fixture = createSyncableFixture();
    const evidenceIds = (fixture.rootSeed.evidence.paperEvidenceSpans ?? []).slice(0, 2).map((span) => span.id);
    expect(evidenceIds.length).toBeGreaterThan(0);
    const root = createThinReadingDocument({
      ...fixture,
      artifactId: "artifact-sync-selected-passage"
    });
    const branched = advanceThinReadingDocument(root, {
      parentNodeId: root.rootNodeId,
      seed: fixture.rootSeed,
      source: {
        kind: "selected_text",
        evidenceIds,
        excerpt: "MaxSim retains the strongest token-level match.",
        prompt: "解释这一匹配信号为何重要"
      },
      title: "MaxSim"
    });
    const document = addThinReadingAnnotation(branched, {
      body: "这条理解应关联到选中的原文证据。",
      excerpt: "MaxSim retains the strongest token-level match.",
      nodeId: branched.activeNodeId,
      visibility: "pending_public"
    });

    expect(listThinReadingPendingPublicAnnotations(document)).toEqual([
      expect.objectContaining({
        artifactId: "artifact-sync-selected-passage",
        scope: expect.objectContaining({
          kind: "selected_passage",
          evidenceIds,
          excerpt: "MaxSim retains the strongest token-level match."
        }),
        status: "pending_public",
        targets: [expect.objectContaining({
          derivedContent: expect.objectContaining({
            artifactId: "artifact-sync-selected-passage",
            excerpt: "MaxSim retains the strongest token-level match."
          }),
          evidence: expect.arrayContaining([
            expect.objectContaining({ excerpt: expect.any(String), literature: expect.any(Object) })
          ]),
          kind: "derived_passage"
        })]
      })
    ]);
  });

  test("sends an idempotent HTTPS sync request and accepts only matching remote receipts", async () => {
    const root = createThinReadingDocument({
      ...createSyncableFixture(),
      artifactId: "artifact-sync-http"
    });
    const document = addThinReadingAnnotation(root, {
      body: "这是一条等待上传的共享批注。",
      excerpt: "attention",
      nodeId: root.rootNodeId,
      visibility: "pending_public"
    });
    const queue = listThinReadingPendingPublicAnnotations(document);
    const transport = vi.fn(async (request) => ({
      json: async () => ({
        results: [{
          annotationId: queue[0].annotationId,
          intuechoAnnotationId: "intuecho-remote-1",
          queueKey: queue[0].queueKey,
          status: "synced",
          syncedAt: "2026-07-28T01:00:00.000Z"
        }]
      }),
      ok: true,
      status: 200
    }));
    const adapter = createHttpIntuechoSyncAdapter({
      getActorBinding: () => actor,
      endpoint: "https://intuecho.example.com/",
      sessionId: "desktop-token",
      transport
    });

    await expect(adapter.syncPendingAnnotations(queue)).resolves.toEqual([{
      annotationId: queue[0].annotationId,
      intuechoAnnotationId: "intuecho-remote-1",
      queueKey: queue[0].queueKey,
      status: "synced",
      syncedAt: "2026-07-28T01:00:00.000Z"
    }]);
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({
        "content-type": "application/json",
        Authorization: "Bearer desktop-token",
        "idempotency-key": expect.stringMatching(/^thin-reading-sync-/)
      }),
      method: "POST",
      url: "https://intuecho.example.com/v1/thin-reading/annotations:sync"
    }));
    const sent = JSON.parse(transport.mock.calls[0][0].body);
    expect(sent.annotations).toEqual([expect.objectContaining({
      annotationId: queue[0].annotationId,
      targets: [expect.objectContaining({ literature: { literatureId: "lit_01J00000000000000000000000" } })]
    })]);
    expect(sent.annotations[0]).not.toHaveProperty("scope");
    expect(sent.annotations[0]).not.toHaveProperty("paperIdentity");
    expect(sent.annotations[0]).not.toHaveProperty("hasConfirmedLiterature");
  });

  test("does not export local-only identities to the remote community", async () => {
    const root = createThinReadingDocument({ ...createThinReadingFixture(), artifactId: "artifact-sync-local-only" });
    const document = addThinReadingAnnotation(root, {
      body: "仅本地身份的批注。",
      excerpt: "attention",
      nodeId: root.rootNodeId,
      visibility: "pending_public"
    });
    const transport = vi.fn();
    const results = await createHttpIntuechoSyncAdapter({
      getActorBinding: () => actor,
      endpoint: "https://intuecho.example.com",
      sessionId: "desktop-token",
      transport
    }).syncPendingAnnotations(listThinReadingPendingPublicAnnotations(document));

    expect(transport).not.toHaveBeenCalled();
    expect(results).toEqual([
      expect.objectContaining({ error: expect.stringContaining("尚未完成来源确认"), status: "failed" })
    ]);
  });

  test("syncs stable identities while retaining local-only items in their original result order", async () => {
    const localRoot = createThinReadingDocument({ ...createThinReadingFixture(), artifactId: "artifact-sync-mixed-local" });
    const localDocument = addThinReadingAnnotation(localRoot, {
      body: "本地批注。",
      excerpt: "attention",
      nodeId: localRoot.rootNodeId,
      visibility: "pending_public"
    });
    const stableRoot = createThinReadingDocument({ ...createSyncableFixture(), artifactId: "artifact-sync-mixed-stable" });
    const stableDocument = addThinReadingAnnotation(stableRoot, {
      body: "稳定身份批注。",
      excerpt: "attention",
      nodeId: stableRoot.rootNodeId,
      visibility: "pending_public"
    });
    const [localItem] = listThinReadingPendingPublicAnnotations(localDocument);
    const [stableItem] = listThinReadingPendingPublicAnnotations(stableDocument);
    const transport = vi.fn(async () => ({
      json: async () => ({ results: [{
        annotationId: stableItem.annotationId,
        intuechoAnnotationId: "intuecho-remote-stable",
        queueKey: stableItem.queueKey,
        status: "synced",
        syncedAt: "2026-07-28T01:00:00.000Z"
      }] }),
      ok: true,
      status: 200
    }));

    const results = await createHttpIntuechoSyncAdapter({
      getActorBinding: () => actor,
      endpoint: "https://intuecho.example.com",
      sessionId: "desktop-token",
      transport
    }).syncPendingAnnotations([localItem, stableItem]);

    expect(JSON.parse(transport.mock.calls[0][0].body)).toEqual({
      annotations: [expect.objectContaining({ annotationId: stableItem.annotationId, targets: stableItem.targets })]
    });
    expect(results).toEqual([
      expect.objectContaining({ annotationId: localItem.annotationId, error: expect.stringContaining("尚未完成来源确认"), status: "failed" }),
      expect.objectContaining({ annotationId: stableItem.annotationId, intuechoAnnotationId: "intuecho-remote-stable", status: "synced" })
    ]);
  });

  test("does not treat missing or non-HTTPS remote sync responses as public success", async () => {
    const root = createThinReadingDocument({ ...createSyncableFixture(), artifactId: "artifact-sync-reject" });
    const document = addThinReadingAnnotation(root, {
      body: "待验证批注。",
      excerpt: "attention",
      nodeId: root.rootNodeId,
      visibility: "pending_public"
    });
    const queue = listThinReadingPendingPublicAnnotations(document);
    const insecureAdapter = createHttpIntuechoSyncAdapter({ getActorBinding: () => actor, endpoint: "http://intuecho.example.com", sessionId: "desktop-token" });
    const incompleteAdapter = createHttpIntuechoSyncAdapter({
      getActorBinding: () => actor,
      endpoint: "https://intuecho.example.com",
      sessionId: "desktop-token",
      transport: async () => ({ json: async () => ({ results: [] }), ok: true, status: 200 })
    });

    await expect(insecureAdapter.syncPendingAnnotations(queue)).resolves.toEqual([
      expect.objectContaining({ status: "failed", error: expect.stringContaining("HTTPS") })
    ]);
    await expect(incompleteAdapter.syncPendingAnnotations(queue)).resolves.toEqual([
      expect.objectContaining({ status: "failed", error: expect.stringContaining("缺少") })
    ]);
  });

  test("normalizes an HTTPS community endpoint before appending the sync route", async () => {
    const pathActor = { ...actor, endpoint: "https://intuecho.example.com/community" };
    const root = createThinReadingDocument({ ...createSyncableFixture(), artifactId: "artifact-sync-path" });
    const document = addThinReadingAnnotation(root, {
      body: "可同步批注。",
      excerpt: "Self-attention",
      nodeId: root.rootNodeId,
      target: { kind: "node_summary", nodeId: root.rootNodeId },
      visibility: "pending_public"
    });
    const transport = vi.fn(async () => ({
      json: async () => ({ results: [] }),
      ok: true,
      status: 200
    }));

    await createHttpIntuechoSyncAdapter({
      getActorBinding: () => pathActor,
      endpoint: "https://intuecho.example.com/community/",
      sessionId: "desktop-token",
      transport
    }).syncPendingAnnotations(listThinReadingPendingPublicAnnotations(document).map((item) => ({ ...item, actorBinding: pathActor })));

    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://intuecho.example.com/community/v1/thin-reading/annotations:sync"
    }));
  });
});
