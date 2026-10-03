import { Button } from "@fluentui/react-components";
import { useEffect, useState } from "react";
import { loadDraft, saveDraft } from "./communityPersistence";

export function LocalDraftControls<T>({ owner, scope, value, onRestore }: {
  owner: string; scope: string; value: T; onRestore: (value: T) => void;
}) {
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState("");
  const [savedValue, setSavedValue] = useState("");
  const serialized = JSON.stringify(value);
  useEffect(() => {
    setStatus("");
    try { setAvailable(Boolean(loadDraft(owner, scope))); }
    catch { setStatus("无法读取本机草稿，请检查浏览器存储。"); }
  }, [owner, scope]);
  return <section aria-label="本机草稿">
    <Button type="button" disabled={!owner} onClick={() => {
      try { saveDraft(owner, scope, value); setSavedValue(serialized); setAvailable(true); setStatus("草稿已保存到此浏览器，仅当前账号可恢复。"); }
      catch (error) { setStatus(error instanceof Error ? error.message : "草稿尚未保存。"); }
    }}>保存本机草稿</Button>
    {available && <Button type="button" onClick={() => {
      try {
        const saved = loadDraft<T>(owner, scope);
        if (saved) { onRestore(saved.value); setStatus("已恢复本机草稿，请重新检查后预览；不会自动发送。"); }
      } catch { setStatus("无法读取本机草稿。"); }
    }}>恢复本机草稿</Button>}
    {status && <p role="status">{status.startsWith("草稿已保存") && savedValue !== serialized ? "当前修改尚未保存到浏览器。" : status}</p>}
  </section>;
}
