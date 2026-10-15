import type { QuickAskPresetRepository } from "../settings/quickAskPresetSettings";
import type { ObjectRepository } from "../objects/objectRepository";
import { refOf } from "../objects/object.types";
import type { ResourceTypeDefinition } from "../resource-filesystem/resourceTypeRegistry";
import { resourceUri, parseResourceUri } from "../resource-filesystem/resourceFileService";
import type { ResourceProvider, ResourceRef, ResourceStat } from "../resource-filesystem/resourceFile.types";
import { AgentAssetError, type AgentAsset } from "../resource-filesystem/agentAsset.types";
import { readAgentAssetText } from "../resource-filesystem/agentAssetService";
import { compileDocument } from "../document-export/documentCompiler";
import { sha256 } from "../document-export/documentExport.types";
import type { QuickAskPreset } from "./quickAskPresets";

/** Read-only projection. Settings remain the sole editable truth; context creates an explicit frozen derived snapshot. */
export function quickAskPresetResourceType({ settings, objects, active }: { settings: QuickAskPresetRepository; objects: ObjectRepository; active(): boolean }): ResourceTypeDefinition {
  const providerId = "quick-ask-presets";
  const scopeId = settings.scopeId;
  if (objects.scopeId !== scopeId) throw new Error("快捷指令与上下文资产账号范围不一致。");
  const scope = { id: scopeId, kind: "account" as const };
  const check = (signal?: AbortSignal) => { signal?.throwIfAborted(); if (!active()) throw new AgentAssetError("scope_changed", "账号已切换。"); };
  const ref = (preset: QuickAskPreset): ResourceRef => ({ providerId, resourceId: preset.id, scopeId, revision: preset.revision });
  function find(input: ResourceRef): QuickAskPreset {
    check();
    if (input.scopeId !== scopeId || input.providerId !== providerId) throw new AgentAssetError("invalid_path", "快捷指令属于其他账号。");
    const preset = settings.read().presets.find(item => item.id === input.resourceId);
    if (!preset) throw new AgentAssetError("unavailable", "快捷指令已删除。");
    if (input.revision && input.revision !== preset.revision) throw new AgentAssetError("revision_conflict", "此快捷指令版本已变化，请重新选择；已有运行快照不受影响。");
    return preset;
  }
  function fromPath(path: string) { const parsed = parseResourceUri(path); return find({ ...parsed, scopeId: parsed.scopeId ?? "" }); }
  const text = (preset: QuickAskPreset) => `${preset.name}\n\n${preset.instruction}`;
  const native = (preset: QuickAskPreset) => JSON.stringify(preset, null, 2);
  const asset = (preset: QuickAskPreset): AgentAsset => ({ path: resourceUri(ref(preset)), title: preset.name, kind: "ai.quick-ask-preset", revision: preset.revision,
    capabilities: ["search", "read", "add_context"], summary: "速问快捷指令；在速问管理中编辑。" });
  function stat(preset: QuickAskPreset): ResourceStat {
    return { protocolVersion: "liteasy.resource-file/v1", canonicalRef: { ...ref(preset), revision: preset.revision }, canonicalUri: resourceUri(ref(preset)), title: preset.name,
      kind: "ai.quick-ask-preset", scope, availability: "available", versioning: "snapshot_required", effectiveCapabilities: ["stat", "list", "read"],
      files: [{ representation: "native", fileName: `${preset.id}.json`, mediaType: "application/json", byteLength: new TextEncoder().encode(native(preset)).length },
        { representation: "markdown", fileName: `${preset.id}.md`, mediaType: "text/markdown", byteLength: new TextEncoder().encode(text(preset)).length }] };
  }
  const provider: ResourceProvider = { providerId, scope, getCurrentScopeId: () => active() ? scopeId : "inactive",
    async stat(input, options) { check(options?.signal); return stat(find(input)); },
    async list(options) { check(options?.signal); const items = [...settings.read().presets].sort((a, b) => a.order - b.order); const offset = Number(options?.cursor ?? "0");
      if (!Number.isSafeInteger(offset) || offset < 0) throw new AgentAssetError("invalid_request", "分页位置无效。");
      const limit = Math.min(100, Math.max(1, options?.limit ?? 30)); return { entries: items.slice(offset, offset + limit).map(stat), consistency: "latest",
        ...(offset + limit < items.length ? { nextCursor: String(offset + limit) } : {}) }; },
    async read(input, options) { check(options.signal); const preset = find(input); const content = options.representation === "native" ? native(preset) : text(preset);
      const byteLength = new TextEncoder().encode(content).length; if (byteLength > options.maxBytes) throw new AgentAssetError("invalid_request", "快捷指令超过读取上限。");
      return { resource: stat(preset), representation: options.representation, fileName: `${preset.id}.${options.representation === "native" ? "json" : "md"}`, mediaType: options.representation === "native" ? "application/json" : "text/markdown", byteLength, encoding: "utf8", content }; },
  };
  return { typeId: providerId, schemaVersion: 1, owner: "settings.store", nativeCodec: "liteasy.quick-ask-preset/v1", profile: "literal/v1", viewId: "native", fixtureIds: ["quickAskPresets:scope-cas-projection"],
    presentation: { supported: true, implementation: async (path, options) => {
      const preset = fromPath(path);
      const read = readAgentAssetText(asset(preset), text(preset), options);
      return { kind: "content", asset: read.asset, read: { ...read, content: { ...read.content, profile: "literal/v1" } } };
    } },
    source: { id: providerId, scopeId, accepts(path) { try { return parseResourceUri(path).providerId === providerId; } catch { return false; } },
      async stat(path, options) { check(options?.signal); return asset(fromPath(path)); },
      async search({ query, limit = 30, signal }) { check(signal); return settings.read().presets.filter(preset => `${preset.name} ${preset.instruction}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, limit).map(asset); },
      async read(path, options) { check(options.signal); const preset = fromPath(path); const result = readAgentAssetText(asset(preset), text(preset), options, { kind: "user", coverage: "unknown" });
        if (result.content) result.content = { ...result.content, profile: "literal/v1" }; return result; },
    },
    context: { supported: true, async implementation(path) { const preset = fromPath(path); check();
      const frozen = await objects.create({ kind: "content.note", title: `快捷指令：${preset.name}`, content: { schema: "liteasy.note/v1", payload: { text: text(preset), origin: "derived" } } }, `quick-ask-preset:${preset.id}:${preset.revision}`);
      check(); return [{ ref: refOf(frozen), refs: [refOf(frozen)], title: frozen.title, kind: "ai.quick-ask-preset", detail: `固定版本 ${preset.revision}` }]; } },
    write: { supported: false, reason: "请通过速问管理器按版本修改设置；内置指令保存为个人副本。" },
    file: { supported: true, implementation: provider },
    navigation: { supported: false, reason: "请在阅读器的速问卡片中打开管理快捷指令。" },
    export: { supported: true, implementation: { formats: ["markdown", "html", "pdf", "docx"], async compile(path, options) {
      const preset = fromPath(path); const source = native(preset); const fence = "`".repeat(Math.max(3, ...(preset.instruction.match(/`+/g) ?? []).map(value => value.length + 1)));
      const document = await compileDocument({ title: preset.name, markdown: `${fence}text\n${preset.instruction}\n${fence}`, options,
        sources: [{ identity: path, revision: preset.revision, state: "pinned", sha256: await sha256(source) }], active });
      check(); document.scopeId = scopeId; return document;
    } } },
  };
}
