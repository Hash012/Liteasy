import { ContextClient } from "../../../../../../packages/context-client/src/index.mjs";
import { accountClient, type AccountStatus } from "../account/accountClient";
import type { LibraryRepository } from "../library/library.types";
import { readIdeaDrafts, saveIdeaDraft, type IdeaDraft } from "./ideaDrafts";

export async function submitIdea(draft: IdeaDraft, account: AccountStatus, repository: LibraryRepository, port = accountClient) {
  if (!account.subject || draft.ownerScope === "local" || draft.ownerScope !== account.scope) throw new Error("请先把此草稿明确复制到当前登录账号。");
  async function assertAccount() {
    const current = await port.status();
    if (current.scope !== account.scope || current.subject !== account.subject || current.apiBaseUrl !== account.apiBaseUrl) throw new Error("账号已切换，原草稿仍保留，提交已暂停。");
  }
  await assertAccount();
  const stored = (await readIdeaDrafts(repository, draft.ownerScope)).find((item) => item.id === draft.id);
  if (!stored) throw new Error("请先保存本机草稿。");
  draft = stored;
  if (draft.receipt) return draft;
  const client = new ContextClient({ origin: account.apiBaseUrl, token: "native-account", transport: async (request) => {
    await assertAccount();
    const path = new URL(request.url).pathname;
    const mapped = path === "/v1/context/whoami" ? "/v1/mobile/context/whoami" : path === "/v1/context/entries" && request.method === "POST" ? "/v1/mobile/context/submit" :
      /^\/v1\/context\/operations\/[^/]+$/.test(path) && request.method === "GET" ? path.replace("/v1/context/", "/v1/mobile/context/") : undefined;
    if (!mapped) throw new Error("移动上下文请求不在允许范围内。");
    const value = await port.request<Record<string, unknown>>(mapped, request.method, request.body ? JSON.parse(request.body) : undefined, account.scope);
    await assertAccount();
    return { status: 200, json: async () => value };
  } });
  const who = await client.whoami();
  if (who.subject !== account.subject) throw new Error("服务账号与草稿不匹配。");
  const pending = draft.pending ?? { firstAttemptAt: new Date().toISOString(), input: {
    schemaVersion: "liteasy.context-write/v1" as const, action: "create" as const, operationId: crypto.randomUUID(), entry: {
      scopeKey: draft.scopeKey, kind: "idea" as const, title: draft.title.trim() || Array.from(draft.bodyMarkdown).slice(0, 60).join(""), bodyMarkdown: draft.bodyMarkdown,
      basis: "user_authored" as const, status: "draft" as const, tags: ["mobile-idea"],
      sourceRefs: draft.sourceUrl ? [{ provider: "web" as const, origin: new URL(draft.sourceUrl).origin, locator: draft.sourceUrl, availability: "unknown" as const }] : []
    }
  } };
  if (!Number.isFinite(Date.parse(pending.firstAttemptAt)) || Date.now() - Date.parse(pending.firstAttemptAt) >= who.idempotencyWindowSeconds * 1000) throw new Error("已超出幂等窗口，请先核查云端内容；草稿仍保留。");
  const saved = await saveIdeaDraft(repository, { ...draft, pending });
  await assertAccount();
  let receipt;
  if (draft.pending) {
    // Mobile native errors may not carry HTTP status, so an uncertain lookup never silently starts a new operation.
    receipt = await client.operation(pending.input.operationId).catch(() => undefined);
  }
  receipt ??= await client.write(pending.input);
  await assertAccount();
  return saveIdeaDraft(repository, { ...saved, receipt });
}
