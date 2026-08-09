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
    publication: { desiredVisibility: "private", state: "not_published" },
    rects: [{ height: 0.1, left: 0.2, top: 0.3, width: 0.4 }],
    revision: 1,
    text: "Selected passage",
    updatedAt: "2026-08-09T00:00:01.000Z",
    ...overrides
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
  initialPapers?: Paper[];
  loadLiterature?: ReturnType<typeof vi.fn>;
  persistPaperLiterature?: ReturnType<typeof vi.fn>;
  resolveLiterature?: ReturnType<typeof vi.fn>;
  confirmLiterature?: ReturnType<typeof vi.fn>;
  applyAnnotationPublications?: ReturnType<typeof vi.fn>;
  onPaperUpdated?: ReturnType<typeof vi.fn>;
} = {}) {
  const workspaceStore = createWorkspaceStore(input.initialPapers ?? [paper()]);
  const loadLiterature = input.loadLiterature ?? vi.fn().mockResolvedValue(undefined);
  const persistPaperLiterature = input.persistPaperLiterature ?? vi.fn().mockImplementation(
    async (current: Paper, confirmed: LiteratureRecord) => ({ ...current, literature: confirmed })
  );
  const resolveLiterature = input.resolveLiterature ?? vi.fn();
  const confirmLiterature = input.confirmLiterature ?? vi.fn();
  const applyAnnotationPublications = input.applyAnnotationPublications ?? vi.fn().mockImplementation(
    async (operations: ForumAnnotationPublicationOperation[]) => ({ results: operations.map((operation) => receipt(operation)) })
  );
  const onPaperUpdated = input.onPaperUpdated ?? vi.fn();
  const hook = renderHook(() => usePdfAnnotationPublicationController({
    forumClient: { applyAnnotationPublications, confirmLiterature, resolveLiterature },
    literatureMetadataRepository: { load: loadLiterature },
    onPaperUpdated,
    persistPaperLiterature,
    workspaceStore
  }));
  return {
    ...hook,
    applyAnnotationPublications,
    confirmLiterature,
    loadLiterature,
    onPaperUpdated,
    persistPaperLiterature,
    resolveLiterature,
    workspaceStore
  };
}

describe("usePdfAnnotationPublicationController", () => {
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
    expect(updated).toEqual({ ...paper(), literature: literature() });
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
    expect(updated).toEqual({
      ...cloudPaper,
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
    expect(updated).toEqual({ ...memberPaper, literature: literature() });
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
        annotation: annotation(), operation: "publish", paper: paper()
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
      resolveLiterature: vi.fn().mockResolvedValue({ candidate, status: "exact", unavailableProviders: [] })
    });
    let pending!: Promise<ReturnType<typeof annotation>["publication"]>;
    act(() => {
      pending = context.result.current.actions.changePublication({
        annotation: annotation(), operation: "publish", paper: paper()
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
        .mockResolvedValueOnce({ candidate, status: "exact", unavailableProviders: [] })
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

  test("opens manual fallback only for not-found and confirms author-year input as manual", async () => {
    const manual = literature({
      identifiers: [{ kind: "title_authors_year_hash", source: "manual", value: "hash-1" }],
      provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "manual" }
    });
    const context = setup({
      confirmLiterature: vi.fn().mockResolvedValue({ literature: manual }),
      resolveLiterature: vi.fn().mockResolvedValue({ candidates: [], status: "not_found", unavailableProviders: [] })
    });
    let pending!: Promise<ReturnType<typeof annotation>["publication"]>;
    act(() => {
      pending = context.result.current.actions.changePublication({
        annotation: annotation(), operation: "publish", paper: paper()
      });
    });
    await waitFor(() => expect(context.result.current.model.literatureDialog?.kind).toBe("manual"));

    act(() => context.result.current.actions.submitManual({
      authors: ["Ada Lovelace"],
      identifiers: [],
      title: "A Test Paper",
      year: 2026
    }));

    let publication!: ReturnType<typeof annotation>["publication"];
    await act(async () => { publication = await pending; });
    expect(publication).toMatchObject({ state: "published" });
    expect(context.confirmLiterature).toHaveBeenCalledWith({
      mode: "manual",
      record: { authors: ["Ada Lovelace"], identifiers: [], title: "A Test Paper", year: 2026 }
    });
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
    await waitFor(() => expect(context.result.current.model.literatureDialog?.kind).toBe("manual"));

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

    expect(first).toEqual({ desiredVisibility: "public", lastError: error, state: "failed" });
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

  test("states that the forum copy remains public when retract fails", async () => {
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
    expect(result.lastError).toContain("论坛仍公开");
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

  test("settles a queued retract privately when create conclusively fails without a remote copy", async () => {
    const apply = vi.fn().mockImplementation(async ([operation]: ForumAnnotationPublicationOperation[]) => ({
      results: [{
        annotationId: operation.annotationId,
        error: "请求被拒绝。",
        pendingOperation: operation,
        queueKey: operation.queueKey,
        state: "failed"
      }]
    }));
    const currentPaper = paper({ literature: literature() });
    const context = setup({ applyAnnotationPublications: apply, initialPapers: [currentPaper] });

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
    expect(apply).toHaveBeenCalledTimes(1);
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
        forumClient,
        literatureMetadataRepository: { load: vi.fn().mockResolvedValue(literature()) },
        onPaperUpdated: setReaderPaper,
        persistPaperLiterature,
        workspaceStore
      });
      return { controller, readerPaper };
    });

    await act(() => result.current.controller.actions.changePublication({
      annotation: annotation(), operation: "publish", paper: result.current.readerPaper
    }));
    await act(() => result.current.controller.actions.changePublication({
      annotation: annotation({ id: "annotation-2" }),
      operation: "publish",
      paper: initialPaper
    }));

    expect(persistPaperLiterature.mock.calls.map(([current]) => current.libraryReference?.revision)).toEqual([4, 5]);
    expect(result.current.readerPaper.libraryReference?.revision).toBe(6);
    expect(result.current.readerPaper.literature).toEqual(literature());
  });
});
