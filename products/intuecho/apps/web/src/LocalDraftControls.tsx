import { OptionPicker } from "./ui/OptionPicker";
import { Button } from "@fluentui/react-components";
import { useState } from "react";
import { useLocalDraft, type LocalDraftController } from "./useLocalDraft";

type Props<T> = { owner: string; scope: string; value: T; onRestore: (value: T) => void; controller?: LocalDraftController<T> };
export function LocalDraftControls<T>(props: Props<T>) {
  return props.controller ? <DraftButtons owner={props.owner} controller={props.controller} /> : <StandaloneDraftControls {...props} />;
}
function StandaloneDraftControls<T>(props: Props<T>) {
  const controller = useLocalDraft(props);
  return <DraftButtons owner={props.owner} controller={controller} />;
}
function DraftButtons<T>({ owner, controller }: { owner: string; controller: LocalDraftController<T> }) {
  const [selectedId, setSelectedId] = useState("");
  const selected = controller.drafts.find((draft) => draft.draftId === selectedId) ?? controller.drafts[0];
  return <section aria-label="本机草稿">
    <Button type="button" disabled={!owner} onClick={() => void controller.save().catch(() => {})}>保存本机草稿</Button>
    {controller.drafts.length > 1 && <label>选择本机草稿<OptionPicker label="选择本机草稿" value={selected?.draftId ?? ""} onValueChange={setSelectedId}
      options={controller.drafts.map((draft) => ({ value: draft.draftId, label: `${draft.conflictOf ? "冲突副本 · " : ""}${new Date(draft.updatedAt).toLocaleString()} · 修订 ${draft.localRevision}` }))} /></label>}
    {selected && <Button type="button" onClick={() => controller.restore(selected.draftId)}>恢复本机草稿</Button>}
    {controller.status && <p role="status">{controller.status}</p>}
  </section>;
}
