import {
  ResourceFileError,
  resourceIdentifierSchema,
  resourceRefSchema,
  type ResourceAddress,
  type ResourceListOptions,
  type ResourceProvider,
  type ResourceReadOptions,
  type ResourceRef
} from "./resourceFile.types";

export function resourceUri(ref: ResourceRef) {
  const parsed = resourceRefSchema.safeParse(ref);
  if (!parsed.success) throw new ResourceFileError("invalid_ref", "资源引用格式无效。");
  const query = new URLSearchParams({ scope: ref.scopeId });
  if (ref.revision) query.set("revision", ref.revision);
  return `liteasy://resources/${encodeURIComponent(ref.providerId)}/${encodeURIComponent(ref.resourceId)}?${query}`;
}

export function assertResourceScope(provider: Pick<ResourceProvider, "scope" | "getCurrentScopeId">, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (provider.getCurrentScopeId && provider.getCurrentScopeId() !== provider.scope.id) {
    throw new ResourceFileError("scope_changed", "资源所属范围已切换，请重新打开资源。");
  }
}

/** Cancels the caller promptly even when a legacy native read cannot be interrupted. */
export function awaitResourceRead<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new DOMException("资源读取已取消。", "AbortError"));
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
    if (signal.aborted) aborted();
    else signal.addEventListener("abort", aborted, { once: true });
  });
}

function parseResourceUri(uri: string) {
  if (uri.length > 2048 || /[\u0000-\u0020\\#]/.test(uri)) {
    throw new ResourceFileError("invalid_ref", "资源地址格式无效。");
  }
  // Validate the raw path before URL normalization can erase '..' segments.
  const match = /^liteasy:\/\/(resources|agent-artifacts)\/([^?]+)(?:\?(.*))?$/.exec(uri);
  if (!match) throw new ResourceFileError("invalid_ref", "不支持此资源地址。");
  let segments: string[];
  try { segments = match[2].split("/").map(decodeURIComponent); }
  catch { throw new ResourceFileError("invalid_ref", "资源地址编码无效。"); }
  if (segments.length !== (match[1] === "resources" ? 2 : 1) ||
    segments.some((segment) => segment === "." || segment === ".." || !resourceIdentifierSchema.safeParse(segment).success)) {
    throw new ResourceFileError("invalid_ref", "资源地址必须包含稳定资源标识。");
  }
  const query = new URLSearchParams(match[3]);
  for (const key of query.keys()) {
    if (!["scope", "revision"].includes(key) || query.getAll(key).length !== 1) {
      throw new ResourceFileError("invalid_ref", "资源地址包含不支持的参数。");
    }
  }
  return {
    providerId: match[1] === "resources" ? segments[0] : "artifacts",
    resourceId: match[1] === "resources" ? segments[1] : segments[0],
    scopeId: query.get("scope") ?? undefined,
    revision: query.get("revision") ?? undefined
  };
}

export function createResourceFileService(initialProviders: readonly ResourceProvider[] = []) {
  const providers = new Map<string, ResourceProvider>();
  const key = (providerId: string, scopeId: string) => `${providerId}/${scopeId}`;
  function registerProvider(provider: ResourceProvider) {
    if (!resourceIdentifierSchema.safeParse(provider.providerId).success ||
      !resourceIdentifierSchema.safeParse(provider.scope.id).success) {
      throw new ResourceFileError("invalid_ref", "资源提供方或所属范围标识无效。");
    }
    const providerKey = key(provider.providerId, provider.scope.id);
    if (providers.has(providerKey)) throw new ResourceFileError("invalid_ref", "同一资源范围不能重复注册提供方。");
    providers.set(providerKey, provider);
    return () => { if (providers.get(providerKey) === provider) providers.delete(providerKey); };
  }
  initialProviders.forEach(registerProvider);

  function resolve(address: ResourceAddress) {
    const objectRef = typeof address === "string" ? undefined : resourceRefSchema.safeParse(address);
    if (objectRef && !objectRef.success) throw new ResourceFileError("invalid_ref", "资源引用格式无效。");
    const candidate = typeof address === "string" ? parseResourceUri(address) : objectRef!.data!;
    const compatible = [...providers.values()].filter((provider) => provider.providerId === candidate.providerId &&
      (!candidate.scopeId || provider.scope.id === candidate.scopeId));
    // Legacy unscoped locators resolve only when their mount is unambiguous.
    if (compatible.length !== 1) throw new ResourceFileError("provider_unavailable", "资源提供方不可用，或需要明确选择资源所属范围。");
    const provider = compatible[0];
    const parsed = resourceRefSchema.safeParse({ ...candidate, scopeId: candidate.scopeId ?? provider.scope.id });
    if (!parsed.success) throw new ResourceFileError("invalid_ref", "资源引用格式无效。");
    return { provider, ref: parsed.data };
  }

  return {
    registerProvider,
    async stat(address: ResourceAddress, options: { signal?: AbortSignal } = {}) {
      const { provider, ref } = resolve(address);
      assertResourceScope(provider, options.signal);
      const result = await provider.stat(ref, options);
      assertResourceScope(provider, options.signal);
      return result;
    },
    async list(input: ResourceListOptions & { providerId: string; scopeId: string }) {
      const provider = providers.get(key(input.providerId, input.scopeId));
      if (!provider) throw new ResourceFileError("provider_unavailable", "资源提供方不可用。");
      assertResourceScope(provider, input.signal);
      const result = await provider.list(input);
      assertResourceScope(provider, input.signal);
      return result;
    },
    async read(address: ResourceAddress, options: ResourceReadOptions) {
      if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > 12 * 1024 * 1024) {
        throw new ResourceFileError("read_limit_exceeded", "读取上限必须在 1 字节至 12 MiB 之间。");
      }
      const { provider, ref } = resolve(address);
      assertResourceScope(provider, options.signal);
      const result = await provider.read(ref, options);
      assertResourceScope(provider, options.signal);
      if (new TextEncoder().encode(result.content).byteLength > options.maxBytes) {
        throw new ResourceFileError("read_limit_exceeded", "资源内容超过本次读取上限。");
      }
      return result;
    }
  };
}
export type ResourceFileService = ReturnType<typeof createResourceFileService>;
