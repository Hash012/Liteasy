import { describe, expect, test, vi } from "vitest";
import { createThinReadingFixture } from "../app/features/thin-reading/thinReadingFixtures";
import {
  addThinReadingAnnotation,
  advanceThinReadingDocument,
  createThinReadingDocument
} from "../app/features/thin-reading/thinReadingProjection";
import {
  THIN_READING_INTUECHO_PENDING_LABEL,
  createHttpIntuechoSyncAdapter,
  createLocalPendingIntuechoSyncAdapter,
  listThinReadingPendingPublicAnnotations
} from "../app/features/thin-reading/thinReadingIntuechoSyncQueue";

function createSyncableFixture() {
  return {
    ...createThinReadingFixture(),
    papers: [{
      ...createThinReadingFixture().papers[0],
      doi: "10.48550/arxiv.1706.03762"
    }]
  };
}

describe("thinReadingIntuechoSyncQueue", () => {
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
    expect(queue[0].scope.paperIdentity?.primary.kind).toBe("local_paper_id");
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
    const root = createThinReadingDocument({
      ...createThinReadingFixture(),
      artifactId: "artifact-sync-selected-passage"
    });
    const branched = advanceThinReadingDocument(root, {
      parentNodeId: root.rootNodeId,
      seed: createThinReadingFixture().rootSeed,
      source: {
        kind: "selected_text",
        evidenceIds: ["evidence-root-1", "evidence-root-2"],
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
          evidenceIds: ["evidence-root-1", "evidence-root-2"],
          excerpt: "MaxSim retains the strongest token-level match."
        }),
        status: "pending_public"
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
      endpoint: "https://intuecho.example.com/",
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
        "idempotency-key": expect.stringMatching(/^thin-reading-sync-/)
      }),
      method: "POST",
      url: "https://intuecho.example.com/v1/thin-reading/annotations:sync"
    }));
    expect(JSON.parse(transport.mock.calls[0][0].body)).toEqual({ annotations: queue });
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
      endpoint: "https://intuecho.example.com",
      transport
    }).syncPendingAnnotations(listThinReadingPendingPublicAnnotations(document));

    expect(transport).not.toHaveBeenCalled();
    expect(results).toEqual([
      expect.objectContaining({ error: expect.stringContaining("仅本地文献身份"), status: "failed" })
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
      endpoint: "https://intuecho.example.com",
      transport
    }).syncPendingAnnotations([localItem, stableItem]);

    expect(JSON.parse(transport.mock.calls[0][0].body)).toEqual({ annotations: [stableItem] });
    expect(results).toEqual([
      expect.objectContaining({ annotationId: localItem.annotationId, error: expect.stringContaining("仅本地文献身份"), status: "failed" }),
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
    const insecureAdapter = createHttpIntuechoSyncAdapter({ endpoint: "http://intuecho.example.com" });
    const incompleteAdapter = createHttpIntuechoSyncAdapter({
      endpoint: "https://intuecho.example.com",
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
      endpoint: "https://intuecho.example.com/community/?preview=true#annotations",
      transport
    }).syncPendingAnnotations(listThinReadingPendingPublicAnnotations(document));

    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://intuecho.example.com/community/v1/thin-reading/annotations:sync"
    }));
  });
});
