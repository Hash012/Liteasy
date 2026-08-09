import {
  loadUserPaperArtifact,
  saveUserPaperArtifact
} from "../library/userPaperArtifactClient";
import { normalizeLiteratureSnapshot } from "./literatureRecord";
import type { LiteratureRecord, LiteratureSnapshot } from "./literature.types";

type LiteratureMetadataRepositoryDependencies = {
  loadArtifact: typeof loadUserPaperArtifact;
  saveArtifact: typeof saveUserPaperArtifact;
};

function requirePaperId(paperId: string): string {
  const normalized = paperId.trim();
  if (!normalized) {
    throw new Error("论文标识无效。");
  }
  return normalized;
}

export function createLiteratureMetadataRepository(
  dependencies: LiteratureMetadataRepositoryDependencies = {
    loadArtifact: loadUserPaperArtifact,
    saveArtifact: saveUserPaperArtifact
  }
) {
  return {
    async load(paperId: string): Promise<LiteratureRecord | undefined> {
      const snapshot = await dependencies.loadArtifact<unknown>({
        artifactKind: "bibliographic-identity",
        paperId: requirePaperId(paperId)
      });
      if (snapshot === undefined) {
        return undefined;
      }
      return normalizeLiteratureSnapshot(snapshot).literature;
    },
    async save(paperId: string, literature: LiteratureRecord): Promise<void> {
      const snapshot: LiteratureSnapshot = normalizeLiteratureSnapshot({ literature, version: 1 });
      await dependencies.saveArtifact({
        artifactKind: "bibliographic-identity",
        paperId: requirePaperId(paperId),
        snapshot
      });
    }
  };
}

export const literatureMetadataRepository = createLiteratureMetadataRepository();
