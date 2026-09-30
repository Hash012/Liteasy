import { z } from "zod";

const schema = z.strictObject({ text: z.string().max(80000), revision: z.string().min(1).max(512) });
type Draft = z.infer<typeof schema>;
const pending = new Map<string, Draft>();
function key(path: string) {
  const url = new URL(path);
  if (url.protocol !== "liteasy:" || !url.searchParams.get("scope")) throw new Error("草稿需要当前账号的 Liteasy Path。");
  return `liteasy.visual-editor-draft.v1:${path}`;
}
/** Editor working copies are separate from saved assets, and never silently evicted. */
export const visualEditorDrafts = {
  get(path: string): Draft | undefined {
    if (pending.has(path)) return pending.get(path);
    try { const raw = localStorage.getItem(key(path)); if (!raw) return; return schema.parse(JSON.parse(raw)); }
    catch { return undefined; }
  },
  save(path: string, value: Draft) {
    const draft = schema.parse(value);
    try { localStorage.setItem(key(path), JSON.stringify(draft)); pending.delete(path); }
    catch (error) {
      // Preserve the working copy when disk quota is exhausted; callers show the failure.
      pending.set(path, draft);
      throw new Error(`草稿暂存在本次会话，请保存或复制后再退出。${String(error)}`);
    }
  },
  remove(path: string) { localStorage.removeItem(key(path)); pending.delete(path); },
};
