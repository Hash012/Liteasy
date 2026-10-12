import type { AgentAssetAdapter } from "./agentAsset.types";
import { AgentAssetError } from "./agentAsset.types";
import { parseResourceUri } from "./resourceFileService";
import { liteasyPath } from "./liteasyPath";
/** Legacy artifact URI bridge; scope policy belongs to this provider, not to context selection. */
export function artifactResourceAlias(adapter: AgentAssetAdapter, scope: string, artifactScope: string): AgentAssetAdapter {
  const resolve = async (path: string) => {
    const ref = parseResourceUri(path);
    if (ref.providerId !== "artifacts" || ref.scopeId !== artifactScope) throw new AgentAssetError("scope_changed", "资源不属于当前账号。");
    const legacy = liteasyPath(scope, { kind: "artifact", artifactId: ref.resourceId });
    const asset = await adapter.stat(legacy);
    if (ref.revision && ref.revision !== asset.revision) throw new AgentAssetError("revision_conflict", "该产物版本已变化。");
    return { legacy, asset };
  };
  return { id: "artifact-resources", scopeId: artifactScope, accepts(path) { try { return path.startsWith("liteasy://resources/") && parseResourceUri(path).providerId === "artifacts"; } catch { return false; } },
    search: async () => [],
    async stat(path) { return { ...(await resolve(path)).asset, path }; },
    async read(path, options) { return adapter.read((await resolve(path)).legacy, options); },
    ...(adapter.context ? { context: async (path: string) => adapter.context!((await resolve(path)).legacy) } : {}),
  };
}
