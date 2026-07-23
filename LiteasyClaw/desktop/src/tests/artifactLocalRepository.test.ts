import { beforeEach, describe, expect, test, vi } from "vitest";
import { createArtifactLocalRepository } from "../app/features/artifacts/artifactLocalRepository";

describe("artifactLocalRepository", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("loads only valid multimodal artifact records", async () => {
    const repository = createArtifactLocalRepository({
      load: vi.fn(async () => ({
        artifacts: [
          { artifactId: "artifact-1", title: "Tree", type: "tree" },
          { artifactId: "skill-doc-1", title: "Skill", type: "skill_doc" },
          { artifactId: "broken", type: "tree" }
        ],
        savedAt: "2026-07-21T00:00:00.000Z",
        version: "liteasy.artifact-catalog/v1"
      })),
      save: vi.fn(async () => undefined)
    });

    await expect(repository.list()).resolves.toEqual([
      { artifactId: "artifact-1", title: "Tree", type: "tree" }
    ]);
  });

  test("writes a versioned snapshot without transient skill documents", async () => {
    const save = vi.fn(async () => undefined);
    const repository = createArtifactLocalRepository({
      load: vi.fn(async () => null),
      save
    });

    await repository.replace([
      { artifactId: "artifact-1", title: "Tree", type: "tree" },
      { artifactId: "skill-doc-1", title: "Skill", type: "skill_doc" }
    ]);

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      artifacts: [{ artifactId: "artifact-1", title: "Tree", type: "tree" }],
      savedAt: expect.any(String),
      version: "liteasy.artifact-catalog/v1"
    }));
  });

  test("restores the browser fallback after the repository is recreated", async () => {
    const firstRepository = createArtifactLocalRepository();
    await firstRepository.replace([
      { artifactId: "artifact-browser", title: "Browser cached tree", type: "tree" }
    ]);

    const restoredRepository = createArtifactLocalRepository();
    await expect(restoredRepository.list()).resolves.toEqual([
      { artifactId: "artifact-browser", title: "Browser cached tree", type: "tree" }
    ]);
  });
});
