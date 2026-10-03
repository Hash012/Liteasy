import type { AssetSourceReference } from "../resource-filesystem/assetSourceReferences";
import type { Paper } from "../workspace/workspace.types";
import type { AgentAsset } from "../resource-filesystem/agentAsset.types";
import type { AgentAssetService } from "../resource-filesystem/agentAssetService";

export type ModelSourceReference = Pick<AssetSourceReference, "scopeType" | "scopeId"> & Partial<Pick<AssetSourceReference, "paperId" | "revision">>;
const deniedMessage = "该资料属于组织，当前尚未允许发送给外部 AI 或第三方服务。可继续在阅读器中阅读；自备 API 不会改变资料权限。";

/** D01 is not approved. Reading/export permission does not authorize model use. */
export function assertExternalSourceReferences(sources: readonly ModelSourceReference[] = []) {
  if (sources.some((source) => source.scopeType === "organization")) throw new Error(deniedMessage);
}

export function assertExternalPaperSources(papers: readonly Pick<Paper, "libraryReference" | "sourcePath">[]) {
  if (papers.some((paper) => paper.sourcePath?.startsWith("org://"))) throw new Error(deniedMessage);
  assertExternalSourceReferences(papers.flatMap((paper) => paper.libraryReference ? [paper.libraryReference] : []));
}

export function externalModelAssetService(assets: AgentAssetService): AgentAssetService {
  const check = (asset: AgentAsset) => { assertExternalSourceReferences(asset.sourceReferences); return asset; };
  return {
    ...assets,
    async search(options) {
      const matches = await assets.search(options);
      const resolved = await Promise.allSettled(matches.map((asset) => assets.stat(asset.path, options)));
      return resolved.flatMap((entry) => entry.status === "fulfilled" && !entry.value.sourceReferences?.some((source) => source.scopeType === "organization") ? [entry.value] : []);
    },
    async stat(path, options) { return check(await assets.stat(path, options)); },
    async read(path, options = {}) {
      check(await assets.stat(path, options));
      const result = await assets.read(path, options);
      check(result.asset);
      return result;
    },
    async resolveImages(path, options = {}) {
      check(await assets.stat(path, options));
      const result = await assets.resolveImages(path, options);
      check(await assets.stat(path, options));
      return result;
    },
    async context(path) {
      check(await assets.stat(path));
      return assets.context(path);
    },
    async write(path, options) {
      check(await assets.stat(path, options));
      return assets.write(path, options);
    }
  };
}
