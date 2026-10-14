import { useEffect, useState } from "react";
import { ActionButton as Button, DisclosureSection, OptionPicker } from "../../shared/ui/productPrimitives";
import type { ExtensionDraft, ExtensionDraftStore } from "./extensionDraftStore";

export function ExtensionDraftHistory({ store, draft, disabled, onRestore }: { store: ExtensionDraftStore; draft: ExtensionDraft; disabled: boolean; onRestore(draft: ExtensionDraft): void }) {
  const [entries, setEntries] = useState<Awaited<ReturnType<ExtensionDraftStore["history"]>>>([]);
  const [selected, setSelected] = useState<ExtensionDraft>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true; setSelected(undefined); setError("");
    void store.history(draft.id).then(value => { if (active) setEntries(value); }, e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [store, draft.id, draft.revision]);
  const changed = selected ? [...new Set([...Object.keys(draft.files), ...Object.keys(selected.files)])].filter(path => draft.files[path] !== selected.files[path]) : [];
  return <DisclosureSection title="修改历史与恢复">
    <p>每次保存都会保留上一份内容。恢复会生成一条新记录，已安装版本保持原样。</p>
    {draft.base ? <p>修复基于版本 {draft.base.version}；发布前须通过校验与样例试跑。</p> : null}
    <OptionPicker aria-label="选择草稿历史" value={selected?.revision ?? ""} disabled={busy || disabled} options={[{ value: "", label: "选择一次保存", disabled: true }, ...entries.map((item, index) => ({ value: item.revision, label: `${new Date(item.updatedAt).toLocaleString()} · ${item.source === "ai" ? "AI 修改" : item.source === "restore" ? "恢复历史" : "用户保存"} · 第 ${entries.length - index} 次${item.revision === draft.revision ? "（当前）" : ""}` }))]} onValueChange={(revision) => { setBusy(true); setError(""); void store.revision(draft.id, revision).then(setSelected, e => setError(String(e))).finally(() => setBusy(false)); }} />
    {selected ? <><p>{changed.length ? `与当前内容有 ${changed.length} 个文件不同。` : "内容与当前一致。"}</p>{changed.map(path => <DisclosureSection key={path} title={path}><div className="studio-diff"><div><p>当前内容</p><pre>{draft.files[path] ?? "（不存在）"}</pre></div><div><p>历史内容</p><pre>{selected.files[path] ?? "（不存在）"}</pre></div></div></DisclosureSection>)}<Button disabled={busy || disabled || !changed.length} onClick={() => { setBusy(true); setError(""); void store.restore(draft.id, draft.revision, selected.revision, "user").then(onRestore, e => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false)); }}>恢复为此内容</Button></> : null}
    {error ? <p role="alert">{error}</p> : null}
  </DisclosureSection>;
}
