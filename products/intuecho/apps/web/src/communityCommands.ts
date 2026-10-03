import { communityCommandPayload } from "@intuecho/contracts";
import { getIdentitySessionGeneration, isIdentitySessionCurrent, resolveIdentitySession } from "./identityClient";
import type { IdentitySession } from "./identity.types";
import { draftOwner, draftRecords, readCommand, saveCommand, transitionCommand, withCommunityLock, type CommandRecord } from "./communityPersistence";

export class CommunityRequestError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(`${message}${message.includes(code) ? "" : ` (${code})`}`); }
}
export class CommunityOutcomeUnknownError extends Error {
  constructor(public operation: CommandRecord) { super("发送结果待核实。请在操作中心核实原操作；不要重新发布。草稿仍保留。"); }
}
export type CommandLookup = { status: "not_found" } | {
  status: "committed";
  receipt: { operationId: string; operationType: CommandRecord["operationType"]; bodyDigest: string; resourceId: string; committedAt: string };
  available?: boolean;
};
export type RequestIdentity = { session: IdentitySession; generation: number };
const sending = new Map<string, { bodyDigest: string; work: Promise<unknown> }>();

export async function durableCreate<T>(operationType: CommandRecord["operationType"], targetId: string | null, input: unknown,
  send: (payload: unknown, identity: RequestIdentity) => Promise<T>, intentId?: string): Promise<T> {
  if (!intentId) throw new Error("发送需要明确的草稿操作 ID；请从编辑器恢复原草稿或新建草稿。");
  const generation = getIdentitySessionGeneration();
  const session = await resolveIdentitySession();
  if (!session || !await isIdentitySessionCurrent(session, generation)) throw new Error("请先确认当前账号后再发送。");
  const owner = draftOwner(session);
  const payload = JSON.parse(JSON.stringify(input, (key, value) => key === "literatureRecord" || key === "command" ? undefined : value));
  const digestBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(communityCommandPayload(operationType, targetId, payload)));
  const bodyDigest = Array.from(new Uint8Array(digestBytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!await isIdentitySessionCurrent(session, generation)) throw new Error("账号会话已变化，请重新操作。");
  const operationId = intentId;
  const intent = JSON.stringify([owner, operationType, operationId, generation]);
  const existing = sending.get(intent);
  if (existing) {
    if (existing.bodyDigest !== bodyDigest) throw new Error("原操作尚未完成，请保持已冻结内容；新内容需要明确的新草稿。");
    return existing.work as Promise<T>;
  }
  const run = async () => {
    const record = await withCommunityLock(`command:${owner}:${operationType}:${operationId}`, () => {
      if (generation !== getIdentitySessionGeneration()) throw new Error("账号会话已变化，请重新操作。");
      const original = readCommand(owner, operationType, operationId);
      if (original?.state === "committed") throw new Error("这份草稿的原操作已提交，请关闭草稿并查看已发布内容；新的发布意图请新建草稿。");
      if (original?.state === "outcome_unknown") throw new CommunityOutcomeUnknownError(original);
      if (original && (original.bodyDigest !== bodyDigest || original.targetId !== targetId)) throw new Error("原操作尚未完成，请恢复原草稿并保持已冻结内容，再核实或重试同一操作。");
      if (original?.state === "rejected") throw new Error("原操作已被拒绝；请核对原因后以新草稿明确建立新意图。");
      const associatedDraft = draftRecords<Record<string, unknown>>(owner).find((draft) => draft.value && typeof draft.value === "object" &&
        [draft.value.intentId, draft.value.packIntentId, draft.value.replyIntentId].includes(operationId));
      const next: CommandRecord = { ...(original ?? { operationId, operationType, targetId, bodyDigest, payload,
        ...(associatedDraft ? { draftId: associatedDraft.draftId, draftScope: associatedDraft.scope } : {}) }),
        state: "outcome_unknown", updatedAt: new Date().toISOString() };
      // This durable transition precedes fetch: reload never treats a possibly sent command as a new draft.
      saveCommand(owner, next);
      return next;
    });
    try {
      const result = await send({ ...payload, command: { protocolVersion: 1, operationId: record.operationId, bodyDigest } }, { session, generation });
      const resource = (result as { annotation?: { id?: string }; reply?: { id?: string } })?.[operationType === "create_reply" ? "reply" : "annotation"];
      if (!resource?.id) throw new Error("Missing resource receipt");
      await transitionCommand(owner, record, { ...record, resourceId: resource.id, payload: undefined, state: "committed", updatedAt: new Date().toISOString() });
      return result;
    } catch (error) {
      if (error instanceof CommunityRequestError && error.status >= 400 && error.status < 500
        && !["COMMAND_RESULT_UNAVAILABLE", "COMMAND_PAYLOAD_CONFLICT", "COMMAND_DIGEST_MISMATCH"].includes(error.code)) {
        await transitionCommand(owner, record, { ...record, state: "rejected", updatedAt: new Date().toISOString() });
        throw error;
      }
      throw new CommunityOutcomeUnknownError(record);
    }
  };
  const work = run();
  sending.set(intent, { bodyDigest, work });
  try { return await work; } finally { sending.delete(intent); }
}

export async function recoverCommand(owner: string, operation: CommandRecord,
  lookup: (operation: CommandRecord) => Promise<CommandLookup>) {
  const generation = getIdentitySessionGeneration();
  const session = await resolveIdentitySession();
  if (draftOwner(session) !== owner || !await isIdentitySessionCurrent(session, generation)) throw new Error("账号会话已变化，请重新操作。");
  const result = validateCommandLookup(await lookup(operation), operation);
  if (!await isIdentitySessionCurrent(session, generation)) throw new Error("账号会话已变化，请重新操作。");
  if (result.status === "committed") {
    await transitionCommand(owner, operation, { ...operation, payload: undefined, resourceId: result.receipt.resourceId, state: "committed", updatedAt: new Date().toISOString() });
  } else {
    const current = await transitionCommand(owner, operation, { ...operation, state: "prepared", updatedAt: new Date().toISOString() });
    if (current?.state === "committed") throw new Error("原操作已提交，迟到的查询结果已忽略；请刷新操作中心查看结果。");
    if (current?.state !== "prepared" || current.bodyDigest !== operation.bodyDigest) throw new Error("核实期间操作状态已变化，请刷新后重新核实。");
  }
  return result;
}

export function validateCommandLookup(value: unknown, operation: CommandRecord): CommandLookup {
  const invalid = () => new Error("操作回执不一致或格式无效，请保留原操作并稍后核实。");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const result = value as Record<string, unknown>;
  if (result.status === "not_found") {
    if (Object.keys(result).some((key) => key !== "status")) throw invalid();
    return { status: "not_found" };
  }
  if (result.status !== "committed" || !result.receipt || typeof result.receipt !== "object" || Array.isArray(result.receipt)) throw invalid();
  const receipt = result.receipt as Record<string, unknown>;
  if (receipt.operationId !== operation.operationId || receipt.bodyDigest !== operation.bodyDigest || receipt.operationType !== operation.operationType ||
    typeof receipt.resourceId !== "string" || !receipt.resourceId.trim() || typeof receipt.committedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(receipt.committedAt) || !Number.isFinite(Date.parse(receipt.committedAt)) ||
    (result.available !== undefined && typeof result.available !== "boolean")) throw invalid();
  return { status: "committed", receipt: receipt as Extract<CommandLookup, { status: "committed" }>["receipt"], ...(typeof result.available === "boolean" ? { available: result.available } : {}) };
}
