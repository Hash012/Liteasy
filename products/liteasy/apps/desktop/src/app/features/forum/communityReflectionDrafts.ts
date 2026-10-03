import { communitySourceLink, parseCommunitySourceLink, type CommunitySourceReference } from "./communitySourceReference";

export type CommunityReflectionDraft = {
  version: 1; id: string; owner: string; writerId: string; localRevision: number;
  reference: CommunitySourceReference; text: string; updatedAt: string;
};
const prefix = "liteasy.community-reflections.v1:";
const storageKey = (owner: string, id: string) => `${prefix}${encodeURIComponent(owner)}:${id}`;
export const reflectionSourceKey = (owner: string, reference: CommunitySourceReference) =>
  JSON.stringify([owner, reference.sourceNamespace, reference.sourceId, reference.locator ?? null]);

export function createReflectionDraft(owner: string, reference: CommunitySourceReference, writerId: string): CommunityReflectionDraft {
  return { version: 1, id: crypto.randomUUID(), owner, writerId, reference, localRevision: 0, text: "", updatedAt: new Date().toISOString() };
}

export function reflectionDrafts(owner: string, reference: CommunitySourceReference): CommunityReflectionDraft[] {
  const records: CommunityReflectionDraft[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(`${prefix}${encodeURIComponent(owner)}:`)) continue;
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? "null") as CommunityReflectionDraft;
      if (value?.version !== 1 || value.owner !== owner || typeof value.id !== "string" || !/^[a-f0-9-]{36}$/.test(value.id) || key !== storageKey(owner, value.id) ||
        typeof value.writerId !== "string" || !value.writerId || !Number.isSafeInteger(value.localRevision) || value.localRevision < 1 ||
        typeof value.text !== "string" || value.text.length > 100_000 || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) continue;
      const parsed = parseCommunitySourceLink(communitySourceLink(value.reference));
      if (reflectionSourceKey(owner, parsed) === reflectionSourceKey(owner, reference)) records.push({ ...value, reference: parsed });
    } catch { /* A damaged draft stays in place; it must not hide another working copy. */ }
  }
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.localRevision - a.localRevision);
}

/** Each editor forks a restored draft before writing: two windows never own the same mutable key. */
export function writeReflectionDraft(draft: CommunityReflectionDraft, text: string, writerId: string,
  reference = draft.reference): CommunityReflectionDraft {
  try {
    if (text.length > 100_000) throw new Error("Draft too large");
    const raw = localStorage.getItem(storageKey(draft.owner, draft.id));
    const fork = draft.writerId !== writerId || (raw !== null && raw !== JSON.stringify(draft));
    const next: CommunityReflectionDraft = { ...draft, id: fork ? crypto.randomUUID() : draft.id,
      writerId, reference, text, localRevision: fork ? 1 : draft.localRevision + 1, updatedAt: new Date().toISOString() };
    const serialized = JSON.stringify(next);
    localStorage.setItem(storageKey(next.owner, next.id), serialized);
    if (localStorage.getItem(storageKey(next.owner, next.id)) !== serialized) throw new Error("Draft write verification failed");
    return next;
  } catch { throw new Error("想法尚未保存到本机，请保留窗口或复制文字后再退出。浏览器存储不可用、空间不足或内容过长。"); }
}

export function removeReflectionDraft(draft: CommunityReflectionDraft): boolean {
  const key = storageKey(draft.owner, draft.id);
  if (localStorage.getItem(key) !== JSON.stringify(draft)) return false;
  localStorage.removeItem(key);
  return true;
}
