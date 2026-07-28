import { describe, expect, test } from "vitest";
import { createThinReadingFixture } from "../app/features/thin-reading/thinReadingFixtures";
import {
  addThinReadingAnnotation,
  advanceThinReadingDocument,
  createThinReadingDocument
} from "../app/features/thin-reading/thinReadingProjection";
import {
  THIN_READING_INTUECHO_PENDING_LABEL,
  createLocalPendingIntuechoSyncAdapter,
  listThinReadingPendingPublicAnnotations
} from "../app/features/thin-reading/thinReadingIntuechoSyncQueue";

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
});
