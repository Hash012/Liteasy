import { Button } from "@fluentui/react-components";
import { useEffect, useRef, useState } from "react";
import { getIdentitySessionGeneration } from "./identityClient";

export function RevisionConflict({ baseRevision, loadCurrent, onUseRevision }: {
  baseRevision: number;
  loadCurrent: () => Promise<{ body: string; revision: number }>;
  onUseRevision: (revision: number) => void;
}) {
  const [latest, setLatest] = useState<{ body: string; revision: number }>();
  const [status, setStatus] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function inspect() {
    const generation = getIdentitySessionGeneration();
    setLatest(undefined); setStatus("");
    try {
      const current = await loadCurrent();
      if (mounted.current && generation === getIdentitySessionGeneration()) setLatest(current);
    } catch { if (mounted.current && generation === getIdentitySessionGeneration()) setStatus("无法读取最新内容，请确认当前权限或稍后重试。你的草稿仍保留。"); }
  }
  return <section aria-label="修订冲突">
    <p>你的修改基于修订 {baseRevision}，编辑框中的草稿已保留。</p>
    <Button type="button" onClick={() => void inspect()}>核对最新版本（保留我的草稿）</Button>
    {latest && <><p>服务器当前修订 {latest.revision}</p><blockquote>{latest.body}</blockquote>
      <Button type="button" onClick={() => onUseRevision(latest.revision)}>以当前修订继续编辑我的草稿</Button></>}
    {status && <p role="status">{status}</p>}
  </section>;
}
