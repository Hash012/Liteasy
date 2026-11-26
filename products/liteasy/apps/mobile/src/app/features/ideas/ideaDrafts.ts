import type { LibraryRepository } from "../library/library.types";
import type { SharedCapture } from "../capture/shareInbox";
import type { ContextReceipt, ContextWrite } from "../../../../../../packages/context-client/src/index.mjs";

export type IdeaDraft = {
  id: string; ownerScope: string; scopeKey: string; title: string; bodyMarkdown: string;
  sourceUrl?: string; shareId?: string; updatedAt: string;
  pending?: { firstAttemptAt: string; input: ContextWrite }; receipt?: ContextReceipt;
};
const key = "idea-drafts:v1";
export function createIdeaDraft(ownerScope: string, capture?: SharedCapture): IdeaDraft {
  return { id: crypto.randomUUID(), ownerScope, scopeKey: "personal", title: Array.from(capture?.title ?? "").slice(0, 160).join(""), bodyMarkdown: capture?.text?.trim() ? capture.text : capture?.sourceUrl ?? "",
    ...(capture?.sourceUrl ? { sourceUrl: capture.sourceUrl } : {}), ...(capture ? { shareId: capture.id } : {}), updatedAt: new Date().toISOString() };
}
export async function readIdeaDrafts(repository: LibraryRepository, scope: string) {
  const values = await repository.readRecord<IdeaDraft[]>(scope, key) ?? [];
  if (!Array.isArray(values) || values.some((item) => item.ownerScope !== scope)) throw new Error("Idea 草稿归属无效，原记录已保留。");
  return values;
}
export async function saveIdeaDraft(repository: LibraryRepository, draft: IdeaDraft) {
  if (!draft.bodyMarkdown.trim() || Array.from(draft.bodyMarkdown).length > 12000 || !/^(personal|project\/[a-z0-9][a-z0-9-]{0,63})$/.test(draft.scopeKey)) throw new Error("请填写 12000 字以内的想法和有效归组。");
  if (Array.from(draft.title).length > 160) throw new Error("标题不能超过 160 字，内容仍可保留在想法正文中。");
  if (draft.sourceUrl) {
    let url;
    try { url = new URL(draft.sourceUrl); } catch { throw new Error("来源链接必须是 HTTP 或 HTTPS 地址。"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || draft.sourceUrl.length > 4096) throw new Error("来源链接必须是 4096 字以内的 HTTP 或 HTTPS 地址。");
  }
  const values = await readIdeaDrafts(repository, draft.ownerScope);
  const previous = values.find((item) => item.id === draft.id);
  if (previous?.pending && (!draft.pending || JSON.stringify(previous.pending.input) !== JSON.stringify(draft.pending.input))) throw new Error("此草稿已有未确认提交，请核查原操作后再修改。");
  if (values.length >= 500 && !values.some((item) => item.id === draft.id)) throw new Error("本机草稿已达 500 条，请先整理。");
  await repository.writeRecord(draft.ownerScope, key, [draft, ...values.filter((item) => item.id !== draft.id)]);
  return draft;
}
