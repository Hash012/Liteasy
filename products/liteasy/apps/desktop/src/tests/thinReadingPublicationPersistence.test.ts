import { afterEach, expect, test, vi } from "vitest";
import { createArtifactStore } from "../app/features/artifacts/artifact.store";
import { useArtifactActions } from "../app/features/artifacts/useArtifactActions";
import { addThinReadingAnnotation, createThinReadingDocument, setThinReadingAnnotationPublic } from "../app/features/thin-reading/thinReadingProjection";
import { createThinReadingFixture } from "./fixtures/thinReadingFixtures";
import type { PublicationActorBinding } from "../app/features/forum/publicationActorBinding";
import type { ThinReadingDocument } from "../app/features/thin-reading/thinReading.types";

const actor: PublicationActorBinding = { endpoint: "https://community.example.invalid", issuer: "https://identity.example.invalid",
  subject: "synthetic-a", scopeId: "synthetic-a", scopeType: "user", sessionGeneration: "runtime:1" };

function fixture() {
  const root = createThinReadingDocument({ ...createThinReadingFixture(), artifactId: "durable-publication" });
  const added = addThinReadingAnnotation(root, { body: "Synthetic reader note", excerpt: "Synthetic evidence", nodeId: root.rootNodeId, visibility: "pending_public" });
  return { ...added, literatureRecords: { [root.paperIds[0]]: {
    authors: [], identifiers: [], literatureId: "literature-1", title: "Synthetic paper", revision: 1, status: "confirmed" as const,
    provenance: { confirmedAt: "2026-10-03T00:00:00.000Z", mode: "public_registry" as const, provider: "crossref" as const }
  } }, annotations: added.annotations.map((annotation) => ({ ...annotation, publication: { actorBinding: actor } })) };
}

function setup(input: { save?: ReturnType<typeof vi.fn>; getActorBinding?: () => PublicationActorBinding; sourceCheck?: ((document: ThinReadingDocument) => void) | null;
  confirmPublication?: ReturnType<typeof vi.fn> } = {}) {
  const document = fixture();
  const store = createArtifactStore();
  store.upsertTab({ artifactId: document.artifactId, title: "Synthetic thin reading", type: "thin_reading", thinReadingDocument: document });
  const save = input.save ?? vi.fn(async () => "saved.json");
  const actions = useArtifactActions({
    artifactStore: store, artifactResultClient: { save, delete: vi.fn(), list: async () => [] },
    getActorBinding: input.getActorBinding ?? (() => actor),
    getIntuechoEndpoint: () => actor.endpoint, getIntuechoSessionId: () => "synthetic-token",
    assertCanPublishThinReading: input.sourceCheck === null ? undefined : input.sourceCheck ?? (() => {}),
    confirmPublication: input.confirmPublication ?? (async () => true),
    getImportedChunksByPaperId: () => ({}), getSelectedDocumentSet: () => ({ documentIds: [], locked: true }), getSelectedPapers: () => [],
    onAnalysisHint: vi.fn(), onArtifactCatalogChanged: vi.fn(), onArtifactTabsChanged: vi.fn(), onArtifactTasksChanged: vi.fn(),
    queueImportForPapers: () => "already_imported", runAgentAnalysis: vi.fn()
  });
  return { actions, document, save, store };
}

afterEach(() => vi.unstubAllGlobals());

test("awaits durable original operation storage before sending and stores its receipt afterwards", async () => {
  let finishSave!: (path: string) => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise<string>((resolve) => { finishSave = resolve; })).mockResolvedValue("saved.json");
  const transport = vi.fn(async (_url: string, request: RequestInit) => ({ ok: true, status: 200, json: async () => ({
    results: JSON.parse(String(request.body)).annotations.map((item: { annotationId: string; queueKey: string }) => ({
      annotationId: item.annotationId, queueKey: item.queueKey, status: "synced", syncedAt: "2026-10-03T00:00:00.000Z", intuechoAnnotationId: "remote-1"
    }))
  }) }));
  vi.stubGlobal("fetch", transport);
  const context = setup({ save });
  const pending = context.actions.syncThinReadingAnnotations({ artifactId: context.document.artifactId, document: context.document });
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].thinReadingDocument.annotations[0].publication).toMatchObject({ actorBinding: actor, outcome: "unknown", pendingOperation: { body: "Synthetic reader note" } });
  expect(transport).not.toHaveBeenCalled();
  finishSave("saved.json");
  await pending;
  expect(transport).toHaveBeenCalledOnce();
  expect(String(transport.mock.calls[0][1].body)).not.toContain("actorBinding");
  expect(save).toHaveBeenCalledTimes(2);
  expect(context.store.getOpenTabs()[0].thinReadingDocument?.annotations[0].syncState?.status).toBe("synced");
});

test("retains the local document and sends nothing if durable storage fails", async () => {
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  const context = setup({ save: vi.fn().mockRejectedValue(new Error("disk unavailable")) });
  await expect(context.actions.syncThinReadingAnnotations({ artifactId: context.document.artifactId, document: context.document })).rejects.toThrow("disk unavailable");
  expect(transport).not.toHaveBeenCalled();
  expect(context.store.getOpenTabs()[0].thinReadingDocument?.annotations).toHaveLength(1);
});

test("requires a source preflight before saving or publishing", async () => {
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  const context = setup({ sourceCheck: null });
  await expect(context.actions.syncThinReadingAnnotations({ artifactId: context.document.artifactId, document: context.document })).rejects.toThrow("来源");
  expect(context.save).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});

test("holds the saved original request if the account changes during storage", async () => {
  let current = actor;
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  const context = setup({ getActorBinding: () => current, save: vi.fn(async () => {
    current = { ...actor, subject: "synthetic-b", scopeId: "synthetic-b" }; return "saved.json";
  }) });
  await expect(context.actions.syncThinReadingAnnotations({ artifactId: context.document.artifactId, document: context.document })).rejects.toThrow("账号");
  expect(transport).not.toHaveBeenCalled();
});

test("requires explicit preview approval before saving a sendable attempt", async () => {
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  const preview = vi.fn(async () => false);
  const context = setup({ confirmPublication: preview });
  await context.actions.syncThinReadingAnnotations({ artifactId: context.document.artifactId, document: context.document });
  expect(preview).toHaveBeenCalledOnce();
  expect(transport).not.toHaveBeenCalled();
  expect(context.save).not.toHaveBeenCalled();
});

test("uses the binding saved by an explicit create when the UI immediately syncs its prior object", async () => {
  const transport = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }));
  vi.stubGlobal("fetch", transport);
  const context = setup();
  const root = { ...context.document, annotations: [], pendingPublicAnnotationIds: [] };
  context.store.upsertTab({ artifactId: root.artifactId, title: "Synthetic thin reading", type: "thin_reading", thinReadingDocument: root });
  const next = addThinReadingAnnotation(root, { body: "Explicit new note", excerpt: "evidence", nodeId: root.rootNodeId, visibility: "pending_public" });
  context.actions.updateThinReadingDocument(root.artifactId, next);
  await context.actions.syncThinReadingAnnotations({ artifactId: root.artifactId, document: next });
  expect(transport).toHaveBeenCalledOnce();
});

test("persists and replays the exact owned withdrawal after a lost response without deleting the local note", async () => {
  const requests: unknown[] = [];
  const transport = vi.fn(async (_url: string, request: RequestInit) => {
    const operation = JSON.parse(String(request.body)).operations[0];
    requests.push(operation);
    if (requests.length === 1) throw new Error("lost response after commit");
    return { ok: true, status: 200, json: async () => ({ results: [{
      annotationId: operation.annotationId, queueKey: operation.queueKey, remoteAnnotationId: operation.remoteAnnotationId,
      remoteRevision: 2, state: "retracted", syncedAt: "2026-10-03T00:00:00.000Z"
    }] }) };
  });
  vi.stubGlobal("fetch", transport);
  const context = setup({ sourceCheck: () => { throw new Error("organization source cannot publish"); } });
  const published = { ...context.document, annotations: context.document.annotations.map((annotation) => ({ ...annotation,
    syncState: { status: "synced" as const, intuechoAnnotationId: "remote-1", syncedAt: "2026-10-03T00:00:00.000Z" }
  })) };
  context.store.upsertTab({ artifactId: published.artifactId, title: "Synthetic thin reading", type: "thin_reading", thinReadingDocument: published });
  const withdrawn = setThinReadingAnnotationPublic(published, published.annotations[0].id, false);
  await context.actions.syncThinReadingAnnotations({ artifactId: withdrawn.artifactId, document: withdrawn });
  expect(requests).toHaveLength(1);
  const pending = context.store.getOpenTabs()[0].thinReadingDocument!;
  expect(pending.annotations[0].publication).toMatchObject({ actorBinding: actor, pendingRetract: requests[0], outcome: "unknown" });
  await context.actions.syncThinReadingAnnotations({ artifactId: pending.artifactId, document: pending });
  expect(requests[1]).toEqual(requests[0]);
  const confirmed = context.store.getOpenTabs()[0].thinReadingDocument!;
  expect(confirmed.annotations).toHaveLength(1);
  expect(confirmed.annotations[0].publication?.retractReceipt).toMatchObject({ state: "retracted", remoteAnnotationId: "remote-1" });
  expect(setThinReadingAnnotationPublic(confirmed, confirmed.annotations[0].id, true).annotations[0].visibility).toBe("private");
});
