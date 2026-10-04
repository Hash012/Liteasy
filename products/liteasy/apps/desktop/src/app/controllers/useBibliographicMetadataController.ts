import { useEffect, useRef, useState } from "react";
import { bibliographicDraft, bibliographicDraftSchema, type BibliographicDraft } from "../features/library/bibliographicFields";
import type { ReadingCatalogEntry } from "../features/library/readingCatalog.types";

type Session = { scope: string; entry: ReadingCatalogEntry; draft: BibliographicDraft; baseline: string; revision: number };
export function useBibliographicMetadataController(input: {
  scope: string; entries: ReadingCatalogEntry[]; selected?: ReadingCatalogEntry;
  save(id: string, draft: BibliographicDraft, revision: number): Promise<void>;
}) {
  const [session, setSession] = useState<Session>();
  const [feedback, setFeedback] = useState({ error: "", message: "" });
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [followSelection, setFollowSelection] = useState(true);
  const busy = useRef(false);
  const latest = useRef(input); latest.current = input;
  const active = session?.scope === input.scope ? session : undefined;
  const entry = active && (input.entries.find((item) => item.id === active.entry.id) ?? active.entry);
  const dirty = Boolean(active && JSON.stringify(active.draft) !== active.baseline);
  function load(entry: ReadingCatalogEntry) {
    const draft = bibliographicDraft(entry);
    setSession({ scope: input.scope, entry, draft, baseline: JSON.stringify(draft), revision: entry.bibliographicRevision ?? 0 });
    setFeedback({ error: "", message: "" });
  }
  useEffect(() => {
    if (followSelection && !dirty && !pending && input.selected &&
        (active?.entry.id !== input.selected.id || active.revision !== (input.selected.bibliographicRevision ?? 0) ||
         active.baseline !== JSON.stringify(bibliographicDraft(input.selected)))) {
      load(input.selected); setEditing(false);
    }
  }, [input.scope, input.selected, followSelection, dirty, pending]);
  return {
    editing, followSelection,
    setFollowSelection(value: boolean) {
      if (busy.current || (dirty && !window.confirm("切换关联将放弃尚未保存的更改，是否继续？"))) return;
      if (value && input.selected) load(input.selected);
      setEditing(false); setFollowSelection(value);
    },
    edit() { setEditing(true); setFollowSelection(false); },
    finishEditing() { if (dirty) return; setEditing(false); },
    entry, draft: active?.draft, dirty, pending: Boolean(active && pending),
    error: active ? feedback.error : "", message: active ? feedback.message : "",
    open(entry: ReadingCatalogEntry) {
      if (active?.entry.id === entry.id) { setEditing(true); setFollowSelection(false); if (!dirty && !busy.current) load(entry); return true; }
      if (busy.current) return false;
      if (dirty && !window.confirm("当前文献的元信息尚未保存，放弃更改并编辑另一篇？")) return false;
      load(entry); setEditing(true); setFollowSelection(false); return true;
    },
    change(patch: Partial<BibliographicDraft>) {
      if (busy.current) return;
      setSession((current) => current?.scope === input.scope ? { ...current, draft: { ...current.draft, ...patch } } : current);
      setFeedback({ error: "", message: "" });
    },
    reload() { if (entry && !busy.current && (!dirty || window.confirm("重新载入会放弃尚未保存的更改，是否继续？"))) load(entry); },
    async save() {
      if (!active || !dirty || busy.current) return;
      const result = bibliographicDraftSchema.safeParse({ ...active.draft, authors: active.draft.authors.map((author) => author.trim()).filter(Boolean) });
      if (!result.success) { setFeedback({ error: result.error.issues[0]?.message || "请检查元信息格式。", message: "" }); return; }
      if (result.data.url && !/^https?:\/\/\S+$/i.test(result.data.url)) {
        setFeedback({ error: "网址请使用完整的 http:// 或 https:// 地址，或留空。", message: "" }); return;
      }
      busy.current = true; setPending(true); setFeedback({ error: "", message: "" });
      try {
        await input.save(active.entry.id, result.data, active.revision);
        if (latest.current.scope === active.scope) {
          setSession({ ...active, draft: result.data, baseline: JSON.stringify(result.data), revision: active.revision + 1 });
          setFeedback({ error: "", message: "元信息已保存。" });
          setEditing(false);
        }
      } catch (error) {
        if (latest.current.scope === active.scope) setFeedback({ error: error instanceof Error ? error.message : "保存失败，请重试。", message: "" });
      } finally { busy.current = false; setPending(false); }
    },
  };
}
