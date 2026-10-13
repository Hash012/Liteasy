import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Field, Input, Select, Textarea } from "@fluentui/react-components";
import type { QuickAskPresetRepository, QuickAskPresetSaveReceipt } from "../settings/quickAskPresetSettings";
import { QUICK_ASK_INSTRUCTION_LIMIT, type QuickAskPreset } from "./quickAskPresets";
import "./quickAskPresets.css";

function QuickAskPresetManagerBody({ repository, initialInstruction = "", onSaved, onClose }: {
  repository: QuickAskPresetRepository; initialInstruction?: string; onSaved?(receipt: QuickAskPresetSaveReceipt): void; onClose?(): void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ preset?: QuickAskPreset; name: string; instruction: string; baseRevision?: string }>({ name: "", instruction: initialInstruction });
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [importText, setImportText] = useState("");
  const [exportText, setExportText] = useState("");
  useEffect(() => repository.subscribe(() => setRefresh(value => value + 1)), [repository]);
  let snapshot: ReturnType<QuickAskPresetRepository["read"]> | undefined;
  let loadError = "";
  try { snapshot = repository.read(); } catch (cause) { loadError = cause instanceof Error ? cause.message : "快捷指令读取失败。"; }
  useEffect(() => { if (snapshot && !draft.baseRevision) setDraft(current => ({ ...current, baseRevision: snapshot.revision })); }, [repository, refresh, snapshot?.revision, draft.baseRevision]);
  const presets = [...(snapshot?.presets ?? [])].sort((a, b) => a.order - b.order);
  const duplicate = presets.some(item => item.id !== (draft.preset?.builtIn ? undefined : draft.preset?.id) && item.name.trim().toLocaleLowerCase() === draft.name.trim().toLocaleLowerCase());
  function select(id: string) {
    const preset = presets.find(item => item.id === id);
    setDraft({ preset, name: preset ? preset.name + (preset.builtIn ? "（副本）" : "") : "", instruction: preset?.instruction ?? initialInstruction, baseRevision: snapshot?.revision });
    setError(""); setStatus(""); setConfirmDelete(false); setAllowDuplicate(false);
  }
  async function run(action: () => Promise<QuickAskPresetSaveReceipt>, saved = false) {
    setError(""); setStatus(""); setBusy(true);
    try {
      const receipt = await action();
      setStatus(`已保存 · ${new Date(receipt.committedAt).toLocaleTimeString()}`);
      setDraft(current => ({ ...current, baseRevision: receipt.revision, ...(receipt.preset ? { preset: receipt.preset } : {}) }));
      if (saved) onSaved?.(receipt);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败；当前草稿已保留。"); }
    finally { setBusy(false); setRefresh(value => value + 1); }
  }
  const revision = snapshot?.revision ?? "";
  return <section className="quick-ask-preset-manager" aria-label="管理快捷指令" aria-busy={busy}>
    <div className="quick-ask-preset-manager-actions"><strong>快捷指令 · 当前账号</strong>{onClose && <Button size="small" onClick={onClose}>关闭管理</Button>}</div>
    <Field label="选择要管理的任务"><Select aria-label="管理快捷指令" disabled={busy || !snapshot} value={draft.preset?.id ?? ""} onChange={(_, data) => select(data.value)}>
      <option value="">新建快捷指令</option>{presets.map(item => <option key={item.id} value={item.id}>{item.name}{item.builtIn ? " · 内置" : ` · ${item.id.slice(-6)}`}{item.pinned ? " · 已置顶" : ""}</option>)}
    </Select></Field>
    {draft.preset?.builtIn && <p>内置指令只读，修改后保存为个人副本。</p>}
    <Field label="快捷指令名称"><Input disabled={busy} aria-label="快捷指令名称" value={draft.name} onChange={(_, data) => setDraft(current => ({ ...current, name: data.value }))} /></Field>
    <Field label="完整指令" validationState={draft.instruction.length > QUICK_ASK_INSTRUCTION_LIMIT ? "error" : "none"}
      validationMessage={`${draft.instruction.length} / ${QUICK_ASK_INSTRUCTION_LIMIT} UTF-16 字符`}>
      <Textarea disabled={busy} aria-label="完整快捷指令" resize="vertical" value={draft.instruction} onChange={(_, data) => setDraft(current => ({ ...current, instruction: data.value }))} />
    </Field>
    {duplicate && <><span role="status">已有同名快捷指令，请修改名称以便区分。</span><Checkbox checked={allowDuplicate} onChange={(_, data) => setAllowDuplicate(data.checked === true)} label="仍保留同名（用独立标识区分）" /></>}
    <div className="quick-ask-preset-manager-actions">
      <Button appearance="primary" disabled={busy || !snapshot || !draft.name.trim() || !draft.instruction.trim() || draft.instruction.length > QUICK_ASK_INSTRUCTION_LIMIT || (duplicate && !allowDuplicate)}
        onClick={() => void run(() => repository.save({ id: draft.preset?.id, expectedRevision: draft.preset?.revision, name: draft.name, instruction: draft.instruction, allowDuplicateName: allowDuplicate }, draft.baseRevision ?? revision), true)}>{draft.preset?.builtIn ? "保存为个人副本" : "保存快捷指令"}</Button>
      {draft.preset && <>
        <Button disabled={busy} onClick={() => void run(() => repository.setPinned(draft.preset!.id, !presets.find(item => item.id === draft.preset?.id)?.pinned, revision))}>{presets.find(item => item.id === draft.preset?.id)?.pinned ? "取消置顶" : "置顶"}</Button>
        <Button disabled={busy || presets[0]?.id === draft.preset.id} onClick={() => void run(() => repository.move(draft.preset!.id, -1, revision))}>上移</Button>
        <Button disabled={busy || presets.at(-1)?.id === draft.preset.id} onClick={() => void run(() => repository.move(draft.preset!.id, 1, revision))}>下移</Button>
        {!draft.preset.builtIn && <Button disabled={busy} onClick={() => setConfirmDelete(true)}>删除</Button>}
      </>}
      <Button disabled={busy} onClick={() => { try { const fresh = repository.read(); setDraft(current => ({ ...current, baseRevision: fresh.revision, preset: current.preset ? fresh.presets.find(item => item.id === current.preset?.id) : undefined })); setError(""); setStatus("已刷新版本，当前草稿保留；确认内容后再次保存。"); } catch (cause) { setError(cause instanceof Error ? cause.message : "读取失败，草稿已保留。"); } }}>保留草稿并刷新版本</Button>
    </div>
    {confirmDelete && <div className="quick-ask-preset-manager-actions"><span>删除此快捷指令？已运行的结果不受影响。</span><Button disabled={busy} onClick={() => void run(async () => { const receipt = await repository.remove(draft.preset!.id, revision); setConfirmDelete(false); setDraft(current => ({ ...current, preset: undefined })); return receipt; })}>确认删除</Button><Button onClick={() => setConfirmDelete(false)}>取消</Button></div>}
    <details><summary>导入与导出</summary>
      <div className="quick-ask-preset-manager-actions"><Button onClick={() => { try { setExportText(repository.exportJson()); } catch (cause) { setError(String(cause)); } }}>生成导出内容</Button></div>
      {exportText && <><Field label="已导出的版本化设置"><Textarea aria-label="导出的快捷指令" readOnly value={exportText} /></Field>
        <Button onClick={() => { const url = URL.createObjectURL(new Blob([exportText], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = "Liteasy-quick-ask-presets.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>下载快捷指令</Button></>}
      <Button disabled={busy} onClick={() => fileInput.current?.click()}>选择快捷指令文件</Button>
      <input ref={fileInput} hidden aria-label="导入快捷指令文件" type="file" accept="application/json,.json" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; if (file.size > 4_000_000) { setError("导入文件过大；原始文件未修改。"); return; } try { setImportText(await file.text()); } catch { setError("文件读取失败，当前待导入内容已保留。"); } }} />
      <Field label="待导入的完整内容"><Textarea disabled={busy} aria-label="待导入的快捷指令" value={importText} onChange={(_, data) => setImportText(data.value)} /></Field>
      <Button disabled={busy || !snapshot || !importText.trim()} onClick={() => void run(() => repository.importJson(importText, revision))}>验证并导入为个人副本</Button>
    </details>
    {(error || loadError) && <div role="alert">{error || loadError}</div>}{status && <div role="status">{status}</div>}
  </section>;
}

export function QuickAskPresetManager(props: Parameters<typeof QuickAskPresetManagerBody>[0]) {
  return <QuickAskPresetManagerBody key={props.repository.scopeId} {...props} />;
}
