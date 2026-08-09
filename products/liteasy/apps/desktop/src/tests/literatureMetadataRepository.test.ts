import { beforeEach, describe, expect, test, vi } from "vitest";

import { createLiteratureMetadataRepository } from "../app/features/paper-identity/literatureMetadataRepository";
import type { LiteratureRecord } from "../app/features/paper-identity/literature.types";

function fixtureLiterature(): LiteratureRecord {
  return {
    authors: ["Ada Lovelace"],
    identifiers: [{ kind: "doi", source: "manual", value: "10.1000/manual" }],
    literatureId: "literature-1",
    provenance: {
      confirmedAt: "2026-08-09T10:00:00.000Z",
      mode: "manual"
    },
    title: "A Manually Confirmed Paper",
    year: 2026
  };
}

describe("literatureMetadataRepository", () => {
  const loadArtifact = vi.fn();
  const saveArtifact = vi.fn();
  const repository = createLiteratureMetadataRepository({ loadArtifact, saveArtifact });

  beforeEach(() => {
    loadArtifact.mockReset();
    saveArtifact.mockReset();
  });

  test("writes bibliographic metadata through the Tauri truth store", async () => {
    saveArtifact.mockResolvedValue(undefined);

    await repository.save("paper-1", fixtureLiterature());

    expect(saveArtifact).toHaveBeenCalledWith(expect.objectContaining({
      artifactKind: "bibliographic-identity",
      paperId: "paper-1",
      snapshot: expect.objectContaining({ version: 1 })
    }));
  });

  test("loads and validates bibliographic metadata from the Tauri truth store", async () => {
    loadArtifact.mockResolvedValue({ literature: fixtureLiterature(), version: 1 });

    await expect(repository.load("paper-1")).resolves.toEqual(fixtureLiterature());
    expect(loadArtifact).toHaveBeenCalledWith({
      artifactKind: "bibliographic-identity",
      paperId: "paper-1"
    });
  });

  test("returns undefined only when no authoritative snapshot exists", async () => {
    loadArtifact.mockResolvedValue(undefined);

    await expect(repository.load("paper-1")).resolves.toBeUndefined();
  });

  test("rejects malformed snapshots and failed Tauri writes", async () => {
    loadArtifact.mockResolvedValue({ literature: { title: "partial" }, version: 1 });
    await expect(repository.load("paper-1")).rejects.toThrow("文献元数据快照无效");

    const writeError = new Error("disk unavailable");
    saveArtifact.mockRejectedValue(writeError);
    await expect(repository.save("paper-1", fixtureLiterature())).rejects.toBe(writeError);
  });

  test("rejects empty paper identifiers before touching storage", async () => {
    await expect(repository.load("  ")).rejects.toThrow("论文标识无效");
    await expect(repository.save("", fixtureLiterature())).rejects.toThrow("论文标识无效");
    expect(loadArtifact).not.toHaveBeenCalled();
    expect(saveArtifact).not.toHaveBeenCalled();
  });
});
