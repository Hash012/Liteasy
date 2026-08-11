import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  createLiteratureResolutionRepository,
  resolutionStateFromResult
} from "../app/features/paper-identity/literatureResolutionRepository";

describe("literatureResolutionRepository", () => {
  const loadArtifact = vi.fn();
  const saveArtifact = vi.fn();
  const repository = createLiteratureResolutionRepository({
    isAvailable: () => true,
    loadArtifact,
    saveArtifact
  });

  beforeEach(() => {
    loadArtifact.mockReset();
    saveArtifact.mockReset();
  });

  test("persists unresolved document-level resolution state separately from confirmed metadata", async () => {
    const resolution = resolutionStateFromResult(
      { hints: { title: "Unknown Paper" }, limit: 5, purpose: "liteasy_pdf_annotation" },
      { candidates: [], status: "not_found", unavailableProviders: ["crossref"] },
      "2026-08-11T00:00:00.000Z"
    );

    await repository.save("paper-1", resolution);

    expect(saveArtifact).toHaveBeenCalledWith({
      artifactKind: "literature-resolution",
      paperId: "paper-1",
      snapshot: { resolution, version: 1 }
    });
  });

  test("loads candidate state for a later user selection", async () => {
    const resolution = resolutionStateFromResult(
      { limit: 5, purpose: "liteasy_pdf_annotation" },
      {
        candidates: [{
          candidateKey: "crossref:doi:10.1000/test",
          provider: "crossref",
          record: {
            authors: ["Ada Lovelace"],
            identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/test" }],
            title: "A Paper"
          }
        }],
        status: "ambiguous",
        unavailableProviders: []
      },
      "2026-08-11T00:00:00.000Z"
    );
    loadArtifact.mockResolvedValue({ resolution, version: 1 });

    await expect(repository.load("paper-1")).resolves.toEqual(resolution);
  });

  test("rejects malformed persisted candidates", async () => {
    loadArtifact.mockResolvedValue({
      resolution: {
        candidates: [{ candidateKey: "client-only", provider: "unknown", record: {} }],
        request: { purpose: "liteasy_pdf_annotation" },
        status: "candidate",
        unavailableProviders: [],
        updatedAt: "2026-08-11T00:00:00.000Z"
      },
      version: 1
    });

    await expect(repository.load("paper-1")).rejects.toThrow("文献身份解析状态无效");
  });
});
