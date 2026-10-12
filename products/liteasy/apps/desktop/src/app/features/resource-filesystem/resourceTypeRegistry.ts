import type { AgentAsset, AgentAssetAdapter, AgentAssetRead } from "./agentAsset.types";
import { AgentAssetError } from "./agentAsset.types";
import { createResourceFileService, parseResourceUri } from "./resourceFileService";
import type { ResourceProvider } from "./resourceFile.types";
import type { ContentFragment } from "../markdown/contentFragment";

export type ResourceCapability<T> = { supported: true; implementation: T } | { supported: false; reason: string };
export type ResourceTypeDefinition = {
  typeId: string;
  schemaVersion: 1;
  owner: string;
  nativeCodec: string;
  profile: ContentFragment["profile"];
  viewId: "content" | "native";
  fixtureIds: readonly string[];
  source: Omit<AgentAssetAdapter, "context" | "write">;
  context: ResourceCapability<NonNullable<AgentAssetAdapter["context"]>>;
  write: ResourceCapability<NonNullable<AgentAssetAdapter["write"]>>;
  file: ResourceCapability<ResourceProvider>;
  navigation: ResourceCapability<(path: string) => Promise<{ path: string; revision: string; scopeId: string }>>;
};
function assertCapability(value: unknown, name: string, callable = true): asserts value is ResourceCapability<unknown> {
  if (!value || typeof value !== "object" || !("supported" in value)) throw new Error(`${name}: 缺少能力声明`);
  const entry = value as Record<string, unknown>;
  if (entry.supported === true ? (callable ? typeof entry.implementation !== "function" : !entry.implementation) :
    entry.supported !== false || typeof entry.reason !== "string" || !entry.reason.trim()) throw new Error(`${name}: 能力需要 handler 或不可用原因`);
}
/** Trusted composition root; no content, remote JSON or renderer may register executable handlers. */
export function createResourceTypeRegistry(active: () => boolean) {
  const definitions = new Map<string, ResourceTypeDefinition>();
  const files = createResourceFileService();
  const check = () => { if (!active()) throw new AgentAssetError("scope_changed", "账号已切换。"); };
  function register(definition: ResourceTypeDefinition) {
    if (!/^[a-z][a-z0-9.-]+$/.test(definition.typeId) || definitions.has(definition.typeId)) throw new Error("资产类型标识无效或重复");
    if (definition.schemaVersion !== 1 || !definition.owner || !definition.nativeCodec || !definition.fixtureIds?.length) throw new Error("资产类型缺少 codec、所有者或契约 fixture");
    if (!["liteasy-research-markdown/v1", "literal/v1"].includes(definition.profile) || !["content", "native"].includes(definition.viewId)) throw new Error("未注册的内容 profile/view");
    for (const method of ["accepts", "stat", "search", "read"] as const) if (typeof definition.source?.[method] !== "function") throw new Error(`缺少 source.${method}`);
    assertCapability(definition.context, "context"); assertCapability(definition.write, "write"); assertCapability(definition.file, "file", false); assertCapability(definition.navigation, "navigation");
    if (definition.file.supported) {
      const provider = definition.file.implementation;
      for (const method of ["stat", "list", "read"] as const) if (typeof provider[method] !== "function") throw new Error(`缺少 provider.${method}`);
      files.registerProvider(provider);
    }
    definitions.set(definition.typeId, definition);
  }
  function adapter(definition: ResourceTypeDefinition): AgentAssetAdapter {
    const capabilities = (asset: AgentAsset): AgentAsset => ({ ...asset, capabilities: asset.capabilities.filter(capability =>
      capability !== "write" && capability !== "add_context" || capability === "write" && definition.write.supported || capability === "add_context" && definition.context.supported) });
    return { ...definition.source, id: definition.typeId,
      async search(options) { check(); const result = await definition.source.search(options); check(); return result.map(capabilities); },
      async stat(path, options) { check(); const result = await definition.source.stat(path, options); check(); return capabilities(result); },
      async read(path, options): Promise<AgentAssetRead> { check(); const result = await definition.source.read(path, options); check(); return { ...result, asset: capabilities(result.asset) }; },
      context: definition.context.supported ? definition.context.implementation : undefined,
      write: definition.write.supported ? definition.write.implementation : undefined,
    };
  }
  return {
    register, files,
    async navigate(path: string) {
      check();
      const definition = [...definitions.values()].find(item => item.source.accepts(path));
      if (!definition?.navigation.supported) throw new AgentAssetError("unavailable", definition?.navigation.supported === false ? definition.navigation.reason : "此类型尚不支持定位");
      const target = await definition.navigation.implementation(path); check(); return target;
    },
    adapters: () => [...definitions.values()].map(adapter),
    matrix: () => [...definitions.values()].map(definition => ({ typeId: definition.typeId, owner: definition.owner, nativeCodec: definition.nativeCodec,
      profile: definition.profile, viewId: definition.viewId, navigation: definition.navigation.supported ? "supported" : definition.navigation.reason, fixtures: definition.fixtureIds,
      context: definition.context.supported ? "supported" : definition.context.reason,
      write: definition.write.supported ? "supported" : definition.write.reason,
      file: definition.file.supported ? "supported" : definition.file.reason })),
    async context(path: string) {
      check();
      const match = [...definitions.values()].filter(definition => definition.source.accepts(path));
      if (match.length !== 1 || !match[0].context.supported) throw new AgentAssetError("unavailable", match[0]?.context.supported === false ? match[0].context.reason : "上下文类型未注册。");
      const result = await match[0].context.implementation(path); check(); return result;
    },
    accepts(path: string) { return [...definitions.values()].some(definition => definition.source.accepts(path)); },
  };
}

/** Compatibility registration is explicit about missing native ports; it never invents a Markdown native codec. */
export function legacyAssetDefinition(source: AgentAssetAdapter): ResourceTypeDefinition {
  return { typeId: source.id, schemaVersion: 1, owner: "workspaceAgentAssetService", nativeCodec: "domain-owned/v1",
    profile: "liteasy-research-markdown/v1", viewId: "content", fixtureIds: [`agentAssetService:${source.id}`], source,
    context: source.context ? { supported: true, implementation: source.context } : { supported: false, reason: "此环境未提供固定上下文入口" },
    write: source.write ? { supported: true, implementation: source.write } : { supported: false, reason: "只读资产；请创建派生笔记" },
    navigation: { supported: false, reason: "通过既有领域导航器定位" },
    file: { supported: false, reason: "原生文件由领域仓库导出，尚未接入通用 ResourceProvider" } };
}

/** Generic provider adapter: registering an ordinary content type needs no Assistant/Evidence switch. */
export function providerAssetSource(provider: ResourceProvider, project: (text: string, asset: AgentAsset, options: import("./agentAsset.types").AgentAssetReadOptions) => AgentAssetRead): ResourceTypeDefinition["source"] {
  const files = createResourceFileService([provider]);
  const asset = (stat: import("./resourceFile.types").ResourceStat): AgentAsset => ({ path: stat.canonicalUri, title: stat.title, kind: stat.kind, revision: stat.canonicalRef.revision, capabilities: ["search", "read", "add_context", ...(stat.effectiveCapabilities.includes("save") ? ["write" as const] : [])] });
  return { id: provider.providerId, accepts(path) { try { return parseResourceUri(path).providerId === provider.providerId; } catch { return false; } },
    async stat(path, options) { return asset(await files.stat(path, options)); },
    async search({ query, limit = 30, signal }) { const result = await files.list({ providerId: provider.providerId, scopeId: provider.scope.id, limit: 100, signal }); return result.entries.map(asset).filter(entry => `${entry.title} ${entry.path}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, limit); },
    async read(path, options) { const result = await files.read(path, { representation: "markdown", maxBytes: 12 * 1024 * 1024, signal: options.signal }); return project(result.content, asset(result.resource), options); },
  };
}
