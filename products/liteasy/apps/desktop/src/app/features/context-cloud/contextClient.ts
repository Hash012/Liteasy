import { ContextClient, type ContextClient as ContextClientType } from "../../../../../../packages/context-client/src/index.mjs";
import type { AccountSession } from "../account/account.types";
import { accountActorStorageKey } from "../account/accountSessionBinding";
import { getAccountSessionGeneration } from "../account/accountSessionStorage";

export type { ContextEntry, ContextEntryInput, ContextGrant, ContextKind, ContextReceipt, ContextSourceRef, ContextWrite } from "../../../../../../packages/context-client/src/index.mjs";
export function createPersonalContextClient(session: AccountSession): ContextClientType {
  const origin = session.endpoint ?? "";
  if (!accountActorStorageKey(session, origin)) throw new Error("请先登录已验证的云账号。");
  const generation = getAccountSessionGeneration();
  return new ContextClient({ origin, token: () => {
    if (getAccountSessionGeneration() !== generation) throw new Error("账号已变化，请重新操作。");
    return session.sessionId;
  } });
}
export function contextFailure(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "context_revision_conflict") return "条目已在其他设备修改。请重新载入后比较，当前编辑仍保留。";
    if (error.code === "context_scope_forbidden") return "当前账号没有此归组的操作权限。";
    if (error.code === "context_network_unavailable") return "网络不可用，保存结果尚未确认。可使用同一次操作重试。";
  }
  return "操作未完成，请检查登录与服务连接后重试。";
}
