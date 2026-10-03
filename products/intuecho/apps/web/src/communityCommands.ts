import { communityCommandPayload } from "@intuecho/contracts";
import { getIdentitySessionGeneration, isIdentitySessionCurrent, resolveIdentitySession } from "./identityClient";
import type { IdentitySession } from "./identity.types";
import { commandRecords, draftOwner, saveCommand, type CommandRecord } from "./communityPersistence";

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
const sending = new Map<string, Promise<unknown>>();

export async function durableCreate<T>(operationType: CommandRecord["operationType"], targetId: string | null, input: unknown,
  send: (payload: unknown, identity: RequestIdentity) => Promise<T>, intentId?: string): Promise<T> {
  const generation = getIdentitySessionGeneration();
  const session = await resolveIdentitySession();
  if (!session || !await isIdentitySessionCurrent(session, generation)) throw new Error("请先确认当前账号后再发送。");
  const owner = draftOwner(session);
  const payload = JSON.parse(JSON.stringify(input, (key, value) => key === "literatureRecord" || key === "command" ? undefined : value));
  const digestBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(communityCommandPayload(operationType, targetId, payload)));
  const bodyDigest = Array.from(new Uint8Array(digestBytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!await isIdentitySessionCurrent(session, generation)) throw new Error("账号会话已变化，请重新操作。");
  const intent = JSON.stringify([owner, operationType, targetId, intentId ?? bodyDigest]);
  const existing = sending.get(intent);
  if (existing) return existing as Promise<T>;
  const run = async () => {
    if (!navigator.locks) throw new Error("此浏览器无法安全保存跨窗口发送操作，请更新浏览器后重试。");
    const record = await navigator.locks.request(`intuecho-create:${owner}:${operationType}:${targetId ?? ""}`, () => {
      if (generation !== getIdentitySessionGeneration()) throw new Error("账号会话已变化，请重新操作。");
      const records = commandRecords(owner).filter((record) => record.operationType === operationType && record.targetId === targetId);
      const completed = intentId && records.find((record) => record.operationId === intentId && record.state === "committed");
      if (completed) throw new Error("这份草稿的原操作已提交，请关闭草稿并查看已发布内容；新的发布意图请新建草稿。");
      const unknown = records.find((record) => record.state === "outcome_unknown");
      if (unknown) throw new CommunityOutcomeUnknownError(unknown);
      const prepared = records.find((record) => record.state === "prepared");
      if (prepared && prepared.bodyDigest !== bodyDigest) throw new Error("原操作尚未完成，请恢复原草稿并保持已冻结内容，再核实或重试同一操作。");
      const record: CommandRecord = prepared ?? { operationId: intentId ?? crypto.randomUUID(), operationType, targetId, bodyDigest, payload,
        state: "prepared", updatedAt: new Date().toISOString() };
      // This durable transition precedes fetch: reload never treats a possibly sent command as a new draft.
      saveCommand(owner, { ...record, state: "outcome_unknown", updatedAt: new Date().toISOString() });
      return record;
    });
    try {
      const result = await send({ ...payload, command: { protocolVersion: 1, operationId: record.operationId, bodyDigest } }, { session, generation });
      const resource = (result as { annotation?: { id?: string }; reply?: { id?: string } })?.[operationType === "create_reply" ? "reply" : "annotation"];
      if (!resource?.id) throw new Error("Missing resource receipt");
      saveCommand(owner, { ...record, resourceId: resource.id, payload: undefined, state: "committed", updatedAt: new Date().toISOString() });
      return result;
    } catch (error) {
      if (error instanceof CommunityRequestError && error.status >= 400 && error.status < 500) {
        saveCommand(owner, { ...record, state: "rejected", updatedAt: new Date().toISOString() });
        throw error;
      }
      throw new CommunityOutcomeUnknownError(record);
    }
  };
  const work = run();
  sending.set(intent, work);
  try { return await work; } finally { sending.delete(intent); }
}

export async function recoverCommand(owner: string, operation: CommandRecord,
  lookup: (operation: CommandRecord) => Promise<CommandLookup>) {
  const generation = getIdentitySessionGeneration();
  const session = await resolveIdentitySession();
  if (draftOwner(session) !== owner || !await isIdentitySessionCurrent(session, generation)) throw new Error("账号会话已变化，请重新操作。");
  const result = await lookup(operation);
  if (!await isIdentitySessionCurrent(session, generation)) throw new Error("账号会话已变化，请重新操作。");
  if (result.status === "committed") {
    if (result.receipt.operationId !== operation.operationId || result.receipt.bodyDigest !== operation.bodyDigest || result.receipt.operationType !== operation.operationType) throw new Error("操作回执不一致，请保留原操作并稍后核实。");
    saveCommand(owner, { ...operation, payload: undefined, resourceId: result.receipt.resourceId, state: "committed", updatedAt: new Date().toISOString() });
  } else {
    saveCommand(owner, { ...operation, state: "prepared", updatedAt: new Date().toISOString() });
  }
  return result;
}
