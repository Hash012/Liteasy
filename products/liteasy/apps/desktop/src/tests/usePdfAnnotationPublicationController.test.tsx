import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import {
  createPersistPaperLiterature,
  usePdfAnnotationPublicationController
} from "../app/controllers/usePdfAnnotationPublicationController";
import type {
  ForumAnnotationPublicationOperation,
  ForumAnnotationPublicationResult
} from "../app/features/forum/forum.types";
import type { LiteratureRecord } from "../app/features/paper-identity/literature.types";
import type { PdfAnnotationV2 } from "../app/features/pdf/pdfAnnotationStorage";
import { createWorkspaceStore } from "../app/features/workspace/workspace.store";
import type { Paper } from "../app/features/workspace/workspace.types";
import type { PublicationActorBinding } from "../app/features/forum/publicationActorBinding";

const publicationActor: PublicationActorBinding = {
  endpoint: "https://community.example.invalid",
  issuer: "https://identity.example.invalid",
  subject: "synthetic-a",
  scopeType: "user",
  scopeId: "synthetic-a",
  sessionGeneration: "runtime-a:1"
};

const authorProfile = { author: { id: publicationActor.subject, name: "Synthetic Ada", initials: "SA" }, profile: { revision: 3, educationStage: "graduate", institutions: [{ name: "Synthetic Lab" }] } };

function literature(overrides: Partial<LiteratureRecord> = {}): LiteratureRecord {
  return {
    authors: ["Ada Lovelace"],
    identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/test" }],
    literatureId: "literature-1",
    provenance: {
      confirmedAt: "2026-08-09T00:00:00.000Z",
      mode: "public_registry",
      provider: "crossref"
    },
    revision: 1,
    status: "confirmed",
    title: "A Test Paper",
    year: 2026,
    ...overrides
  };
}

function paper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "paper-1",
    sourcePath: "/papers/test.pdf",
    title: "A Test Paper",
    ...overrides
  };
}

function annotation(overrides: Partial<PdfAnnotationV2> = {}): PdfAnnotationV2 {
  return {
    createdAt: "2026-08-09T00:00:00.000Z",
    excerpt: "Selected passage",
    id: "annotation-1",
    kind: "highlight",
    page: 2,
    paperIdentity: {
      candidates: [{ id: "doi:10.1000/test", kind: "doi", source: "metadata", value: "10.1000/test" }],
      paperId: "paper-1",
      primary: { id: "doi:10.1000/test", kind: "doi", source: "metadata", value: "10.1000/test" },
      title: "A Test Paper"
    },
    rects: [{ height: 0.1, left: 0.2, top: 0.3, width: 0.4 }],
    revision: 1,
    text: "Selected passage",
    updatedAt: "2026-08-09T00:00:01.000Z",
    ...overrides,
    publication: { actorBinding: publicationActor, ...(overrides.publication ?? { desiredVisibility: "private", state: "not_published" }) }
  };
}

function receipt(
  operation: ForumAnnotationPublicationOperation,
  overrides: Partial<Extract<ForumAnnotationPublicationResult, { state: "published" | "retracted" }>> = {}
): ForumAnnotationPublicationResult {
  return {
    annotationId: operation.annotationId,
    queueKey: operation.queueKey,
    remoteAnnotationId: operation.operation === "retract" ? operation.remoteAnnotationId : "remote-1",
    remoteRevision: 1,
    sourceRevision: operation.revision,
    state: operation.operation === "retract" ? "retracted" : "published",
    syncedAt: "2026-08-09T00:00:02.000Z",
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function setup(input: {
  confirmPublication?: (preview: import("../app/features/forum/usePublicationPreview").PublicationPreview) => Promise<boolean>;
  getActorBinding?: () => PublicationActorBinding | undefined;
  initialPapers?: Paper[];
  loadLiterature?: ReturnType<typeof vi.fn>;
  loadResolution?: ReturnType<typeof vi.fn>;
  saveResolution?: ReturnType<typeof vi.fn>;
  persistPaperLiterature?: ReturnType<typeof vi.fn>;
  resolveLiterature?: ReturnType<typeof vi.fn>;
  confirmLiterature?: ReturnType<typeof vi.fn>;
  verifyLiterature?: ReturnType<typeof vi.fn>;
  applyAnnotationPublications?: ReturnType<typeof vi.fn>;
  lookupAnnotationPublications?: ReturnType<typeof vi.fn>;
  readPublicationAuthorProfile?: ReturnType<typeof vi.fn>;
  onPaperUpdated?: ReturnType<typeof vi.fn>;
} = {}) {
  const workspaceStore = createWorkspaceStore(input.initialPapers ?? [paper()]);
  const loadLiterature = input.loadLiterature ?? vi.fn().mockResolvedValue(undefined);
  const loadResolution = input.loadResolution ?? vi.fn().mockResolvedValue(undefined);
  const saveResolution = input.saveResolution ?? vi.fn().mockResolvedValue(undefined);
  const persistPaperLiterature = input.persistPaperLiterature ?? vi.fn().mockImplementation(
    async (current: Paper, confirmed: LiteratureRecord) => ({ ...current, literature: confirmed })
  );
  const resolveLiterature = input.resolveLiterature ?? vi.fn();
  const confirmLiterature = input.confirmLiterature ?? vi.fn();
  const verifyLiterature = input.verifyLiterature ?? vi.fn();
  const applyAnnotationPublications = input.applyAnnotationPublications ?? vi.fn().mockImplementation(
    async (operations: ForumAnnotationPublicationOperation[]) => ({ results: operations.map((operation) => receipt(operation)) })
  );
  const lookupAnnotationPublications = input.lookupAnnotationPublications ?? vi.fn().mockImplementation(async (operations: ForumAnnotationPublicationOperation[]) => ({ results: operations.map((operation) => receipt(operation)) }));
  const readPublicationAuthorProfile = input.readPublicationAuthorProfile ?? vi.fn().mockResolvedValue(authorProfile);
  const onPaperUpdated = input.onPaperUpdated ?? vi.fn();
  const hook = renderHook(() => {
    const controller = usePdfAnnotationPublicationController({
    getActorBinding: input.getActorBinding ?? (() => publicationActor),
    confirmPublication: input.confirmPublication ?? (async () => true),
    forumClient: { applyAnnotationPublications, lookupAnnotationPublications, readPublicationAuthorProfile },
    literatureClient: {
      confirmLiterature,
      resolveLiterature,
      verifyLiterature
    },
    literatureMetadataRepository: { load: loadLiterature },
    literatureResolutionRepository: { load: loadResolution, save: saveResolution },
    onPaperUpdated,
    persistPaperLiterature,
    workspaceStore
    });
    return { ...controller, actions: { ...controller.actions,
      changePublication: (request: Parameters<typeof controller.actions.changePublication>[0]) => controller.actions.changePublication({
        onPreparedPublication: async () => {}, ...request
      })
    } };
  });
  return {
    ...hook,
    applyAnnotationPublications,
    lookupAnnotationPublications,
    readPublicationAuthorProfile,
    confirmLiterature,
    loadLiterature,
    loadResolution,
    onPaperUpdated,
    persistPaperLiterature,
    resolveLiterature,
    saveResolution,
    verifyLiterature,
    workspaceStore
  };
}

describe("usePdfAnnotationPublicationController", () => {
  test("previews and persists exactly the author profile revision sent with a new publication", async () => {
    const preview = vi.fn(async () => true), prepared = vi.fn();
    const context = setup({ confirmPublication: preview });
    const result = await context.result.current.actions.changePublication({ annotation: annotation(), operation: "publish",
      paper: paper({ literature: literature() }), onPreparedPublication: prepared });
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ authorProfiles: [{ label: "公开作者资料", profile: authorProfile }] }));
    expect(prepared).toHaveBeenCalledWith(expect.objectContaining({ authorProfile,
      pendingOperation: expect.objectContaining({ expectedAuthorProfileRevision: 3 }) }));
    expect(context.applyAnnotationPublications).toHaveBeenCalledWith([expect.objectContaining({ expectedAuthorProfileRevision: 3 })], publicationActor);
    expect(result.authorProfile).toEqual(authorProfile);
  });

  test("drops a late profile read after account generation changes without preparing or sending", async () => {
    let actor = publicationActor;
    const pending = deferred<typeof authorProfile>(), preview = vi.fn(async () => true), prepared = vi.fn();
    const read = vi.fn(() => pending.promise);
    const context = setup({ getActorBinding: () => actor, confirmPublication: preview, readPublicationAuthorProfile: read });
    const request = context.result.current.actions.changePublication({ annotation: annotation(), operation: "publish",
      paper: paper({ literature: literature() }), onPreparedPublication: prepared });
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    actor = { ...publicationActor, sessionGeneration: "new-generation" };
    pending.resolve(authorProfile);
    expect((await request).state).toBe("failed");
    expect(preview).not.toHaveBeenCalled();
    expect(prepared).not.toHaveBeenCalled();
    expect(context.applyAnnotationPublications).not.toHaveBeenCalled();
  });

  test("only a definitive changed-profile rejection permits a fresh explicitly reviewed operation", async () => {
    const apply = vi.fn(async ([operation]: ForumAnnotationPublicationOperation[]) => ({ results: [{
      annotationId: operation.annotationId, queueKey: operation.queueKey, state: "failed", code: "AUTHOR_PROFILE_CHANGED", error: "profile changed"
    }] }));
    const read = vi.fn().mockResolvedValueOnce(authorProfile).mockResolvedValue({ ...authorProfile, profile: { ...authorProfile.profile, revision: 4 } });
    const preview = vi.fn(async () => true), context = setup({ applyAnnotationPublications: apply, readPublicationAuthorProfile: read, confirmPublication: preview });
    const first = await context.result.current.actions.changePublication({ annotation: annotation(), operation: "publish", paper: paper({ literature: literature() }) });
    expect(first.pendingOperation).toBeUndefined();
    expect(first.outcome).toBeUndefined();
    await context.result.current.actions.changePublication({ annotation: annotation({ publication: first }), operation: "publish", paper: paper({ literature: literature() }) });
    expect(preview).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[0][0][0]).toHaveProperty("expectedAuthorProfileRevision", 3);
    expect(apply.mock.calls[1][0][0]).toHaveProperty("expectedAuthorProfileRevision", 4);
  });

  test("keeps a legacy unknown create untouched when readonly reconciliation cannot find it", async () => {
    const { createUpsertOperation } = await import("../app/features/pdf/pdfAnnotationIntuechoSync");
    const original = createUpsertOperation(annotation(), literature());
    const lookup = vi.fn(async () => ({ results: [{ annotationId: original.annotationId, queueKey: original.queueKey, state: "failed", error: "not found" }] }));
    const preview = vi.fn(async () => true), context = setup({ lookupAnnotationPublications: lookup, confirmPublication: preview });
    const result = await context.result.current.actions.changePublication({ annotation: annotation({ publication: {
      actorBinding: publicationActor, desiredVisibility: "public", state: "failed", pendingOperation: original, outcome: "unknown"
    } }), operation: "publish", paper: paper(), resumePublication: true });
    expect(result.pendingOperation).toEqual(original);
    expect(result.outcome).toBe("unknown");
    expect(preview).not.toHaveBeenCalled();
    expect(context.readPublicationAuthorProfile).not.toHaveBeenCalled();
    expect(context.applyAnnotationPublications).not.toHaveBeenCalled();
  });

  test("does not prepare or upload when the local publication preview is cancelled", async () => {
    const confirmPublication = vi.fn(async () => false);
    const context = setup({ confirmPublication });
    const persist = vi.fn();
    const result = await context.result.current.actions.changePublication({
      annotation: annotation(), operation: "publish", paper: paper({ literature: literature() }), onPreparedPublication: persist
    });
    expect(confirmPublication).toHaveBeenCalledWith(expect.objectContaining({ title: "预览将公开的批注", recipient: "Intuecho 公开批注及广场" }));
    expect(result.lastError).toContain("已取消");
    expect(result.pendingOperation).toBeUndefined();
    expect(persist).not.toHaveBeenCalled();
    expect(context.applyAnnotationPublications).not.toHaveBeenCalled();
  });

  test("does not label a newer local edit as published when reconciling an older frozen operation", async () => {
    const context = setup();
    const { createUpsertOperation } = await import("../app/features/pdf/pdfAnnotationIntuechoSync");
    const original = createUpsertOperation(annotation(), literature());
    const changed = annotation({ note: "A newer local edit", revision: 2, publication: {
      actorBinding: publicationActor, desiredVisibility: "public", state: "failed", pendingOperation: original, outcome: "unknown"
    } });
    const reconciled = await context.result.current.actions.changePublication({ annotation: changed,
      operation: "update", paper: paper({ literature: literature() }), resumePublication: true });
    expect(context.lookupAnnotationPublications).toHaveBeenCalledWith([original], publicationActor);
    expect(context.applyAnnotationPublications).not.toHaveBeenCalled();
    expect(reconciled).toMatchObject({ state: "failed", remoteAnnotationId: "remote-1" });
    expect(reconciled.lastError).toContain("本地修改尚未发布");
    expect(reconciled.pendingOperation).toBeUndefined();
    const updated = await context.result.current.actions.changePublication({ annotation: { ...changed, publication: reconciled },
      operation: "update", paper: paper({ literature: literature() }), resumePublication: true });
    expect(updated.state).toBe("published");
    expect(context.applyAnnotationPublications).toHaveBeenNthCalledWith(1, [expect.objectContaining({ body: "A newer local edit", revision: 2 })], publicationActor);
  });

  test("rejects organization content before publishing while preserving an owner's known withdrawal", async () => {
    const context = setup();
    const source = paper({ literature: literature(), libraryReference: {
      scopeType: "organization", scopeId: "org-1", paperId: "paper-1", revision: 1
    } });
    const blocked = await context.result.current.actions.changePublication({
      annotation: annotation(), operation: "publish", paper: source
    });
    expect(blocked.state).toBe("failed");
    expect(context.applyAnnotationPublications).not.toHaveBeenCalled();
    const withdrawn = await context.result.current.actions.changePublication({
      annotation: annotation({ publication: { desiredVisibility: "private", state: "pending_retract", remoteAnnotationId: "remote-1" } }),
      operation: "retract", paper: source
    });
    expect(withdrawn.state).toBe("not_published");
    expect(context.applyAnnotationPublications).toHaveBeenCalledOnce();
  });

  test("requires durable preparation to succeed before sending", async () => {
    const context = setup();
    const result = await context.result.current.actions.changePublication({
      annotation: annotation(), operation: "publish", paper: paper({ literature: literature() }),
      onPreparedPublication: async () => { throw new Error("disk unavailable"); }
    });
    expect(result.state).toBe("failed");
    expect(result.lastError).toContain("disk unavailable");
    expect(context.applyAnnotationPublications).not.toHaveBeenCalled();
  });

  test("reconciles the exact prior operation only after explicit same-actor recovery", async () => {
    const newerActor = { ...publicationActor, sessionGeneration: "runtime-b:1" };
    const context = setup({ getActorBinding: () => newerActor });
    const { createUpsertOperation } = await import("../app/features/pdf/pdfAnnotationIntuechoSync");
    const pendingOperation = createUpsertOperation(annotation(), literature());
    const onPreparedPublication = vi.fn().mockResolvedValue(undefined);
    const result = await context.result.current.actions.changePublication({
      annotation: annotation({ publication: { actorBinding: publicationActor, desiredVisibility: "public", state: "failed", pendingOperation, outcome: "unknown" } }),
      operation: "publish", paper: paper(), resumePublication: true, onPreparedPublication
    });
    expect(result).toMatchObject({ actorBinding: newerActor, state: "published" });
    expect(onPreparedPublication).not.toHaveBeenCalled();
    expect(context.lookupAnnotationPublications).toHaveBeenCalledWith([pendingOperation], newerActor);
    expect(context.applyAnnotationPublications).not.toHaveBeenCalled();
    expect(context.loadLiterature).not.toHaveBeenCalled();
  });

  test("does not accept a late successful receipt after an account change", async () => {
    let actor = publicationActor;
    const waiting = deferred<{ results: ForumAnnotationPublicationResult[] }>();
    const apply = vi.fn(() => waiting.promise);
    const context = setup({ getActorBinding: () => actor, applyAnnotationPublications: apply });
    const pending = context.result.current.actions.changePublication({
      annotation: annotation(), operation: "publish", paper: paper({ literature: literature() })
    });
    await waitFor(() => expect(apply).toHaveBeenCalledOnce());
    actor = { ...publicationActor, subject: "synthetic-b", scopeId: "synthetic-b" };
    const operation = (apply.mock.calls[0] as unknown as [ForumAnnotationPublicationOperation[]])[0][0];
    waiting.resolve({ results: [receipt(operation)] });
    await expect(pending).resolves.toMatchObject({ actorBinding: publicationActor, state: "failed", pendingOperation: operation, outcome: "unknown" });
  });

  test("does not send a queued publication through another account after literature loading", async () => {
    const loading = deferred<LiteratureRecord>();
    let actor = publicationActor;
    const context = setup({ getActorBinding: () => actor, loadLiterature: vi.fn(() => loading.promise) });
    const pending = context.result.current.actions.changePublication({
      annotation: annotation(), operation: "publish", paper: paper(), newPublication: true,
      onPreparedPublication: vi.fn().mockResolvedValue(undefined)
    });
    await waitFor(() => expect(context.loadLiterature).toHaveBeenCalled());
    actor = { ...publicationActor, subject: "synthetic-b", scopeId: "synthetic-b", sessionGeneration: "runtime-a:2" };
    await act(async () => loading.resolve(literature()));

    await expect(pending).resolves.toMatchObject({ actorBinding: publicationActor, state: "failed" });
    expect(context.applyAnnotationPublications).not.toHaveBeenCalled();
    expect(context.persistPaperLiterature).not.toHaveBeenCalled();
  });

  test("persists the exact operation and actor before dispatching a publication", async () => {
    const saving = deferred<void>();
    const onPreparedPublication = vi.fn(() => saving.promise);
    const context = setup();
    const pending = context.result.current.actions.changePublication({
      annotation: annotation(), operation: "publish", paper: paper({ literature: literature() }), newPublication: true,
      onPreparedPublication
    });
    await act(async () => { await Promise.resolve(); });
    expect(onPreparedPublication).toHaveBeenCalledWith(expect.objectContaining({
      actorBinding: publicationActor,
      pendingOperation: expect.objectContaining({ operation: "upsert", queueKey: "paper-1:annotation-1", revision: 1 })
    }));
    expect(context.applyAnnotationPublications).not.toHaveBeenCalled();
    await act(async () => saving.resolve());
    await expect(pending).resolves.toMatchObject({ actorBinding: publicationActor, state: "published" });
  });

  test("holds a prior runtime publication on automatic restart instead of borrowing the new session", async () => {
    const context = setup({ getActorBinding: () => ({ ...publicationActor, sessionGeneration: "runtime-b:1" }),
      loadLiterature: vi.fn().mockResolvedValue(literature()) });
    const result = await context.result.current.actions.changePublication({
      annotation: annotation({ publication: { actorBinding: publicationActor, desiredVisibility: "public", state: "pending_create" } }),
      operation: "publish", paper: paper({ literature: literature() }), restartReplay: true,
      onPreparedPublication: vi.fn().mockResolvedValue(undefined)
    });
    expect(result).toMatchObject({ actorBinding: publicationActor, state: "failed" });
    expect(context.applyAnnotationPublications).not.toHaveBeenCalled();
  });

  test("holds legacy unbound pending tasks instead of assigning the current account", async () => {
    const context = setup({ loadLiterature: vi.fn().mockResolvedValue(literature()) });
    const result = await context.result.current.actions.changePublication({
      annotation: { ...annotation(), publication: { desiredVisibility: "public", state: "pending_create" } },
      operation: "publish", paper: paper(), restartReplay: true,
      onPreparedPublication: vi.fn().mockResolvedValue(undefined)
    });
    expect(result.state).toBe("failed");
    expect(context.applyAnnotationPublications).not.toHaveBeenCalled();
  });

  test("persists local paper literature through the authoritative metadata repository", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const updateLiterature = vi.fn();
    const persist = createPersistPaperLiterature({
      canManageLibraryReference: () => true,
      cloudLibraryClient: { updateLiterature },
      literatureMetadataRepository: { save }
    });

    const updated = await persist(paper(), literature());

    expect(save).toHaveBeenCalledWith("paper-1", literature());
    expect(updateLiterature).not.toHaveBeenCalled();
    expect(updated).toMatchObject({ id: paper().id, title: literature().title, authors: literature().authors, year: literature().year, literature: literature() });
  });

  test("persists cloud paper literature with the referenced revision and writes back the receipt revision", async () => {
    const save = vi.fn();
    const updateLiterature = vi.fn().mockResolvedValue({ revision: 5 });
    const persist = createPersistPaperLiterature({
      canManageLibraryReference: () => true,
      cloudLibraryClient: { updateLiterature },
      literatureMetadataRepository: { save }
    });
    const cloudPaper = paper({
      libraryReference: {
        documentId: "document-1",
        revision: 4,
        scopeId: "organization-1",
        scopeType: "organization"
      }
    });

    const updated = await persist(cloudPaper, literature());

    expect(updateLiterature).toHaveBeenCalledWith(
      { scopeId: "organization-1", scopeType: "organization" },
      "document-1",
      4,
      literature()
    );
    expect(save).not.toHaveBeenCalled();
    expect(updated).toMatchObject({
      ...cloudPaper, title: literature().title, authors: literature().authors,
      libraryReference: { ...cloudPaper.libraryReference!, revision: 5 },
      literature: literature()
    });
  });

  test("falls back to local authoritative metadata for an organization member", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const updateLiterature = vi.fn();
    const persist = createPersistPaperLiterature({
      canManageLibraryReference: () => false,
      cloudLibraryClient: { updateLiterature },
      literatureMetadataRepository: { save }
    });
    const memberPaper = paper({
      libraryReference: {
        documentId: "document-1",
        revision: 4,
        scopeId: "organization-1",
        scopeType: "organization"
      }
    });

    const updated = await persist(memberPaper, literature());

    expect(save).toHaveBeenCalledWith("paper-1", literature());
    expect(updateLiterature).not.toHaveBeenCalled();
    expect(updated).toMatchObject({ id: memberPaper.id, title: literature().title, authors: literature().authors, literature: literature() });
  });

  test("always persists a user-library reference through its cloud owner", async () => {
    const save = vi.fn();
    const updateLiterature = vi.fn().mockResolvedValue({ revision: 5 });
    const persist = createPersistPaperLiterature({
      canManageLibraryReference: () => false,
      cloudLibraryClient: { updateLiterature },
      literatureMetadataRepository: { save }
    });
    const userPaper = paper({
      libraryReference: {
        documentId: "document-1",
        revision: 4,
        scopeId: "user-1",
        scopeType: "user"
      }
    });

    await persist(userPaper, literature());

    expect(updateLiterature).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  test("reuses paper literature and persists it before a local publication", async () => {
    const currentPaper = paper({ literature: literature() });
    const context = setup({ initialPapers: [currentPaper] });

    const publication = await act(() => context.result.current.actions.changePublication({
      annotation: annotation(),
      operation: "publish",
      paper: currentPaper
    }));

    expect(publication).toMatchObject({
      desiredVisibility: "public",
      remoteAnnotationId: "remote-1",
      remoteRevision: 1,
      state: "published"
    });
    expect(context.loadLiterature).not.toHaveBeenCalled();
    expect(context.resolveLiterature).not.toHaveBeenCalled();
    expect(context.persistPaperLiterature.mock.invocationCallOrder[0])
      .toBeLessThan(context.applyAnnotationPublications.mock.invocationCallOrder[0]);
    expect(context.workspaceStore.getState().papers[0].literature).toEqual(literature());
  });

  test("reloads authoritative literature before replaying a restart operation", async () => {
    const staleLiterature = literature({ literatureId: "literature-stale" });
    const freshLiterature = literature({ literatureId: "literature-fresh" });
    const currentPaper = paper({ literature: staleLiterature });
    const context = setup({
      initialPapers: [currentPaper],
      loadLiterature: vi.fn().mockResolvedValue(freshLiterature)
    });

    await act(() => context.result.current.actions.changePublication({
      annotation: annotation({
        publication: { desiredVisibility: "public", state: "pending_create" },
        revision: 8
      }),
      operation: "publish",
      paper: currentPaper,
      restartReplay: true
    }));

    expect(context.loadLiterature).toHaveBeenCalledWith("paper-1");
    expect(context.applyAnnotationPublications).toHaveBeenCalledWith([
      expect.objectContaining({ literatureId: "literature-fresh", revision: 8 })
    ], publicationActor);
  });

  test("loads authoritative stored literature before resolving", async () => {
    const stored = literature({ literatureId: "stored-literature" });
    const context = setup({ loadLiterature: vi.fn().mockResolvedValue(stored) });

    await act(() => context.result.current.actions.changePublication({
      annotation: annotation(),
      operation: "publish",
      paper: paper()
    }));

    expect(context.loadLiterature).toHaveBeenCalledWith("paper-1");
    expect(context.resolveLiterature).not.toHaveBeenCalled();
    expect(context.persistPaperLiterature).toHaveBeenCalledWith(paper(), stored);
  });

  test.each([
    paper(),
    paper({ libraryReference: { documentId: "document-1", revision: 4, scopeId: "user-1", scopeType: "user" } })
  ])("writes local or cloud paper metadata before the remote operation", async (currentPaper) => {
    const context = setup({ initialPapers: [currentPaper] });
    context.loadLiterature.mockResolvedValue(literature());

    await act(() => context.result.current.actions.changePublication({
      annotation: annotation(),
      operation: "publish",
      paper: currentPaper
    }));

    expect(context.persistPaperLiterature).toHaveBeenCalledWith(currentPaper, literature());
    expect(context.persistPaperLiterature.mock.invocationCallOrder[0])
      .toBeLessThan(context.applyAnnotationPublications.mock.invocationCallOrder[0]);
  });

  test("auto-confirms an exact result using only bounded bibliographic hints", async () => {
    const candidate = {
      candidateKey: "candidate:doi:10.1000/test",
      provider: "crossref" as const,
      record: { authors: ["Ada Lovelace"], identifiers: [], title: "A Test Paper", year: 2026 }
    };
    const context = setup({
      confirmLiterature: vi.fn().mockResolvedValue({ literature: literature() }),
      resolveLiterature: vi.fn().mockResolvedValue({
        candidate,
        confirmationMode: "candidate",
        status: "exact",
        unavailableProviders: []
      })
    });

    const publication = await act(() => context.result.current.actions.changePublication({
      annotation: annotation(),
      literatureHints: {
        authors: Array.from({ length: 240 }, (_, index) => `Author ${index}${"x".repeat(400)}`),
        identifiers: Array.from({ length: 25 }, (_, index) => ({ kind: "doi" as const, value: `10.1000/${index}${"x".repeat(1200)}` })),
        title: "t".repeat(1200),
        year: 2026
      },
      operation: "publish",
      paper: paper()
    }));

    expect(publication.state).toBe("published");
    expect(context.resolveLiterature).toHaveBeenCalledWith({
      hints: {
        authors: expect.arrayContaining(["Author 0" + "x".repeat(292)]),
        identifiers: expect.any(Array),
        title: "t".repeat(1000),
        year: 2026
      },
      limit: 5,
      purpose: "liteasy_pdf_annotation"
    });
    const sentHints = context.resolveLiterature.mock.calls[0][0].hints;
    expect(sentHints.authors).toHaveLength(200);
    expect(sentHints.identifiers).toHaveLength(20);
    expect(sentHints.identifiers[0].value).toHaveLength(1000);
    expect(context.confirmLiterature).toHaveBeenCalledWith({
      candidateKey: candidate.candidateKey,
      mode: "candidate"
    });
    expect(context.result.current.model.literatureDialog).toBeNull();
  });

  it("preserves corroborated confirmation mode for an exact aggregate result", async () => {
    const corroboratedCandidate = {
      candidateKey: "openalex:openalex_id:W123",
      provider: "openalex" as const,
      record: { authors: ["Ada Lovelace"], identifiers: [], title: "A Test Paper", year: 2026 }
    };
    const context = setup({
      confirmLiterature: vi.fn().mockResolvedValue({ literature: literature() }),
      resolveLiterature: vi.fn().mockResolvedValue({
        candidate: corroboratedCandidate,
        confirmationMode: "corroborated",
        status: "exact",
        unavailableProviders: []
      })
    });

    await act(async () => {
      await context.result.current.actions.changePublication({
        annotation: annotation(),
        operation: "publish",
        paper: paper()
      });
    });

    expect(context.confirmLiterature).toHaveBeenCalledWith({
      candidateKey: corroboratedCandidate.candidateKey,
      mode: "corroborated"
    });
  });

  test("defers an ambiguous result until the user selects a candidate", async () => {
    const candidate = {
      candidateKey: "candidate:doi:10.1000/test",
      provider: "crossref" as const,
      record: { authors: ["Ada Lovelace"], identifiers: [], title: "A Test Paper", year: 2026 }
    };
    const context = setup({
      confirmLiterature: vi.fn().mockResolvedValue({ literature: literature() }),
      resolveLiterature: vi.fn().mockResolvedValue({
        candidates: [candidate],
        status: "ambiguous",
        unavailableProviders: []
      })
    });

    let pending!: Promise<ReturnType<typeof annotation>["publication"]>;
    act(() => {
      pending = context.result.current.actions.changePublication({
        annotation: annotation(),
        operation: "publish",
        paper: paper()
      });
    });
    await waitFor(() => expect(context.result.current.model.literatureDialog?.kind).toBe("candidates"));
    act(() => context.result.current.actions.selectCandidate(candidate.candidateKey));

    let publication!: ReturnType<typeof annotation>["publication"];
    await act(async () => { publication = await pending; });
    expect(publication).toMatchObject({ state: "published" });
    expect(context.confirmLiterature).toHaveBeenCalledWith({ candidateKey: candidate.candidateKey, mode: "candidate" });
  });

  test("restores persisted candidates without repeating provider search", async () => {
    const candidate = {
      candidateKey: "crossref:doi:10.1000/persisted",
      provider: "crossref" as const,
      record: {
        authors: ["Ada Lovelace"],
        identifiers: [{ kind: "doi" as const, source: "public_registry" as const, value: "10.1000/persisted" }],
        title: "Persisted Candidate"
      }
    };
    const context = setup({
      confirmLiterature: vi.fn().mockResolvedValue({ literature: literature() }),
      loadResolution: vi.fn().mockResolvedValue({
        candidates: [candidate],
        request: { limit: 5, purpose: "liteasy_pdf_annotation" },
        status: "candidate",
        unavailableProviders: [],
        updatedAt: "2026-08-11T00:00:00.000Z"
      })
    });

    let pending!: Promise<ReturnType<typeof annotation>["publication"]>;
    act(() => {
      pending = context.result.current.actions.changePublication({
        annotation: annotation(), operation: "publish", paper: paper()
      });
    });
    await waitFor(() => expect(context.result.current.model.literatureDialog?.kind).toBe("candidates"));
    expect(context.resolveLiterature).not.toHaveBeenCalled();

    act(() => context.result.current.actions.selectCandidate(candidate.candidateKey));
    let publication!: ReturnType<typeof annotation>["publication"];
    await act(async () => { publication = await pending; });
    expect(publication).toMatchObject({ state: "published" });
  });

  test("stages imported identity hints locally without contacting Intuecho", async () => {
    const context = setup();

    await act(() => context.result.current.actions.stagePaperIdentity(paper(), {
      identifiers: [{ kind: "doi", value: "10.1000/imported" }]
    }));

    expect(context.resolveLiterature).not.toHaveBeenCalled();
    expect(context.confirmLiterature).not.toHaveBeenCalled();
    expect(context.persistPaperLiterature).not.toHaveBeenCalled();
    expect(context.applyAnnotationPublications).not.toHaveBeenCalled();
    expect(context.saveResolution).toHaveBeenLastCalledWith("paper-1", expect.objectContaining({
      request: expect.objectContaining({
        hints: { identifiers: [{ kind: "doi", value: "10.1000/imported" }] }
      }),
      status: "unresolved"
    }));
  });

  test("hydrates every non-confirmed resolution status for visible user recovery", async () => {
    const candidate = {
      candidateKey: "crossref:doi:10.1000/state",
      provider: "crossref" as const,
      record: {
        authors: ["Ada Lovelace"],
        identifiers: [{ kind: "doi" as const, source: "public_registry" as const, value: "10.1000/state" }],
        title: "State paper"
      }
    };
    const request = { purpose: "liteasy_pdf_annotation" as const, query: "State paper" };
    const states = {
      ambiguous: { candidates: [candidate], request, status: "ambiguous" as const, unavailableProviders: [], updatedAt: "2026-08-11T00:00:00.000Z" },
      candidate: { candidates: [candidate], request, status: "candidate" as const, unavailableProviders: [], updatedAt: "2026-08-11T00:00:00.000Z" },
      conflict: { request, status: "conflict" as const, unavailableProviders: [], updatedAt: "2026-08-11T00:00:00.000Z" },
      unavailable: { request, status: "unavailable" as const, unavailableProviders: ["crossref" as const], updatedAt: "2026-08-11T00:00:00.000Z" },
      unresolved: { request, status: "unresolved" as const, unavailableProviders: [], updatedAt: "2026-08-11T00:00:00.000Z" }
    };
    const papers = Object.keys(states).map((id) => paper({ id }));
    const context = setup({
      initialPapers: papers,
      loadResolution: vi.fn(async (paperId: keyof typeof states) => states[paperId])
    });

    await act(() => context.result.current.actions.hydrateResolutionStates(papers));

    expect(context.result.current.model.resolutionsByPaperId).toEqual(states);
  });

  test("recovers a legacy confirmed resolution through Liteasy without writing another resolution", async () => {
    const confirmed = literature({ literatureId: "literature-restored", revision: 4 });
    const context = setup({
      loadResolution: vi.fn().mockResolvedValue({
        literatureId: confirmed.literatureId,
        request: { purpose: "liteasy_pdf_annotation", query: "10.1000/test" },
        revision: confirmed.revision,
        status: "confirmed",
        updatedAt: "2026-08-11T00:00:00.000Z"
      }),
      verifyLiterature: vi.fn().mockResolvedValue(confirmed)
    });

    await act(() => context.result.current.actions.resolvePaperIdentity(paper()));

    expect(context.verifyLiterature).toHaveBeenCalledWith({
      literatureId: "literature-restored",
      revision: 4
    });
    expect(context.persistPaperLiterature).toHaveBeenCalledWith(paper(), confirmed);
    expect(context.saveResolution).not.toHaveBeenCalled();
  });

  test("exposes a cancellable resolving model before the resolver returns and ignores its late result", async () => {
    const resolution = deferred<{
      candidates: [];
      status: "not_found";
      unavailableProviders: [];
    }>();
    const context = setup({ resolveLiterature: vi.fn().mockReturnValue(resolution.promise) });
    let pending!: Promise<ReturnType<typeof annotation>["publication"]>;
    act(() => {
      pending = context.result.current.actions.changePublication({
        annotation: annotation(),
        operation: "publish",
        paper: paper()
      });
    });

    await waitFor(() => expect(context.result.current.model.literatureDialog?.kind).toBe("resolving"));
    act(() => context.result.current.actions.cancelResolution());
    await expect(pending).resolves.toEqual({ desiredVisibility: "private", state: "not_published" });
    act(() => resolution.resolve({ candidates: [], status: "not_found", unavailableProviders: [] }));
    await Promise.resolve();
    expect(context.result.current.model.literatureDialog).toBeNull();
  });

  test("exposes confirming immediately and ignores a candidate confirmation after cancel", async () => {
    const confirmation = deferred<{ literature: LiteratureRecord }>();
    const candidate = {
      candidateKey: "candidate:doi:10.1000/test",
      provider: "crossref" as const,
      record: { authors: [], identifiers: [], title: "A Test Paper" }
    };
    const context = setup({
      confirmLiterature: vi.fn().mockReturnValue(confirmation.promise),
      resolveLiterature: vi.fn().mockResolvedValue({ candidate, confirmationMode: "candidate", status: "exact", unavailableProviders: [] })
    });
    let pending!: Promise<ReturnType<typeof annotation>["publication"]>;
    act(() => {
      pending = context.result.current.actions.changePublication({
        annotation: annotation(),
        literatureHints: { authors: ["Ada Lovelace"], title: "A Test Paper", year: 2026 },
        operation: "publish",
        paper: paper()
      });
    });

    await waitFor(() => expect(context.result.current.model.literatureDialog?.kind).toBe("confirming"));
    act(() => context.result.current.actions.cancelResolution());
    await expect(pending).resolves.toEqual({ desiredVisibility: "private", state: "not_published" });
    act(() => confirmation.resolve({ literature: literature() }));
    await Promise.resolve();
    expect(context.persistPaperLiterature).not.toHaveBeenCalled();
    expect(context.applyAnnotationPublications).not.toHaveBeenCalled();
  });

  test("returns a stable busy result for another paper while identity resolution is active", async () => {
    const resolution = deferred<never>();
    const context = setup({ resolveLiterature: vi.fn().mockReturnValue(resolution.promise) });
    let first!: Promise<ReturnType<typeof annotation>["publication"]>;
    act(() => {
      first = context.result.current.actions.changePublication({
        annotation: annotation(), operation: "publish", paper: paper()
      });
    });
    await waitFor(() => expect(context.resolveLiterature).toHaveBeenCalledTimes(1));

    const busy = await act(() => context.result.current.actions.changePublication({
      annotation: annotation({ id: "annotation-2" }),
      operation: "publish",
      paper: paper({ id: "paper-2", title: "Another Paper" })
    }));

    expect(busy).toEqual({
      desiredVisibility: "public",
      lastError: "已有文献身份确认正在进行，请完成或取消后重试。",
      state: "failed"
    });
    act(() => context.result.current.actions.cancelResolution());
    await expect(first).resolves.toEqual({ desiredVisibility: "private", state: "not_published" });
  });

  test("keeps unavailable resolution retry-only and retries the same request", async () => {
    const candidate = {
      candidateKey: "candidate:doi:10.1000/test",
      provider: "crossref" as const,
      record: { authors: [], identifiers: [], title: "A Test Paper" }
    };
    const context = setup({
      confirmLiterature: vi.fn().mockResolvedValue({ literature: literature() }),
      resolveLiterature: vi.fn()
        .mockResolvedValueOnce({ retryable: true, status: "unavailable", unavailableProviders: ["crossref"] })
        .mockResolvedValueOnce({ candidate, confirmationMode: "candidate", status: "exact", unavailableProviders: [] })
    });
    let pending!: Promise<ReturnType<typeof annotation>["publication"]>;
    act(() => {
      pending = context.result.current.actions.changePublication({
        annotation: annotation(), operation: "publish", paper: paper()
      });
    });
    await waitFor(() => expect(context.result.current.model.literatureDialog).toMatchObject({ kind: "unavailable" }));

    act(() => context.result.current.actions.retryResolution());

    let publication!: ReturnType<typeof annotation>["publication"];
    await act(async () => { publication = await pending; });
    expect(publication).toMatchObject({ state: "published" });
    expect(context.resolveLiterature).toHaveBeenCalledTimes(2);
  });

  test("keeps not-found metadata unresolved instead of creating a formal manual record", async () => {
    const context = setup({
      resolveLiterature: vi.fn().mockResolvedValue({ candidates: [], status: "not_found", unavailableProviders: [] })
    });
    let pending!: Promise<ReturnType<typeof annotation>["publication"]>;
    act(() => {
      pending = context.result.current.actions.changePublication({
        annotation: annotation(),
        literatureHints: { authors: ["Ada Lovelace"], title: "A Test Paper", year: 2026 },
        operation: "publish",
        paper: paper()
      });
    });
    await waitFor(() => expect(context.result.current.model.literatureDialog?.kind).toBe("unresolved"));
    expect(context.confirmLiterature).not.toHaveBeenCalled();
    act(() => context.result.current.actions.cancelResolution());
    await expect(pending).resolves.toEqual({ desiredVisibility: "private", state: "not_published" });
  });

  test("restarts provider resolution from corrected bibliography without reusing extracted identifiers", async () => {
    const candidate = {
      candidateKey: "crossref:doi:10.1000/corrected",
      provider: "crossref" as const,
      record: {
        authors: ["Ada Lovelace", "Grace Hopper"],
        identifiers: [{ kind: "doi" as const, source: "public_registry" as const, value: "10.1000/corrected" }],
        title: "Corrected Paper",
        year: 2026
      }
    };
    const context = setup({
      resolveLiterature: vi.fn()
        .mockResolvedValueOnce({ candidates: [], status: "not_found", unavailableProviders: [] })
        .mockResolvedValueOnce({ candidates: [candidate], status: "ambiguous", unavailableProviders: [] })
    });
    let pending!: Promise<ReturnType<typeof annotation>["publication"]>;
    act(() => {
      pending = context.result.current.actions.changePublication({
        annotation: annotation(),
        literatureHints: {
          identifiers: [{ kind: "doi", value: "10.1000/incorrect" }],
          title: "Incorrect Paper"
        },
        operation: "publish",
        paper: paper()
      });
    });
    await waitFor(() => expect(context.result.current.model.literatureDialog?.kind).toBe("unresolved"));

    act(() => context.result.current.actions.searchLiterature({
      authors: ["Ada Lovelace", "Grace Hopper"],
      title: "Corrected Paper",
      year: 2026
    }));

    await waitFor(() => expect(context.resolveLiterature).toHaveBeenCalledTimes(2));
    expect(context.resolveLiterature.mock.calls[1][0]).toEqual({
      hints: {
        authors: ["Ada Lovelace", "Grace Hopper"],
        title: "Corrected Paper",
        year: 2026
      },
      limit: 5,
      purpose: "liteasy_pdf_annotation",
      query: "Corrected Paper"
    });
    await waitFor(() => expect(context.result.current.model.literatureDialog?.kind).toBe("candidates"));
    act(() => context.result.current.actions.cancelResolution());
    await expect(pending).resolves.toEqual({ desiredVisibility: "private", state: "not_published" });
  });

  test("cancels identity resolution without an error state", async () => {
    const context = setup({
      resolveLiterature: vi.fn().mockResolvedValue({ candidates: [], status: "not_found", unavailableProviders: [] })
    });
    let pending!: Promise<ReturnType<typeof annotation>["publication"]>;
    act(() => {
      pending = context.result.current.actions.changePublication({
        annotation: annotation(), operation: "publish", paper: paper()
      });
    });
    await waitFor(() => expect(context.result.current.model.literatureDialog?.kind).toBe("unresolved"));

    act(() => context.result.current.actions.cancelResolution());

    await expect(pending).resolves.toEqual({ desiredVisibility: "private", state: "not_published" });
    expect(context.result.current.model.literatureDialog).toBeNull();
    expect(context.applyAnnotationPublications).not.toHaveBeenCalled();
  });

  test("stops before Intuecho when the authoritative Liteasy write is rejected", async () => {
    const context = setup({
      loadLiterature: vi.fn().mockResolvedValue(literature()),
      persistPaperLiterature: vi.fn().mockRejectedValue(new Error("没有组织文献管理权限。"))
    });

    const publication = await act(() => context.result.current.actions.changePublication({
      annotation: annotation(), operation: "publish", paper: paper()
    }));

    expect(publication).toEqual({
      actorBinding: publicationActor,
      desiredVisibility: "public",
      lastError: "没有组织文献管理权限。",
      state: "failed"
    });
    expect(context.applyAnnotationPublications).not.toHaveBeenCalled();
  });

  test.each([
    ["offline", "论坛发布请求失败，请稍后重试。"],
    ["unauthenticated", "请先登录 Liteasy 再打开论坛发布页。"],
    ["rate_limit", "请求过于频繁，请稍后重试。"]
  ])("keeps a stable retryable operation after %s failure", async (code, error) => {
    const operations: ForumAnnotationPublicationOperation[] = [];
    const apply = vi.fn().mockImplementation(async ([operation]: ForumAnnotationPublicationOperation[]) => {
      operations.push(operation);
      return { results: [{
        annotationId: operation.annotationId,
        code,
        error,
        pendingOperation: operation,
        queueKey: operation.queueKey,
        state: "failed"
      }] };
    });
    const currentPaper = paper({ literature: literature() });
    const context = setup({ applyAnnotationPublications: apply, initialPapers: [currentPaper] });

    const first = await act(() => context.result.current.actions.changePublication({
      annotation: annotation(), operation: "publish", paper: currentPaper
    }));
    const retry = await act(() => context.result.current.actions.changePublication({
      annotation: annotation(), operation: "publish", paper: currentPaper
    }));

    expect(first).toMatchObject({
      desiredVisibility: "public",
      lastError: `发布结果待核实。${error}`,
      pendingCreateOperation: operations[0],
      state: "failed"
    });
    expect(retry).toEqual(first);
    expect(operations[0]).toEqual(operations[1]);
  });

  test("uses upsert for an update and preserves the confirmed remote identity", async () => {
    const currentPaper = paper({ literature: literature() });
    const context = setup({
      applyAnnotationPublications: vi.fn().mockImplementation(
        async ([operation]: ForumAnnotationPublicationOperation[]) => ({
          results: [receipt(operation, { remoteAnnotationId: "remote-existing", remoteRevision: 4 })]
        })
      ),
      initialPapers: [currentPaper]
    });
    const current = annotation({
      publication: {
        desiredVisibility: "public",
        remoteAnnotationId: "remote-existing",
        remoteRevision: 3,
        state: "published"
      },
      revision: 2
    });

    const result = await act(() => context.result.current.actions.changePublication({
      annotation: current, operation: "update", paper: currentPaper
    }));

    expect(context.applyAnnotationPublications.mock.calls[0][0][0]).toMatchObject({
      annotationId: "annotation-1", operation: "upsert", queueKey: "paper-1:annotation-1", revision: 2
    });
    expect(result).toMatchObject({
      desiredVisibility: "public",
      remoteAnnotationId: "remote-existing",
      remoteRevision: 4,
      state: "published"
    });
  });

  test("retracts an existing publication with the exact remote annotation ID", async () => {
    const context = setup({
      applyAnnotationPublications: vi.fn().mockImplementation(
        async ([operation]: ForumAnnotationPublicationOperation[]) => ({
          results: [receipt(operation, { remoteRevision: 4 })]
        })
      )
    });
    const current = annotation({
      publication: {
        desiredVisibility: "private",
        remoteAnnotationId: "remote-existing",
        remoteRevision: 3,
        state: "pending_retract"
      },
      revision: 3
    });

    const result = await act(() => context.result.current.actions.changePublication({
      annotation: current, operation: "retract", paper: paper()
    }));

    expect(context.applyAnnotationPublications.mock.calls[0][0][0]).toMatchObject({
      operation: "retract", remoteAnnotationId: "remote-existing"
    });
    expect(result).toMatchObject({
      desiredVisibility: "private",
      remoteAnnotationId: "remote-existing",
      state: "not_published"
    });
  });

  test("keeps an unknown retract outcome for reconciliation when its response fails", async () => {
    const applyAnnotationPublications = vi.fn().mockImplementation(
      async ([operation]: ForumAnnotationPublicationOperation[]) => ({ results: [{
        annotationId: operation.annotationId,
        error: "论坛发布请求失败，请稍后重试。",
        pendingOperation: operation,
        queueKey: operation.queueKey,
        state: "failed"
      }] })
    );
    const context = setup({ applyAnnotationPublications });

    const result = await act(() => context.result.current.actions.changePublication({
      annotation: annotation({
        publication: {
          desiredVisibility: "private",
          remoteAnnotationId: "remote-existing",
          remoteRevision: 3,
          state: "pending_retract"
        },
        revision: 4
      }),
      operation: "retract",
      paper: paper()
    }));

    expect(result).toMatchObject({ desiredVisibility: "private", state: "failed" });
    expect(result.lastError).toContain("撤回结果待核实");
    expect(result.lastError).toContain("论坛发布请求失败");
    expect(result.pendingOperation).toMatchObject({ operation: "retract", revision: 4 });
    expect(result).toMatchObject({ remoteAnnotationId: "remote-existing", remoteRevision: 3 });
  });

  test.each(["update", "retract"] as const)(
    "preserves remote publication provenance when %s fails",
    async (operation) => {
      const applyAnnotationPublications = vi.fn().mockImplementation(
        async ([pendingOperation]: ForumAnnotationPublicationOperation[]) => ({ results: [{
          annotationId: pendingOperation.annotationId,
          error: "请求过于频繁，请稍后重试。",
          pendingOperation,
          queueKey: pendingOperation.queueKey,
          state: "failed"
        }] })
      );
      const currentPaper = paper({ literature: literature() });
      const context = setup({ applyAnnotationPublications, initialPapers: [currentPaper] });
      const current = annotation({
        publication: {
          desiredVisibility: operation === "retract" ? "private" : "public",
          remoteAnnotationId: "remote-existing",
          remoteRevision: 7,
          state: operation === "retract" ? "pending_retract" : "pending_update"
        },
        revision: 8
      });

      const result = await act(() => context.result.current.actions.changePublication({
        annotation: current, operation, paper: currentPaper
      }));

      expect(result).toMatchObject({
        remoteAnnotationId: "remote-existing",
        remoteRevision: 7,
        state: "failed"
      });
    }
  );

  test("serializes publish then retract and retracts the create receipt identity", async () => {
    const create = deferred<{ results: ForumAnnotationPublicationResult[] }>();
    const operations: ForumAnnotationPublicationOperation[] = [];
    const apply = vi.fn().mockImplementation(async ([operation]: ForumAnnotationPublicationOperation[]) => {
      operations.push(operation);
      if (operation.operation === "upsert") return create.promise;
      return { results: [receipt(operation)] };
    });
    const currentPaper = paper({ literature: literature() });
    const context = setup({ applyAnnotationPublications: apply, initialPapers: [currentPaper] });

    let publishing!: Promise<ReturnType<typeof annotation>["publication"]>;
    let retracting!: Promise<ReturnType<typeof annotation>["publication"]>;
    act(() => {
      publishing = context.result.current.actions.changePublication({
        annotation: annotation(), operation: "publish", paper: currentPaper
      });
      retracting = context.result.current.actions.changePublication({
        annotation: annotation({
          publication: { desiredVisibility: "private", state: "pending_retract" },
          revision: 2
        }),
        operation: "retract",
        paper: currentPaper
      });
    });
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    const upsert = operations[0];
    act(() => create.resolve({ results: [receipt(upsert, { remoteAnnotationId: "created-remotely" })] }));

    await expect(publishing).resolves.toMatchObject({ state: "published" });
    await expect(retracting).resolves.toMatchObject({ state: "not_published" });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(operations).toHaveLength(2);
    expect(operations[1]).toMatchObject({ operation: "retract", remoteAnnotationId: "created-remotely" });
  });

  test("looks up the exact create after its response is lost and retracts the recovered remote ID", async () => {
    const operations: ForumAnnotationPublicationOperation[] = [];
    let upsertAttempts = 0;
    const apply = vi.fn().mockImplementation(async ([operation]: ForumAnnotationPublicationOperation[]) => {
      operations.push(operation);
      if (operation.operation === "upsert" && upsertAttempts++ === 0) {
        return { results: [{
          annotationId: operation.annotationId,
          error: "论坛发布请求失败，请稍后重试。",
          pendingOperation: operation,
          queueKey: operation.queueKey,
          state: "failed"
        }] };
      }
      return { results: [receipt(operation, {
        remoteAnnotationId: "created-before-response-loss",
        remoteRevision: operation.operation === "retract" ? 5 : 4
      })] };
    });
    const currentPaper = paper({ literature: literature() });
    const lookup = vi.fn(async ([operation]: ForumAnnotationPublicationOperation[]) => ({ results: [receipt(operation, { remoteAnnotationId: "created-before-response-loss", remoteRevision: 4 })] }));
    const context = setup({ applyAnnotationPublications: apply, lookupAnnotationPublications: lookup, initialPapers: [currentPaper] });

    const publishing = context.result.current.actions.changePublication({
      annotation: annotation(), operation: "publish", paper: currentPaper
    });
    const retracting = context.result.current.actions.changePublication({
      annotation: annotation({
        publication: { desiredVisibility: "private", state: "pending_retract" },
        revision: 2
      }),
      operation: "retract",
      paper: currentPaper
    });

    await expect(publishing).resolves.toMatchObject({ state: "failed" });
    await expect(retracting).resolves.toMatchObject({
      desiredVisibility: "private",
      remoteAnnotationId: "created-before-response-loss",
      remoteRevision: 5,
      state: "not_published"
    });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenCalledWith([operations[0]], publicationActor);
    expect(operations[1]).toMatchObject({
      operation: "retract",
      remoteAnnotationId: "created-before-response-loss"
    });
  });

  test("keeps a queued retract failed and private-desired when create recovery is still outcome-unknown", async () => {
    const operations: ForumAnnotationPublicationOperation[] = [];
    const apply = vi.fn().mockImplementation(async ([operation]: ForumAnnotationPublicationOperation[]) => {
      operations.push(operation);
      return { results: [{
        annotationId: operation.annotationId,
        error: "论坛发布请求失败，请稍后重试。",
        pendingOperation: operation,
        queueKey: operation.queueKey,
        state: "failed"
      }] };
    });
    const currentPaper = paper({ literature: literature() });
    const lookup = vi.fn(async ([operation]: ForumAnnotationPublicationOperation[]) => ({ results: [{ annotationId: operation.annotationId, queueKey: operation.queueKey, state: "failed", error: "论坛发布请求失败，请稍后重试。" }] }));
    const context = setup({ applyAnnotationPublications: apply, lookupAnnotationPublications: lookup, initialPapers: [currentPaper] });

    const publishing = context.result.current.actions.changePublication({
      annotation: annotation(), operation: "publish", paper: currentPaper
    });
    const retracting = context.result.current.actions.changePublication({
      annotation: annotation({
        publication: { desiredVisibility: "private", state: "pending_retract" },
        revision: 2
      }),
      operation: "retract",
      paper: currentPaper
    });

    await expect(publishing).resolves.toMatchObject({ state: "failed" });
    await expect(retracting).resolves.toMatchObject({
      desiredVisibility: "private",
      lastError: "撤回未完成，论坛发布状态未知。论坛发布请求失败，请稍后重试。",
      pendingCreateOperation: operations[0],
      state: "failed"
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith([operations[0]], publicationActor);
  });

  test("looks up a restart-durable exact create before retracting after controller restart", async () => {
    const exactCreate: Extract<ForumAnnotationPublicationOperation, { operation: "upsert" }> = {
      annotationId: "annotation-1",
      body: "Exact pre-crash body",
      literatureId: "literature-before-crash",
      operation: "upsert",
      queueKey: "paper-1:annotation-1",
      revision: 6,
      sourcePassage: {
        anchorHash: "pdf:paper-1:2:pre-crash",
        excerpt: "Exact pre-crash excerpt",
        page: 2,
        rects: [{ height: 0.1, left: 0.2, top: 0.3, width: 0.4 }]
      },
      updatedAt: "2026-08-09T00:00:03.000Z"
    };
    const operations: ForumAnnotationPublicationOperation[] = [];
    const apply = vi.fn().mockImplementation(async ([operation]: ForumAnnotationPublicationOperation[]) => {
      operations.push(operation);
      return { results: [receipt(operation, {
        remoteAnnotationId: "created-before-restart",
        remoteRevision: operation.operation === "retract" ? 8 : 7
      })] };
    });
    const currentPaper = paper({ literature: literature() });
    const lookup = vi.fn(async ([operation]: ForumAnnotationPublicationOperation[]) => ({ results: [receipt(operation, { remoteAnnotationId: "created-before-restart", remoteRevision: 7 })] }));
    const context = setup({ applyAnnotationPublications: apply, lookupAnnotationPublications: lookup, initialPapers: [currentPaper] });
    const restartAnnotation = annotation({
      publication: {
        desiredVisibility: "private",
        lastError: "撤回未完成，论坛发布状态未知。",
        pendingCreateOperation: exactCreate,
        state: "pending_retract"
      } as unknown as PdfAnnotationV2["publication"],
      revision: 7
    });

    const result = await context.result.current.actions.changePublication({
      annotation: restartAnnotation,
      operation: "retract",
      paper: currentPaper,
      restartReplay: true
    });

    expect(result).toMatchObject({
      desiredVisibility: "private",
      remoteAnnotationId: "created-before-restart",
      state: "not_published"
    });
    expect(operations).toHaveLength(1);
    expect(lookup).toHaveBeenCalledWith([exactCreate], publicationActor);
    expect(operations[0]).toMatchObject({
      operation: "retract",
      remoteAnnotationId: "created-before-restart",
      revision: 7
    });
  });

  test("settles queued retract as not published after a definitive preflight failure", async () => {
    const currentPaper = paper({ literature: literature() });
    const context = setup({
      initialPapers: [currentPaper],
      persistPaperLiterature: vi.fn().mockRejectedValue(new Error("没有组织文献管理权限。"))
    });

    const publishing = context.result.current.actions.changePublication({
      annotation: annotation(), operation: "publish", paper: currentPaper
    });
    const retracting = context.result.current.actions.changePublication({
      annotation: annotation({
        publication: { desiredVisibility: "private", state: "pending_retract" },
        revision: 2
      }),
      operation: "retract",
      paper: currentPaper
    });

    await expect(publishing).resolves.toMatchObject({ state: "failed" });
    await expect(retracting).resolves.toEqual({ desiredVisibility: "private", state: "not_published" });
    expect(context.applyAnnotationPublications).not.toHaveBeenCalled();
  });

  test("writes the returned cloud revision and literature into the workspace before publication", async () => {
    const currentPaper = paper({
      libraryReference: { documentId: "document-1", revision: 4, scopeId: "user-1", scopeType: "user" }
    });
    const persisted = {
      ...currentPaper,
      libraryReference: { ...currentPaper.libraryReference!, revision: 5 },
      literature: literature()
    };
    const context = setup({
      initialPapers: [currentPaper],
      loadLiterature: vi.fn().mockResolvedValue(literature()),
      persistPaperLiterature: vi.fn().mockResolvedValue(persisted)
    });

    await act(() => context.result.current.actions.changePublication({
      annotation: annotation(), operation: "publish", paper: currentPaper
    }));

    expect(context.workspaceStore.getState().papers[0]).toEqual(persisted);
    expect(context.workspaceStore.getState().workspaceRevision).toBe(1);
    expect(context.onPaperUpdated).toHaveBeenCalledWith(persisted);
  });

  test("writes paper state back and reuses the returned cloud revision for a sequential publication", async () => {
    const initialPaper = paper({
      libraryReference: { documentId: "document-1", revision: 4, scopeId: "user-1", scopeType: "user" }
    });
    const persistPaperLiterature = vi.fn().mockImplementation(async (
      current: Paper,
      confirmed: LiteratureRecord
    ) => ({
      ...current,
      libraryReference: {
        ...current.libraryReference!,
        revision: current.libraryReference!.revision + 1
      },
      literature: confirmed
    }));
    const workspaceStore = createWorkspaceStore([initialPaper]);
    const forumClient = {
      applyAnnotationPublications: vi.fn().mockImplementation(
        async (operations: ForumAnnotationPublicationOperation[]) => ({
          results: operations.map((operation) => receipt(operation))
        })
      ),
      confirmLiterature: vi.fn(),
      resolveLiterature: vi.fn()
    };
    const { result } = renderHook(() => {
      const [readerPaper, setReaderPaper] = useState(initialPaper);
      const controller = usePdfAnnotationPublicationController({
        getActorBinding: () => publicationActor,
        confirmPublication: async () => true,
        forumClient,
        literatureMetadataRepository: { load: vi.fn().mockResolvedValue(literature()) },
        onPaperUpdated: setReaderPaper,
        persistPaperLiterature,
        workspaceStore
      });
      return { controller, readerPaper };
    });

    await act(() => result.current.controller.actions.changePublication({
      annotation: annotation(), operation: "publish", paper: result.current.readerPaper,
      onPreparedPublication: async () => {}
    }));
    await act(() => result.current.controller.actions.changePublication({
      annotation: annotation({ id: "annotation-2" }),
      operation: "publish",
      onPreparedPublication: async () => {},
      paper: initialPaper
    }));

    expect(persistPaperLiterature.mock.calls.map(([current]) => current.libraryReference?.revision)).toEqual([4, 5]);
    expect(result.current.readerPaper.libraryReference?.revision).toBe(6);
    expect(result.current.readerPaper.literature).toEqual(literature());
  });
});
