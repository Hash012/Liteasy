import { strToU8, zipSync } from "fflate";
import { isArtifactResult } from "../artifacts/artifactResultClient";
import type { AgentArtifactResult } from "../artifacts/artifact.types";
import { parseAuthoredArtifact } from "../artifact-workflow/authoredArtifact";
import { sha256Hex } from "../paper-identity/paperIdentity";
import { awaitResourceRead } from "../resource-filesystem/resourceFileService";
import { captureAccountSessionRequest } from "./accountSessionBinding";
import { loadStoredAccountSession } from "./accountSessionStorage";

const lifetimeMs = 5 * 60_000;
const responseLimit = 16 * 1024 * 1024;
const archiveLimit = 24 * 1024 * 1024;
const artifactLimit = 100;
const exclusions = [
  "PDF 正文和附件", "本机笔记、批注、画像与文件", "组织资产", "Intuecho 数据",
  "登录凭据、应用配置、模型配置和恢复草稿", "产物的原始证据、图片与交互式可视化",
  "回收站资料与历史版本", "原始行为记录和审计记录"
];

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("云资料返回格式无效。");
  return value as RecordValue;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("云资料返回格式无效。");
  return value;
}
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function revision(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("云资料版本无效。");
  return Number(value);
}
function fingerprint(value: unknown) { return sha256Hex(JSON.stringify(value)); }

function personalManifest(value: unknown, subject: string) {
  const tree = record(record(value).tree);
  if (tree.scopeType !== "user" || tree.scopeId !== subject) throw new Error("云资料不属于当前账号，已停止导出。");
  const entries = array(tree.entries).map((value) => {
    const entry = record(value);
    if (entry.scopeType !== "user" || entry.scopeId !== subject || entry.status !== "active" ||
      !["pdf", "metadata_only"].includes(text(entry.entryKind)) || !text(entry.documentId)) {
      throw new Error("文献清单包含其他范围或无效条目，已停止导出。");
    }
    return { documentId: text(entry.documentId), title: text(entry.title), entryKind: text(entry.entryKind),
      folderId: text(entry.folderId) || undefined, createdAt: text(entry.createdAt), updatedAt: text(entry.updatedAt),
      doi: text(entry.doi) || undefined, contentHash: text(entry.contentHash) || undefined };
  });
  if (entries.length > 10_000 || new Set(entries.map((entry) => entry.documentId)).size !== entries.length) {
    throw new Error("文献清单过大或存在重复标识，已停止导出。");
  }
  const folders = array(tree.folders).map((value) => {
    const folder = record(value);
    return { folderId: text(folder.folderId), name: text(folder.name), parentFolderId: text(folder.parentFolderId) || undefined };
  });
  return { scopeType: "user" as const, scopeId: subject, revision: revision(tree.revision), entries, folders };
}

function profileProjection(value: unknown) {
  const snapshot = record(value);
  const profile = record(snapshot.profile);
  return {
    enabled: snapshot.enabled === true,
    personalizationVersion: revision(snapshot.personalizationVersion),
    profile: { stage: text(profile.stage), profileVersion: revision(profile.profileVersion),
      disciplines: array(profile.disciplines).map((value) => {
        const discipline = record(value);
        return { code: text(discipline.code), name: text(discipline.name), categoryCode: text(discipline.categoryCode),
          categoryName: text(discipline.categoryName), description: text(discipline.description) };
      }) },
    tags: array(snapshot.tags).map((value) => {
      const tag = record(value);
      return { label: text(tag.label), evidenceCount: Number(tag.evidenceCount) || 0, weight: Number(tag.weight) || 0 };
    })
  };
}

function hasForeignScope(value: unknown, subject: string, depth = 0): boolean {
  if (depth > 40) return true;
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasForeignScope(item, subject, depth + 1));
  const item = value as RecordValue;
  if (item.scopeType !== undefined && (item.scopeType !== "user" || item.scopeId !== subject)) return true;
  if (item.scope && typeof item.scope === "object") {
    const scope = item.scope as RecordValue;
    if (scope.kind || scope.type) return true; // Unreviewed resource mounts are not personal-cloud proof.
  }
  return Object.values(item).some((child) => hasForeignScope(child, subject, depth + 1));
}

function artifactExclusion(artifact: AgentArtifactResult, manifest: ReturnType<typeof personalManifest>) {
  if (hasForeignScope(artifact, manifest.scopeId)) return "含组织或其他范围来源";
  if (artifact.sourceContextRefs?.length) return "对象来源尚未核实为本人云文献";
  const owned = new Set(manifest.entries.map((entry) => entry.documentId));
  if (!artifact.papers.length || artifact.papers.some((paper) => !owned.has(paper.id))) return "来源尚未核实为本人云文献";
  if (artifact.thinReadingDocument?.paperIds.some((id) => !owned.has(id))) return "薄读包含未核实来源";
  return undefined;
}

// Export user content by field, never spread the persisted envelope. Literal
// words such as "token" in authored prose remain content, not configuration.
function artifactProjection(artifact: AgentArtifactResult, artifactRevision: number) {
  return {
    artifactId: artifact.artifactId, revision: artifactRevision, type: text(artifact.artifactType),
    title: artifact.title, createdAt: artifact.createdAt, answer: artifact.answer,
    papers: artifact.papers.map((paper) => ({ id: text(paper.id), title: text(paper.title) })),
    outlineMarkdown: text(artifact.outlineMarkdown) || undefined,
    authoredArtifact: artifact.authoredArtifact ? parseAuthoredArtifact(artifact.authoredArtifact) : undefined,
    thinReading: artifact.thinReadingDocument ? {
      version: text(artifact.thinReadingDocument.version), title: text(artifact.thinReadingDocument.title),
      rootNodeId: text(artifact.thinReadingDocument.rootNodeId),
      nodes: Object.values(artifact.thinReadingDocument.nodes).map((node) => ({
        id: text(node.id), parentId: text(node.parentId) || undefined, childIds: [...node.childIds].map(text), title: text(node.title),
        summary: text(node.summary), createdAt: text(node.createdAt)
      }))
    } : undefined
  };
}

export type AccountDataExportPlan = {
  readonly subject: string;
  readonly endpoint: string;
  readonly expiresAt: string;
  readonly documentCount: number;
  readonly artifacts: readonly { artifactId: string; title: string; excludedReason?: string }[];
  readonly exclusions: readonly string[];
};
export type AccountDataExportArchive = { bytes: Uint8Array; fileName: string };

function downloadArchive(archive: AccountDataExportArchive) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(archive.bytes).buffer], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = archive.fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createAccountDataExportClient(input: {
  getEndpoint: () => string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  download?: (archive: AccountDataExportArchive) => void;
}) {
  const now = input.now ?? Date.now;
  const transport = input.fetchImpl ?? fetch;
  type Prepared = {
    binding: ReturnType<typeof captureAccountSessionRequest>;
    issuer: string;
    expires: number;
    manifest: ReturnType<typeof personalManifest>;
    profile: ReturnType<typeof profileProjection>;
    artifacts: Map<string, { hash: string; excluded: boolean }>;
  };
  const plans = new WeakMap<AccountDataExportPlan, Prepared>();
  function check(data: Pick<Prepared, "binding" | "expires">, signal?: AbortSignal) {
    signal?.throwIfAborted();
    data.binding.assertCurrent();
    if (data.binding.endpoint !== input.getEndpoint().replace(/\/+$/, "")) throw new Error("云服务已变化，请重新预览导出。");
    if (now() >= data.expires) throw new Error("导出预览已过期，请重新预览。");
  }
  async function json(data: Pick<Prepared, "binding" | "expires">, path: string, body: unknown, signal?: AbortSignal) {
    check(data, signal);
    const response = await awaitResourceRead(transport(`${data.binding.endpoint}${path}`, {
      method: body === undefined ? "GET" : "POST", signal,
      headers: { Authorization: `Bearer ${data.binding.sessionId}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), signal);
    check(data, signal);
    if (!response.ok) throw new Error(`读取云资料失败（HTTP ${response.status}），未生成资料包。`);
    if (Number(response.headers.get("Content-Length")) > responseLimit) throw new Error("单次云资料超过导出大小上限。");
    const chunks: Uint8Array[] = [];
    let length = 0;
    const reader = response.body?.getReader();
    if (!reader) throw new Error("云资料响应不可读取。");
    try {
      while (true) {
        const { done, value } = await awaitResourceRead(reader.read(), signal);
        check(data, signal);
        if (done) break;
        length += value.byteLength;
        if (length > responseLimit) throw new Error("单次云资料超过导出大小上限。");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    check(data, signal);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  }
  async function tree(data: Pick<Prepared, "binding" | "expires">, signal?: AbortSignal) {
    return personalManifest(await json(data, "/v1/library/tree", {
      scopeType: "user", scopeId: data.binding.subject, status: "active"
    }, signal), data.binding.subject!);
  }
  return {
    async prepare(signal?: AbortSignal): Promise<AccountDataExportPlan> {
      const binding = captureAccountSessionRequest(input.getEndpoint());
      const session = loadStoredAccountSession();
      if (!binding.actorKey || !binding.subject || !session?.issuer) throw new Error("请先登录已验证的云账号，再导出本人云资料。");
      const context = { binding, expires: now() + lifetimeMs };
      const manifest = await tree(context, signal);
      const profile = profileProjection(await json(context, "/v1/profile/get", {}, signal));
      const artifacts = array(record(await json(context, "/v1/agent-artifacts", undefined, signal)).artifacts);
      if (artifacts.length > artifactLimit || !artifacts.every(isArtifactResult)) throw new Error("云产物数量超过 100 项或格式不完整，请先整理资料后重试。");
      const entries = artifacts.map((artifact) => ({ artifactId: artifact.artifactId, title: artifact.title,
        excludedReason: artifactExclusion(artifact, manifest) }));
      if (new Set(entries.map((entry) => entry.artifactId)).size !== entries.length) throw new Error("云产物包含重复标识。");
      const plan = Object.freeze({ subject: binding.subject, endpoint: binding.endpoint,
        expiresAt: new Date(context.expires).toISOString(), documentCount: manifest.entries.length,
        artifacts: entries, exclusions: [...exclusions] });
      plans.set(plan, { ...context, issuer: session.issuer, manifest, profile,
        artifacts: new Map(artifacts.map((artifact, index) => [artifact.artifactId,
          { hash: fingerprint(artifact), excluded: Boolean(entries[index].excludedReason) }])) });
      check(context, signal);
      return plan;
    },
    async export(plan: AccountDataExportPlan, selectedArtifactIds: readonly string[], signal?: AbortSignal) {
      const data = plans.get(plan);
      if (!data) throw new Error("请先预览本人云资料包。");
      check(data, signal);
      const selected = [...new Set(selectedArtifactIds)];
      if (selected.length !== selectedArtifactIds.length || selected.some((id) => !data.artifacts.has(id) || data.artifacts.get(id)!.excluded)) {
        throw new Error("所选产物不在已核实的导出范围中。");
      }
      const manifest = await tree(data, signal);
      if (fingerprint(manifest) !== fingerprint(data.manifest)) throw new Error("本人云文献已变化，请重新预览导出。");
      const profile = profileProjection(await json(data, "/v1/profile/get", {}, signal));
      if (fingerprint(profile) !== fingerprint(data.profile)) throw new Error("云画像已变化，请重新预览导出。");
      const files: Record<string, Uint8Array> = {};
      let size = 0;
      const add = (path: string, value: unknown) => {
        const bytes = strToU8(JSON.stringify(value, null, 2));
        size += bytes.byteLength;
        if (size > archiveLimit) throw new Error("资料包超过 24 MiB，请减少所选产物。");
        files[path] = bytes;
      };
      add("profile.json", profile);
      const exported = [];
      for (const [index, id] of selected.entries()) {
        const result = record(await json(data, `/v1/agent-artifacts/${encodeURIComponent(id)}`, undefined, signal));
        if (!isArtifactResult(result.artifact) || result.artifact.artifactId !== id ||
          fingerprint(result.artifact) !== data.artifacts.get(id)!.hash || artifactExclusion(result.artifact, manifest)) {
          throw new Error("所选产物或来源已变化，请重新预览导出。");
        }
        const artifactRevision = revision(result.revision);
        if (artifactRevision < 1) throw new Error("产物版本无效。");
        const path = `artifacts/${String(index + 1).padStart(4, "0")}.json`;
        add(path, artifactProjection(result.artifact, artifactRevision));
        exported.push({ artifactId: id, title: result.artifact.title, revision: artifactRevision, path });
      }
      // Reauthenticate once more immediately before producing a download. No
      // durable URL or bearer capability is written into the resulting archive.
      await json(data, "/v1/profile/get", {}, signal);
      add("manifest.json", { format: "liteasy.personal-cloud-export/v1", exportedAt: new Date(now()).toISOString(),
        account: { subject: data.binding.subject, issuer: data.issuer, endpoint: data.binding.endpoint },
        library: manifest, artifacts: exported, exclusions,
        omittedArtifacts: plan.artifacts.filter((item) => !selected.includes(item.artifactId)).map((item) => ({
          artifactId: item.artifactId, reason: item.excludedReason ?? "未选择"
        })) });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      check(data, signal);
      const bytes = zipSync(files, { level: 0 });
      check(data, signal);
      (input.download ?? downloadArchive)({ bytes, fileName: `liteasy-personal-cloud-${new Date(now()).toISOString().slice(0, 10)}.zip` });
      plans.delete(plan);
      return { artifactCount: exported.length, documentCount: manifest.entries.length };
    }
  };
}
