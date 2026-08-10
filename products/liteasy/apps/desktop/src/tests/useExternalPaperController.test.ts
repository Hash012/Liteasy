import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useExternalPaperController } from "../app/controllers/useExternalPaperController";

const contentHash = "a".repeat(64);

function createHarness(
  exportDocument: ReturnType<typeof vi.fn>,
  literature?: unknown
) {
  const addMetadataOnlyEntry = vi.fn(async () => ({ created: true, documentId: "metadata-version" }));
  const addExternalPdfToLibrary = vi.fn(async () => undefined);
  const promoteCachedPdf = vi.fn(async () => "/library/paper.pdf");
  const refreshLocalLibrary = vi.fn(async () => undefined);
  const saveLiteratureMetadata = vi.fn(async () => undefined);
  const cloudClient = {
    exportDocument,
    openDocument: vi.fn(async () => ({
      authorization: {
        document: {
          contentHash,
          ...(literature === undefined ? {} : { metadata: { literature } })
        },
        expiresAt: "2026-08-07T00:05:00.000Z",
        revision: 7,
        serverNow: "2026-08-07T00:00:00.000Z"
      },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      cachePath: "C:/cache/paper-cache/organization.pdf"
    }))
  };
  const result = renderHook(() => useExternalPaperController({
    addExternalPdfToLibrary,
    addMetadataOnlyEntry,
    cloudLibraryClientFactory: () => cloudClient as never,
    endpoint: "https://cloud.example.test",
    promoteCachedPdf,
    refreshLocalLibrary,
    saveLiteratureMetadata,
    setActiveCenterArtifactId: vi.fn(),
    setActiveReaderPaperId: vi.fn(),
    setOpenReaderPaperIds: vi.fn(),
    transport: vi.fn()
  }));
  return {
    addExternalPdfToLibrary,
    addMetadataOnlyEntry,
    cloudClient,
    promoteCachedPdf,
    refreshLocalLibrary,
    result,
    saveLiteratureMetadata
  };
}

test("acquires a confirmed related version as a local metadata entry with its identity snapshot", async () => {
  const harness = createHarness(vi.fn());
  const literature = {
    authors: ["Ada Lovelace"],
    identifiers: [{ kind: "doi" as const, role: "confirmable" as const, source: "public_registry" as const, value: "10.1000/published" }],
    literatureId: "literature-publication",
    provenance: { confirmedAt: "2026-08-10T00:00:00.000Z", mode: "public_registry" as const, provider: "crossref" as const },
    revision: 2,
    status: "confirmed" as const,
    title: "Published Version",
    year: 2026
  };

  let acquired;
  await act(async () => {
    acquired = await harness.result.result.current.acquireLiteratureVersion(literature, {
      recordUrl: "https://doi.org/10.1000/published"
    });
  });

  expect(harness.addMetadataOnlyEntry).toHaveBeenCalledWith({
    doi: "10.1000/published",
    externalUrl: "https://doi.org/10.1000/published",
    sourceId: "literature:literature-publication",
    title: "Published Version"
  });
  expect(harness.saveLiteratureMetadata).toHaveBeenCalledWith("metadata-version", literature);
  expect(harness.refreshLocalLibrary).toHaveBeenCalledTimes(1);
  expect(acquired).toEqual({ created: true, documentId: "metadata-version" });
});

test("rechecks organization export policy before promoting a reader cache", async () => {
  const exportDocument = vi.fn(async () => ({
    bytes: new Uint8Array([37, 80, 68, 70, 45, 49])
  }));
  const harness = createHarness(exportDocument);
  let paper;
  await act(async () => {
    paper = await harness.result.result.current.openCloudDocumentInReader({
      documentId: "document-1",
      scopeId: "organization-1",
      scopeType: "organization",
      title: "Organization Paper"
    });
  });

  await act(async () => {
    await harness.result.result.current.promoteCachedPaperToLibrary(paper!.id);
  });

  expect(exportDocument).toHaveBeenCalledWith(
    { scopeId: "organization-1", scopeType: "organization" },
    "document-1"
  );
  expect(harness.addExternalPdfToLibrary).toHaveBeenCalledWith(expect.objectContaining({
    bytes: new Uint8Array([37, 80, 68, 70, 45, 49]),
    title: "Organization Paper"
  }));
  expect(harness.promoteCachedPdf).not.toHaveBeenCalled();
  expect(harness.refreshLocalLibrary).toHaveBeenCalledTimes(1);
});

test("does not create a local copy when organization export is denied", async () => {
  const exportDocument = vi.fn(async () => {
    throw new Error("当前组织策略不允许将文献复制出组织库。");
  });
  const harness = createHarness(exportDocument);
  let paper;
  await act(async () => {
    paper = await harness.result.result.current.openCloudDocumentInReader({
      documentId: "document-1",
      scopeId: "organization-1",
      scopeType: "organization",
      title: "Restricted Paper"
    });
  });

  await expect(act(async () => {
    await harness.result.result.current.promoteCachedPaperToLibrary(paper!.id);
  })).rejects.toThrow("当前组织策略不允许");

  expect(harness.addExternalPdfToLibrary).not.toHaveBeenCalled();
  expect(harness.promoteCachedPdf).not.toHaveBeenCalled();
  expect(harness.refreshLocalLibrary).not.toHaveBeenCalled();
});

test("keeps the authorized cloud document reference on the opened reader paper", async () => {
  const harness = createHarness(vi.fn());
  let paper;
  await act(async () => {
    paper = await harness.result.result.current.openCloudDocumentInReader({
      documentId: "document-1",
      scopeId: "organization-1",
      scopeType: "organization",
      title: "Organization Paper"
    });
  });

  expect(paper!.libraryReference).toEqual({
    documentId: "document-1",
    revision: 7,
    scopeId: "organization-1",
    scopeType: "organization"
  });
});

test("hydrates canonical cloud literature onto the cached reader paper and reuses it on reopen", async () => {
  const literature = {
    authors: ["Ada Lovelace"],
    identifiers: [{ kind: "doi", role: "confirmable", source: "public_registry", value: "10.1000/cloud" }],
    literatureId: "literature_cloud",
    provenance: { confirmedAt: "2026-08-07T00:00:00.000Z", mode: "public_registry", provider: "crossref" },
    revision: 1,
    status: "confirmed",
    title: "Cloud Literature",
    year: 2026
  };
  const harness = createHarness(vi.fn(), literature);
  let first;
  let second;
  await act(async () => {
    first = await harness.result.result.current.openCloudDocumentInReader({
      documentId: "document-1",
      scopeId: "user-1",
      scopeType: "user",
      title: "Cloud Literature"
    });
    second = await harness.result.result.current.openCloudDocumentInReader({
      documentId: "document-1",
      scopeId: "user-1",
      scopeType: "user",
      title: "Cloud Literature"
    });
  });

  expect(first!.literature).toEqual(literature);
  expect(second!.literature).toEqual(literature);
});

test("rejects malformed cloud literature metadata instead of attaching it", async () => {
  const harness = createHarness(vi.fn(), {
    literatureId: "untrusted",
    title: "Missing identifiers"
  });

  await expect(act(async () => harness.result.result.current.openCloudDocumentInReader({
    documentId: "document-1",
    scopeId: "user-1",
    scopeType: "user",
    title: "Malformed Cloud Paper"
  }))).rejects.toThrow("文献元数据");
});
