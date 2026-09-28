import { MAX_NOTE_FILE_BYTES } from "../note-files/noteFileService";
import { validateModelImages } from "../models/modelImages";
import { AgentAssetError, type AgentAsset, type AgentAssetAdapter, type AgentAssetReadOptions, type AgentAssetSearch, type AgentAssetWriteOptions } from "./agentAsset.types";

/** One discovery/read/write/context boundary shared by the assistant and asset UI. */
export function createAgentAssetService(input: { scopeId: string; active(): boolean; adapters?: AgentAssetAdapter[] }) {
  const adapters = new Map<string, AgentAssetAdapter>();
  const check = (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (!input.active()) throw new AgentAssetError("scope_changed", "账号已切换，请重新选择资产。");
  };
  const registerAdapter = (adapter: AgentAssetAdapter) => {
    if (!adapter.id || adapters.has(adapter.id)) throw new AgentAssetError("invalid_request", "资产适配器标识重复。");
    adapters.set(adapter.id, adapter);
    return () => { if (adapters.get(adapter.id) === adapter) adapters.delete(adapter.id); };
  };
  input.adapters?.forEach(registerAdapter);
  const resolve = (path: string) => {
    let url: URL;
    try { url = new URL(path); } catch { throw new AgentAssetError("invalid_path", "请输入有效的 Liteasy Path。"); }
    if (path.length > 8192 || url.protocol !== "liteasy:" || url.username || url.password || url.port || url.hash ||
      url.searchParams.getAll("scope").length > 1 || (url.searchParams.has("scope") && url.searchParams.get("scope") !== input.scopeId)) {
      throw new AgentAssetError("invalid_path", "资产地址无效或属于其他账号。");
    }
    const matches = [...adapters.values()].filter((adapter) => adapter.accepts(path));
    if (matches.length !== 1) throw new AgentAssetError("unavailable", "当前资产类型不可用，请重新从文献库选择。");
    return matches[0];
  };
  return {
    registerAdapter,
    async search(options: AgentAssetSearch) {
      check(options.signal);
      const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 30)));
      if (options.query.length > 2048) throw new AgentAssetError("invalid_request", "搜索内容过长。");
      const groups = await Promise.allSettled([...adapters.values()].map((adapter) => adapter.search({ ...options, limit })));
      check(options.signal);
      const available = groups.flatMap((group) => group.status === "fulfilled" ? group.value : []);
      if (groups.length && groups.every((group) => group.status === "rejected")) throw (groups[0] as PromiseRejectedResult).reason;
      return [...new Map(available.map((asset) => [asset.path, asset])).values()]
        .sort((left, right) => Number(right.title.toLocaleLowerCase() === options.query.toLocaleLowerCase()) -
          Number(left.title.toLocaleLowerCase() === options.query.toLocaleLowerCase()))
        .slice(0, limit);
    },
    async stat(path: string, options: { signal?: AbortSignal } = {}) {
      check(options.signal);
      const result = await resolve(path).stat(path, options);
      check(options.signal);
      return result;
    },
    async read(path: string, options: AgentAssetReadOptions = {}) {
      check(options.signal);
      const maxCharacters = options.maxCharacters ?? 12000;
      const offset = options.offset ?? 0;
      if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > 80000 || !Number.isSafeInteger(offset) || offset < 0) {
        throw new AgentAssetError("invalid_request", "读取范围无效；单次最多读取 80000 个字符。");
      }
      const result = await resolve(path).read(path, { ...options, maxCharacters, offset });
      check(options.signal);
      if (result.text.length > maxCharacters) throw new AgentAssetError("invalid_request", "资产适配器返回内容超过读取上限。");
      return result;
    },
    async write(path: string, options: AgentAssetWriteOptions) {
      check(options.signal);
      if (typeof options.expectedRevision !== "string" || !options.expectedRevision || options.expectedRevision.length > 512 || typeof options.text !== "string" ||
        new TextEncoder().encode(options.text).byteLength > MAX_NOTE_FILE_BYTES ||
        (options.mode && options.mode !== "replace" && options.mode !== "append")) {
        throw new AgentAssetError("invalid_request", "写入需要读取时的版本，且正文不能超过 8 MiB。");
      }
      const adapter = resolve(path);
      const asset = await adapter.stat(path, { signal: options.signal });
      check(options.signal);
      if (!adapter.write || !asset.capabilities.includes("write")) throw new AgentAssetError("read_only", "此资产为只读，请选择可编辑的笔记或内部白板。");
      if (asset.revision !== options.expectedRevision) throw new AgentAssetError("revision_conflict", "资产已被修改，请重新读取后再写入。");
      // A committed write has a receipt even if cancellation arrives after commit.
      return adapter.write(path, options);
    },
    async resolveImages(path: string, options: { signal?: AbortSignal } = {}) {
      check(options.signal);
      const images = await resolve(path).resolveImages?.(path, options) ?? [];
      check(options.signal);
      validateModelImages(images);
      return images;
    },
    async context(path: string) {
      check();
      const adapter = resolve(path);
      const asset = await adapter.stat(path);
      check();
      if (!asset.capabilities.includes("add_context") || !adapter.context) throw new AgentAssetError("unavailable", "此资产暂时无法加入对话。");
      const result = await adapter.context(path);
      check();
      return result;
    },
  };
}
export type AgentAssetService = ReturnType<typeof createAgentAssetService>;

export function readAgentAssetText(asset: AgentAsset, text: string, options: AgentAssetReadOptions) {
  const offset = options.offset ?? 0;
  const end = Math.min(text.length, offset + (options.maxCharacters ?? 12000));
  return { asset, text: text.slice(offset, end), offset, totalCharacters: text.length,
    truncated: offset > 0 || end < text.length, ...(end < text.length ? { nextOffset: end } : {}) };
}

export function assetChangedLines(before: string, after: string) {
  const left = before.split("\n"), right = after.split("\n");
  let start = 0, end = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1;
  while (end < left.length - start && end < right.length - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end += 1;
  return { addedLines: right.length - start - end, removedLines: left.length - start - end };
}
