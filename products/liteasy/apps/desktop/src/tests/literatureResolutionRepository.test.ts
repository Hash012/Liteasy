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
      snapshot: { resolution, version: 2 }
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
    expect(resolution.status).toBe("ambiguous");
    loadArtifact.mockResolvedValue({ resolution, version: 2 });

    await expect(repository.load("paper-1")).resolves.toEqual(resolution);
  });

  test("persists auditable PMLR candidate evidence", async () => {
    const resolution = resolutionStateFromResult(
      { hints: { identifiers: [{ kind: "pmlr_id", value: "v235/abad-rocamora24a" }] }, purpose: "liteasy_pdf_annotation" },
      {
        candidate: {
          candidateKey: "pmlr:pmlr_id:v235/abad-rocamora24a",
          provider: "pmlr",
          record: {
            authors: ["Elias Abad Rocamora"],
            documentType: "conference-paper",
            identifiers: [{ kind: "pmlr_id", source: "public_registry", value: "v235/abad-rocamora24a" }],
            title: "An ICML Paper",
            year: 2024
          },
          recordUrl: "https://proceedings.mlr.press/v235/abad-rocamora24a.html",
          sourceEvidence: {
            artifactHash: `sha256:${"a".repeat(64)}`,
            artifactUrl: "https://proceedings.mlr.press/v235/assets/bib/bibliography.bib",
            entryKey: "pmlr-v235-abad-rocamora24a",
            sourceKind: "official_volume_bibtex",
            volume: 235
          }
        },
        confirmationMode: "candidate",
        status: "exact",
        unavailableProviders: []
      },
      "2026-08-11T00:00:00.000Z"
    );

    await repository.save("paper-pmlr", resolution);
    expect(saveArtifact).toHaveBeenCalledWith(expect.objectContaining({ paperId: "paper-pmlr" }));
  });

  test("rejects PMLR candidates whose audit evidence is missing or belongs to another volume", async () => {
    const candidate = {
      candidateKey: "pmlr:pmlr_id:v235/abad-rocamora24a",
      provider: "pmlr" as const,
      record: {
        authors: ["Elias Abad Rocamora"],
        documentType: "conference-paper",
        identifiers: [{ kind: "pmlr_id" as const, source: "public_registry" as const, value: "v235/abad-rocamora24a" }],
        title: "An ICML Paper",
        year: 2024
      },
      recordUrl: "https://proceedings.mlr.press/v235/abad-rocamora24a.html"
    };
    const request = { purpose: "liteasy_pdf_annotation" as const };

    await expect(repository.save("paper-pmlr-missing", resolutionStateFromResult(request, {
      candidate,
      confirmationMode: "candidate",
      status: "exact",
      unavailableProviders: []
    }))).rejects.toThrow("文献身份解析状态无效");

    await expect(repository.save("paper-pmlr-cross-volume", resolutionStateFromResult(request, {
      candidate: {
        ...candidate,
        sourceEvidence: {
          artifactHash: `sha256:${"a".repeat(64)}`,
          artifactUrl: "https://proceedings.mlr.press/v236/assets/bib/bibliography.bib",
          entryKey: "pmlr-v235-abad-rocamora24a",
          sourceKind: "official_volume_bibtex",
          volume: 236
        }
      },
      confirmationMode: "candidate",
      status: "exact",
      unavailableProviders: []
    }))).rejects.toThrow("文献身份解析状态无效");
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

  test("keeps old confirmed artifacts readable but refuses new duplicate confirmed writes", async () => {
    const confirmed = {
      literatureId: "literature-1",
      request: { purpose: "liteasy_pdf_annotation" as const, query: "10.1000/test" },
      revision: 1,
      status: "confirmed" as const,
      updatedAt: "2026-08-11T00:00:00.000Z"
    };
    loadArtifact.mockResolvedValue({ resolution: confirmed, version: 1 });

    await expect(repository.load("paper-1")).resolves.toEqual(confirmed);
    await expect(repository.save("paper-1", confirmed)).rejects.toThrow("文献身份解析状态无效");
  });
});
