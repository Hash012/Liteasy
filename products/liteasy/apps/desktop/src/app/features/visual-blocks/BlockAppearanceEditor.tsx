import { useEffect, useState } from "react";
import { Button, Checkbox, Field, SpinButton } from "@fluentui/react-components";
import { SystemFontPicker } from "../settings/SystemFontPicker";
import { blockPresentationSchema, defaultBlockPresentation, type BlockPresentation } from "../objects/visualBlock.types";

export function BlockAppearanceEditor({ value, onSave }: { value: BlockPresentation; onSave(value: BlockPresentation): Promise<unknown> }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(value); }, [value]);
  const save = async (next: BlockPresentation) => {
    setSaving(true); setError("");
    try { await onSave(blockPresentationSchema.parse(next)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  return <div className="block-appearance-editor" onPointerDown={(event) => event.stopPropagation()}>
    <Field label="字体"><SystemFontPicker label="卡片字体" value={draft.fontFamily ?? ""} options={[{ label: "跟随阅读字体", value: "" }]} onChange={(fontFamily) => setDraft({ ...draft, fontFamily: fontFamily || undefined })} /></Field>
    <Field label="字号"><SpinButton aria-label="卡片字号" min={10} max={72} value={draft.fontSize ?? 16} onChange={(_, data) => { if (data.value != null) setDraft({ ...draft, fontSize: data.value }); }} /></Field>
    <Field label="行距"><SpinButton aria-label="卡片行距" min={1} max={3} step={0.1} value={draft.lineHeight ?? 1.6} onChange={(_, data) => { if (data.value != null) setDraft({ ...draft, lineHeight: data.value }); }} /></Field>
    <Checkbox label="自动换行" checked={draft.wrap !== false} onChange={(_, data) => setDraft({ ...draft, wrap: !!data.checked })} />
    <Checkbox label="锁定位置与尺寸" checked={!!draft.locked} onChange={(_, data) => setDraft({ ...draft, locked: !!data.checked })} />
    <div className="object-toolbar"><Button disabled={saving} appearance="primary" onClick={() => void save(draft)}>应用</Button><Button disabled={saving} onClick={() => void save(defaultBlockPresentation)}>恢复继承</Button></div>
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
