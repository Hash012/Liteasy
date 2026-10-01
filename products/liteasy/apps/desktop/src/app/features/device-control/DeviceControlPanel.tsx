import { createContext, useContext, useEffect, useState } from "react";
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Spinner } from "@fluentui/react-components";
import { taskKindLabels, taskStatusLabels, type DeviceJournal, type DeviceSnapshot, type DeviceTask } from "./deviceControl.types";

export type DeviceControlModel = { available: boolean; journal: DeviceJournal; snapshot: DeviceSnapshot; error: string; busy: boolean;
  code?: { code: string; expiresAt: number }; configure: (enabled: boolean, summary: boolean, name: string) => Promise<void>;
  pair: () => Promise<void>; unpair: (id: string) => Promise<void>; refresh: () => Promise<void>; loadResult: (task: DeviceTask) => Promise<DeviceTask> };
export const DeviceControlContext = createContext<DeviceControlModel | null>(null);
export function DeviceControlPanel() {
  const model = useContext(DeviceControlContext); const [name, setName] = useState(""); const [unpair, setUnpair] = useState<string>();
  const [resultId, setResultId] = useState<string>();
  const resultTask = model?.snapshot.tasks.find((task) => task.taskId === resultId);
  useEffect(() => { setName(model?.journal.name ?? "Liteasy 桌面"); }, [model?.journal.name]);
  const [, clock] = useState(0);
  useEffect(() => { const timer = setInterval(() => clock((value) => value + 1), 10_000); return () => clearInterval(timer); }, []);
  if (!model?.available) return <p>{model?.error || "登录账号后，可与同一账号的手机配对。"}</p>;
  return <div className="device-control-panel">
    <p>开启后，已配对的手机可以请求打开文献、提取文字和同步资料库。桌面需保持运行；关闭后暂停领取新任务。</p>
    <Checkbox label="允许已配对手机发送任务" checked={model.journal.enabled} disabled={model.busy} onChange={(_, data) => void model.configure(data.checked === true, model.journal.allowSummary, name)} />
    <Checkbox label="允许手机发起摘要（使用当前模型，可能产生费用）" checked={model.journal.allowSummary} disabled={model.busy} onChange={(_, data) => void model.configure(model.journal.enabled, data.checked === true, name)} />
    <Field label="此桌面的名称"><Input maxLength={100} value={name} onChange={(_, data) => setName(data.value)} /></Field>
    <Button disabled={model.busy || !name.trim()} onClick={() => void model.configure(model.journal.enabled, model.journal.allowSummary, name)}>保存设备名称</Button>
    <Button disabled={model.busy || !model.journal.enabled} onClick={() => void model.pair()}>生成手机配对码</Button>
    {model.code ? <p>{model.code.expiresAt > Date.now() ? <>配对码：<strong>{model.code.code}</strong> · 有效至 {new Date(model.code.expiresAt).toLocaleTimeString()}</> : "配对码已过期，请重新生成。"}</p> : null}
    {model.error ? <p role="alert">{model.error}</p> : null}
    <h3>已配对手机</h3><ul>{model.snapshot.devices.map((device) => <li key={device.deviceId}>{device.name}
      <Button onClick={() => setUnpair(model.snapshot.pairs.find((pair) => pair.mobileId === device.deviceId)?.pairId)}>解除配对</Button></li>)}</ul>
    {unpair ? <p>解除后将取消尚未执行的任务。<Button onClick={() => { void model.unpair(unpair); setUnpair(undefined); }}>确认解除配对</Button><Button onClick={() => setUnpair(undefined)}>保留</Button></p> : null}
    <h3>手机任务记录</h3><Button onClick={() => void model.refresh()} disabled={model.busy}>刷新任务</Button>
    <ul>{model.snapshot.tasks.map((task) => <li key={task.taskId}>{taskKindLabels[task.kind]} · {task.document?.title} · {taskStatusLabels[task.status] ?? "状态待确认"}
      {task.result?.message ? <p>{task.result.message}</p> : null}
      {task.result?.text || task.result?.hasText ? <Button onClick={() => setResultId(task.taskId)}>查看结果</Button> : null}
      {task.status === "uncertain" ? <p>请核查实际结果；系统不会自动重跑此任务。</p> : null}</li>)}</ul>
    {resultTask ? <DeviceTaskResult key={resultTask.taskId} task={resultTask} load={model.loadResult} onClose={() => setResultId(undefined)} /> : null}
  </div>;
}

function DeviceTaskResult({ task, load, onClose }: { task: DeviceTask; load: DeviceControlModel["loadResult"]; onClose: () => void }) {
  const [value, setValue] = useState<DeviceTask>(); const [error, setError] = useState("");
  useEffect(() => { let active = true; void load(task).then((result) => { if (active) setValue(result); }).catch(() => { if (active) setError("结果暂时无法读取，请稍后重试。"); }); return () => { active = false; }; }, [task.taskId]);
  return <Dialog open onOpenChange={(_, data) => { if (!data.open) onClose(); }}><DialogSurface><DialogBody><DialogTitle>手机任务结果</DialogTitle><DialogContent>
    {error ? <p role="alert">{error}</p> : value ? <><p>{value.result?.message}</p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{value.result?.text}</pre></> : <Spinner label="正在读取结果…" />}
  </DialogContent><DialogActions><Button onClick={onClose}>关闭结果</Button></DialogActions></DialogBody></DialogSurface></Dialog>;
}
