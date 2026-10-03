import { Button } from "@fluentui/react-components";
import { useEffect, useRef, useState } from "react";
import { communityApi } from "./communityApi";
import { recoverCommand } from "./communityCommands";
import { commandRecords, communityStorageChanged, type CommandRecord } from "./communityPersistence";

const labels: Record<CommandRecord["state"], string> = {
  prepared: "待发送：尚未查到提交回执", outcome_unknown: "结果待核实", committed: "已提交", rejected: "未提交：需要处理后重试"
};
export function CommunityOperationCenter({ owner, accountName }: { owner: string; accountName: string }) {
  const [records, setRecords] = useState<CommandRecord[]>([]);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState("");
  const activeOwner = useRef(owner);
  activeOwner.current = owner;
  useEffect(() => {
    setStatus(""); setPending("");
    const refresh = () => {
      try { setRecords(commandRecords(owner)); }
      catch { setStatus("无法读取本机操作记录，请检查浏览器存储。"); setRecords([]); }
    };
    refresh();
    window.addEventListener(communityStorageChanged, refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(communityStorageChanged, refresh); window.removeEventListener("storage", refresh); };
  }, [owner]);
  async function check(record: CommandRecord) {
    setPending(record.operationId); setStatus("");
    try {
      const result = await recoverCommand(owner, record, communityApi.lookupCommand);
      if (activeOwner.current !== owner) return;
      setStatus(result.status === "not_found" ? "尚未查到回执。可打开原草稿，检查后使用同一操作再次发送。核实不会发送内容。" : result.available === false ? "已核实提交；当前来源不可访问，不显示历史正文。" : "已核实提交。当前可见范围、撤回与访问权限仍以来源为准。");
    } catch (error) { if (activeOwner.current === owner) setStatus(error instanceof Error ? error.message : "暂时无法核实，请稍后重试。"); }
    finally { if (activeOwner.current === owner) setPending(""); }
  }
  return <section className="single-column" aria-label="空间与操作中心">
    <div className="page-heading"><span>{accountName} · Intuecho</span><h1>空间与操作</h1></div>
    <p>本机草稿保存在此浏览器。个人云、组织资料和 Intuecho 发布分别保存；登录不会自动上传。</p>
    <p>公开内容即使不加入广场仍对所有人可见。通知已读仅表示你已查看，不表示任务完成或内容已发布。</p>
    <p>这里只显示当前账号在此浏览器的社区操作记录。取消窗口不会撤回已经提交的内容。</p>
    {!records.length && <p>暂无社区发送记录。</p>}
    {records.map((record) => <article className="annotation-card" key={record.operationId}>
      <strong>{record.operationType === "create_reply" ? "回复" : "批注或读书包"} · {labels[record.state]}</strong>
      <p>操作 {record.operationId}</p>
      {(record.state === "outcome_unknown" || record.state === "prepared") && <Button disabled={Boolean(pending)} onClick={() => void check(record)}>{pending === record.operationId ? "正在核实" : "核实原操作（只读）"}</Button>}
    </article>)}
    {status && <p role="status">{status}</p>}
  </section>;
}
