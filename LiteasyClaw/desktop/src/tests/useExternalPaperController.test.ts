import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useExternalPaperController } from "../app/controllers/useExternalPaperController";

const contentHash = "a".repeat(64);

function createHarness(exportDocument: ReturnType<typeof vi.fn>) {
  const addExternalPdfToLibrary = vi.fn(async () => undefined);
  const promoteCachedPdf = vi.fn(async () => "/library/paper.pdf");
  const refreshLocalLibrary = vi.fn(async () => undefined);
  const cloudClient = {
    exportDocument,
    openDocument: vi.fn(async () => ({
      authorization: {
        document: { contentHash },
        expiresAt: "2026-08-07T00:05:00.000Z",
        serverNow: "2026-08-07T00:00:00.000Z"
      },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      cachePath: "C:/cache/paper-cache/organization.pdf"
    }))
  };
  const result = renderHook(() => useExternalPaperController({
    addExternalPdfToLibrary,
    cloudLibraryClientFactory: () => cloudClient as never,
    endpoint: "https://cloud.example.test",
    promoteCachedPdf,
    refreshLocalLibrary,
    setActiveCenterArtifactId: vi.fn(),
    setActiveReaderPaperId: vi.fn(),
    setOpenReaderPaperIds: vi.fn(),
    transport: vi.fn()
  }));
  return {
    addExternalPdfToLibrary,
    cloudClient,
    promoteCachedPdf,
    refreshLocalLibrary,
    result
  };
}

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
