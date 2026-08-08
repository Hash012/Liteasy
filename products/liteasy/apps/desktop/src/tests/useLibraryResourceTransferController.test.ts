import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type {
  CloudLibraryDocument,
  CloudLibraryMetadataEntry
} from "../app/features/library/cloudLibraryStorageClient";
import type {
  LibraryResourceFolderSource,
  LibraryResourceTransferSource,
  LibraryResourceTransferTarget
} from "../app/features/library/libraryResourceTransfer.types";

const cloud = vi.hoisted(() => ({
  copyEntry: vi.fn(),
  createFolder: vi.fn(),
  createMetadataEntry: vi.fn(),
  downloadDocumentStream: vi.fn(),
  exportDocument: vi.fn(),
  getOrganizationStoragePolicy: vi.fn(),
  openDocument: vi.fn(),
  purgeFolder: vi.fn(),
  trashFolder: vi.fn(),
  updateDocument: vi.fn(),
  updateFolder: vi.fn(),
  uploadDocument: vi.fn(),
  uploadDocumentStream: vi.fn()
}));
const local = vi.hoisted(() => ({
  addMetadataOnlyLibraryEntry: vi.fn(),
  createLocalLibraryPdfStream: vi.fn(),
  createLocalLibraryFolder: vi.fn(),
  persistDroppedPdfFiles: vi.fn(),
  persistPdfByteStream: vi.fn(),
  purgeLocalLibraryTrashItem: vi.fn(),
  readLocalLibraryPdf: vi.fn(),
  trashLocalLibraryResource: vi.fn()
}));
const recommendationPdf = vi.hoisted(() => ({
  downloadRecommendationPdf: vi.fn()
}));

vi.mock("../app/features/library/cloudLibraryStorageClient", () => ({
  createCloudLibraryStorageClient: () => cloud
}));
vi.mock("../app/features/library/libraryFileSystemClient", () => local);
vi.mock("../app/features/recommendations/recommendationPdfClient", () => recommendationPdf);

import { useLibraryResourceTransferController } from "../app/controllers/useLibraryResourceTransferController";

const organizationScope = (scopeId: string) => ({
  scopeId,
  scopeType: "organization" as const
});
const collectionScope = { scopeId: "user:user-1", scopeType: "user" as const };

function documentEntry(documentId = "document-1"): CloudLibraryDocument {
  return {
    byteLength: 20,
    contentHash: "a".repeat(64),
    createdAt: "2026-08-06T00:00:00.000Z",
    documentId,
    entryKind: "pdf",
    fileName: "Paper.pdf",
    scopeId: "org-source",
    scopeType: "organization",
    status: "active",
    title: "Paper",
    updatedAt: "2026-08-06T00:00:00.000Z",
    uploadedBy: "user:owner"
  };
}

function metadataEntry(documentId = "metadata-1"): CloudLibraryMetadataEntry {
  return {
    createdAt: "2026-08-06T00:00:00.000Z",
    documentId,
    entryKind: "metadata_only",
    scopeId: "org-source",
    scopeType: "organization",
    status: "active",
    title: "Metadata paper",
    updatedAt: "2026-08-06T00:00:00.000Z"
  };
}

const localSource: LibraryResourceTransferSource = {
  area: "local",
  entry: {
    contentHash: null,
    id: "local-metadata-1",
    path: null,
    relativePath: null,
    title: "Local metadata paper"
  }
};
const collectionSource: LibraryResourceTransferSource = {
  area: "collection",
  entry: metadataEntry("collection-metadata-1"),
  scope: collectionScope
};
const recommendationSource: LibraryResourceTransferSource = {
  area: "recommendation",
  recommendation: {
    discoveredAt: "2026-08-06T00:00:00.000Z",
    id: "recommendation-1",
    reason: "Related work",
    relatedDocumentTitle: "Source paper",
    relevanceBand: "high",
    relevanceScore: 0.9,
    source: "OpenAlex",
    sourceKind: "live",
    sourceUrl: "https://openalex.org/W1",
    title: "Recommended paper"
  }
};
const organizationSource: LibraryResourceTransferSource = {
  area: "organization",
  entry: metadataEntry("organization-metadata-1"),
  scope: organizationScope("org-source")
};

const matrixSources = {
  collection: collectionSource,
  local: localSource,
  organization: organizationSource,
  recommendation: recommendationSource
};

const matrixTargets: Record<string, LibraryResourceTransferTarget> = {
  collection: { area: "collection", expectedRevision: 1, scope: collectionScope },
  local: { area: "local", localFolderPath: "/library" },
  organization: {
    area: "organization",
    expectedRevision: 1,
    scope: organizationScope("org-target")
  },
  recommendation: { area: "recommendation" }
};

function renderController() {
  const onRecommendationSaved = vi.fn();
  const refreshCloudTrees = vi.fn();
  const refreshLocalLibrary = vi.fn();
  const hook = renderHook(() => useLibraryResourceTransferController({
    endpoint: "http://cloud.test",
    onRecommendationSaved,
    refreshCloudTrees,
    refreshLocalLibrary
  }));
  return { ...hook, onRecommendationSaved, refreshCloudTrees, refreshLocalLibrary };
}

beforeEach(() => {
  vi.clearAllMocks();
  recommendationPdf.downloadRecommendationPdf.mockResolvedValue(null);
  cloud.copyEntry.mockResolvedValue({ revision: 2 });
  cloud.getOrganizationStoragePolicy.mockResolvedValue({
    exportPolicy: "all_members",
    role: "member",
    uploadPolicy: "all_members"
  });
  cloud.downloadDocumentStream.mockResolvedValue(new ReadableStream());
  cloud.uploadDocumentStream.mockResolvedValue({ revision: 2, status: "imported" });
  local.createLocalLibraryPdfStream.mockResolvedValue({
    byteLength: 5,
    stream: new ReadableStream()
  });
  local.persistDroppedPdfFiles.mockResolvedValue({});
  local.persistPdfByteStream.mockResolvedValue({});
});

test.each([
  ["local", "local", "none"],
  ["local", "collection", "createMetadataEntry"],
  ["local", "recommendation", "reject"],
  ["local", "organization", "createMetadataEntry"],
  ["collection", "local", "addMetadataOnlyLibraryEntry"],
  ["collection", "collection", "updateDocument"],
  ["collection", "recommendation", "reject"],
  ["collection", "organization", "copyEntry"],
  ["recommendation", "local", "addMetadataOnlyLibraryEntry"],
  ["recommendation", "collection", "createMetadataEntry"],
  ["recommendation", "recommendation", "reject"],
  ["recommendation", "organization", "createMetadataEntry"],
  ["organization", "local", "addMetadataOnlyLibraryEntry"],
  ["organization", "collection", "copyEntry"],
  ["organization", "recommendation", "reject"],
  ["organization", "organization", "copyEntry"]
] as const)("implements matrix cell %s -> %s via %s", async (sourceArea, targetArea, expected) => {
  const { result } = renderController();
  const action = result.current(matrixSources[sourceArea], matrixTargets[targetArea]);
  if (expected === "reject") {
    await expect(action).rejects.toThrow("关联推荐不接受拖入内容");
    return;
  }
  await act(() => action);
  if (expected === "none") {
    expect(cloud.createMetadataEntry).not.toHaveBeenCalled();
    expect(local.addMetadataOnlyLibraryEntry).not.toHaveBeenCalled();
    return;
  }
  const operation = expected === "addMetadataOnlyLibraryEntry"
    ? local.addMetadataOnlyLibraryEntry
    : cloud[expected];
  expect(operation).toHaveBeenCalled();
});

test("saves an available recommendation PDF into the real collection tree before recording feedback", async () => {
  recommendationPdf.downloadRecommendationPdf.mockResolvedValue({
    bytes: new TextEncoder().encode("%PDF-1.7\nrecommendation"),
    contentHash: "a".repeat(64),
    finalUrl: "https://publisher.example/paper.pdf",
    sourceId: "recommendation-1"
  });
  const source: LibraryResourceTransferSource = {
    area: "recommendation",
    recommendation: {
      ...recommendationSource.recommendation,
      openAccessAvailable: true
    }
  };
  const { onRecommendationSaved, result } = renderController();

  await act(() => result.current(source, matrixTargets.collection));

  expect(cloud.uploadDocumentStream).toHaveBeenCalledWith(expect.objectContaining({
    expectedRevision: 1,
    fileName: "Recommended paper.pdf",
    scope: collectionScope
  }));
  expect(cloud.createMetadataEntry).not.toHaveBeenCalled();
  expect(onRecommendationSaved).toHaveBeenCalledWith(source.recommendation);
  expect(onRecommendationSaved.mock.invocationCallOrder[0])
    .toBeGreaterThan(cloud.uploadDocumentStream.mock.invocationCallOrder[0]);
});

test("falls back to a traceable metadata entry only when no recommendation PDF is available", async () => {
  const { onRecommendationSaved, result } = renderController();

  await act(() => result.current(recommendationSource, matrixTargets.collection));

  expect(cloud.createMetadataEntry).toHaveBeenCalledWith(expect.objectContaining({
    externalUrl: "https://openalex.org/W1",
    sourceId: "recommendation-1",
    scope: collectionScope,
    title: "Recommended paper"
  }));
  expect(cloud.uploadDocumentStream).not.toHaveBeenCalled();
  expect(onRecommendationSaved).toHaveBeenCalledOnce();
});

test("rechecks organization export policy and streams the export into the local importer", async () => {
  cloud.getOrganizationStoragePolicy.mockResolvedValue({
    exportPolicy: "admins_only",
    role: "admin",
    uploadPolicy: "owner_admins"
  });
  const { result, refreshLocalLibrary } = renderController();
  const source: LibraryResourceTransferSource = {
    area: "organization",
    entry: documentEntry(),
    scope: organizationScope("org-source")
  };
  const target: LibraryResourceTransferTarget = {
    area: "local",
    localFolderPath: "/library"
  };

  await act(() => result.current(source, target));
  expect(cloud.getOrganizationStoragePolicy).toHaveBeenCalledWith("org-source");
  expect(cloud.downloadDocumentStream).toHaveBeenCalledWith(
    organizationScope("org-source"),
    "document-1",
    "export"
  );
  expect(local.persistPdfByteStream).toHaveBeenCalledWith(expect.objectContaining({
    fileName: "Paper.pdf",
    targetFolderPath: "/library"
  }));
  expect(cloud.exportDocument).not.toHaveBeenCalled();
  expect(cloud.openDocument).not.toHaveBeenCalled();
  expect(refreshLocalLibrary).toHaveBeenCalledOnce();
});

test("stops when the organization policy changed before submission", async () => {
  cloud.getOrganizationStoragePolicy.mockResolvedValue({
    exportPolicy: "disabled",
    role: "member",
    uploadPolicy: "all_members"
  });
  const { result } = renderController();
  await expect(result.current({
    area: "organization",
    entry: documentEntry(),
    scope: organizationScope("org-source")
  }, {
    area: "collection",
    expectedRevision: 1,
    scope: collectionScope
  })).rejects.toThrow("不允许将文献复制出组织库");
  expect(cloud.copyEntry).not.toHaveBeenCalled();
});

test("streams a local PDF into cloud storage without reading the entire file", async () => {
  const { result } = renderController();
  await act(() => result.current({
    area: "local",
    entry: {
      contentHash: "a".repeat(64),
      id: "local-pdf-1",
      path: "/library/Paper.pdf",
      relativePath: "Paper.pdf",
      title: "Paper"
    }
  }, {
    area: "collection",
    expectedRevision: 1,
    scope: collectionScope
  }));

  expect(cloud.uploadDocumentStream).toHaveBeenCalledWith(expect.objectContaining({
    expectedRevision: 1,
    fileName: "Paper.pdf",
    scope: collectionScope
  }));
  const { createBody } = cloud.uploadDocumentStream.mock.calls[0][0];
  await createBody();
  expect(local.createLocalLibraryPdfStream).toHaveBeenCalledWith("/library/Paper.pdf");
  expect(local.readLocalLibraryPdf).not.toHaveBeenCalled();
});

test("cross-organization copies check source export and target upload before copying", async () => {
  const { result } = renderController();
  await act(() => result.current({
    area: "organization",
    entry: documentEntry(),
    scope: organizationScope("org-source")
  }, {
    area: "organization",
    expectedRevision: 4,
    scope: organizationScope("org-target")
  }));
  expect(cloud.getOrganizationStoragePolicy.mock.calls.map(([id]) => id)).toEqual([
    "org-source",
    "org-target"
  ]);
  expect(cloud.copyEntry).toHaveBeenCalledWith(expect.objectContaining({
    source: organizationScope("org-source"),
    target: expect.objectContaining(organizationScope("org-target"))
  }));
});

test("same-organization moves reject members even when upload and export are open", async () => {
  const { result } = renderController();
  await expect(result.current({
    area: "organization",
    entry: documentEntry(),
    scope: organizationScope("org-source")
  }, {
    area: "organization",
    expectedRevision: 1,
    scope: organizationScope("org-source")
  })).rejects.toThrow("不能移动组织文献库内容");
  expect(cloud.updateDocument).not.toHaveBeenCalled();
});

test("failed cloud folder copies trash and purge the visible partial subtree", async () => {
  cloud.createFolder.mockResolvedValue({ folder: { folderId: "created-root" }, revision: 2 });
  cloud.copyEntry.mockRejectedValue(new Error("write failed"));
  cloud.trashFolder.mockResolvedValue({ revision: 3 });
  cloud.purgeFolder.mockResolvedValue({ revision: 4 });
  const source: LibraryResourceFolderSource = {
    area: "organization",
    folder: {
      createdAt: "2026-08-06T00:00:00.000Z",
      folderId: "source-folder",
      name: "Source",
      status: "active",
      updatedAt: "2026-08-06T00:00:00.000Z"
    },
    scope: organizationScope("org-source"),
    tree: {
      children: [],
      entries: [{
        area: "organization",
        entry: metadataEntry(),
        scope: organizationScope("org-source")
      }],
      name: "Source"
    }
  };
  const { result } = renderController();
  await expect(result.current(source, {
    area: "collection",
    expectedRevision: 1,
    scope: collectionScope
  })).rejects.toThrow("write failed");
  expect(cloud.trashFolder).toHaveBeenCalledWith(collectionScope, "created-root", 2);
  expect(cloud.purgeFolder).toHaveBeenCalledWith(collectionScope, "created-root", 3);
});
