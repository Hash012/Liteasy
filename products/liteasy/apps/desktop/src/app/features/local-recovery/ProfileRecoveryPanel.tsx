import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import { ArrowCounterclockwiseRegular, SaveRegular } from "@fluentui/react-icons";
import { displayPath } from "../resource-filesystem/displayPath";
import { createLocalRecoveryService, isLocalRecoveryAvailable, type LocalRecoveryService, type RecoveryPreview, type RecoveryReceipt } from "./localRecoveryService";

export function ProfileRecoveryPanel({ scopeId, service }: { scopeId: string; service?: LocalRecoveryService }) {
  const currentScope = useRef(scopeId); currentScope.current = scopeId;
  const api = useMemo(() => service ?? createLocalRecoveryService(scopeId, () => currentScope.current), [scopeId, service]);
  const generation = useRef(0), working = useRef(false), pending = useRef<RecoveryPreview | null>(null);
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [receipt, setReceipt] = useState<RecoveryReceipt | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    ++generation.current; working.current = false; pending.current = null;
    setPreview(null); setReceipt(null); setBusy(false); setError("");
    return () => { ++generation.current; if (pending.current) void api.cancel(pending.current.planId).catch(() => undefined); pending.current = null; };
  }, [scopeId, api]);
  const active = (revision: number) => generation.current === revision && currentScope.current === scopeId;
  async function perform(work: (revision: number) => Promise<void>) {
    if (working.current) return;
    const revision = generation.current; working.current = true; setBusy(true); setError("");
    try { await work(revision); } catch (failure) { if (active(revision)) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (active(revision)) { working.current = false; setBusy(false); } }
  }
  function prepare(kind: "backup" | "restore") {
    void perform(async (revision) => {
      setReceipt(null);
      const result = await api.prepare(kind);
      if (!active(revision)) { if (result) await api.cancel(result.planId); return; }
      pending.current = result; setPreview(result);
    });
  }
  if (!service && !isLocalRecoveryAvailable()) return null;
  return <section aria-label="隔离配置恢复" className="library-location-panel">
    <h3>本地配置备份与恢复演练</h3>
    <p>备份当前分区的文献、对象笔记、批注、关联、白板和任务回执。恢复到新的隔离配置，可离线继续阅读与编辑。</p>
    <p>不携带登录凭据、插件授权和外部目录访问权。已关联的外部笔记复制为新配置拥有的文件；缺失或不支持的附件会阻止备份。</p>
    <Button icon={<SaveRegular />} disabled={busy || Boolean(preview)} onClick={() => prepare("backup")}>预览本地恢复备份</Button>
    <Button icon={<ArrowCounterclockwiseRegular />} disabled={busy || Boolean(preview)} onClick={() => prepare("restore")}>校验并恢复隔离配置</Button>
    {preview ? <div aria-label="隔离恢复预览">
      <p>{preview.restored ? "恢复" : "备份"} {preview.fileCount} 个文件 · {(preview.totalBytes / 1024 / 1024).toFixed(2)} MiB</p>
      <p>新目录：{displayPath(preview.targetPath)}</p>
      <p>不包含：{preview.exclusions.join("、")}。</p>
      <Button appearance="primary" disabled={busy} onClick={() => void perform(async (revision) => {
        const planId = preview.planId; pending.current = null; setPreview(null);
        const result = await api.commit(planId); if (active(revision)) setReceipt(result);
      })}>确认创建新配置副本</Button>
      <Button disabled={busy} onClick={() => void perform(async (revision) => { await api.cancel(preview.planId); if (active(revision)) { pending.current = null; setPreview(null); } })}>取消恢复预览</Button>
    </div> : null}
    {busy ? <p role="status">正在校验和保存本地资料。</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {receipt ? <div aria-label="隔离恢复回执">
      <p role="status">{receipt.restored ? "隔离配置已恢复" : "本地恢复备份已保存"}：{displayPath(receipt.path)}</p>
      {receipt.restored ? <Button disabled={busy} onClick={() => void perform(async () => api.openProfile(receipt.receiptId))}>打开隔离恢复配置</Button> : null}
      <p>原配置保留。恢复窗口使用独立浏览器数据和本地资料，不登录账号或执行联网任务。</p>
    </div> : null}
  </section>;
}
