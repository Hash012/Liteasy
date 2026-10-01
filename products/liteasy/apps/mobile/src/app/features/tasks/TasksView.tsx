import { useEffect, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Select, Spinner } from "@fluentui/react-components";
import type { LibraryItem } from "../library/library.types";
import type { RemoteTask, TaskKind, TaskSnapshot } from "./taskClient";

const labels: Record<TaskKind, string> = { "open-document": "在桌面打开文献", "extract-text": "提取文献正文", "summarize-document": "生成文献摘要", "sync-library": "同步桌面资料库" };
const states: Record<string, string> = { "pending-send": "待发送", queued: "等待桌面领取", leased: "桌面正在准备", "waiting-input": "等待桌面同步附件", running: "正在执行", uncertain: "执行结果待确认", succeeded: "已完成", failed: "失败", cancelled: "已取消" };
const errors: Record<string, string> = { desktop_lease_expired: "桌面未能及时领取任务。", desktop_completion_unknown: "桌面尚未确认最终结果。", task_expired: "任务等待超过一天，已停止排队。", document_not_ready: "桌面还没有此版本的附件，请先同步。" };
export type TaskControls = { snapshot: TaskSnapshot; available: boolean; error: string; busy: boolean;
  loadResult: (task: RemoteTask) => Promise<RemoteTask>;
  pair: (code: string) => Promise<void>; unpair: (id: string) => Promise<void>; cancel: (task: RemoteTask) => Promise<void>; retry: () => Promise<void>; enqueue: (desktopId: string, kind: TaskKind, item?: LibraryItem) => Promise<void> };
export function TasksView({ controls, items }: { controls: TaskControls; items: LibraryItem[] }) {
  const [code, setCode] = useState(""); const [deviceId, setDeviceId] = useState(""); const [kind, setKind] = useState<TaskKind>("open-document");
  const [documentId, setDocumentId] = useState(""); const [unpair, setUnpair] = useState<string>();
  const [result, setResult] = useState<RemoteTask>();
  const device = controls.snapshot.devices.find((value) => value.deviceId === deviceId);
  const item = items.find((value) => value.id === documentId && !value.deletedAt && value.kind === "pdf");
  const outboxIds = new Set(controls.snapshot.outbox.map((value) => value.operationId));
  const tasks = [...controls.snapshot.outbox, ...controls.snapshot.tasks.filter((value) => !outboxIds.has(value.operationId))];
  return <section className="tasks-view"><h1>桌面任务</h1>
    {!controls.available ? <p>请登录账号并切换到账号资料库，再配对桌面设备。</p> : <>
      <p>在桌面版的设备设置中生成配对码。两端需登录同一账号。</p>
      <div className="task-pair"><Field label="8 位配对码"><Input inputMode="numeric" maxLength={8} value={code} onChange={(_, data) => setCode(data.value.replace(/\D/g, ""))} /></Field>
        <Button disabled={controls.busy || code.length !== 8} onClick={() => void controls.pair(code)}>配对桌面</Button></div>
      <h2>已配对设备</h2><ul>{controls.snapshot.devices.map((value) => <li key={value.deviceId}>{value.name} · {value.online ? "在线" : "离线，可排队"}
        <Button onClick={() => setUnpair(controls.snapshot.pairs.find((pair) => pair.desktopId === value.deviceId)?.pairId)}>解除配对</Button></li>)}</ul>
      {unpair ? <p>解除配对会取消尚未执行的任务。<Button disabled={controls.busy} onClick={() => { const id = unpair; setUnpair(undefined); void controls.unpair(id); }}>确认解除</Button><Button onClick={() => setUnpair(undefined)}>保留配对</Button></p> : null}
      <div className="task-create"><Field label="目标桌面"><Select value={deviceId} onChange={(_, data) => setDeviceId(data.value)}><option value="">选择设备</option>{controls.snapshot.devices.map((value) => <option key={value.deviceId} value={value.deviceId}>{value.name}</option>)}</Select></Field>
        <Field label="任务"><Select value={kind} onChange={(_, data) => setKind(data.value as TaskKind)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value} disabled={!device?.capabilities.includes(value as TaskKind)}>{label}</option>)}</Select></Field>
        {kind !== "sync-library" ? <Field label="文献"><Select value={documentId} onChange={(_, data) => setDocumentId(data.value)}><option value="">选择文献</option>{items.filter((value) => value.kind === "pdf" && !value.deletedAt).map((value) => <option key={value.id} value={value.id}>{value.title}</option>)}</Select></Field> : null}
        <p>文献任务需要桌面拥有同一版本的附件。先通过文件同步传输；附件未到达时任务会等待。</p>
        <Button appearance="primary" disabled={controls.busy || !device || !device.capabilities.includes(kind) || (kind !== "sync-library" && !item)} onClick={() => void controls.enqueue(deviceId, kind, item)}>发送任务</Button>
      </div>
      <Button disabled={controls.busy} onClick={() => void controls.retry()}>重试待发送任务</Button>
    </>}
    {controls.error || controls.snapshot.error ? <p role="alert">{controls.error || controls.snapshot.error}</p> : null}
    <h2>任务记录</h2><ul className="task-list">{tasks.map((task) => <li key={task.operationId}><strong>{labels[task.kind]}{task.document ? ` · ${task.document.title}` : ""}</strong>
      <p>{states[task.status] ?? "状态待确认"}{task.cancelRequested ? " · 已请求取消" : ""}{task.progress !== undefined ? ` · ${task.progress}%` : ""}</p>
      {task.status === "uncertain" ? <p>桌面未能确认结果，请检查桌面上的任务记录后再决定是否重新发送。</p> : null}
      {task.error ? <p>{errors[task.error] ?? (/^[a-z_]+$/.test(task.error) ? "任务暂时无法完成，请检查桌面状态。" : task.error)}</p> : null}{task.result?.message ? <p>{task.result.message}</p> : null}
      {task.result?.hasText || task.result?.text ? <Button onClick={() => setResult(task)}>查看结果</Button> : null}
      {!["succeeded", "failed", "cancelled"].includes(task.status) && !task.cancelRequested ? <Button disabled={controls.busy} onClick={() => void controls.cancel(task)}>取消任务</Button> : null}
    </li>)}</ul>
    {result ? <TaskResult key={result.taskId} task={result} load={controls.loadResult} onClose={() => setResult(undefined)} /> : null}
  </section>;
}

function TaskResult({ task, load, onClose }: { task: RemoteTask; load: TaskControls["loadResult"]; onClose: () => void }) {
  const [value, setValue] = useState<RemoteTask>(); const [error, setError] = useState("");
  useEffect(() => { let active = true; void load(task).then((result) => { if (active) setValue(result); }).catch(() => { if (active) setError("结果暂时无法读取，请连接网络后重试。"); }); return () => { active = false; }; }, [task.taskId, task.updatedAt]);
  return <Dialog open onOpenChange={(_, data) => { if (!data.open) onClose(); }}><DialogSurface><DialogBody><DialogTitle>{labels[task.kind]}结果</DialogTitle>
    <DialogContent>{error ? <p role="alert">{error}</p> : !value ? <Spinner label="正在读取结果…" /> : <><p>{value.result?.message}</p><div className="task-result">{value.result?.text}</div></>}</DialogContent>
    <DialogActions><Button onClick={onClose}>关闭结果</Button></DialogActions>
  </DialogBody></DialogSurface></Dialog>;
}
