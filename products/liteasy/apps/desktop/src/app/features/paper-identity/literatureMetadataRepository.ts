import {
  isUserPaperArtifactStoreAvailable,
  loadUserPaperArtifact,
  saveUserPaperArtifact
} from "../library/userPaperArtifactClient";
import { normalizeLiteratureSnapshot } from "./literatureRecord";
import type { LiteratureRecord, LiteratureSnapshot } from "./literature.types";

type LiteratureMetadataRepositoryDependencies = {
  isAvailable?: () => boolean;
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
    isAvailable: isUserPaperArtifactStoreAvailable,
    loadArtifact: loadUserPaperArtifact,
    saveArtifact: saveUserPaperArtifact
  }
) {
  return {
    async load(paperId: string): Promise<LiteratureRecord | undefined> {
      if (dependencies.isAvailable && !dependencies.isAvailable()) {
        throw new Error("本地文献元数据存储不可用。");
      }
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
      if (dependencies.isAvailable && !dependencies.isAvailable()) {
        throw new Error("本地文献元数据存储不可用。");
      }
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
