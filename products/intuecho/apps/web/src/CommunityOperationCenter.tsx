import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { useEffect, useRef, useState } from "react";
import { communityApi } from "./communityApi";
import { CommunityRequestError, recoverCommand } from "./communityCommands";
import { commandRecords, communityStorageChanged, communityStorageUsage, exportCommunityRecords, quarantinedRecords, readCommand, type CommandRecord } from "./communityPersistence";

const labels: Record<CommandRecord["state"], string> = {
  prepared: "待发送：尚未查到提交回执", outcome_unknown: "结果待核实", committed: "已提交", rejected: "未提交：需要处理后重试"
};
const unavailable = "当前内容不可访问，可能已撤回或访问权限已变化。原操作记录仍保留。";
export function CommunityOperationCenter({ owner, accountName, onRestoreOperation, onOpenResult }: {
  owner: string;
  accountName: string;
  onRestoreOperation?: (record: CommandRecord) => void | Promise<void>;
  onOpenResult?: (annotationId: string, replyId?: string) => void;
}) {
  const [records, setRecords] = useState<CommandRecord[]>([]);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState("");
  const [restore, setRestore] = useState<CommandRecord>();
  const [conflict, setConflict] = useState<CommandRecord>();
  const [exportOpen, setExportOpen] = useState(false);
  const [quarantinedCount, setQuarantinedCount] = useState(0);
  const [usage, setUsage] = useState({ bytes: 0, approachingCapacity: false, archivedCount: 0 });
  const activeOwner = useRef(owner);
  const mounted = useRef(true);
  activeOwner.current = owner;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const isCurrent = () => mounted.current && activeOwner.current === owner;
  useEffect(() => {
    setStatus(""); setPending(""); setRestore(undefined); setConflict(undefined); setExportOpen(false);
    const refresh = () => {
      try {
        setRecords(commandRecords(owner));
        setQuarantinedCount(quarantinedRecords(owner).length);
        setUsage(communityStorageUsage(owner));
      } catch { setStatus("无法读取本机操作记录，请检查浏览器存储。"); setRecords([]); }
    };
    refresh();
    window.addEventListener(communityStorageChanged, refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(communityStorageChanged, refresh); window.removeEventListener("storage", refresh); };
  }, [owner]);
  function reportError(error: unknown) {
    if (!isCurrent()) return;
    setStatus(error instanceof CommunityRequestError && [401, 403, 404].includes(error.status) ? unavailable : error instanceof Error ? error.message : "暂时无法核实，请稍后重试。");
  }
  async function check(record: CommandRecord) {
    setPending(record.operationId); setStatus("");
    try {
      const result = await recoverCommand(owner, record, communityApi.lookupCommand);
      if (!isCurrent()) return;
      setStatus(result.status === "not_found" ? "尚未查到回执。可打开原草稿，检查后使用同一操作再次发送。核实不会发送内容。" : result.available === false ? "已核实提交；当前来源不可访问，不显示历史正文。" : "已核实提交。当前可见范围、撤回与访问权限仍以来源为准。");
    } catch (error) { reportError(error); }
    finally { if (isCurrent()) setPending(""); }
  }
  async function openResult(record: CommandRecord) {
    setPending(record.operationId); setStatus("");
    try {
      // Local receipts are navigation hints, never an authorization or content cache.
      const current = readCommand(owner, record.operationType, record.operationId);
      if (!current) throw new Error("原操作记录不可用，请保留此浏览器中的记录并核实。");
      const lookup = await recoverCommand(owner, current, communityApi.lookupCommand);
      if (!isCurrent()) return;
      if (lookup.status !== "committed" || !lookup.available) { setStatus(unavailable); return; }
      const annotationId = record.operationType === "create_reply" ? record.targetId : lookup.receipt.resourceId;
      if (!annotationId) { setStatus(unavailable); return; }
      const { annotation } = await communityApi.annotation(annotationId);
      if (!isCurrent()) return;
      if (annotation.withdrawnAt) { setStatus(unavailable); return; }
      const replyId = record.operationType === "create_reply" ? lookup.receipt.resourceId : undefined;
      if (replyId) {
        const { replies } = await communityApi.replies(annotationId);
        if (!isCurrent()) return;
        if (!replies.some((reply) => reply.id === replyId)) { setStatus(unavailable); return; }
      }
      onOpenResult?.(annotationId, replyId);
    } catch (error) { reportError(error); }
    finally { if (isCurrent()) setPending(""); }
  }
  async function restoreOriginal() {
    if (!restore) return;
    setPending(restore.operationId); setStatus("");
    try {
      const current = readCommand(owner, restore.operationType, restore.operationId);
      if (!current?.payload) throw new Error("原稿暂不可恢复；请保留原记录，不要为同一操作创建新的发送编号。");
      await onRestoreOperation?.(current);
      if (isCurrent()) setRestore(undefined);
    } catch (error) { reportError(error); }
    finally { if (isCurrent()) setPending(""); }
  }
  function exportLocalRecords() {
    try {
      const url = URL.createObjectURL(new Blob([exportCommunityRecords(owner)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = "intuecho-local-recovery.json"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setExportOpen(false);
      setStatus("已导出本机恢复记录；请妥善保存，其中可能包含私人草稿。");
    } catch (error) { reportError(error); }
  }
  return <section className="single-column" aria-label="空间与操作中心">
    <div className="page-heading"><span>{accountName} · Intuecho</span><h1>空间与操作</h1></div>
    <p>本机草稿保存在此浏览器。个人云、组织资料和 Intuecho 发布分别保存；登录不会自动上传。</p>
    <p>公开内容即使不加入广场仍对所有人可见。通知已读仅表示你已查看，不表示任务完成或内容已发布。</p>
    <p>这里只显示当前账号在此浏览器的社区操作记录。取消窗口不会撤回已经提交的内容。</p>
    <div className="operation-storage-summary"><span>本机恢复记录约 {Math.ceil(usage.bytes / 1024)} KB · 已归档回执 {usage.archivedCount} 项</span><Button onClick={() => setExportOpen(true)}>导出本机恢复记录</Button></div>
    {usage.approachingCapacity && <p role="alert">本机恢复记录接近容量上限，请先导出备份。未完成操作和草稿不会自动删除。</p>}
    {quarantinedCount > 0 && <p role="alert">已隔离 {quarantinedCount} 项损坏记录，原始数据仍保留，可随恢复记录导出。其他健康记录可继续使用。</p>}
    {!records.length && <p>暂无社区发送记录。</p>}
    {records.map((record) => <article className="annotation-card" key={record.operationId}>
      <strong>{record.operationType === "create_reply" ? "回复" : "批注或读书包"} · {labels[record.state]}</strong>
      <details className="operation-identifier"><summary>操作标识</summary><code>{record.operationId}</code></details>
      <div className="operation-actions">
        {(record.state === "outcome_unknown" || record.state === "prepared") && <Button disabled={Boolean(pending)} onClick={() => void check(record)}>{pending === record.operationId ? "正在核实" : "核实原操作（只读）"}</Button>}
        {record.payload && onRestoreOperation && <Button disabled={Boolean(pending)} onClick={() => setRestore(record)}>打开原稿</Button>}
        {record.state === "committed" && onOpenResult && <Button disabled={Boolean(pending)} onClick={() => void openResult(record)}>打开已创建内容</Button>}
        {record.state === "rejected" && <Button disabled={Boolean(pending)} onClick={() => setConflict(record)}>查看冲突详情</Button>}
      </div>
    </article>)}
    {status && <p role="status">{status}</p>}
    <Dialog open={Boolean(restore)} onOpenChange={(_, data) => { if (!data.open && !pending) setRestore(undefined); }}><DialogSurface><DialogBody>
      <DialogTitle>恢复原稿</DialogTitle><DialogContent>将恢复当前账号保存的原始发送意图。打开不会发送；尚未确定结果的操作保持原编号和冻结内容，需先核实再显式重试。</DialogContent>
      <DialogActions><Button disabled={Boolean(pending)} onClick={() => setRestore(undefined)}>取消</Button><Button appearance="primary" disabled={Boolean(pending)} onClick={() => void restoreOriginal()}>确认恢复原稿</Button></DialogActions>
    </DialogBody></DialogSurface></Dialog>
    <Dialog open={Boolean(conflict)} onOpenChange={(_, data) => !data.open && setConflict(undefined)}><DialogSurface><DialogBody>
      <DialogTitle>原操作需要处理</DialogTitle><DialogContent>这次发送没有确认成功。原始意图和草稿已保留；请恢复原稿查看发送前提或核对当前来源。不会用缓存正文代替最新内容。</DialogContent>
      <DialogActions><Button onClick={() => setConflict(undefined)}>关闭</Button>{conflict?.payload && onRestoreOperation && <Button onClick={() => { setRestore(conflict); setConflict(undefined); }}>打开原稿</Button>}{conflict && <Button onClick={() => { void check(conflict); setConflict(undefined); }}>核实原操作（只读）</Button>}</DialogActions>
    </DialogBody></DialogSurface></Dialog>
    <Dialog open={exportOpen} onOpenChange={(_, data) => setExportOpen(data.open)}><DialogSurface><DialogBody>
      <DialogTitle>导出本机恢复记录</DialogTitle><DialogContent>导出文件可能包含私人草稿和损坏记录的原始内容。只保存到你信任的位置，不会上传到服务器。</DialogContent>
      <DialogActions><Button onClick={() => setExportOpen(false)}>取消</Button><Button appearance="primary" onClick={exportLocalRecords}>确认导出</Button></DialogActions>
    </DialogBody></DialogSurface></Dialog>
  </section>;
}
