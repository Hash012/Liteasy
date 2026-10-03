import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createArtifactStore } from "../app/features/artifacts/artifact.store";
import { useArtifactActions } from "../app/features/artifacts/useArtifactActions";
import { addThinReadingAnnotation, createThinReadingDocument, setThinReadingAnnotationPublic } from "../app/features/thin-reading/thinReadingProjection";
import { createThinReadingFixture } from "./fixtures/thinReadingFixtures";
import type { PublicationActorBinding } from "../app/features/forum/publicationActorBinding";
import { prepareThinReadingPublications } from "../app/features/thin-reading/thinReadingIntuechoSyncQueue";
import type { ThinReadingDocument } from "../app/features/thin-reading/thinReading.types";

const { readAuthorProfile } = vi.hoisted(() => ({ readAuthorProfile: vi.fn() }));
vi.mock("../app/features/forum/forumClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("../app/features/forum/forumClient")>();
  return { ...original, createForumClient: (...args: Parameters<typeof original.createForumClient>) => ({
    ...original.createForumClient(...args), readPublicationAuthorProfile: readAuthorProfile
  }) };
});

const actor: PublicationActorBinding = { endpoint: "https://community.example.invalid", issuer: "https://identity.example.invalid",
  subject: "synthetic-a", scopeId: "synthetic-a", scopeType: "user", sessionGeneration: "runtime:1" };

const authorProfile = { author: { id: actor.subject, name: "Synthetic Owner", initials: "SO" },
  profile: { revision: 3, educationStage: "undergraduate", institutions: [{ name: "Original University" }] } };
beforeEach(() => { readAuthorProfile.mockReset(); readAuthorProfile.mockResolvedValue(authorProfile); });

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


function unknownCreateWithdrawal(context: ReturnType<typeof setup>) {
  const prepared = prepareThinReadingPublications(context.document, actor);
  const withdrawn = setThinReadingAnnotationPublic(prepared, prepared.annotations[0].id, false);
  context.store.upsertTab({ artifactId: withdrawn.artifactId, title: "Synthetic thin reading", type: "thin_reading", thinReadingDocument: withdrawn });
  return withdrawn;
}

test("reads the unknown original result then durably withdraws it without republishing its body", async () => {
  const context = setup({ sourceCheck: () => { throw new Error("organization source cannot publish"); } });
  const document = unknownCreateWithdrawal(context);
  const transport = vi.fn(async (url: string, request: RequestInit) => {
    const input = JSON.parse(String(request.body));
    if (url.endsWith("/v1/thin-reading/annotations:lookup")) {
      expect(input.queries[0]).toMatchObject({ annotationId: document.annotations[0].id, queueKey: `${document.artifactId}:${document.annotations[0].id}` });
      expect(input.queries[0].payloadDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(String(request.body)).not.toContain("Synthetic reader note");
      expect(String(request.body)).not.toContain("targets");
      return { ok: true, status: 200, json: async () => ({ results: [{ ...input.queries[0], status: "matched", remoteAnnotationId: "remote-unknown", publicationRevision: 1 }] }) };
    }
    expect(url).toBe(`${actor.endpoint}/v1/pdf-annotations:sync`);
    const operation = input.operations[0];
    expect(context.save).toHaveBeenCalled();
    expect(context.save.mock.calls.at(-1)?.[0].thinReadingDocument.annotations[0].publication.pendingRetract).toEqual(operation);
    return { ok: true, status: 200, json: async () => ({ results: [{ annotationId: operation.annotationId, queueKey: operation.queueKey,
      remoteAnnotationId: operation.remoteAnnotationId, state: "retracted", remoteRevision: 2, syncedAt: "2026-10-03T00:00:00.000Z" }] }) };
  });
  vi.stubGlobal("fetch", transport);
  await context.actions.syncThinReadingAnnotations({ artifactId: document.artifactId, document });
  expect(transport).toHaveBeenCalledTimes(2);
  expect(context.store.getOpenTabs()[0].thinReadingDocument?.annotations[0].publication?.retractReceipt?.state).toBe("retracted");
});

test.each(["not_found", "conflict", "wrong_digest", "duplicate", "incomplete"])("holds unknown create when lookup returns %s", async (status) => {
  const context = setup();
  const document = unknownCreateWithdrawal(context);
  const transport = vi.fn(async (_url: string, request: RequestInit) => {
    const query = JSON.parse(String(request.body)).queries[0];
    const matched = { ...query, status: "matched", remoteAnnotationId: "remote-1", publicationRevision: 1 };
    const results = status === "duplicate" ? [matched, matched] : [status === "wrong_digest" ? { ...matched, payloadDigest: "0".repeat(64) }
      : status === "incomplete" ? { ...matched, publicationRevision: undefined } : { annotationId: query.annotationId, queueKey: query.queueKey, status }];
    return { ok: true, status: 200, json: async () => ({ results }) };
  });
  vi.stubGlobal("fetch", transport);
  await expect(context.actions.syncThinReadingAnnotations({ artifactId: document.artifactId, document })).rejects.toThrow();
  expect(transport).toHaveBeenCalledOnce();
  const saved = context.store.getOpenTabs()[0].thinReadingDocument!.annotations[0];
  expect(saved.publication?.pendingOperation).toEqual(document.annotations[0].publication?.pendingOperation);
  expect(saved.publication?.retractReceipt).toBeUndefined();
});

test("holds the original actor and source identity before lookup and checks the session after lookup", async () => {
  let current = actor;
  const context = setup({ getActorBinding: () => current });
  const document = unknownCreateWithdrawal(context);
  const transport = vi.fn(async (_url: string, request: RequestInit) => {
    const query = JSON.parse(String(request.body)).queries[0];
    current = { ...actor, sessionGeneration: "runtime:2" };
    return { ok: true, status: 200, json: async () => ({ results: [{ ...query, status: "matched", remoteAnnotationId: "remote-1", publicationRevision: 1 }] }) };
  });
  vi.stubGlobal("fetch", transport);
  current = { ...actor, subject: "another", scopeId: "another" };
  await expect(context.actions.syncThinReadingAnnotations({ artifactId: document.artifactId, document })).rejects.toThrow("账号");
  expect(transport).not.toHaveBeenCalled();
  current = actor;
  await expect(context.actions.syncThinReadingAnnotations({ artifactId: document.artifactId, document })).rejects.toThrow("会话");
  expect(transport).toHaveBeenCalledOnce();
});


test("withdraws matched batch items while preserving unresolved original requests for a later read-only retry", async () => {
  const context = setup();
  const withTwo = addThinReadingAnnotation(context.document, { body: "Second synthetic note", excerpt: "Second evidence", nodeId: context.document.rootNodeId, visibility: "pending_public" });
  const bound = { ...withTwo, annotations: withTwo.annotations.map((annotation) => ({ ...annotation, publication: { actorBinding: actor } })) };
  const prepared = prepareThinReadingPublications(bound, actor);
  const document = { ...prepared, annotations: prepared.annotations.map((annotation) => ({ ...annotation, visibility: "private" as const })) };
  context.store.upsertTab({ artifactId: document.artifactId, title: "Two unknown originals", type: "thin_reading", thinReadingDocument: document });
  const transport = vi.fn(async (url: string, request: RequestInit) => {
    const input = JSON.parse(String(request.body));
    if (url.endsWith(":lookup")) return { ok: true, status: 200, json: async () => ({ results: [
      { ...input.queries[0], status: "matched", remoteAnnotationId: "remote-first", publicationRevision: 4 },
      { annotationId: input.queries[1].annotationId, queueKey: input.queries[1].queueKey, status: "not_found" }
    ] }) };
    expect(input.operations).toHaveLength(1);
    expect(input.operations[0].revision).toBe(5);
    return { ok: true, status: 200, json: async () => ({ results: [{ ...input.operations[0], state: "retracted", remoteRevision: 5, syncedAt: "2026-10-03T00:00:00.000Z" }] }) };
  });
  vi.stubGlobal("fetch", transport);
  await context.actions.syncThinReadingAnnotations({ artifactId: document.artifactId, document });
  expect(transport).toHaveBeenCalledTimes(2);
  const saved = context.store.getOpenTabs()[0].thinReadingDocument!;
  expect(saved.annotations[0].publication?.retractReceipt?.state).toBe("retracted");
  expect(saved.annotations[1].publication?.pendingOperation).toEqual(document.annotations[1].publication?.pendingOperation);
  expect(saved.annotations[1].publication?.pendingRetract).toBeUndefined();
});

test("does not trust an input original that differs from the durable original", async () => {
  const context = setup();
  const saved = unknownCreateWithdrawal(context);
  const document = structuredClone(saved);
  document.annotations[0].publication!.pendingOperation!.body = "Substituted original";
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  await expect(context.actions.syncThinReadingAnnotations({ artifactId: document.artifactId, document })).rejects.toThrow("原发布请求");
  expect(transport).not.toHaveBeenCalled();
});

test.each(["original", "local-note"])("holds a changed local %s while its lookup is in flight", async (changedField) => {
  const context = setup();
  const document = unknownCreateWithdrawal(context);
  const transport = vi.fn(async (_url: string, request: RequestInit) => {
    const query = JSON.parse(String(request.body)).queries[0];
    const changed = structuredClone(document);
    if (changedField === "original") changed.annotations[0].publication!.pendingOperation!.body = "Changed during lookup";
    else changed.annotations[0].body = "A local edit that must survive lookup";
    context.store.upsertTab({ artifactId: changed.artifactId, title: "Changed", type: "thin_reading", thinReadingDocument: changed });
    return { ok: true, status: 200, json: async () => ({ results: [{ ...query, status: "matched", remoteAnnotationId: "remote-1", publicationRevision: 1 }] }) };
  });
  vi.stubGlobal("fetch", transport);
  await expect(context.actions.syncThinReadingAnnotations({ artifactId: document.artifactId, document })).rejects.toThrow("原发布请求");
  expect(transport).toHaveBeenCalledOnce();
  expect(context.save).not.toHaveBeenCalled();
});


test("previews and persists the exact author profile and all wire evidence before a new publication", async () => {
  const preview = vi.fn(async () => true);
  const context = setup({ confirmPublication: preview });
  const transport = vi.fn(async (_url: string, request: RequestInit) => {
    const operation = JSON.parse(String(request.body)).annotations[0];
    expect(operation.expectedAuthorProfileRevision).toBe(3);
    expect(context.save.mock.calls[0][0].thinReadingDocument.annotations[0].publication.authorProfile).toEqual(authorProfile);
    expect(preview.mock.calls[0][0].items[0].authorProfile).toEqual(authorProfile);
    const excerpts = preview.mock.calls[0][0].items[0].excerpts.map((item: { text: string }) => item.text);
    for (const target of operation.targets) {
      if (target.excerpt) expect(excerpts).toContain(target.excerpt);
      if (target.derivedContent) expect(excerpts).toContain(target.derivedContent.excerpt);
      for (const evidence of target.evidence ?? []) expect(excerpts).toContain(evidence.excerpt);
    }
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  });
  vi.stubGlobal("fetch", transport);
  await context.actions.syncThinReadingAnnotations({ artifactId: context.document.artifactId, document: context.document });
  expect(readAuthorProfile).toHaveBeenCalledOnce();
  expect(transport).toHaveBeenCalledOnce();
});

test("preserves the saved profile fence and preview when reconciling an unknown original after a profile edit", async () => {
  const preview = vi.fn(async () => true);
  const context = setup({ confirmPublication: preview });
  const original = prepareThinReadingPublications(context.document, actor, { authorProfile });
  context.store.upsertTab({ artifactId: original.artifactId, title: "Original", type: "thin_reading", thinReadingDocument: original });
  readAuthorProfile.mockResolvedValue({ ...authorProfile, profile: { revision: 4, educationStage: null, institutions: [] } });
  const transport = vi.fn(async (_url: string, request: RequestInit) => {
    expect(JSON.parse(String(request.body)).annotations[0]).toEqual(original.annotations[0].publication?.pendingOperation);
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  });
  vi.stubGlobal("fetch", transport);
  await context.actions.syncThinReadingAnnotations({ artifactId: original.artifactId, document: original });
  expect(preview.mock.calls[0][0].items[0].authorProfile).toEqual(authorProfile);
  expect(transport).toHaveBeenCalledOnce();
});

test("does not retrofit a profile fence onto an old unknown original or send when profile reads fail", async () => {
  const context = setup();
  const original = prepareThinReadingPublications(context.document, actor);
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  await expect(context.actions.syncThinReadingAnnotations({ artifactId: original.artifactId, document: original })).rejects.toThrow("资料预览");
  expect(transport).not.toHaveBeenCalled();
  readAuthorProfile.mockRejectedValue(new Error("profile unavailable"));
  await expect(context.actions.syncThinReadingAnnotations({ artifactId: context.document.artifactId, document: context.document })).rejects.toThrow("profile unavailable");
  expect(context.save).not.toHaveBeenCalled();
});
