import { contentPresentation } from "../resource-filesystem/resourcePresentation";
import { resourceUri, parseResourceUri } from "../resource-filesystem/resourceFileService";
import { providerAssetSource, type ResourceTypeDefinition } from "../resource-filesystem/resourceTypeRegistry";
import { ResourceFileError, type ResourceProvider, type ResourceRef } from "../resource-filesystem/resourceFile.types";
import { readAgentAssetText } from "../resource-filesystem/agentAssetService";
import type { AgentAssetAdapter } from "../resource-filesystem/agentAsset.types";
import { liteasyPath } from "../resource-filesystem/liteasyPath";
import { compileResearchDocument } from "./researchExportAdapter";
import { researchReportMarkdown, type ResearchHostPort, type ResearchTaskDetail } from "./researchHostClient";

/** A view of the host ledger, never a second writable copy of authoritative runs. */
export function researchResourceType(input: { host: ResearchHostPort; scope: string; active(): boolean; objects: AgentAssetAdapter }): ResourceTypeDefinition {
  const providerId = "research-tasks", scope = { id: input.scope, kind: input.scope === "local" ? "device" as const : "account" as const };
  const check = () => { if (!input.active()) throw new ResourceFileError("scope_changed", "账号已切换。"); };
  const reference = (path: string): ResourceRef => {
    const parsed = parseResourceUri(path);
    if (!parsed.scopeId) throw new ResourceFileError("invalid_ref", "研究引用需要明确作用域。");
    return { ...parsed, scopeId: parsed.scopeId };
  };
  const resolve = async (ref: ResourceRef) => {
    check();
    if (ref.providerId !== providerId || ref.scopeId !== scope.id) throw new ResourceFileError("resource_unavailable", "研究任务不在当前作用域。");
    const detail = await input.host.call<ResearchTaskDetail>("get", { taskId: ref.resourceId }); check();
    if (ref.revision && ref.revision !== String(detail.task.checkpointRevision)) throw new ResourceFileError("revision_unavailable", "旧任务快照不可回退到当前状态，请使用已导出的固定证据包。");
    return detail;
  };
  const stat = (detail: ResearchTaskDetail) => ({ protocolVersion: "liteasy.resource-file/v1" as const,
    canonicalRef: { providerId, scopeId: scope.id, resourceId: detail.task.taskId, revision: String(detail.task.checkpointRevision) },
    canonicalUri: resourceUri({ providerId, scopeId: scope.id, resourceId: detail.task.taskId, revision: String(detail.task.checkpointRevision) }),
    title: detail.task.goal, kind: "research.task", scope, availability: "available" as const, versioning: "snapshot_required" as const,
    effectiveCapabilities: ["stat", "list", "read"] as const,
    files: [{ representation: "markdown" as const, fileName: "research-report.md", mediaType: "text/markdown", byteLength: new TextEncoder().encode(researchReportMarkdown(detail)).length },
      { representation: "native" as const, fileName: "research-task.json", mediaType: "application/json", byteLength: new TextEncoder().encode(JSON.stringify(detail)).length }] });
  const provider: ResourceProvider = { providerId, scope, getCurrentScopeId: () => input.active() ? scope.id : "revoked",
    async stat(ref) { return stat(await resolve(ref)); },
    async list({ limit = 30, cursor } = {}) {
      check(); if (cursor) throw new ResourceFileError("invalid_cursor", "此研究目录不提供游标。");
      const tasks = await input.host.call<ResearchTaskDetail["task"][]>("list");
      const entries = await Promise.all(tasks.slice(0, Math.min(limit, 100)).map(async task => stat(await resolve({ providerId, scopeId: scope.id, resourceId: task.taskId }))));
      check(); return { entries, consistency: "latest" };
    },
    async read(ref, options) {
      options.signal?.throwIfAborted(); const detail = await resolve(ref);
      const content = options.representation === "native" ? JSON.stringify(detail, null, 2) : researchReportMarkdown(detail);
      const byteLength = new TextEncoder().encode(content).length;
      if (byteLength > options.maxBytes) throw new ResourceFileError("read_limit_exceeded", "研究证据超出读取预算。");
      check(); return { resource: stat(detail), representation: options.representation, fileName: options.representation === "native" ? "research-task.json" : "research-report.md",
        mediaType: options.representation === "native" ? "application/json" : "text/markdown", byteLength, encoding: "utf8", content };
    } };
  const source = providerAssetSource(provider, (text, asset, options) => readAgentAssetText(asset, text, options, { kind: "derived", coverage: "unknown", reason: "宿主实验记录；资料被读取不等于语义支持。" }));
  const originalStat = source.stat;
  source.stat = async (path, options) => {
    const asset = await originalStat(path, options), detail = await resolve(reference(path));
    const refs = detail.records.filter(record => record.kind === "hypothesis").flatMap(record => record.body.literatureRefs as Array<{ objectId: string; revision: string }>);
    const parents = await Promise.allSettled(refs.map(ref => input.objects.stat(liteasyPath(scope.id, { kind: "object", ref }), options)));
    asset.sourceReferences = parents.flatMap(parent => parent.status === "fulfilled" ? parent.value.sourceReferences ?? [] : []);
    if (parents.some(parent => parent.status === "rejected" || parent.value.sourceResolution === "unavailable")) asset.sourceResolution = "unavailable";
    check(); return asset;
  };
  const originalRead = source.read;
  source.read = async (path, options) => { const asset = await source.stat(path, options), result = await originalRead(path, options); return { ...result, asset }; };
  // Discovery of unrelated research tasks is opt-in through the research directory, not ordinary chat.
  source.search = async () => [];
  return { typeId: "research.task", schemaVersion: 1, owner: "ResearchHost", nativeCodec: "liteasy.research-task/v1", profile: "liteasy-research-markdown/v1", viewId: "native",
    fixtureIds: ["research:host-ledger"], source, presentation: { supported: true, implementation: contentPresentation(source) },
    context: { supported: false, reason: "请按固定版本读取研究报告；不自动把完整任务加入模型上下文。" },
    write: { supported: false, reason: "正式测量只能由宿主执行服务写入。" }, file: { supported: true, implementation: provider },
    navigation: { supported: false, reason: "通过研究工作台选择任务。" },
    export: { supported: true, implementation: { formats: ["pdf", "markdown", "docx", "html"], async compile(path, options) {
      const detail = await resolve(reference(path));
      return compileResearchDocument({ taskId: detail.task.taskId, scope: scope.id, sessionGeneration: scope.id, active: input.active, host: input.host, options: options ?? {} });
    } } } };
}
