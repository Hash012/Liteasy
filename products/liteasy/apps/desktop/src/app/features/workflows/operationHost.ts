import { acquireExecutionSlot } from "./executionQuota";
import type { ObjectRepository } from "../objects/objectRepository";
import { refOf } from "../objects/object.types";
import { liteasyPath } from "../resource-filesystem/liteasyPath";
import { createBlockRegistry, projectBlockText } from "../visual-blocks/blockRegistry";
import { evaluatePureOperation } from "./pureOperations";
import { z } from "zod";
import type { ObjectStorage } from "../objects/objectStorage";
import type { AgentAssetService } from "../resource-filesystem/agentAssetService";
import { hashText } from "../context/objectContext";
import { boundedJson, parseDataSchema, validateSchemaValue, type JsonObject, type JsonValue } from "../extensions/extensionSchema";
import { operationCatalog, type OperationId } from "./operationCatalog";

export class OperationError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = "OperationError"; } }
const grantSchema = z.strictObject({ schema: z.literal("liteasy.extension-grant/v1"), id: z.string(), owner: z.string(), digest: z.string(), scope: z.string(), capabilities: z.array(z.string()), selection: z.array(z.string()).max(200), output: z.boolean(), outputKinds: z.array(z.string()).optional(), modelConnection: z.string().nullable(), createdAt: z.string(), revoked: z.boolean() });
export type ExtensionGrant = z.infer<typeof grantSchema>;
export function createGrantStore(storage: ObjectStorage, scope: string) {
  return {
    async issue(input: Omit<ExtensionGrant, "schema" | "id" | "scope" | "createdAt" | "revoked">) {
      const grant = grantSchema.parse({ ...input, schema: "liteasy.extension-grant/v1", id: crypto.randomUUID(), scope, createdAt: new Date().toISOString(), revoked: false });
      const key = `extension-grant/${grant.id}`;
      await storage.commit([{ key, expected: null, row: { key, version: crypto.randomUUID(), value: grant } }]);
      return grant;
    },
    async get(id: string) { const row = await storage.get(`extension-grant/${id}`); if (!row) throw new OperationError("permission_denied", "本机授权不存在，请重新绑定资料与输出位置。"); const grant = grantSchema.parse(row.value); if (grant.revoked || grant.scope !== scope) throw new OperationError("permission_denied", "授权已撤销或账号已切换。"); return grant; },
    async revoke(id: string) { const key = `extension-grant/${id}`, row = await storage.get(key); if (!row) return; await storage.commit([{ key, expected: row.version, row: { key, version: crypto.randomUUID(), value: { ...grantSchema.parse(row.value), revoked: true } } }]); },
  };
}
export type OperationReceipt = { schema: "liteasy.operation-receipt/v1"; operationId: string; fingerprint: string; operation: OperationId; status: "running" | "committed" | "no_change" | "failed" | "needs_reconciliation"; result?: JsonValue; error?: { code: string; message: string }; undo?: { path: string; text: string; expectedRevision: string }; startedAt: string; completedAt?: string };
export type OperationModelResult = { value: JsonValue; usage: { tokens: number; estimated: boolean }; model: string; provider: string };
export function createOperationHost(input: {
  storage: ObjectStorage; assets: AgentAssetService; scope: string;
  enabled(owner: string, digest: string): boolean;
  repository?: ObjectRepository;
  registry?(owner: string): ReturnType<typeof createBlockRegistry>;
  model?: (options: { prompt: string; schema?: JsonValue; maxOutputTokens: number; signal: AbortSignal; connection: string }) => Promise<OperationModelResult>;
  open?(path: string): Promise<void>;
}) {
  const grants = createGrantStore(input.storage, input.scope);
  const running = new Map<string, Promise<OperationReceipt>>();
  const keyFor = (id: string) => `extension-operation/${encodeURIComponent(id)}`;
  const identity = (path: string) => { const url = new URL(path); if (url.protocol !== "liteasy:" || url.searchParams.get("scope") !== input.scope) throw new OperationError("scope_changed", "资源不属于本轮账号。"); url.searchParams.delete("revision"); url.searchParams.delete("followLatest"); return url.toString(); };
  async function execute(request: { operationId: string; operation: OperationId; value: JsonObject; grantId: string; owner: string; digest: string; signal: AbortSignal; outputPaths?: string[] }): Promise<OperationReceipt> {
    request.signal.throwIfAborted(); boundedJson(request.value);
    if (!input.enabled(request.owner, request.digest)) throw new OperationError("dependency_unavailable", "扩展已停用或版本发生变化，执行已停止。");
    const grant = await grants.get(request.grantId);
    if (grant.owner !== request.owner || grant.digest !== request.digest) throw new OperationError("permission_denied", "授权与扩展版本不匹配。");
    const descriptor = operationCatalog[request.operation];
    if (!descriptor) throw new OperationError("invalid_input", "操作未登记。");
    if (descriptor.capability && !grant.capabilities.includes(descriptor.capability)) throw new OperationError("permission_denied", `未授权能力：${descriptor.capability}`);
    const args = descriptor.input.parse(request.value) as JsonObject;
    const allowed = new Set([...grant.selection, ...request.outputPaths ?? []].map(identity));
    const checkPath = (path: string) => { if (!allowed.has(identity(path))) throw new OperationError("permission_denied", "资源未包含在本轮授权范围。"); };
    if (typeof args.path === "string") checkPath(args.path);
    if (typeof args.paperPath === "string") checkPath(args.paperPath);
    if (["resources.create", "boards.compose"].includes(request.operation) && !grant.output) throw new OperationError("permission_denied", "尚未绑定输出位置。");
    if (request.operation === "resources.create" && grant.outputKinds && !grant.outputKinds.includes(args.kind === "note" ? "content.note" : "workspace.board")) throw new OperationError("permission_denied", "此资产类型未包含在创建授权中。");
    if (request.operation === "boards.compose" && grant.outputKinds && (!grant.outputKinds.includes("workspace.board") || !grant.outputKinds.includes("content.note"))) throw new OperationError("permission_denied", "组合白板需要白板与内容卡片的创建授权。");
    if (request.operation === "model.generate" && !grant.modelConnection) throw new OperationError("permission_denied", "尚未绑定模型连接。");
    const fingerprint = await hashText(JSON.stringify({ operation: request.operation, input: args, owner: request.owner, digest: request.digest, grant: grant.id }));
    const key = keyFor(request.operationId);
    const row = await input.storage.get(key);
    const prior = row?.value as OperationReceipt | undefined;
    if (prior && (prior.schema !== "liteasy.operation-receipt/v1" || prior.fingerprint !== fingerprint)) throw new OperationError("invalid_input", "operationId 已用于不同的输入或版本。");
    if (prior?.status === "committed" || prior?.status === "no_change") return prior;
    if (prior && descriptor.retry === "never" && ["running", "needs_reconciliation", ...(descriptor.effect === "model" ? ["failed"] : [])].includes(prior.status)) {
      const receipt: OperationReceipt = { ...prior, status: "needs_reconciliation", error: { code: "needs_reconciliation", message: "上次操作结果不确定；请检查目标内容后发起新的操作，禁止盲目重复执行。" } };
      await input.storage.commit([{ key, expected: row!.version, row: { key, version: crypto.randomUUID(), value: receipt } }]); return receipt;
    }
    const intent: OperationReceipt = { schema: "liteasy.operation-receipt/v1", operationId: request.operationId, fingerprint, operation: request.operation, status: "running", startedAt: new Date().toISOString() };
    const revision = crypto.randomUUID();
    await input.storage.commit([{ key, expected: row?.version ?? null, row: { key, version: revision, value: intent } }]);
    let final: OperationReceipt;
    try {
      let result: JsonValue = null, undo: OperationReceipt["undo"];
      switch (request.operation) {
        case "core.value": case "core.end": case "core.join": case "core.branch": case "core.template": case "core.validate": case "core.comparison": result = evaluatePureOperation(request.operation, args); break;
        case "core.wait": throw new OperationError("waiting_input", String(args.message));
        case "resources.search": {
          const values = []; for (const path of grant.selection.slice(0, 200)) { request.signal.throwIfAborted(); values.push(await input.assets.stat(path, { signal: request.signal })); }
          result = JSON.parse(JSON.stringify(values.filter((asset) => `${asset.title} ${asset.summary ?? ""}`.toLowerCase().includes(String(args.query).toLowerCase())).slice(0, Number(args.limit)))) as JsonValue; break;
        }
        case "resources.stat": result = JSON.parse(JSON.stringify(await input.assets.stat(String(args.path), { signal: request.signal }))); break;
        case "resources.read": result = JSON.parse(JSON.stringify(await input.assets.read(String(args.path), { offset: Number(args.offset), maxCharacters: Number(args.maxCharacters), signal: request.signal }))); break;
        case "boards.compose": {
          if (!input.repository) throw new OperationError("dependency_unavailable", "白板存储尚未就绪。");
          const value = operationCatalog["boards.compose"].input.parse(args), registry = input.registry?.(request.owner) ?? createBlockRegistry();
          const board = await input.repository.importBoardFile({ title: value.title, operationId: `flow:${(await hashText(request.operationId)).slice(0, 64)}`, edges: [], nodes: value.cards.map((card, index) => { const data = registry.instantiate(card.type.id, card.type.version, card.data); return { id: `card-${index}`, position: { x: (index % 4) * 370 + 24, y: Math.floor(index / 4) * 500 + 24 }, size: { width: 340, height: 460 }, structured: { schema: "liteasy.visual-block/v1" as const, type: card.type, data }, draft: { kind: "content.note" as const, title: card.title, content: { schema: "liteasy.note/v1" as const, payload: { text: projectBlockText(data), origin: "derived" as const } } } }; }) });
          result = { path: liteasyPath(input.scope, { kind: "object", ref: refOf(board), followLatest: true }), title: board.title, kind: board.kind, revision: board.revision, capabilities: ["read", "write", "add_context"] }; break;
        }
        case "resources.create": result = JSON.parse(JSON.stringify(await input.assets.create({ kind: args.kind as "note" | "board", title: String(args.title), text: args.text as string | undefined, paperPath: args.paperPath as string | undefined, operationId: `flow:${(await hashText(request.operationId)).slice(0, 64)}`, signal: request.signal }))); break;
        case "resources.write": {
          const before = await input.assets.read(String(args.path), { maxCharacters: 80000, signal: request.signal });
          if (before.asset.revision !== args.expectedRevision) throw new OperationError("revision_conflict", "目标已发生变化，请保留草稿并重新读取。");
          if (args.mode === "replace" && before.truncated) throw new OperationError("invalid_input", "目标超出本次完整替换上限，请分页读取后使用原编辑器保存。");
          const receipt = await input.assets.write(String(args.path), { text: String(args.text), expectedRevision: String(args.expectedRevision), mode: args.mode as "append" | "replace", signal: request.signal });
          if (!before.truncated && receipt.asset.revision) undo = { path: receipt.asset.path, text: before.text, expectedRevision: receipt.asset.revision };
          result = JSON.parse(JSON.stringify(receipt)); break;
        }
        case "model.generate": {
          if (!input.model) throw new OperationError("dependency_unavailable", "模型连接不可用。");
          const model = await input.model({ prompt: String(args.prompt), schema: args.schema, maxOutputTokens: Number(args.maxOutputTokens), signal: request.signal, connection: grant.modelConnection! });
          if (args.schema) validateSchemaValue(parseDataSchema(args.schema), model.value);
          result = model as unknown as JsonValue; break;
        }
        case "ui.open": await input.open?.(String(args.path)); result = { path: args.path }; break;
      }
      boundedJson(result);
      final = { ...intent, status: "committed", result, ...(undo ? { undo } : {}), completedAt: new Date().toISOString() };
    } catch (error) {
      const uncertain = descriptor.effect === "write" && !(error instanceof OperationError && ["revision_conflict", "invalid_input"].includes(error.code));
      final = { ...intent, status: uncertain ? "needs_reconciliation" : "failed", error: { code: error instanceof OperationError ? error.code : request.signal.aborted ? "cancelled" : "operation_failed", message: error instanceof Error ? error.message : String(error) }, completedAt: new Date().toISOString() };
    }
    await input.storage.commit([{ key, expected: revision, row: { key, version: crypto.randomUUID(), value: final } }]);
    return final;
  }
  return {
    grants,
    async call(request: Parameters<typeof execute>[0]) {
      // Deduplicate locally, then revalidate the caller/fingerprint on every request.
      const pending = running.get(request.operationId); if (pending) await pending;
      const promise = (async () => { const release = await acquireExecutionSlot(`${input.scope}/${request.owner}`, request.signal); try { return await execute(request); } finally { release(); } })(); running.set(request.operationId, promise);
      try { return await promise; } finally { if (running.get(request.operationId) === promise) running.delete(request.operationId); }
    },
    async receipt(id: string) { return (await input.storage.get(keyFor(id)))?.value as OperationReceipt | undefined; },
    async undo(id: string, request: Omit<Parameters<typeof execute>[0], "operationId" | "operation" | "value">) {
      const receipt = await this.receipt(id);
      if (!receipt?.undo) throw new OperationError("read_only", "此操作没有可用的条件撤销。");
      return this.call({ ...request, operationId: `${id}:undo`, operation: "resources.write", value: { ...receipt.undo, mode: "replace" } });
    },
  };
}
export type OperationHost = ReturnType<typeof createOperationHost>;
